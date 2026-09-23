// Practice operations: the register, the timesheet, and payment certificates.
//
// Deliberately not part of web/v2. That is the drawing app, and the drawing
// app is one activity that logs time against a job rather than the product.
// What these three screens replace is a spreadsheet the whole firm is run
// from, so the rules that matter are the ones about money: captured value is
// never edited, a write-down carries a reason, and a gap in the data is shown
// rather than filled in with a plausible zero.

import { ApiError, api } from "./api.js";
import { drawPreview } from "./preview.js";

const state = {
  session: null,
  reference: null,
  projects: [],
  // Three destinations, plus the new-job composer. `selectedId` is the job
  // the workspace is pointed at and survives a trip to Practice or Register,
  // so coming back lands where you left rather than on whatever sorts first.
  view: "practice",
  selectedId: null,
  registerFilter: "all",
  registerQuery: "",
  registerSort: "risk",
  registerAsc: false,
  switcher: null,
  recentIds: [],
  phases: null,
  phasePicker: false,
  // Outlines, keyed by project id, for every job that has a drawing. Loaded
  // once for the practice page and reused by the job header.
  previews: null,
  tab: "overview",
  entries: [],
  certificates: [],
  openCertificate: null,
  feeSchedule: null,
  tasks: [],
  monthEntries: [],
  signUpMode: false,
  returnView: null,
  newJob: null,
};

const el = (id) => document.getElementById(id);

// --- formatting -------------------------------------------------------------

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

/** An em dash, not "R 0.00". A figure nobody has entered is not a zero. */
function money(value) {
  if (value === null || value === undefined) return "&mdash;";
  const [whole, cents] = Math.abs(value).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009");
  return `${value < 0 ? "-" : ""}R\u2009${grouped}.${cents}`;
}

/** Subtracting two money figures in binary floating point leaves a tail. */
const cents = (value) => Math.round(value * 100) / 100;

function percent(value) {
  if (value === null || value === undefined) return "&mdash;";
  return `${Math.round(value * 1000) / 10}%`;
}

function duration(minutes) {
  if (!minutes) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

const realisationClass = (value) => {
  if (value === null || value === undefined) return "flat";
  if (value >= 0.9) return "good";
  if (value >= 0.7) return "mid";
  return "bad";
};

const burnClass = (value) => {
  if (value === null || value === undefined) return "ok";
  if (value >= 1) return "over";
  if (value >= 0.8) return "warn";
  return "ok";
};

/**
 * A preview of what the row about to be saved is worth. The server re-prices
 * every entry from the same ladder and its answer is the one that is stored;
 * this exists so the number appears while somebody is still typing, which is
 * the only moment the warning can change what they do.
 */
function previewAmount(minutes, rule, hourlyRate) {
  if (!Number.isInteger(minutes) || minutes < 0) return null;
  if (rule === "linear_32") return minutes * 32;
  if (rule === "band_hourly") {
    return hourlyRate ? Math.round((minutes / 60) * hourlyRate * 100) / 100 : null;
  }
  return Math.ceil(minutes / 15) * 480;
}

function minutesBetween(start, end) {
  const clock = (value) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    return hours > 23 || mins > 59 ? null : hours * 60 + mins;
  };
  const from = clock(start);
  const to = clock(end);
  if (from === null || to === null || to < from) return null;
  return to - from;
}

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;

function toast(message, bad = false) {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = bad ? "toast bad" : "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), bad ? 6000 : 3000);
}

/** Every mutation goes through here, so a rejected write always says why. */
async function attempt(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) toast(error.message, true);
    else toast("Something went wrong", true);
    return null;
  }
}

// --- warnings ---------------------------------------------------------------

/**
 * Derived from the stored numbers, never typed by anybody. Each of these has
 * a real example behind it in the source workbook, which is why they are the
 * starting set: D063 ran to 142% of its fee and was never certified once;
 * P074's July certificate carries a 20% discount with no reason recorded.
 */
function warningsFor(project) {
  const money_ = project.financials;
  const out = [];
  const type = state.reference?.projectTypes.find((t) => t.code === project.typeCode);

  if (money_.quoted && money_.captured > money_.quoted) {
    out.push({
      level: "high",
      title: `Captured value is ${percent(money_.burn)} of the quoted fee`,
      body: `${money(money_.captured)} of time against a quote of ${money(money_.quoted)}. `
        + "Unrecoverable unless the fee is renegotiated; what cannot be billed becomes a "
        + "write-down on a certificate, with a reason.",
    });
  }
  if (money_.captured > 0 && money_.certifiedGross === 0) {
    out.push({
      level: money_.draftGross > 0 ? "med" : "high",
      title: "Time captured, nothing certified",
      body: money_.draftGross > 0
        ? `${money(money_.draftGross)} sits on a draft certificate that has not gone out.`
        : `${money(money_.captured)} of work has been done and no certificate exists.`,
    });
  }
  if (money_.certifiedGross > 0 && money_.uncertifiedCaptured > 0) {
    out.push({
      level: "med",
      title: "Captured time never reached a certificate",
      body: `${money(money_.uncertifiedCaptured)} of time carries no certificate line. `
        + "In the workbook this was invisible, because each invoice was compiled by hand "
        + "from whichever rows were noticed.",
    });
  }
  if (money_.brokenRows > 0) {
    out.push({
      level: "med",
      title: `${money_.brokenRows} timesheet row${money_.brokenRows === 1 ? "" : "s"} cannot be priced`,
      body: "No end time, or hours logged and priced at nothing. Counted rather than hidden, "
        + "because each one is captured value the job will never show.",
    });
  }
  if (money_.unexplainedWrittenDown > 0) {
    out.push({
      level: "high",
      title: "A write-down with no reason recorded",
      body: `${money(money_.unexplainedWrittenDown)} was given up and nobody can say why. `
        + "Imported from the workbook; new write-downs require a reason.",
    });
  }
  // D063 is the real example: a register budget of R120 000 against a template
  // totalling R54 445.80. Whichever is wrong, somebody quoted one of them.
  if (money_.quotedSource === "fee_schedule" && money_.budgetEstimate !== null
    && Math.abs(money_.budgetEstimate - money_.quoted) >= 1) {
    out.push({
      level: "med",
      title: "The fee schedule and the register budget disagree",
      body: `The schedule adds up to ${money(money_.quoted)}; the register records
        ${money(money_.budgetEstimate)}. Burn is measured against the schedule, because it is
        the breakdown that was agreed &mdash; but one of these two numbers was quoted to
        somebody and the other was not.`,
    });
  }
  if (project.billingBasis === "fixed_fee" && money_.quoted === null) {
    out.push({
      level: "med",
      title: "Fixed fee with no quoted figure",
      body: "Neither a fee schedule nor a budget estimate. Burn cannot be reported against a "
        + "quote that does not exist, so this job is invisible to every overrun warning "
        + "until one of the two is entered.",
    });
  }
  if (type?.isPlaceholder) {
    out.push({
      level: "low",
      title: `${type.name} has no fee template yet`,
      body: "The type is registered and everything here works, but there are no pre-built "
        + "tasks or phase splits behind it. Certificate lines are entered by hand.",
    });
  }
  if (project.status === "halted" || project.status === "on_hold") {
    out.push({
      level: "med",
      title: project.status === "halted" ? "Halted" : "On hold",
      body: "Time logged against a job in this state should be deliberate.",
    });
  }
  return out;
}

const warningsHtml = (warnings) => (warnings.length
  ? `<div class="warn-list">${warnings.map((w) => `
      <div class="w ${esc(w.level)}">
        <span class="sev">${w.level === "high" ? "Act" : w.level === "med" ? "Watch" : "Note"}</span>
        <b>${esc(w.title)}</b>
        <p>${w.body}</p>
      </div>`).join("")}</div>`
  : `<div class="empty">Nothing to flag. Quoted, captured and certified all agree.</div>`);

// --- the register list ------------------------------------------------------

/**
 * Risk order: what is going wrong, not what was touched last. A list in date
 * order answers "what did I open yesterday", which nobody needs a register to
 * tell them; the question this screen exists for is which job is losing
 * money, and that job is rarely the most recent one.
 *
 * Four bands, and a job can only be in one:
 *
 *   0  past its fee - the loudest thing the numbers can say, worst first
 *   1  billed something, so realisation is real, worst first
 *   2  spending against a fee with nothing certified yet, deepest first
 *   3  nothing to say yet: no time, or no fee to measure it against
 *
 * Band 3 is last and stays in date order, because there is no honest way to
 * rank jobs that have not told us anything.
 *
 * This is the register's default sort and no longer the order of a permanent
 * navigation element. A list that reorders itself as work happens cannot be
 * navigated from memory, which is why it belongs on a page whose sort is a
 * visible, changeable column header.
 */
function riskBand(project) {
  const { realisation, burn } = project.financials;
  if (burn !== null && burn > 1) return [0, -burn];
  if (realisation !== null) return [1, realisation];
  if (burn !== null && burn > 0) return [2, -burn];
  return [3, 0];
}

function byRisk(a, b) {
  const [bandA, scoreA] = riskBand(a);
  const [bandB, scoreB] = riskBand(b);
  if (bandA !== bandB) return bandA - bandB;
  if (scoreA !== scoreB) return scoreA - scoreB;
  return String(b.openedAt ?? "").localeCompare(String(a.openedAt ?? ""));
}

/**
 * The four filters the practice tiles count, expressed once so a tile and the
 * register it opens can never disagree about what they mean.
 */
const REGISTER_FILTERS = {
  all: { label: "All jobs", match: () => true },
  over: {
    label: "Past the fee",
    match: (p) => p.financials.burn !== null && p.financials.burn > 1,
  },
  unbilled: {
    label: "Worked, never billed",
    match: (p) => p.financials.captured > 0
      && p.financials.certifiedGross === 0 && p.financials.draftGross === 0,
  },
  stalled: {
    label: "On hold or halted",
    match: (p) => p.status === "on_hold" || p.status === "halted",
  },
  nofee: {
    label: "No fee to measure against",
    match: (p) => p.financials.quoted === null,
  },
};

const REGISTER_COLUMNS = [
  ["code", "Code", false],
  ["name", "Job", false],
  ["client", "Client", false],
  ["type", "Type", false],
  ["phase", "Phase", false],
  ["status", "Status", false],
  ["quoted", "Quoted", true],
  ["captured", "Captured", true],
  ["burn", "Burn", true],
  ["realisation", "Realisation", true],
];

/**
 * Burn and realisation are separate columns, deliberately. Folded into one
 * badge they cannot be told apart: a job at 211% of its fee and never
 * certified reads 0% realisation, exactly like a job that has logged nothing
 * at all, and the figure the list was ordered by is not the one on screen.
 */
function sortKey(project, column) {
  const f = project.financials;
  const type = state.reference?.projectTypes.find((t) => t.code === project.typeCode);
  switch (column) {
    case "code": return String(project.code || "").toLowerCase();
    case "name": return String(project.name || "").toLowerCase();
    case "client": return String(project.clientName || "").toLowerCase();
    case "type": return String(type?.name || project.typeCode || "").toLowerCase();
    // Sorted by how long it has sat there, not alphabetically. The phase name
    // is what you read; the days are what tells you which one to pick up.
    case "phase": return project.currentPhase ? -(daysSince(project.phaseSince) ?? 0) : null;
    case "status": return String(project.status || "");
    case "quoted": return f.quoted;
    case "captured": return f.captured;
    case "burn": return f.burn;
    case "realisation": return f.realisation;
    default: return null;
  }
}

/** Nulls last whichever way the column is pointing: "not known" is not small. */
function compareBy(column, ascending) {
  return (a, b) => {
    const left = sortKey(a, column);
    const right = sortKey(b, column);
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    const order = left < right ? -1 : 1;
    return ascending ? order : -order;
  };
}

function visibleProjects() {
  const query = state.registerQuery.trim().toLowerCase();
  const filter = REGISTER_FILTERS[state.registerFilter] ?? REGISTER_FILTERS.all;
  const rows = state.projects.filter((project) => {
    if (!filter.match(project)) return false;
    if (!query) return true;
    return [project.code, project.name, project.clientName]
      .some((field) => String(field || "").toLowerCase().includes(query));
  });
  return state.registerSort === "risk"
    ? rows.sort(byRisk)
    : rows.sort(compareBy(state.registerSort, state.registerAsc));
}

function registerHtml() {
  if (!state.projects.length) {
    return `<div class="empty">No jobs yet.<br />
      The register is the spine: a job here needs no drawing, no template and no fee.<br />
      Press <b>New job</b> and it will walk through each of those choices.</div>`;
  }
  const rows = visibleProjects();
  const chips = Object.entries(REGISTER_FILTERS).map(([key, { label, match }]) => {
    const count = key === "all" ? state.projects.length : state.projects.filter(match).length;
    return `<button class="chip" data-filter="${key}"
              aria-pressed="${state.registerFilter === key}">${esc(label)} <b>${count}</b></button>`;
  }).join("");

  const head = REGISTER_COLUMNS.map(([key, label, numeric]) => {
    const sorted = state.registerSort === key;
    return `<th class="sortable${numeric ? " num" : ""}" data-sort="${key}"
              ${sorted ? `aria-sort="${state.registerAsc ? "ascending" : "descending"}"` : ""}
              >${esc(label)}</th>`;
  }).join("");

  const body = rows.map((project) => {
    const f = project.financials;
    const type = state.reference?.projectTypes.find((t) => t.code === project.typeCode);
    const flagged = f.burn !== null && f.burn > 1;
    return `<tr class="row-link${flagged ? " flagged" : ""}" data-project="${esc(project.id)}">
      <td><span class="code-cell">${esc(project.code || "no code")}</span></td>
      <td>${esc(project.name || "Untitled")}</td>
      <td>${esc(project.clientName || "—")}</td>
      <td>${esc(type?.name || project.typeCode || "—")}</td>
      <td>${project.currentPhase
    ? `${esc(project.currentPhase)}<em>${dayCount(daysSince(project.phaseSince))}</em>`
    : '<span class="pill flat">not stated</span>'}</td>
      <td>${project.status === "open" ? "open"
    : `<span class="pill warn">${esc(String(project.status || "—").replace(/_/g, " "))}</span>`}</td>
      <td class="num">${money(f.quoted)}</td>
      <td class="num">${money(f.captured)}</td>
      <td class="num">${f.burn === null ? "&mdash;"
    : `<span class="real ${f.burn > 1 ? "bad" : f.burn >= 0.8 ? "mid" : "flat"}">${percent(f.burn)}</span>`}</td>
      <td class="num">${f.realisation === null ? "&mdash;"
    : `<span class="real ${realisationClass(f.realisation)}">${percent(f.realisation)}</span>`}</td>
    </tr>`;
  }).join("");

  return `
    <h3 class="sec">Register <small>${rows.length} of ${state.projects.length} jobs</small></h3>
    <div class="toolbar">
      <input type="search" id="register-query" value="${esc(state.registerQuery)}"
             placeholder="Code, description or client" aria-label="Search the register" />
      <div class="chips">${chips}</div>
      <div class="spacer" style="flex:1"></div>
      <button class="chip" data-sort="risk" aria-pressed="${state.registerSort === "risk"}">Risk order</button>
    </div>
    ${rows.length ? `<table class="grid">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>` : `<div class="empty">No job matches that.</div>`}
    <p class="note-line">${state.registerSort === "risk"
    ? `Ordered by risk: past the fee first, worst realisation next, then jobs that have not
       said anything yet. Burn and realisation are separate columns because they answer
       different questions &mdash; a job well past its fee and never certified realises
       nothing, and so does a job nobody has started.`
    : "Sorted by that column. Click it again to reverse, or pick Risk to go back."}</p>`;
}

// --- the main panel ---------------------------------------------------------

function selected() {
  return state.projects.find((project) => project.id === state.selectedId) || null;
}

function renderChrome() {
  for (const button of document.querySelectorAll("#nav [data-view]")) {
    button.setAttribute("aria-current", button.dataset.view === state.view ? "page" : "false");
  }
  el("switch-job").hidden = state.projects.length < 2 || state.view === "new";
}

function renderMain() {
  const composing = state.view === "new";
  el("composer").hidden = !composing;
  el("workspace").inert = composing;
  renderChrome();
  if (composing) {
    renderComposer();
    syncAddress();
    return;
  }
  const main = el("main");
  if (state.view === "practice") {
    main.innerHTML = `<div class="panel wrap">${practiceHtml()}</div>`;
    paintPreviews();
    syncAddress();
    return;
  }
  if (state.view === "register") {
    main.innerHTML = `<div class="panel wrap">${registerHtml()}</div>`;
    syncAddress();
    return;
  }
  const project = selected();
  if (!project) {
    state.view = "register";
    renderMain();
    return;
  }
  const type = state.reference?.projectTypes.find((t) => t.code === project.typeCode);
  const drawingLabel = project.drawingId ? "Open drawing" : "Start a drawing";
  main.innerHTML = `
    <div class="proj-head">
      <nav class="crumbs" aria-label="Breadcrumb">
        <button type="button" data-action="go-register">Register</button>
        <span>/</span><span>${esc(project.code || "no code")}</span>
      </nav>
      <div class="proj-head-row">
        <div>
          <div class="code">${esc(project.code || "NO CODE")}</div>
          <h1>${esc(project.name || "Untitled")}</h1>
          <div class="facts">
            <span>Client <b>${esc(project.clientName || "—")}</b></span>
            <span>Type <b>${esc(type?.name || project.typeCode || "—")}</b></span>
            <span>Basis <b>${project.billingBasis === "time_and_materials" ? "Time &amp; materials" : project.billingBasis === "fixed_fee" ? "Fixed fee" : "—"}</b></span>
            <span>Status <b>${esc(project.status || "—")}</b></span>
          </div>
        </div>
        <div class="proj-head-drawing">
          ${previewHtml(project, { size: "md", opens: "drawing" })}
          <button class="btn btn-sm" type="button" data-action="drawing">${drawingLabel}</button>
        </div>
      </div>
      ${phaseStripHtml(project)}
    </div>
    <div class="tabs">
      ${TABS.map(([tab, label]) => `
        <button data-tab="${tab}" aria-selected="${state.tab === tab}">${label}</button>`).join("")}
    </div>
    <div class="panel">${
      state.tab === "schedule" ? feeScheduleHtml(project)
        : state.tab === "time" ? timeHtml(project)
          : state.tab === "certificates" ? certificatesHtml(project)
            : overviewHtml(project)
    }</div>`;
  paintPreviews();
  syncAddress();
}

/** So a return from the planner lands on this job, and a refresh stays here. */
function syncAddress() {
  const url = new URL(location.href);
  if (state.view === "job" && state.selectedId) {
    url.searchParams.set("project", state.selectedId);
    url.searchParams.delete("view");
  } else if (state.view === "register") {
    url.searchParams.delete("project");
    url.searchParams.set("view", "register");
  } else if (state.view === "practice") {
    url.searchParams.delete("project");
    url.searchParams.delete("view");
  }
  const next = `${url.pathname}${url.search}`;
  if (next !== `${location.pathname}${location.search}`) history.replaceState(null, "", next);
}

/** One path into a job, so "recently opened" is always true. */
async function openJob(id, { tab } = {}) {
  state.selectedId = id;
  state.view = "job";
  if (tab) state.tab = tab;
  state.openCertificate = null;
  state.phases = null;
  state.phasePicker = false;
  state.recentIds = [id, ...state.recentIds.filter((other) => other !== id)].slice(0, 8);
  await loadTab();
  renderMain();
}

async function goView(view, { filter } = {}) {
  state.view = view;
  if (filter) state.registerFilter = filter;
  await loadTab();
  renderMain();
}

/**
 * An empty drawing in the same shape the planner mints. The id is the
 * drawing's identity, chosen here so the row and the document agree before
 * either has been saved from the canvas.
 */
function blankDrawing(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return {
    schema: "sp.doc/2",
    id: `doc${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed || null,
    packId: "tsp-template",
    site: null,
    rooms: [],
    segments: [],
    slabs: [],
    roofs: [],
    openings: [],
    items: [],
    beams: [],
    stairs: [],
    groups: [],
    sheets: [],
    floorsRevealed: 0,
    levels: [],
  };
}

async function goToDrawing(project) {
  if (!project) return;
  if (!project.drawingId) {
    const attached = await attempt(() => api.attachDrawing(project.id, {
      doc: blankDrawing(project.name),
      packId: "tsp-template",
    }));
    if (!attached?.drawing) return;
  }
  location.assign(`/v2/index.html?project=${encodeURIComponent(project.id)}`);
}

// --- the drawing, at a glance -----------------------------------------------

/**
 * A document is minted the moment somebody presses "Start a drawing", so
 * `drawingId` says a drawing exists and says nothing about whether anything
 * is on it. The picture is what tells those two apart, and it is worth
 * showing for that alone: a job that has been "drawn" for three months and
 * is still a blank sheet is a fact no column in the register can report.
 */
function previewHtml(project, { size = "sm", opens = "job" } = {}) {
  if (!project?.drawingId) return "";
  const who = project.code || project.name || "this job";
  // From the practice page a thumbnail opens the job, like everything else on
  // that page. From the job header it opens the planner, because that is what
  // the button beside it already says and the job is already open.
  const target = opens === "drawing"
    ? `data-action="drawing" aria-label="Open the drawing for ${esc(who)}"`
    : `data-project="${esc(project.id)}" aria-label="Open ${esc(who)}"`;
  return `
    <figure class="dwg dwg-${size}">
      <button type="button" class="dwg-frame" ${target}>
        <canvas data-preview="${esc(project.id)}"></canvas>
      </button>
      <figcaption data-preview-note="${esc(project.id)}"></figcaption>
    </figure>`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A canvas cannot be filled by a template string, so every render paints them
 * afterwards. The caption is written here rather than in the markup for the
 * same reason the warnings are derived: it reports what the renderer actually
 * put on the canvas, so it cannot describe a plan that is not there.
 */
function paintPreviews() {
  for (const canvas of document.querySelectorAll("canvas[data-preview]")) {
    const id = canvas.dataset.preview;
    const preview = state.previews?.get(id) || null;
    const drawn = preview ? drawPreview(canvas, preview) : null;
    canvas.closest(".dwg")?.classList.toggle("blank", !drawn);
    const note = document.querySelector(`[data-preview-note="${CSS.escape(id)}"]`);
    if (!note) continue;
    if (!drawn) {
      note.textContent = preview
        ? "Started, nothing drawn on it yet"
        : "Drawing not loaded";
      continue;
    }
    // What the plan is made of, not an inventory of it. Rooms are the answer
    // where there are any - a house has a slab and a roof and saying so is
    // not news. Where there are none, a site layout is its erven and a
    // boundary job is its walls, and those are worth naming.
    const parts = [];
    if (drawn.rooms) parts.push(plural(drawn.rooms, "room"));
    else if (drawn.slabs) parts.push(plural(drawn.slabs, "slab"));
    else if (drawn.roofs) parts.push(plural(drawn.roofs, "roof"));
    if (drawn.walls) parts.push(plural(drawn.walls, "wall"));
    parts.push(`${drawn.width.toFixed(1)} \u00d7 ${drawn.height.toFixed(1)} m`);
    note.textContent = parts.join(" \u00b7 ");
  }
}

/**
 * The drawings, together. Only jobs that have one appear - there is no
 * placeholder tile for a job nobody has drawn, because a grey rectangle
 * captioned with a job code is a picture of work that does not exist.
 */
function drawingsHtml() {
  if (!state.previews) return "";
  const drawn = state.projects.filter((project) => state.previews.has(project.id));
  if (!drawn.length) return "";
  return `
    <h3 class="sec">Drawings
      <small>${drawn.length} of ${plural(state.projects.length, "job")}
        ${drawn.length === 1 ? "has" : "have"} a document</small>
    </h3>
    <div class="dwg-grid">${drawn.map((project) => `
      <div class="dwg-card">
        ${previewHtml(project)}
        <button type="button" class="link-job" data-project="${esc(project.id)}"
          >${esc(project.code || "no code")} &middot; ${esc(project.name || "Untitled")}</button>
      </div>`).join("")}</div>`;
}

// --- where the job has got to -----------------------------------------------

/** Whole days, because "3 days at council" is the sentence people say. */
function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
}

const dayCount = (days) => (days === null ? "" : days === 0 ? "today"
  : days === 1 ? "1 day" : `${days} days`);

/**
 * The job's process, made permanent.
 *
 * The composer already showed this sequence once, on the day the job was
 * registered, and then it was never shown again - phases survived only as
 * grey separator rows in a forty-row task table. This is the same list, kept,
 * with the job's position on it.
 *
 * The position is stated, never inferred. A phase whose tasks are all ticked
 * is not made current for you: "the tasks are done" and "we have moved on"
 * are different claims, and where the two disagree that is reported rather
 * than resolved.
 */
function phaseStripHtml(project) {
  const data = state.phases;
  if (!data) return "";
  const { phases, current, currentSince, currentListed } = data;

  if (!phases.length && !current) {
    return `<div class="phase-strip empty-strip">
      <p class="note-line" style="margin:0">No phase list on this job. Phases come from the
        fee schedule or the type's task list; this one has neither, so where it has got to
        can still be recorded by hand.</p>
      ${phasePickerHtml(project, [])}
    </div>`;
  }

  const days = daysSince(currentSince);
  const steps = phases.map((phase) => {
    const billed = phase.quoted === null ? ""
      : phase.certified >= phase.quoted && phase.quoted > 0 ? "billed"
        : phase.certified > 0 ? "part-billed" : "";
    const tasks = phase.tasksTotal
      ? `${phase.tasksDone}/${phase.tasksTotal - phase.tasksStruck} done`
      : "no tasks";
    return `<li class="step ${esc(phase.position || "unknown")}">
      <button type="button" data-phase="${esc(phase.ref)}"
              aria-current="${phase.position === "current"}">
        <span class="step-seq">${phase.seq}</span>
        <span class="step-name">${esc(phase.ref)}</span>
        <span class="step-evi">${tasks}${phase.quoted === null ? ""
    : ` &middot; ${money(phase.quoted)}${billed ? ` &middot; ${billed}` : ""}`}</span>
      </button>
    </li>`;
  }).join("");

  return `<div class="phase-strip">
    <div class="phase-head">
      <h2>Where this job is</h2>
      ${current
    ? `<p>In <b>${esc(current)}</b>${days === null ? "" : ` for ${dayCount(days)}`}${
      currentListed ? "" : ' <span class="pill warn">not on the fee schedule</span>'}</p>`
    : `<p class="unstated">Nobody has said. A job with no phase recorded is not
         phase&nbsp;one &mdash; it is a job whose position nobody has stated.</p>`}
    </div>
    ${phases.length ? `<ol class="phase-steps">${steps}</ol>` : ""}
    ${phasePickerHtml(project, phases)}
    ${phaseWarningsHtml()}
  </div>`;
}

function phasePickerHtml(project, phases) {
  if (!state.phasePicker) {
    return `<div class="phase-actions">
      <button class="btn btn-sm" type="button" data-action="phase-picker">
        ${state.phases?.current ? "Move to another phase" : "Record where this job is"}
      </button>
    </div>`;
  }
  return `
    <form class="form phase-form" data-form="phase" data-project="${esc(project.id)}">
      <div class="fields">
        <div class="field">
          <label for="ph-ref">Phase</label>
          <input id="ph-ref" name="phaseRef" list="phase-options" required autocomplete="off"
                 value="" placeholder="${esc(phases[0]?.ref || "Submitted to council")}" />
          <datalist id="phase-options">
            ${phases.map((phase) => `<option value="${esc(phase.ref)}"></option>`).join("")}
          </datalist>
        </div>
        <div class="field wide">
          <label for="ph-note">Note</label>
          <input id="ph-note" name="note" placeholder="Optional — why it moved" />
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Record it</button>
        <button class="btn" type="button" data-action="phase-cancel">Cancel</button>
      </div>
      <p class="note-line">Recorded, not overwritten. Going back to an earlier phase is
        another entry &mdash; &ldquo;council sent it back in August&rdquo; is the fact a fee
        query turns on, and a column that only held the latest value would lose it.</p>
    </form>`;
}

/**
 * Where the stated phase and the evidence disagree. Both are facts; neither
 * is corrected. The disagreement is the whole content of the warning.
 */
function phaseWarningsHtml() {
  const data = state.phases;
  if (!data?.current) return "";
  const behind = data.phases.filter((phase) => phase.position === "behind");
  const unclaimed = behind.filter((phase) => phase.quoted !== null && phase.variance > 0);
  const undone = behind.filter((phase) => phase.tasksTotal - phase.tasksStruck > phase.tasksDone);
  if (!unclaimed.length && !undone.length) return "";

  const total = cents(unclaimed.reduce((sum, phase) => sum + phase.variance, 0));
  return `<div class="warn-list" style="margin-top:12px">
    ${unclaimed.length ? `<div class="w med">
      <span class="sev">Watch</span>
      <b>${money(total)} quoted on phases the job has already passed, not yet certified</b>
      <p>${unclaimed.map((phase) => esc(phase.ref)).join(", ")}. Work the client has been
        told is behind them is work that is harder to invoice the longer it waits.</p>
    </div>` : ""}
    ${undone.length ? `<div class="w med">
      <span class="sev">Watch</span>
      <b>Tasks still open on phases the job has moved past</b>
      <p>${undone.map((phase) => `${esc(phase.ref)} (${phase.tasksTotal - phase.tasksStruck - phase.tasksDone} left)`).join(", ")}.
        Either they were not needed &mdash; in which case strike them, and the list will say
        somebody decided that &mdash; or the job moved on without them.</p>
    </div>` : ""}
  </div>`;
}

// --- switch job -------------------------------------------------------------

/**
 * The affordance the rail used to be, minus the rail. Switching job is
 * something people do a handful of times a day, which buys a keystroke rather
 * than a permanent third of the window - and unlike a risk-ordered list, a
 * search box does not move the thing you are reaching for between visits.
 */
function switcherMatches() {
  const query = (state.switcher?.query || "").trim().toLowerCase();
  const recentFirst = [
    ...state.recentIds.map((id) => state.projects.find((p) => p.id === id)).filter(Boolean),
    ...state.projects.filter((p) => !state.recentIds.includes(p.id)),
  ];
  if (!query) return recentFirst.slice(0, 12);
  return recentFirst.filter((project) => [project.code, project.name, project.clientName]
    .some((field) => String(field || "").toLowerCase().includes(query))).slice(0, 12);
}

function renderSwitcher() {
  const node = el("switcher");
  node.hidden = !state.switcher;
  el("workspace").inert = Boolean(state.switcher) || state.view === "new";
  if (!state.switcher) return;
  const rows = switcherMatches();
  state.switcher.index = Math.min(state.switcher.index, Math.max(rows.length - 1, 0));
  el("switcher-list").innerHTML = rows.length
    ? rows.map((project, index) => {
      const { burn } = project.financials;
      return `<button class="switcher-row" role="option" data-project="${esc(project.id)}"
                aria-selected="${index === state.switcher.index}">
          <b>${esc(project.code || "no code")} &middot; ${esc(project.name || "Untitled")}</b>
          <em>${esc(project.clientName || "No client recorded")}</em>
          ${burn === null ? "" : `<span class="real ${burn > 1 ? "bad" : "flat"}"
            title="Burn">${percent(burn)}</span>`}
        </button>`;
    }).join("")
    : '<div class="switcher-empty">No job matches that.</div>';
  node.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function openSwitcher() {
  if (state.projects.length < 2) return;
  state.switcher = { query: "", index: 0 };
  renderSwitcher();
  const input = el("switcher-query");
  input.value = "";
  input.focus();
}

function closeSwitcher() {
  state.switcher = null;
  renderSwitcher();
}

const TABS = [
  ["overview", "Overview"],
  ["schedule", "Fee schedule"],
  ["time", "Time"],
  ["certificates", "Certificates"],
];

/**
 * The practice, not one job, and the page you land on. Every tab in the job
 * workspace answers a question about a single project; this is the only place
 * that can say how the firm is doing, and it costs nothing because the
 * register already carries each job's money with it.
 *
 * It used to render only when nothing was selected, which nothing could
 * produce - boot always opened the first job - so the firm never saw it.
 */
function practiceHtml() {
  const jobs = state.projects;
  if (!jobs.length) {
    return `<div class="empty">No jobs yet.<br />
      A job needs only a code to exist &mdash; client, type, fee and drawing can all arrive later.
      Press <b>New job</b> and it will walk through each of those choices.</div>`;
  }
  const open = jobs.filter((p) => p.status === "open");
  const overFee = jobs.filter(REGISTER_FILTERS.over.match);
  const uncertified = jobs.filter(REGISTER_FILTERS.unbilled.match);
  const capturedThisMonth = state.monthEntries.reduce((sum, e) => sum + e.capturedAmount, 0);
  const minutesThisMonth = state.monthEntries.reduce((sum, e) => sum + e.minutes, 0);

  // A count with no way through to the jobs it counted is a poster. Each of
  // these opens the register filtered by the same predicate it was counted
  // with, so the tile and the list cannot drift apart.
  const tile = (filter, label, list, sub) => `
    <button class="kpi${list.length ? " flag" : ""}" type="button"
            data-goto-filter="${filter}"${list.length ? "" : " disabled"}>
      <div class="lbl">${esc(label)}</div>
      <div class="val">${list.length}</div>
      <div class="sub">${sub}</div>
      ${list.length ? '<div class="go">Show these &rarr;</div>' : ""}
    </button>`;

  const codes = (list) => (list.length
    ? `${list.slice(0, 4).map((p) => esc(p.code || "no code")).join(", ")}${
      list.length > 4 ? ` and ${list.length - 4} more` : ""}`
    : "None.");

  const recent = state.recentIds
    .map((id) => jobs.find((p) => p.id === id))
    .filter(Boolean);

  return `
    <h3 class="sec">The practice <small>every job, not the one you had open</small></h3>
    <div class="kpis">
      <button class="kpi" type="button" data-goto-filter="all">
        <div class="lbl">Open jobs</div>
        <div class="val">${open.length}</div>
        <div class="sub">${jobs.length} in the register altogether</div>
        <div class="go">Open the register &rarr;</div>
      </button>
      <div class="kpi">
        <div class="lbl">Captured this month</div>
        <div class="val">${money(capturedThisMonth)}</div>
        <div class="sub">${duration(minutesThisMonth)} logged since ${esc(monthStart())}</div>
      </div>
      ${tile("over", "Past the fee", overFee, codes(overFee))}
      ${tile("unbilled", "Worked, never billed", uncertified, codes(uncertified))}
    </div>
    <p class="note-line">Time captured and no certificate at all is the gap the workbook could
      not show: each invoice was compiled by hand from whichever rows somebody noticed, so an
      unbilled job looked exactly like a quiet one.</p>

    ${attentionHtml()}

    ${whereTheWorkIsHtml()}

    ${drawingsHtml()}

    ${recent.length ? `
      <h3 class="sec">Recently opened</h3>
      <table class="grid"><tbody>${recent.map((project) => `
        <tr class="row-link" data-project="${esc(project.id)}">
          <td><span class="code-cell">${esc(project.code || "no code")}</span></td>
          <td>${esc(project.name || "Untitled")}</td>
          <td>${esc(project.clientName || "—")}</td>
          <td class="num">${project.financials.burn === null ? "&mdash;"
    : `<span class="real ${project.financials.burn > 1 ? "bad" : "flat"}">${percent(project.financials.burn)}</span>`}</td>
        </tr>`).join("")}</tbody></table>` : ""}`;
}

/**
 * The executive reading of the process: which jobs are where, longest-sitting
 * first. A job that has been at the same phase for ninety days is the thing
 * this section exists to surface, and it is the one fact neither the money
 * columns nor the warnings can say.
 *
 * Phases are not counted across types, because they are not the same phases -
 * a township establishment has five stages and a strata report has one, and a
 * histogram of their names would put unrelated work in one bar.
 */
function whereTheWorkIsHtml() {
  const live = state.projects.filter((p) => p.status === "open" || p.status === "on_hold");
  if (!live.length) return "";
  const stated = live.filter((p) => p.currentPhase)
    .sort((a, b) => (daysSince(b.phaseSince) ?? 0) - (daysSince(a.phaseSince) ?? 0));
  const silent = live.filter((p) => !p.currentPhase);

  return `
    <h3 class="sec">Where the work is
      <small>${stated.length ? "longest at the same phase first" : "nothing recorded yet"}</small>
    </h3>
    ${stated.length ? `<table class="grid">
      <thead><tr>
        <th>Code</th><th>Job</th><th>Phase</th><th class="num">Sitting there</th>
      </tr></thead>
      <tbody>${stated.map((project) => {
    const days = daysSince(project.phaseSince);
    return `<tr class="row-link${days !== null && days >= 60 ? " flagged" : ""}"
                data-project="${esc(project.id)}">
          <td><span class="code-cell">${esc(project.code || "no code")}</span></td>
          <td>${esc(project.name || "Untitled")}</td>
          <td>${esc(project.currentPhase)}</td>
          <td class="num">${dayCount(days)}</td>
        </tr>`;
  }).join("")}</tbody>
    </table>` : `<div class="empty">No open job has a phase recorded.<br />
      Open one and press <b>Record where this job is</b>; the register will start being able
      to answer &ldquo;what is at council&rdquo; without anybody opening a file.</div>`}
    ${stated.length && silent.length ? `<p class="note-line">${silent.length} open
      job${silent.length === 1 ? " has" : "s have"} no phase recorded
      (${silent.slice(0, 5).map((p) => esc(p.code || "no code")).join(", ")}${
  silent.length > 5 ? ` and ${silent.length - 5} more` : ""}). They are missing from the
      list above rather than counted as if they were at the start.</p>` : ""}`;
}

/**
 * The warnings every job already derives, gathered across the register and
 * ranked. This is the executive reading: not a number per job, but the
 * sentences the numbers make, worst first. Only `high` appears here - a page
 * that lists every `med` is a page nobody reads twice.
 */
function attentionHtml() {
  const flagged = state.projects
    .map((project) => ({ project, warnings: warningsFor(project).filter((w) => w.level === "high") }))
    .filter((row) => row.warnings.length)
    .sort((a, b) => b.warnings.length - a.warnings.length);

  if (!flagged.length) {
    return `<h3 class="sec">Needs attention</h3>
      <div class="empty">Nothing at the top severity. Quoted, captured and certified agree
        across the register.</div>`;
  }
  return `
    <h3 class="sec">Needs attention
      <small>${flagged.length} job${flagged.length === 1 ? "" : "s"} the numbers are arguing about</small>
    </h3>
    <div class="warn-list">${flagged.map(({ project, warnings }) => `
      <div class="w high">
        <span class="sev">Act</span>
        <b><button type="button" class="link-job" data-project="${esc(project.id)}"
           >${esc(project.code || "no code")} &middot; ${esc(project.name || "Untitled")}</button></b>
        <p>${warnings.map((w) => esc(w.title)).join(". ")}.</p>
      </div>`).join("")}</div>`;
}

/**
 * The agreed quote against what has actually been claimed under each phase.
 *
 * This is the only place an overrun is visible per phase rather than as one
 * total against another: a job can be comfortably inside its fee overall and
 * have spent the whole public-participation phase twice over, and the second
 * sentence is the one that changes what anybody does.
 */
function feeScheduleHtml(project) {
  const schedule = state.feeSchedule;
  const f = project.financials;
  if (!schedule) return '<div class="empty">Loading.</div>';
  const { lines, unallocated } = schedule;

  const rows = lines.map((line) => `
    <tr${line.variance < 0 ? ' class="flagged"' : ""}>
      <td>${line.seq}</td>
      <td>${esc(line.label)}</td>
      <td class="num">${money(line.quoted)}</td>
      <td class="num">${money(line.certified)}</td>
      <td class="num">${line.draft ? money(line.draft) : "&mdash;"}</td>
      <td class="num">${line.variance < 0
        ? `<span class="pill err">${money(line.variance)}</span>`
        : money(line.variance)}</td>
    </tr>`).join("");

  const loose = unallocated.certified + unallocated.draft;

  return `
    <h3 class="sec">Fee schedule
      <small>${lines.length ? "the agreed breakdown, against what has been claimed under it"
    : "nothing agreed yet"}</small>
    </h3>
    ${lines.length ? `
      <table class="grid">
        <thead><tr>
          <th>#</th><th>Phase</th>
          <th class="num">Quoted</th><th class="num">Certified</th>
          <th class="num">On draft</th><th class="num">Left to claim</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2">Total</td>
            <td class="num">${money(schedule.quoted)}</td>
            <td class="num">${money(schedule.certified)}</td>
            <td class="num"></td>
            <td class="num">${money(cents(schedule.quoted - schedule.certified))}</td>
          </tr>
        </tfoot>
      </table>
      ${loose > 0 ? `<div class="warn-list" style="margin-top:10px"><div class="w med">
        <span class="sev">Watch</span>
        <b>${money(loose)} certified against no phase on this schedule</b>
        <p>Certificate lines whose phase is blank, or names something the schedule does not.
          Counted separately rather than folded into a phase, because a total that quietly
          absorbs it would make every variance above read better than it is.</p>
      </div></div>` : ""}
      <p class="note-line">A negative figure is an overrun on that phase, and it is not an
        error &mdash; it is the number the firm needs before the next one is quoted. The
        quoted total here is what <b>burn</b> is measured against; the register's budget
        estimate${f.budgetEstimate === null ? " (none entered)"
    : ` of ${money(f.budgetEstimate)}`} is only used when there is no schedule.</p>`
    : `<div class="empty">No fee schedule on this job.<br />
        Burn is measured against the register's budget estimate
        ${f.budgetEstimate === null ? "&mdash; and there isn't one, so it cannot be measured at all."
    : `of ${money(f.budgetEstimate)}.`}<br />
        A schedule replaces that single figure with the phases it was built from.</div>`}

    <h3 class="sec">Revise the schedule <small>the whole document, the way a proposal is reissued</small></h3>
    <form class="form" data-form="fee-schedule" data-project="${esc(project.id)}">
      <div id="schedule-rows">
        ${(lines.length ? lines : [{ label: "", quoted: "" }]).map((line, index) => `
          <div class="fields schedule-row">
            <label class="field wide" style="grid-column:span 2">
              <span${index ? ' class="sr-only"' : ""}>Phase</span>
              <input name="label" value="${esc(line.label)}" placeholder="Phase 1: inception" />
            </label>
            <label class="field">
              <span${index ? ' class="sr-only"' : ""}>Quoted</span>
              <input name="quoted" type="number" step="0.01" value="${line.quoted}" />
            </label>
            <div class="field" style="align-self:end">
              <button class="btn btn-sm" type="button" data-action="drop-schedule-row">Remove</button>
            </div>
          </div>`).join("")}
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Save the schedule</button>
        <button class="btn" type="button" data-action="add-schedule-row">Add a phase</button>
      </div>
      <p class="note-line">Saving replaces the schedule outright. The superseded lines are kept,
        dated and attributed &mdash; what the client was quoted in March is a question somebody
        asks in September.</p>
    </form>`;
}

function overviewHtml(project) {
  const f = project.financials;
  const burnWidth = f.burn === null ? 0 : Math.min(f.burn, 1) * 100;
  return `
    <h3 class="sec">Where this job stands</h3>
    <div class="kpis">
      <div class="kpi${f.quoted === null ? " dim" : ""}">
        <div class="lbl">Quoted</div>
        <div class="val">${money(f.quoted)}</div>
        <div class="sub">${f.quoted === null ? "No figure entered"
    : f.quotedSource === "fee_schedule"
      ? `Fee schedule, ${f.scheduleLines} phase${f.scheduleLines === 1 ? "" : "s"}`
      : "Register budget estimate &mdash; no fee schedule yet"}</div>
      </div>
      <div class="kpi${f.burn !== null && f.burn > 1 ? " flag" : ""}">
        <div class="lbl">Captured</div>
        <div class="val">${money(f.captured)}</div>
        <div class="sub">${duration(f.capturedMinutes)} logged${f.burn === null ? "" : ` &middot; ${percent(f.burn)} of fee`}
          <div class="bar" style="margin-top:5px"><i class="${burnClass(f.burn)}" style="width:${burnWidth}%"></i></div>
        </div>
      </div>
      <div class="kpi">
        <div class="lbl">Billed</div>
        <div class="val">${money(f.billed)}</div>
        <div class="sub">${f.writtenDown > 0 ? `${money(f.certifiedGross)} certified, less ${money(f.writtenDown)} written down` : "Certified, after write-downs"}</div>
      </div>
      <div class="kpi${f.realisation !== null && f.realisation < 0.7 ? " flag" : ""}">
        <div class="lbl">Realisation</div>
        <div class="val">${percent(f.realisation)}</div>
        <div class="sub">${f.realisation === null ? "Nothing captured yet" : "Billed &divide; captured"}</div>
      </div>
    </div>

    <h3 class="sec">Warnings <small>derived from the numbers, not typed by anyone</small></h3>
    ${warningsHtml(warningsFor(project))}

    ${tasksHtml(project)}

    <h3 class="sec">Register</h3>
    ${registerFormHtml(project)}`;
}

const TASK_STATUS_LABELS = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  not_required: "Struck",
};

/**
 * The job's own copy of its type's task list, cloned when it was registered.
 *
 * A struck task is shown, not hidden. "We looked at this and it was not
 * needed" is the answer to a query about the fee months later, and a list that
 * quietly dropped it cannot give that answer - which is why there is no delete
 * here, only `not_required`.
 */
function tasksHtml(project) {
  const tasks = state.tasks;
  const type = state.reference?.projectTypes.find((t) => t.code === project.typeCode);
  const done = tasks.filter((t) => t.status === "done").length;
  const struck = tasks.filter((t) => t.status === "not_required").length;

  const addForm = `
    <form class="form" data-form="add-task" data-project="${esc(project.id)}" style="margin-top:10px">
      <div class="fields">
        <div class="field wide">
          <label for="nt-description">Add a task</label>
          <input id="nt-description" name="description" required
                 placeholder="Respond to the environmental department complaint" />
        </div>
        <div class="field">
          <label for="nt-phase">Phase</label>
          <input id="nt-phase" name="phaseLabel" list="task-phases" placeholder="Optional" />
          <datalist id="task-phases">
            ${[...new Set(tasks.map((t) => t.phaseLabel).filter(Boolean))]
    .map((label) => `<option value="${esc(label)}"></option>`).join("")}
          </datalist>
        </div>
        <div class="field">
          <label for="nt-fee">Fee</label>
          <input id="nt-fee" name="defaultFee" type="number" step="0.01" placeholder="Optional" />
        </div>
      </div>
      <div class="actions"><button class="btn" type="submit">Add task</button></div>
    </form>`;

  if (!tasks.length) {
    return `
      <h3 class="sec">Tasks</h3>
      <div class="empty">${type?.isPlaceholder
    ? `${esc(type.name)} is a registered type with no fee template behind it, so this job
         started with an empty list. That is the finished state for it, not a gap &mdash;
         add the tasks this particular job needs.`
    : "No task list on this job. Tasks are cloned from the project type's fee template when "
      + "the job is registered; this one had no type, or none with a template."}</div>
      ${addForm}`;
  }

  let currentPhase = null;
  const rows = tasks.map((task) => {
    const header = task.phaseLabel !== currentPhase
      ? `<tr class="phase-row"><td colspan="5">${esc(task.phaseLabel || "No phase")}</td></tr>`
      : "";
    currentPhase = task.phaseLabel;
    const struckRow = task.status === "not_required";
    return `${header}
      <tr${struckRow ? ' class="struck"' : ""}>
        <td>${esc(task.description)}
          ${task.templateTaskId === null ? ' <span class="pill flat">added</span>' : ""}
          ${task.note ? `<div class="task-note">${esc(task.note)}</div>` : ""}</td>
        <td class="num">${task.defaultFee === null ? "&mdash;" : money(task.defaultFee)}</td>
        <td>${task.certificateId
    ? `<span class="pill ${task.certificateStatus === "issued" ? "ok" : "flat"}">${
      task.certificateStatus === "issued" ? "billed" : "on a draft"}</span>`
    : '<span class="pill flat">not billed</span>'}</td>
        <td>
          <select data-action="task-status" data-task="${esc(task.id)}">
            ${Object.entries(TASK_STATUS_LABELS).map(([value, label]) => `
              <option value="${esc(value)}"${task.status === value ? " selected" : ""}>${label}</option>`).join("")}
          </select>
        </td>
        <td class="num">${struckRow
    ? `<button class="btn btn-sm" data-action="unstrike-task" data-task="${esc(task.id)}">Restore</button>`
    : `<button class="btn btn-sm" data-action="strike-task" data-task="${esc(task.id)}">Strike</button>`}</td>
      </tr>`;
  }).join("");

  return `
    <h3 class="sec">Tasks
      <small>${tasks.length} from the ${esc(type?.name || project.typeCode || "job's")} template
        &middot; ${done} done${struck ? ` &middot; ${struck} struck` : ""}</small>
    </h3>
    <div class="scroller"><table class="grid">
      <thead><tr>
        <th>Task</th><th class="num">Fee</th><th>Billed</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="note-line">A struck task stays on the list. Deleting it would lose the only record
      that somebody looked at it and decided it was not needed &mdash; which is the question
      asked when the fee is queried.</p>
    ${addForm}`;
}

function registerFormHtml(project) {
  const types = state.reference?.projectTypes || [];
  const value = (key) => esc(project?.[key] ?? "");
  const option = (list, current) => list.map((item) => {
    const code = typeof item === "string" ? item : item.code;
    const label = typeof item === "string" ? item : item.name;
    const placeholder = typeof item === "object" && item.isPlaceholder ? " (no template yet)" : "";
    return `<option value="${esc(code)}"${code === current ? " selected" : ""}>${esc(label)}${placeholder}</option>`;
  }).join("");

  return `
    <form class="form" data-form="update" data-project="${esc(project.id)}">
      <div class="fields">
        <div class="field">
          <label for="f-code">Project code</label>
          <input id="f-code" name="code" value="${value("code")}" required
                 placeholder="D063" autocomplete="off" />
        </div>
        <div class="field">
          <label for="f-name">Description</label>
          <input id="f-name" name="name" value="${value("name")}" placeholder="Bon Accord township" />
        </div>
        <div class="field">
          <label for="f-type">Project type</label>
          <select id="f-type" name="typeCode">
            <option value="">Not classified yet</option>
            ${option(types, project?.typeCode ?? "")}
          </select>
        </div>
        <div class="field">
          <label for="f-basis">Billing basis</label>
          <select id="f-basis" name="billingBasis">
            <option value="">Not decided</option>
            <option value="fixed_fee"${project?.billingBasis === "fixed_fee" ? " selected" : ""}>Fixed fee</option>
            <option value="time_and_materials"${project?.billingBasis === "time_and_materials" ? " selected" : ""}>Time &amp; materials</option>
          </select>
        </div>
        <div class="field">
          <label for="f-budget">Budget estimate</label>
          <input id="f-budget" name="budgetEstimate" type="number" step="0.01" min="0"
                 value="${project?.budgetEstimate ?? ""}" placeholder="Leave blank if none" />
        </div>
        <div class="field">
          <label for="f-status">Status</label>
          <select id="f-status" name="status">
            ${(state.reference?.projectStatuses || ["open"]).map((status) => `
              <option value="${esc(status)}"${(project?.status ?? "open") === status ? " selected" : ""}>
                ${esc(status.replace(/_/g, " "))}
              </option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="f-client">Client</label>
          <input id="f-client" name="clientName" value="${value("clientName")}" />
        </div>
        <div class="field">
          <label for="f-email">Client email</label>
          <input id="f-email" name="clientEmail" type="email" value="${value("clientEmail")}" />
        </div>
        <div class="field">
          <label for="f-cell">Client cell</label>
          <input id="f-cell" name="clientCell" value="${value("clientCell")}" />
        </div>
        <div class="field wide">
          <label for="f-address">Address</label>
          <input id="f-address" name="clientAddress" value="${value("clientAddress")}" />
        </div>
        <div class="field wide">
          <label for="f-property">Property description</label>
          <input id="f-property" name="propertyDescription" value="${value("propertyDescription")}" />
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Save</button>
      </div>
      <p class="note-line">A project code is unique within the firm, compared ignoring case and
        surrounding spaces &mdash; the source workbook carried <code>P078</code> twice and
        <code>C036&nbsp;</code> beside <code>CO36.9</code>.</p>
    </form>`;
}

/**
 * What choosing a type does on the day the job is opened. Figures are left
 * out: the template is the firm's, and it can be edited. The sentence that
 * matters is whether a task list and a fee schedule are copied, and of what.
 */
const TYPE_GUIDE = {
  STRATAREPORT: "Copies one phase and its three tasks — council documents, the title deed, external reports — and a fee schedule of that single line.",
  "CONSENT USE": "Copies five phases, from inception to promulgation, with their tasks and a fee schedule that matches them.",
  REZONING: "Copies five phases, from inception to promulgation, with their tasks and a fee schedule that matches them.",
  "REMOVAL OF RESTRICTIONS": "Copies eight phases, from the briefing through the approval formalities, with their tasks and a matching fee schedule.",
  "TOWNSHIP establishment": "Copies five stages plus sundries, with their tasks and a fee schedule built from the same lines.",
};

const NEW_JOB_STEPS = [
  ["name", "Name"],
  ["type", "Type"],
  ["billing", "Billing"],
  ["client", "Client"],
];

function blankNewJob() {
  return {
    step: 0,
    error: "",
    saving: false,
    code: "",
    name: "",
    typeCode: null,
    billingBasis: null,
    budgetEstimate: "",
    clientName: "",
    clientEmail: "",
    clientCell: "",
    clientAddress: "",
    propertyDescription: "",
  };
}

function openNewJob() {
  if (state.view !== "new") {
    state.returnView = state.view;
    state.newJob = blankNewJob();
  }
  state.view = "new";
  renderMain();
}

function closeNewJob() {
  state.view = state.returnView ?? "register";
  state.returnView = null;
  state.newJob = null;
  renderMain();
}

function readComposerFields() {
  const job = state.newJob;
  const root = el("composer-body");
  for (const input of root.querySelectorAll("[data-field]")) {
    if (input.type === "radio") {
      if (input.checked) job[input.dataset.field] = input.value;
    } else {
      job[input.dataset.field] = input.value;
    }
  }
}

function composerStepError() {
  const job = state.newJob;
  if (job.step === 0 && !String(job.code).trim()) {
    return "A project code is the one thing a job needs before it can exist.";
  }
  if (job.step === 1 && job.typeCode === null) {
    return "Choose a type, or choose to leave it unclassified. Either is a finished answer.";
  }
  if (job.step === 2 && job.billingBasis === null) {
    return "Choose how this job will be billed, or choose that it is not decided yet.";
  }
  return "";
}

/** Successful template fetches, so stepping back does not load the sequence again. */
const roadmapCache = new Map();
let roadmapRequest = 0;

function typeGuide(type) {
  if (!type) {
    return "Nothing is copied. Classify it later from the register; until then there is no task list and no fee schedule.";
  }
  if (type.isPlaceholder) {
    return "No pre-built tasks. The job opens with an empty list, and you add the tasks this particular job needs. Time, certificates and burn still work; the fee schedule is entered by hand.";
  }
  return TYPE_GUIDE[type.code]
    || "Copies this type's tasks and a fee schedule built from the same template, so the two agree on the day the job opens.";
}

function choiceCard(field, value, checked, title, body) {
  return `<label class="choice">
    <input type="radio" name="${esc(field)}" data-field="${esc(field)}" value="${esc(value)}"${checked ? " checked" : ""} />
    <span><b>${title}</b><p>${body}</p></span>
  </label>`;
}

function composerNameStep(job) {
  return `
    <div class="form">
      <div class="fields">
        <div class="field">
          <label for="nj-code">Project code</label>
          <input id="nj-code" data-field="code" value="${esc(job.code)}" required
                 placeholder="D063" autocomplete="off" />
        </div>
        <div class="field">
          <label for="nj-name">Description</label>
          <input id="nj-name" data-field="name" value="${esc(job.name)}"
                 placeholder="Bon Accord township" />
        </div>
      </div>
      <p class="note-line">The code is unique in the firm, compared ignoring case and surrounding
        spaces. The workbook carried <code>P078</code> twice and <code>C036&nbsp;</code> beside
        <code>CO36.9</code>, and those only surfaced when somebody tried to bill them.
        The description is the name people read in the register; it can wait.</p>
    </div>`;
}

function composerTypeStep(job) {
  const types = state.reference?.projectTypes || [];
  const templated = types.filter((type) => !type.isPlaceholder);
  const placeholders = types.filter((type) => type.isPlaceholder);
  const cards = (list) => list.map((type) => choiceCard(
    "typeCode", type.code, job.typeCode === type.code, esc(type.name), typeGuide(type),
  )).join("");
  return `
    <div class="choice-group">
      <h2>Copies a task list and a fee schedule</h2>
      <div class="choices">${cards(templated)}</div>
    </div>
    <div class="choice-group">
      <h2>Registered, with no template yet</h2>
      <p class="note-line" style="margin-top:0">An empty list is the finished state for these, not a missing file. You write the tasks the job actually has.</p>
      <div class="choices">${cards(placeholders)}</div>
    </div>
    <div class="choice-group">
      <h2>Or leave it for later</h2>
      <div class="choices">${choiceCard(
        "typeCode", "", job.typeCode === "", "Not classified yet", typeGuide(null),
      )}</div>
    </div>
    ${roadmapHtml(job)}`;
}

/**
 * Phases of the selected type, in order, with the tasks under each. Fees stay
 * off this step: the question here is whether the sequence fits the job.
 * A placeholder and an unclassified job have nothing to preview.
 */
function roadmapHtml(job) {
  const code = job.typeCode || "";
  const type = (state.reference?.projectTypes || []).find((item) => item.code === code);
  if (!code || type?.isPlaceholder) {
    return `<section class="roadmap" id="type-roadmap" hidden></section>`;
  }
  const roadmap = job.roadmap?.typeCode === code ? job.roadmap : null;
  if (!roadmap || roadmap.loading) {
    return `<section class="roadmap" id="type-roadmap" aria-live="polite">
      <h2>What this type copies</h2>
      <p class="note-line">Loading the sequence…</p>
    </section>`;
  }
  if (roadmap.error) {
    return `<section class="roadmap" id="type-roadmap" aria-live="polite">
      <h2>What this type copies</h2>
      <p class="note-line">The sequence could not be loaded. The type can still be chosen;
        the job is built from it when it is created.</p>
    </section>`;
  }
  const phases = (roadmap.phases || []).map((phase) => {
    const tasks = phase.tasks || [];
    const count = tasks.length === 1 ? "1 task" : `${tasks.length} tasks`;
    if (!tasks.length) return `<li><b>${esc(phase.name)}</b></li>`;
    return `<li><details>
      <summary>${esc(phase.name)} <span>${count}</span></summary>
      <ul>${tasks.map((task) => `<li>${esc(task.description)}</li>`).join("")}</ul>
    </details></li>`;
  }).join("");
  return `<section class="roadmap" id="type-roadmap" aria-live="polite">
    <h2>What this type copies</h2>
    <ol class="roadmap-phases">${phases}</ol>
    <p class="note-line">This sequence is copied onto the job. Tasks can be added or struck
      afterwards. The firm's template is unchanged.</p>
  </section>`;
}

function paintRoadmap() {
  const node = el("type-roadmap");
  if (!node || !state.newJob || state.newJob.step !== 1) return;
  const hadPhases = Boolean(node.querySelector(".roadmap-phases"));
  node.outerHTML = roadmapHtml(state.newJob);
  const shown = el("type-roadmap");
  if (shown && !hadPhases && shown.querySelector(".roadmap-phases")) {
    shown.scrollIntoView({ block: "nearest" });
  }
}

function ensureRoadmap() {
  const job = state.newJob;
  if (!job || job.step !== 1) return;
  const code = job.typeCode || "";
  const type = (state.reference?.projectTypes || []).find((item) => item.code === code);
  if (!code || type?.isPlaceholder) {
    job.roadmap = null;
    paintRoadmap();
    return;
  }
  if (roadmapCache.has(code)) {
    job.roadmap = roadmapCache.get(code);
    paintRoadmap();
    return;
  }
  if (job.roadmap?.typeCode === code && job.roadmap.loading) return;
  const request = ++roadmapRequest;
  job.roadmap = { typeCode: code, loading: true };
  paintRoadmap();
  api.feeTemplate(code).then(({ template }) => {
    const entry = { typeCode: code, loading: false, phases: template.phases || [] };
    roadmapCache.set(code, entry);
    if (request !== roadmapRequest || state.newJob?.typeCode !== code) return;
    state.newJob.roadmap = entry;
    paintRoadmap();
  }).catch(() => {
    if (request !== roadmapRequest || state.newJob?.typeCode !== code) return;
    state.newJob.roadmap = { typeCode: code, loading: false, error: true, phases: [] };
    paintRoadmap();
  });
}

function budgetNote(basis) {
  if (basis === "fixed_fee") {
    return "On a fixed fee this is a working figure. The moment a fee schedule exists — including one just copied from the type — burn is measured against the schedule, and a disagreement with this estimate is shown rather than smoothed over.";
  }
  if (basis === "time_and_materials") {
    return "Time and materials often opens with no budget. Leave this blank when there isn't one. Blank is not zero: zero would say the fee is already spent, and every hour after it would read as an overrun.";
  }
  return "Until a fee schedule exists, burn is measured against this figure. Leave it blank if there isn't one. Blank is not zero.";
}

function composerBillingStep(job) {
  const basis = job.billingBasis;
  return `
    <div class="choices">
      ${choiceCard("billingBasis", "fixed_fee", basis === "fixed_fee", "Fixed fee",
        "Certificates follow the fee split. Time past a phase stays on the job as variance; it is not added to what the client is asked to pay. That variance is how you see a phase was under-quoted before you quote the next one.")}
      ${choiceCard("billingBasis", "time_and_materials", basis === "time_and_materials", "Time &amp; materials",
        "Certificate lines are built from the time logged, at the captured amount. Giving part of that up is a write-down with a reason on the certificate. The timesheet row itself is never reduced.")}
      ${choiceCard("billingBasis", "", basis === "", "Not decided yet",
        "The job can open without a basis. Set it on the register before the first certificate. Burn can still be measured against a budget, or against a fee schedule once one exists.")}
    </div>
    <div class="form" style="margin-top:14px">
      <div class="field" style="max-width:280px">
        <label for="nj-budget">Budget estimate</label>
        <input id="nj-budget" data-field="budgetEstimate" type="number" step="0.01" min="0"
               value="${esc(job.budgetEstimate)}" placeholder="Leave blank if none" />
      </div>
      <p class="note-line" id="nj-budget-note">${esc(budgetNote(basis))}</p>
    </div>`;
}

function composerClientStep(job) {
  const type = (state.reference?.projectTypes || []).find((item) => item.code === job.typeCode);
  const basis = job.billingBasis === "fixed_fee" ? "Fixed fee"
    : job.billingBasis === "time_and_materials" ? "Time & materials"
      : "Basis not decided";
  const row = (label, value) => `<div><dt>${label}</dt><dd>${value || "—"}</dd></div>`;
  return `
    <dl class="composer-summary">
      ${row("Code", esc(job.code))}
      ${row("Description", esc(job.name))}
      ${row("Type", job.typeCode ? esc(type?.name || job.typeCode) : "Not classified yet")}
      ${row("Billing", esc(basis))}
      ${row("Budget", job.budgetEstimate === "" ? "None" : money(Number(job.budgetEstimate)))}
    </dl>
    <p class="composer-lead">Status starts as open. Hold, halt and complete are set once the job exists, and a drawing is attached later from the job itself.</p>
    <div class="form">
      <div class="fields">
        <div class="field">
          <label for="nj-client">Client</label>
          <input id="nj-client" data-field="clientName" value="${esc(job.clientName)}"
                 placeholder="The name on the certificate" />
        </div>
        <div class="field">
          <label for="nj-email">Email</label>
          <input id="nj-email" data-field="clientEmail" type="email" value="${esc(job.clientEmail)}" />
        </div>
        <div class="field">
          <label for="nj-cell">Cell</label>
          <input id="nj-cell" data-field="clientCell" value="${esc(job.clientCell)}" />
        </div>
        <div class="field wide">
          <label for="nj-address">Client address</label>
          <input id="nj-address" data-field="clientAddress" value="${esc(job.clientAddress)}"
                 placeholder="Where the client is, not the site" />
        </div>
        <div class="field wide">
          <label for="nj-property">Property</label>
          <input id="nj-property" data-field="propertyDescription" value="${esc(job.propertyDescription)}"
                 placeholder="The site: erf, township, portion" />
        </div>
      </div>
      <p class="note-line">All of this can be blank. The client's address and the property are different
        places: one is who you bill, the other is the land the work is about.</p>
    </div>`;
}

const COMPOSER_COPY = [
  ["Name the job", "A code is enough to open the register. Everything after this step can be decided now or left for the job itself."],
  ["What kind of work is it?", "The type decides what lands on the job today: a copied task list and fee schedule, an empty list you write yourself, or nothing until you classify it."],
  ["How will it be billed?", "The basis decides what a certificate is allowed to claim. The budget is the figure burn uses until a fee schedule replaces it."],
  ["Who is it for?", "Client and property are the register entry. Neither is required to create the job, and both can be filled in afterwards."],
];

function renderComposer() {
  const job = state.newJob;
  const [title, lead] = COMPOSER_COPY[job.step];
  const body = job.step === 0 ? composerNameStep(job)
    : job.step === 1 ? composerTypeStep(job)
      : job.step === 2 ? composerBillingStep(job)
        : composerClientStep(job);
  const last = job.step === NEW_JOB_STEPS.length - 1;
  el("composer-body").innerHTML = `
    <p class="composer-kicker">New job</p>
    <h1 id="composer-title" tabindex="-1">${title}</h1>
    <p class="composer-lead">${lead}</p>
    <nav class="composer-steps" aria-label="New job steps">
      ${NEW_JOB_STEPS.map(([id, label], index) => `
        <button type="button" data-action="composer-step" data-step="${index}"
                ${index > job.step ? "disabled" : ""}
                aria-current="${index === job.step ? "step" : "false"}">${index + 1} ${label}</button>`).join("")}
    </nav>
    <form data-form="composer">
      ${body}
      ${job.error ? `<p class="composer-error">${esc(job.error)}</p>` : ""}
      <div class="actions">
        ${job.step ? '<button class="btn" type="button" data-action="composer-back">Back</button>' : ""}
        <button class="btn btn-primary" type="submit"${job.saving ? " disabled" : ""}>
          ${last ? "Create job" : "Continue"}</button>
        <div class="spacer"></div>
        <button class="btn" type="button" data-action="composer-cancel">Cancel</button>
      </div>
    </form>`;
  el("composer-title")?.focus();
}

async function submitNewJob() {
  const job = state.newJob;
  job.saving = true;
  job.error = "";
  renderComposer();
  let created = null;
  try {
    created = await api.createRegisterProject({
      code: job.code,
      name: job.name,
      typeCode: job.typeCode || "",
      billingBasis: job.billingBasis || "",
      budgetEstimate: job.budgetEstimate,
      clientName: job.clientName,
      clientEmail: job.clientEmail,
      clientCell: job.clientCell,
      clientAddress: job.clientAddress,
      propertyDescription: job.propertyDescription,
      status: "open",
    });
  } catch (error) {
    job.saving = false;
    const message = error instanceof ApiError ? error.message : "Could not create the job";
    if (/already in use/i.test(message)) {
      job.step = 0;
      job.error = message;
    } else {
      job.error = message;
    }
    renderComposer();
    return;
  }
  state.returnView = null;
  state.newJob = null;
  state.tab = "overview";
  toast(`${created.project.code} created`);
  await loadProjects();
  await openJob(created.project.id, { tab: "overview" });
}

function timeHtml(project) {
  const f = project.financials;
  const bands = state.reference?.rateBands || [];
  const activities = state.reference?.activityTypes || [];
  return `
    <h3 class="sec">Log time <small>captured value is written once and never edited</small></h3>
    <form class="form" data-form="time" data-project="${esc(project.id)}">
      <div class="fields">
        <div class="field">
          <label for="t-date">Date</label>
          <input id="t-date" name="date" type="date" value="${today()}" required />
        </div>
        <div class="field">
          <label for="t-start">Start</label>
          <input id="t-start" name="start" type="time" />
        </div>
        <div class="field">
          <label for="t-end">End</label>
          <input id="t-end" name="end" type="time" />
        </div>
        <div class="field">
          <label for="t-minutes">Minutes</label>
          <input id="t-minutes" name="minutes" type="number" min="0" step="1" required />
        </div>
        <div class="field">
          <label for="t-activity">Activity</label>
          <select id="t-activity" name="activityType" required>
            ${activities.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="t-rule">Pricing</label>
          <select id="t-rule" name="pricingRule">
            <option value="tier_1920">Quarter-hour ladder (R480)</option>
            <option value="linear_32">Linear (R32 a minute)</option>
            <option value="band_hourly">Tariff band</option>
          </select>
        </div>
        <div class="field">
          <label for="t-band">Band</label>
          <select id="t-band" name="rateBandCode">
            ${bands.map((b) => `<option value="${esc(b.code)}">${esc(b.code)} &middot; ${esc(b.label)} &middot; ${money(b.hourlyRate)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="t-phase">Phase or task</label>
          <input id="t-phase" name="phaseRef" placeholder="Optional" />
        </div>
        <div class="field wide">
          <label for="t-description">Description on the certificate</label>
          <input id="t-description" name="description" required
                 placeholder="What the client will read, not &quot;Phone call&quot;" />
        </div>
      </div>
      <div class="preview" id="time-preview">
        <span>Enter a duration to see what it is worth.</span>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Log it</button>
        <div class="spacer"></div>
        <span class="note-line" style="margin:0">Captured ${money(f.captured)} of ${f.quoted === null ? "an unquoted fee" : money(f.quoted)}</span>
      </div>
    </form>

    <h3 class="sec">Entries <small>${state.entries.length} row${state.entries.length === 1 ? "" : "s"}</small></h3>
    ${state.entries.length ? `
      <div class="scroller"><table class="grid">
        <thead><tr>
          <th>Date</th><th>Who</th><th>Activity</th><th>Description</th>
          <th class="num">Time</th><th class="num">Captured</th><th>Billed on</th><th></th>
        </tr></thead>
        <tbody>${state.entries.map((entry) => {
          // Clocked on and never off, or time logged and priced at nothing.
          // A duration typed without clock times is the normal case.
          const broken = (entry.start && !entry.end)
            || (entry.minutes > 0 && entry.capturedAmount === 0);
          return `<tr${broken ? ' class="flagged"' : ""}>
            <td>${esc(entry.date)}</td>
            <td>${esc((entry.userEmail || "").split("@")[0])}</td>
            <td>${esc(entry.activityType)}</td>
            <td>${esc(entry.description)}${entry.phaseRef ? ` <span class="pill flat">${esc(entry.phaseRef)}</span>` : ""}</td>
            <td class="num">${duration(entry.minutes)}${broken ? ' <span class="pill err">broken</span>' : ""}</td>
            <td class="num">${money(entry.capturedAmount)}</td>
            <td>${entry.certificateId ? '<span class="pill ok">yes</span>' : '<span class="pill flat">not yet</span>'}</td>
            <td class="num"><button class="btn btn-sm" data-action="withdraw-entry"
                data-entry="${esc(entry.id)}">Withdraw</button></td>
          </tr>`;
        }).join("")}</tbody>
        <tfoot><tr>
          <td colspan="4">Captured, before anything is written down</td>
          <td class="num">${duration(state.entries.reduce((sum, e) => sum + e.minutes, 0))}</td>
          <td class="num">${money(state.entries.reduce((sum, e) => sum + e.capturedAmount, 0))}</td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table></div>
      <p class="note-line">A wrong row is withdrawn, not corrected: the entry stays, dated and
        attributed, and the total stops counting it. An hour already on an issued certificate
        cannot be withdrawn &mdash; that is a credit, not a deletion.</p>`
    : `<div class="empty">No time logged against this job.<br />
        Captured value is what the work actually cost the firm, whatever is eventually billed.</div>`}`;
}

function certificatesHtml(project) {
  const open = state.openCertificate;
  return `
    <h3 class="sec">Payment certificates
      <small>${state.certificates.length || "no"} certificate${state.certificates.length === 1 ? "" : "s"}</small>
    </h3>
    ${state.certificates.length ? `
      <table class="grid">
        <thead><tr>
          <th>No.</th><th>Period</th><th>Status</th>
          <th class="num">Subtotal</th><th class="num">Written down</th><th class="num">Net</th><th></th>
        </tr></thead>
        <tbody>${state.certificates.map((c) => `
          <tr>
            <td>${c.seq}</td>
            <td>${c.periodStart || c.periodEnd ? `${esc(c.periodStart || "…")} &ndash; ${esc(c.periodEnd || "…")}` : "&mdash;"}</td>
            <td><span class="pill ${c.status === "issued" ? "ok" : "flat"}">${esc(c.status)}</span></td>
            <td class="num">${money(c.subtotal)}</td>
            <td class="num">${c.writtenDown ? money(c.writtenDown) : "&mdash;"}</td>
            <td class="num">${money(c.net)}</td>
            <td class="num"><button class="btn btn-sm" data-action="open-certificate"
                data-certificate="${esc(c.id)}">${open?.id === c.id ? "Close" : "Open"}</button></td>
          </tr>`).join("")}</tbody>
      </table>`
    : `<div class="empty">Nothing has been certified on this job.</div>`}

    <div class="actions">
      <button class="btn btn-primary" data-action="new-certificate"
              data-project="${esc(project.id)}">Start a certificate</button>
    </div>

    ${open ? certificateHtml(open) : ""}`;
}

function certificateHtml(certificate) {
  const draft = certificate.status === "draft";
  const reasons = state.reference?.writeDownReasons || [];
  return `
    <h3 class="sec">Certificate ${certificate.seq}
      <small>${draft ? "draft &mdash; nothing has gone to the client" : `issued ${esc((certificate.issuedAt || "").slice(0, 10))}`}</small>
    </h3>
    <table class="grid">
      <thead><tr>
        <th>#</th><th>Source</th><th>Description</th>
        <th class="num">Hours</th><th class="num">Amount</th>
      </tr></thead>
      <tbody>${certificate.lines.length ? certificate.lines.map((line) => `
        <tr>
          <td>${line.seq}</td>
          <td><span class="pill flat">${esc(line.source)}</span></td>
          <td>${esc(line.description)}${line.phaseRef ? ` <span class="pill flat">${esc(line.phaseRef)}</span>` : ""}</td>
          <td class="num">${line.units === null ? "&mdash;" : line.units.toFixed(2)}</td>
          <td class="num">${money(line.amount)}</td>
        </tr>`).join("")
        : '<tr><td colspan="5" style="color:var(--ink-muted)">No lines yet.</td></tr>'}
      </tbody>
      <tfoot>
        <tr><td colspan="4">Subtotal</td><td class="num">${money(certificate.subtotal)}</td></tr>
        ${certificate.writeDowns.map((down) => `
          <tr><td colspan="4" style="font-weight:600">
            Less write-down &mdash; ${esc(down.reasonCode.replace(/_/g, " "))}
            ${down.pct ? ` (${percent(down.pct)})` : ""}
            ${down.note ? `<div style="font-weight:400;color:var(--ink-soft);font-size:11.5px">${esc(down.note)}</div>` : ""}
          </td><td class="num">-${money(down.amount)}</td></tr>`).join("")}
        <tr><td colspan="4">Net</td><td class="num">${money(certificate.net)}</td></tr>
        <tr><td colspan="4">VAT at ${percent(certificate.vatRate)}</td><td class="num">${money(certificate.vat)}</td></tr>
        <tr><td colspan="4">Total</td><td class="num">${money(certificate.total)}</td></tr>
      </tfoot>
    </table>

    ${draft ? `
      <div class="two" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:16px">
        <form class="form" data-form="lines-from-time" data-certificate="${esc(certificate.id)}">
          <div class="fields">
            <div class="field"><label for="c-from">From</label><input id="c-from" name="from" type="date" /></div>
            <div class="field"><label for="c-to">To</label><input id="c-to" name="to" type="date" /></div>
          </div>
          <div class="actions"><button class="btn btn-primary" type="submit">Pull unbilled time</button></div>
          <p class="note-line">Every unbilled hour in the range, oldest first. There is no
            sixteen-line limit &mdash; the workbook's macro had one, and the seventeenth hour
            simply never reached the client. An hour already on a line is skipped, so an
            overlapping range is a no-op rather than a second charge.</p>
        </form>

        ${billableTasksHtml(certificate)}

        <form class="form" data-form="schedule-line" data-certificate="${esc(certificate.id)}">
          <div class="fields">
            <div class="field wide">
              <label for="s-description">Fee schedule line</label>
              <input id="s-description" name="description" required placeholder="Phase 1: application lodged" />
            </div>
            <div class="field"><label for="s-amount">Amount</label>
              <input id="s-amount" name="amount" type="number" step="0.01" required /></div>
            <div class="field"><label for="s-phase">Phase</label>
              <input id="s-phase" name="phaseRef" placeholder="Optional" /></div>
          </div>
          <div class="actions"><button class="btn" type="submit">Add line</button></div>
        </form>

        <form class="form" data-form="write-down" data-certificate="${esc(certificate.id)}">
          <div class="fields">
            <div class="field">
              <label for="w-reason">Write-down reason</label>
              <select id="w-reason" name="reasonCode" required>
                ${reasons.map((reason) => `<option value="${esc(reason)}">${esc(reason.replace(/_/g, " "))}</option>`).join("")}
              </select>
            </div>
            <div class="field"><label for="w-pct">Percent</label>
              <input id="w-pct" name="pct" type="number" step="0.5" min="0" max="100" placeholder="20" /></div>
            <div class="field"><label for="w-amount">or Amount</label>
              <input id="w-amount" name="amount" type="number" step="0.01" min="0" /></div>
            <div class="field wide"><label for="w-note">Note</label>
              <input id="w-note" name="note" placeholder="Optional, but the next person will want it" /></div>
          </div>
          <div class="actions"><button class="btn" type="submit">Write down</button></div>
          <p class="note-line">The reason is compulsory. The firm cannot always recoup time from
            a client, and that is a decision, not an accident &mdash; this is what makes it
            reportable instead of invisible.</p>
        </form>
      </div>

      <div class="actions">
        <button class="btn btn-primary" data-action="issue-certificate"
                data-certificate="${esc(certificate.id)}">Issue this certificate</button>
        <span class="note-line" style="margin:0">Issuing is one way. A correction is the next certificate.</span>
      </div>`
    : `<p class="note-line">Issued, and therefore fixed. The captured time underneath it is
        unchanged: what the work cost the firm and what the client was asked to pay are two
        different numbers, and both are still here.</p>`}`;
}

/**
 * The third source of a certificate line, beside pulled time and a typed one.
 *
 * Each task is billed at its own fee where the template priced it that way
 * (`TOWNSHIP establishment`) and at a typed amount where the template prices
 * the phase instead (`REZONING`, `CONSENT USE`) - which is why the amount box
 * is always there, pre-filled when there is something to pre-fill with.
 */
function billableTasksHtml(certificate) {
  const billable = state.tasks.filter((task) => !task.certificateId
    && task.status !== "not_required");
  if (!state.tasks.length) return "";

  return `
    <form class="form" data-form="lines-from-tasks" data-certificate="${esc(certificate.id)}">
      <h4 style="margin:0 0 8px;font-family:var(--font-display);font-weight:560;font-size:0.9rem">
        Bill phase tasks</h4>
      ${billable.length ? `
        <div class="task-picker">
          ${billable.map((task) => `
            <label class="task-pick">
              <input type="checkbox" name="task" value="${esc(task.id)}" />
              <span>${esc(task.description)}
                <em>${esc(task.phaseLabel || "no phase")}${
  task.status === "done" ? " &middot; done" : ""}</em></span>
              <input type="number" step="0.01" name="amount" aria-label="Amount"
                     value="${task.defaultFee ?? ""}"
                     placeholder="${task.defaultFee === null ? "Amount" : ""}" />
            </label>`).join("")}
        </div>
        <div class="actions"><button class="btn btn-primary" type="submit">Bill the ticked tasks</button></div>
        <p class="note-line">Each line is tagged with the phase it was quoted under, so the fee
          schedule can show it against that phase rather than only in the total. A task is
          billable once.</p>`
    : `<div class="empty" style="padding:18px 12px">Every task on this job is either billed
        already or struck. A task is billable once.</div>`}
    </form>`;
}

// --- loading ----------------------------------------------------------------

async function loadProjects({ initial = false } = {}) {
  const { projects } = await api.listRegister();
  // Sorted here rather than in SQL: the ordering is a reading of four figures
  // the server already sends, and the day somebody wants it by code instead,
  // that is a click rather than a migration.
  state.projects = projects.slice().sort(byRisk);
  if (initial) {
    // No job is opened for you. The landing page is the practice, because the
    // question somebody has when they sign in is "what is going on", not
    // "what happens to sort first today".
    const params = new URLSearchParams(location.search);
    const requested = params.get("project");
    if (projects.some((p) => p.id === requested)) {
      state.selectedId = requested;
      state.view = "job";
      state.recentIds = [requested];
    } else {
      state.view = params.get("view") === "register" ? "register" : "practice";
    }
  } else if (state.view === "job" && !projects.some((p) => p.id === state.selectedId)) {
    state.view = "register";
    state.selectedId = null;
  }
  state.recentIds = state.recentIds.filter((id) => projects.some((p) => p.id === id));
}

/**
 * One request for the whole firm rather than one per tile. Held for the
 * session: a document only changes in the planner, and the way back from the
 * planner is a fresh page load.
 */
async function loadPreviews() {
  if (state.previews) return;
  const result = await api.drawingPreviews().catch(() => null);
  if (result) state.previews = new Map(result.previews.map((p) => [p.projectId, p]));
}

async function loadTab() {
  if (state.view === "practice") {
    // The one figure the register rows do not already carry is what was
    // captured this month.
    state.monthEntries = state.projects.length
      ? (await api.listTimeEntries({ from: monthStart(), to: today() })).entries
      : [];
    await loadPreviews();
    return;
  }
  const project = state.view === "job" ? selected() : null;
  if (!project) return;
  if (project.drawingId) await loadPreviews();
  // The phase strip sits in the header, above the tabs, so it is loaded for
  // every tab rather than by whichever one happens to want it.
  state.phases = (await api.phases(project.id).catch(() => null));
  if (state.tab === "overview") {
    state.tasks = (await api.listTasks(project.id)).tasks;
  } else if (state.tab === "schedule") {
    state.feeSchedule = (await api.feeSchedule(project.id)).feeSchedule;
  } else if (state.tab === "time") {
    state.entries = (await api.listTimeEntries({ project: project.id })).entries;
  } else if (state.tab === "certificates") {
    // The certificate builder offers unbilled tasks as a third line source.
    state.tasks = (await api.listTasks(project.id)).tasks;
    state.certificates = (await api.listCertificates(project.id)).certificates;
    if (state.openCertificate
      && !state.certificates.some((c) => c.id === state.openCertificate.id)) {
      state.openCertificate = null;
    }
  }
}

/** One path for "something changed": re-read, re-render, keep the user in place. */
async function refresh() {
  await loadProjects();
  await loadTab();
  renderMain();
}

// --- events -----------------------------------------------------------------

function formValues(form) {
  const out = {};
  for (const [key, value] of new FormData(form)) {
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

function updatePreview(form) {
  const node = form.querySelector("#time-preview");
  if (!node) return;
  const values = formValues(form);
  const derived = minutesBetween(values.start, values.end);
  const minutesField = form.querySelector('[name="minutes"]');
  // Start and end win over a typed duration, because that is the order the
  // clock is read in; a duration typed on its own is still honoured.
  if (derived !== null && document.activeElement !== minutesField) {
    minutesField.value = String(derived);
  }
  const minutes = Number(minutesField.value);
  const band = state.reference?.rateBands.find((b) => b.code === values.rateBandCode);
  const amount = previewAmount(minutes, values.pricingRule, band?.hourlyRate);
  const project = selected();
  const f = project?.financials;

  if (amount === null || !minutes) {
    node.className = "preview";
    node.innerHTML = "<span>Enter a duration to see what it is worth.</span>";
    return;
  }
  const after = (f?.captured ?? 0) + amount;
  const burnAfter = f?.quoted ? after / f.quoted : null;
  node.className = burnAfter !== null && burnAfter > 1 ? "preview over" : "preview";
  node.innerHTML = `
    <span>This row <strong>${money(amount)}</strong></span>
    <span>Captured after it <strong>${money(after)}</strong></span>
    ${burnAfter === null
      ? '<span>No quoted fee to measure against</span>'
      : `<span>Burn <strong>${percent(burnAfter)}</strong>${burnAfter > 1 ? " &mdash; past the fee" : ""}</span>`}`;
}

function wireGate() {
  el("gate-toggle").addEventListener("click", () => {
    state.signUpMode = !state.signUpMode;
    el("gate-org-field").hidden = !state.signUpMode;
    el("gate-submit").textContent = state.signUpMode ? "Create firm" : "Sign in";
    el("gate-toggle").textContent = state.signUpMode ? "I have an account" : "Create a firm";
    el("gate-password").autocomplete = state.signUpMode ? "new-password" : "current-password";
  });

  el("gate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    el("gate-error").textContent = "";
    const body = {
      email: el("gate-email").value.trim(),
      password: el("gate-password").value,
      orgName: el("gate-org").value.trim(),
    };
    try {
      state.session = state.signUpMode ? await api.signUp(body) : await api.signIn(body);
      await start();
    } catch (error) {
      el("gate-error").textContent = error instanceof ApiError
        ? error.message : "Could not reach the server";
    }
  });
}

function wireApp() {
  el("sign-out").addEventListener("click", async () => {
    await api.signOut();
    location.reload();
  });

  el("new-project").addEventListener("click", () => openNewJob());

  const composer = el("composer");
  composer.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset;
    if (!action || !state.newJob) return;
    if (action.action === "composer-cancel") {
      closeNewJob();
    } else if (action.action === "composer-back") {
      readComposerFields();
      state.newJob.step -= 1;
      state.newJob.error = "";
      renderComposer();
    } else if (action.action === "composer-step") {
      const index = Number(action.step);
      if (index >= state.newJob.step) return;
      readComposerFields();
      state.newJob.step = index;
      state.newJob.error = "";
      renderComposer();
    }
  });
  composer.addEventListener("change", (event) => {
    if (!state.newJob) return;
    const field = event.target.dataset.field;
    if (field === "billingBasis") {
      readComposerFields();
      const note = el("nj-budget-note");
      if (note) note.textContent = budgetNote(state.newJob.billingBasis);
    } else if (field === "typeCode") {
      readComposerFields();
      ensureRoadmap();
    }
  });
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.newJob || state.newJob.saving) return;
    readComposerFields();
    const error = composerStepError();
    state.newJob.error = error;
    if (error) {
      renderComposer();
      return;
    }
    if (state.newJob.step === NEW_JOB_STEPS.length - 1) {
      submitNewJob();
      return;
    }
    state.newJob.step += 1;
    state.newJob.error = "";
    renderComposer();
  });
  el("nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) goView(button.dataset.view);
  });

  el("switch-job").addEventListener("click", () => openSwitcher());

  // --- the switcher ---
  const switcher = el("switcher");
  switcher.addEventListener("click", (event) => {
    if (event.target === switcher) return closeSwitcher();
    const row = event.target.closest("[data-project]");
    if (!row) return;
    const id = row.dataset.project;
    closeSwitcher();
    openJob(id);
  });
  el("switcher-query").addEventListener("input", (event) => {
    if (!state.switcher) return;
    state.switcher.query = event.target.value;
    state.switcher.index = 0;
    renderSwitcher();
  });

  // A canvas holds pixels, not geometry, so a window that changes width
  // leaves every preview stretched until it is drawn again.
  let repaint = null;
  window.addEventListener("resize", () => {
    clearTimeout(repaint);
    repaint = setTimeout(paintPreviews, 120);
  });

  document.addEventListener("keydown", (event) => {
    const palette = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
    if (palette && state.view !== "new") {
      event.preventDefault();
      if (state.switcher) closeSwitcher();
      else openSwitcher();
      return;
    }
    if (state.switcher) {
      const rows = switcherMatches();
      if (event.key === "Escape") {
        event.preventDefault();
        closeSwitcher();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!rows.length) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        state.switcher.index = (state.switcher.index + step + rows.length) % rows.length;
        renderSwitcher();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const picked = rows[state.switcher.index];
        if (!picked) return;
        closeSwitcher();
        openJob(picked.id);
      }
      return;
    }
    if (event.key === "Escape" && state.view === "new" && !state.newJob?.saving) {
      closeNewJob();
    }
  });

  const main = el("main");

  main.addEventListener("click", async (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      state.tab = tab.dataset.tab;
      await loadTab();
      renderMain();
      return;
    }
    // A phase step is a button inside the header, and must be read before the
    // generic row handler: it is not a way of opening a different job.
    const step = event.target.closest("[data-phase]");
    if (step) {
      const project = selected();
      if (!project) return;
      const saved = await attempt(() => api.setPhase(project.id, {
        phaseRef: step.dataset.phase,
      }));
      if (!saved) return;
      state.phases = saved;
      state.phasePicker = false;
      toast(`Now in ${saved.current}`);
      await loadProjects();
      renderMain();
      return;
    }
    // Practice tiles and register rows both reach a job or a filtered list.
    const tile = event.target.closest("[data-goto-filter]");
    if (tile) return goView("register", { filter: tile.dataset.gotoFilter });
    const row = event.target.closest("[data-project]");
    if (row) return openJob(row.dataset.project);
    const sorter = event.target.closest("[data-sort]");
    if (sorter) {
      const column = sorter.dataset.sort;
      state.registerAsc = state.registerSort === column ? !state.registerAsc : false;
      state.registerSort = column;
      renderMain();
      return;
    }
    const chip = event.target.closest("[data-filter]");
    if (chip) {
      state.registerFilter = chip.dataset.filter;
      renderMain();
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset;
    if (!action) return;

    if (action.action === "go-register") return goView("register");
    if (action.action === "phase-picker" || action.action === "phase-cancel") {
      state.phasePicker = action.action === "phase-picker";
      renderMain();
      if (state.phasePicker) el("ph-ref")?.focus();
      return;
    }

    if (action.action === "drawing") {
      const button = event.target.closest("[data-action='drawing']");
      if (button) button.disabled = true;
      await goToDrawing(selected());
      if (button?.isConnected) button.disabled = false;
      return;
    }
    if (action.action === "add-schedule-row") {
      const rows = el("schedule-rows");
      const last = rows.lastElementChild;
      const copy = last.cloneNode(true);
      for (const input of copy.querySelectorAll("input")) input.value = "";
      for (const span of copy.querySelectorAll(".field > span")) span.className = "sr-only";
      rows.appendChild(copy);
      copy.querySelector("input")?.focus();
    } else if (action.action === "drop-schedule-row") {
      const rows = el("schedule-rows");
      // Never the last one. An empty form with no fields to type in is a dead
      // end, and "remove every phase" is what saving an empty schedule means.
      if (rows.children.length > 1) event.target.closest(".schedule-row").remove();
      else for (const input of rows.querySelectorAll("input")) input.value = "";
    } else if (action.action === "strike-task" || action.action === "unstrike-task") {
      const status = action.action === "strike-task" ? "not_required" : "not_started";
      const result = await attempt(() => api.updateTask(action.task, { status }));
      if (!result) return;
      state.tasks = result.tasks;
      renderMain();
    } else if (action.action === "withdraw-entry") {
      if (await attempt(() => api.deleteTimeEntry(action.entry))) await refresh();
    } else if (action.action === "new-certificate") {
      const created = await attempt(() => api.createCertificate(action.project, {}));
      if (created) {
        state.openCertificate = created.certificate;
        await refresh();
      }
    } else if (action.action === "open-certificate") {
      state.openCertificate = state.openCertificate?.id === action.certificate
        ? null
        : (await attempt(() => api.getCertificate(action.certificate)))?.certificate ?? null;
      renderMain();
    } else if (action.action === "issue-certificate") {
      const issued = await attempt(() => api.issueCertificate(action.certificate));
      if (issued) {
        state.openCertificate = issued.certificate;
        toast(`Certificate ${issued.certificate.seq} issued`);
        await refresh();
      }
    }
  });

  main.addEventListener("input", (event) => {
    if (event.target.id === "register-query") {
      state.registerQuery = event.target.value;
      const caret = event.target.selectionStart;
      renderMain();
      // The panel is re-rendered wholesale, so the box that was being typed
      // into no longer exists. Put the cursor back where the keystroke left it.
      const box = el("register-query");
      if (box) {
        box.focus();
        box.setSelectionRange(caret, caret);
      }
      return;
    }
    const form = event.target.closest('[data-form="time"]');
    if (form) updatePreview(form);
  });

  main.addEventListener("change", async (event) => {
    const select = event.target.closest('[data-action="task-status"]');
    if (!select) return;
    const result = await attempt(() => api.updateTask(select.dataset.task, {
      status: select.value,
    }));
    if (!result) return;
    state.tasks = result.tasks;
    renderMain();
  });

  main.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const kind = form.dataset.form;
    const values = formValues(form);

    if (kind === "fee-schedule") {
      // Read the rows off the DOM rather than FormData: every row uses the
      // same two field names, and pairing them by position is the only thing
      // that keeps a label with its own figure.
      const lines = [...form.querySelectorAll(".schedule-row")].map((row) => ({
        label: row.querySelector('[name="label"]').value.trim(),
        quoted: Number(row.querySelector('[name="quoted"]').value),
      })).filter((line) => line.label);
      const saved = await attempt(() => api.setFeeSchedule(form.dataset.project, lines));
      if (!saved) return;
      state.feeSchedule = saved.feeSchedule;
      toast(lines.length
        ? `Fee schedule saved: ${lines.length} phase${lines.length === 1 ? "" : "s"}, ${money(saved.feeSchedule.quoted)}`
        : "Fee schedule cleared. Burn falls back to the register budget.");
      await refresh();
    } else if (kind === "phase") {
      const saved = await attempt(() => api.setPhase(form.dataset.project, {
        phaseRef: values.phaseRef,
        note: values.note || null,
      }));
      if (!saved) return;
      state.phases = saved;
      state.phasePicker = false;
      toast(`Now in ${saved.current}`);
      await loadProjects();
      renderMain();
    } else if (kind === "update") {
      const saved = await attempt(() => api.updateRegisterProject(form.dataset.project, values));
      if (!saved) return;
      toast("Saved");
      await refresh();
    } else if (kind === "time") {
      const result = await attempt(() => api.createTimeEntry({
        ...values,
        projectId: form.dataset.project,
        minutes: Number(values.minutes),
        // Only meaningful for the band rule; sending it otherwise would record
        // a band against an entry that was not priced from one.
        rateBandCode: values.pricingRule === "band_hourly" ? values.rateBandCode : null,
      }));
      if (!result) return;
      const burn = result.financials.burn;
      toast(burn !== null && burn > 1
        ? `Logged. This job is now at ${percent(burn)} of its fee.`
        : `Logged ${money(result.entry.capturedAmount)}.`);
      await refresh();
    } else if (kind === "lines-from-time") {
      const result = await attempt(() => api.addLinesFromTime(form.dataset.certificate, values));
      if (!result) return;
      state.openCertificate = result.certificate;
      toast(`${result.certificate.lines.length} line(s) on the certificate`);
      await refresh();
    } else if (kind === "add-task") {
      const result = await attempt(() => api.addTask(form.dataset.project, {
        description: values.description,
        phaseLabel: values.phaseLabel || null,
        defaultFee: values.defaultFee || null,
      }));
      if (!result) return;
      state.tasks = result.tasks;
      toast("Task added");
      renderMain();
    } else if (kind === "lines-from-tasks") {
      // Paired by row, not by FormData: every row shares the same two field
      // names and only the ticked ones are being billed.
      const picked = [...form.querySelectorAll(".task-pick")]
        .filter((row) => row.querySelector('[name="task"]').checked)
        .map((row) => ({
          taskId: row.querySelector('[name="task"]').value,
          amount: row.querySelector('[name="amount"]').value || null,
        }));
      if (!picked.length) return toast("Tick a task to bill first", true);
      const result = await attempt(() => api.addLinesFromTasks(form.dataset.certificate, picked));
      if (!result) return;
      state.openCertificate = result.certificate;
      toast(`${picked.length} task${picked.length === 1 ? "" : "s"} billed`);
      await refresh();
    } else if (kind === "schedule-line") {
      const result = await attempt(() => api.addScheduleLine(form.dataset.certificate, values));
      if (!result) return;
      state.openCertificate = result.certificate;
      await refresh();
    } else if (kind === "write-down") {
      // A percentage is typed as 20, stored as 0.2. One of the two fields.
      const body = {
        reasonCode: values.reasonCode,
        note: values.note || null,
        amount: values.amount ? Number(values.amount) : null,
        pct: values.amount ? null : (values.pct ? Number(values.pct) / 100 : null),
      };
      const result = await attempt(() => api.addWriteDown(form.dataset.certificate, body));
      if (!result) return;
      state.openCertificate = result.certificate;
      toast(`${money(result.certificate.writtenDown)} written down`);
      await refresh();
    }
  });
}

// --- boot -------------------------------------------------------------------

async function start() {
  el("gate").hidden = true;
  el("app").hidden = false;
  el("who").textContent = `${state.session.email} · ${state.session.orgName || "—"}`;
  state.reference = await api.reference();
  await loadProjects({ initial: true });
  await loadTab();
  renderMain();
}

async function boot() {
  wireGate();
  wireApp();
  const session = await api.session().catch(() => ({ signedIn: false }));
  if (session.signedIn) {
    state.session = session;
    await start();
  } else {
    el("gate").hidden = false;
  }
}

boot();
