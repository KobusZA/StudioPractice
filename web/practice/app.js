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
import { mountTemplateEditor } from "./settings.js";
import { mountFirmSettings } from "./firm.js";
import { mountTeam } from "./team.js";

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
  // The phase drilled into from a Fee schedule row, matched against time
  // entries and certificate lines the same way the server does (trimmed,
  // case-insensitive label match). Survives tab switches and trips to
  // Practice/Register like `tab` does; cleared only when the job itself
  // changes (see `openJob`), because "which phase was I looking at" is
  // scoped to one job, not carried into a different one.
  selectedPhaseRef: null,
  entries: [],
  certificates: [],
  openCertificate: null,
  feeSchedule: null,
  tasks: [],
  monthEntries: [],
  signUpMode: false,
  returnView: null,
  newJob: null,
  // The "My time" screen: one person's log across every job. Built lazily by
  // ensureMyTime() the first time the view is opened.
  myTime: null,
  // The firm's letterhead, loaded when a certificate is opened (owner only).
  orgSettings: null,
  // Staff, for the certificate's "whose time" filter (owner only).
  team: [],
};

const el = (id) => document.getElementById(id);

/**
 * PERMISSIONS-PROPOSAL.md's gate, read off the session the server already
 * sent. Money fields the server redacted already render as "&mdash;" through
 * `money()`/`percent()` below - the same "a gap is shown, never a guessed
 * zero" rule this app already used for "nobody has budgeted this job yet".
 * What this helper is for is the other half: hiding the *write* forms
 * (start a certificate, add a line, write a schedule) that would otherwise
 * sit on screen and 403 the moment somebody without the capability submits
 * them - "hide, don't disable" (PERMISSIONS-PROPOSAL.md Â§"web/practice/").
 */
function canViewBilled() {
  return Boolean(state.session?.capabilities?.canViewBilled);
}

function isOwner() {
  return state.session?.role === "owner";
}

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

/**
 * Matches a fee-schedule label against a time entry's or certificate line's
 * `phaseRef` the same way the server does (`upper(btrim(...))`), so a phase
 * drilled into from the fee schedule never disagrees with what the totals on
 * that same schedule were built from.
 */
const phaseKey = (value) => (value || "").trim().toUpperCase();
const samePhase = (a, b) => {
  const key = phaseKey(a);
  return key !== "" && key === phaseKey(b);
};

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
/** The day after an ISO date, so a new period starts where the last one ended. */
const dayAfter = (iso) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + 86400000)
  .toISOString().slice(0, 10);

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

  // Every warning below reads a billed-tier field (`quoted`, `captured`,
  // `certifiedGross`, `budgetEstimate`, ...), which the server has already
  // redacted to `null` for a role without `canViewBilled`. Skipping the
  // whole block rather than letting each check run against nulls matters for
  // one of them specifically: "fixed fee with no quoted figure" would
  // otherwise read `money_.quoted === null` as true for *every* fixed-fee
  // job an employee opens, quote or no quote - a false warning invented by
  // the redaction itself, which is exactly what this codebase's "never
  // invent, always show the real gap" rule exists to prevent.
  if (!canViewBilled()) {
    if (project.status === "halted" || project.status === "on_hold") {
      out.push({
        level: "med",
        title: project.status === "halted" ? "Halted" : "On hold",
        body: "Time logged against a job in this state should be deliberate.",
      });
    }
    return out;
  }

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
    // `quoted === null` means two different things depending on who is
    // looking: a real gap in the register, or a field the server redacted
    // because this viewer lacks `canViewBilled`. Without the guard, every
    // job would match for an employee - not "no fee entered", just "you
    // cannot see it" misreported as a data gap.
    match: (p) => canViewBilled() && p.financials.quoted === null,
  },
};

/**
 * `[key, label, numeric, billedOnly]`. A billed-only column is removed for a
 * role the money is hidden from, not filled with em dashes: "hide, don't
 * disable" - a spreadsheet-era reader takes a row of blank money cells for
 * data, and a table two columns narrower reads as a table with two fewer
 * questions rather than as two answers withheld.
 */
const REGISTER_COLUMNS = [
  ["code", "Code", false],
  ["name", "Job", false],
  ["client", "Client", false],
  ["type", "Type", false],
  ["phase", "Phase", false],
  ["status", "Status", false],
  ["quoted", "Quoted", true, true],
  ["captured", "Captured", true, true],
  // One bar where burn and realisation used to be two columns, and where
  // certified, written down and uncertified were never columns at all - the
  // register had no room for eight money headings, so the owner did the
  // arithmetic between the four it had. Sorting this column sorts by burn,
  // which is the thing the eye picks a bar out for; realisation is on the bar's
  // own second line, so neither reading has been lost.
  ["burn", "Against the fee", false],
];

const registerColumns = () => REGISTER_COLUMNS.filter(
  ([, , , billedOnly]) => !billedOnly || canViewBilled(),
);

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

  const head = registerColumns().map(([key, label, numeric]) => {
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
      <td>${esc(project.clientName || "â€”")}</td>
      <td>${esc(type?.name || project.typeCode || "â€”")}</td>
      <td>${project.currentPhase
    ? `${esc(project.currentPhase)}<em>${dayCount(daysSince(project.phaseSince))}</em>`
    : '<span class="pill flat">not stated</span>'}</td>
      <td>${project.status === "open" ? "open"
    : `<span class="pill warn">${esc(String(project.status || "â€”").replace(/_/g, " "))}</span>`}</td>
      ${canViewBilled() ? `
      <td class="num">${money(f.quoted)}</td>
      <td class="num">${money(f.captured)}</td>` : ""}
      <td class="feebar-cell">${feeBar(f, {
    size: "compact", basis: project.billingBasis, linkTab: true, gapNote: false,
  }) || `<span class="real ${f.burn === null ? "flat" : f.burn > 1 ? "bad" : f.burn >= 0.8 ? "mid" : "flat"}"
             title="Captured &divide; quoted">${f.burn === null ? "no fee" : percent(f.burn)}</span>`}</td>
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
       said anything yet.${canViewBilled()
    ? ` The bar reads left to right &mdash; invoiced, written down, on a draft, ready to
        invoice, not yet earned &mdash; and a dashed tail past its end is an overrun. Click a
        segment to open the job at the rows behind it.`
    : ` Against the fee is captured hours over the quoted fee. The fee itself, and what has
        been billed of it, are an owner's to see.`}`
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
  el("nav-templates").hidden = !isOwner();
  el("nav-firm").hidden = !isOwner();
  el("nav-team").hidden = !isOwner();

  // The sticky-selection pill: shows the job `selectedId` still points at,
  // whenever that job is not the one already on screen. Selecting a
  // different job (register row, switcher, KPI drill-through) overwrites
  // `selectedId`, so this always follows the most recent choice rather than
  // the first one â€” the same behaviour Vantagepoint documents for its hub.
  const pill = el("current-job");
  const job = selected();
  const inJob = state.view === "job" && Boolean(job);
  const showPill = Boolean(job) && state.view !== "new";
  pill.hidden = !showPill;
  // Inside a job the pill is the "you are here" marker; Register stays lit
  // only as its parent section.
  pill.classList.toggle("is-here", inJob);
  pill.setAttribute("aria-current", inJob ? "page" : "false");
  el("nav").querySelector('[data-view="register"]')?.classList.toggle("is-parent", inJob);
  if (inJob) {
    pill.innerHTML = `${esc(job.code || "no code")} <span class="muted">${esc(job.name || "Untitled")}</span>`;
    pill.title = "You are in this job";
  } else if (showPill) {
    pill.innerHTML = `${esc(job.code || "no code")} <span class="muted">&rarr; ${esc(job.name || "Untitled")}</span>`;
    pill.title = state.selectedPhaseRef
      ? `Back to ${job.code || "the job"}, viewing ${state.selectedPhaseRef} on ${state.tab || "overview"}`
      : `Back to ${job.code || "the job"} you were in, on the ${state.tab || "overview"} tab`;
  }
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
  if (state.view === "time") {
    // The composer's typed-but-unsent fields survive a re-render (a withdrawn
    // row, a changed day) the same way the job page's do - except straight
    // after a save, when the draft has just been rebuilt on purpose and the
    // old DOM would put the last description back.
    const mt = ensureMyTime();
    const pending = mt.fresh ? null : capturePendingEdits(main);
    mt.fresh = false;
    main.innerHTML = `<div class="panel wrap">${myTimeHtml()}</div>`;
    if (pending) restorePendingEdits(main, pending);
    const composerForm = main.querySelector('[data-form="mytime"]');
    if (composerForm) {
      syncMyTimeProject(composerForm);
      updatePreview(composerForm);
    }
    syncAddress();
    return;
  }
  if (state.view === "team") {
    // Owner-only; a non-owner who types ?view=team lands on the register.
    if (!isOwner()) {
      state.view = "register";
      renderMain();
      return;
    }
    main.innerHTML = `<div class="panel wrap" id="team-host"></div>`;
    mountTeam(main.querySelector("#team-host"), { toast });
    syncAddress();
    return;
  }
  if (state.view === "firm") {
    if (!isOwner()) {
      state.view = "register";
      renderMain();
      return;
    }
    main.innerHTML = `<div class="panel wrap" id="firm-host"></div>`;
    mountFirmSettings(main.querySelector("#firm-host"), {
      toast,
      onSaved: (settings) => { state.orgSettings = settings; },
    });
    syncAddress();
    return;
  }
  if (state.view === "templates") {
    // Owner-only; a non-owner who types ?view=templates lands on the register.
    if (!isOwner()) {
      state.view = "register";
      renderMain();
      return;
    }
    let host = main.querySelector("#tpl-host");
    if (!host) {
      main.innerHTML = `<div class="panel wrap" id="tpl-host"></div>`;
      host = main.querySelector("#tpl-host");
    }
    mountTemplateEditor(host, {
      projectTypes: (state.reference?.projectTypes ?? []),
      toast,
    });
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
  // Ticking one task's status, striking another, or any other action on this
  // page calls renderMain() to pick up the change, and renderMain() rebuilds
  // the whole job view from `state` â€” which knows nothing about a keystroke
  // nobody has submitted yet. Without capturing it first, typing into "Add a
  // task" or the Register form and then, say, striking an unrelated task
  // makes the field you were mid-sentence in "snap back" to empty.
  const pending = capturePendingEdits(main);
  main.innerHTML = `
    <div class="proj-head">
      <nav class="crumbs" aria-label="Breadcrumb">
        <button type="button" data-action="go-register">&larr; Register</button>
        <span class="crumb-code">${esc(project.code || "NO CODE")}</span>
      </nav>
      <div class="proj-head-row">
        <div>
          <h1>${esc(project.name || "Untitled")}</h1>
          <div class="facts">
            <span>Client <b>${esc(project.clientName || "â€”")}</b></span>
            <span>Type <b>${esc(type?.name || project.typeCode || "â€”")}</b></span>
            <span>Basis <b>${project.billingBasis === "time_and_materials" ? "Time &amp; materials" : project.billingBasis === "fixed_fee" ? "Fixed fee" : "â€”"}${
  project.feeCeiling && canViewBilled() ? ' <span class="pill warn" title="Billing stops at the quoted fee">ceiling</span>' : ""}</b></span>
            <span>Status <b>${esc(project.status || "â€”")}</b></span>
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
  restorePendingEdits(main, pending);
  paintPreviews();
  syncAddress();
}

/**
 * Field IDs on the job page whose value is typed but not yet submitted: the
 * add-a-task row, and the Register form (id="f-*"). Everything else on this
 * page either has no local draft state (it re-renders from the server's
 * answer) or saves on every change (the per-task status dropdown), so there
 * is nothing there for a re-render to lose.
 */
const DRAFT_FIELD_IDS = [
  "nt-description", "nt-phase", "nt-fee",
  "f-code", "f-name", "f-type", "f-basis", "f-budget", "f-status",
  "f-client", "f-email", "f-cell", "f-address", "f-property",
  // The My time composer. The phase select and its freehand box are not here:
  // they are kept in `state.myTime.draft`, because their options arrive after
  // the render and a restored value would have nothing to match.
  "mt-project", "mt-start", "mt-end", "mt-minutes", "mt-activity",
  "mt-description", "mt-prints", "mt-travel", "mt-rule", "mt-band",
];

function capturePendingEdits(main) {
  const values = {};
  for (const id of DRAFT_FIELD_IDS) {
    const field = main.querySelector(`#${id}`);
    if (field) values[id] = field.value;
  }
  const snapshot = { values };
  const active = document.activeElement;
  if (active && DRAFT_FIELD_IDS.includes(active.id)) {
    snapshot.focusId = active.id;
    if (typeof active.selectionStart === "number") {
      snapshot.selectionStart = active.selectionStart;
      snapshot.selectionEnd = active.selectionEnd;
    }
  }
  return snapshot;
}

function restorePendingEdits(main, snapshot) {
  for (const [id, value] of Object.entries(snapshot.values)) {
    const field = main.querySelector(`#${id}`);
    if (field && field.value !== value) field.value = value;
  }
  if (!snapshot.focusId) return;
  const field = main.querySelector(`#${snapshot.focusId}`);
  if (!field) return;
  field.focus();
  if (typeof snapshot.selectionStart === "number" && typeof field.setSelectionRange === "function") {
    field.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

// --- combobox (replaces `<input list>`) --------------------------------
//
// See the comment on `.combo-menu` in practice.css for why this exists
// instead of the native datalist popup: Chromium can close its own
// suggestion list within the same click that opened it, and no CSS or
// `autocomplete` value talks it out of that race. This is the whole
// dropdown - open, filter, pick, close - owned by us instead.

function comboMenuFor(input) {
  return input.closest(".combo")?.querySelector("[data-combo-menu]") || null;
}

/** Shows the menu (unless it has nothing to offer) filtered to what's typed. */
function filterCombo(input) {
  const menu = comboMenuFor(input);
  if (!menu) return;
  const query = input.value.trim().toLowerCase();
  let visible = 0;
  for (const li of menu.children) {
    // `data-search` lets a row match on more than the value it inserts: the
    // job picker inserts a code but should also find "bon accord" or a client.
    const hay = `${li.dataset.value} ${li.dataset.search || ""}`.toLowerCase();
    const match = !query || hay.includes(query);
    li.hidden = !match;
    li.classList.remove("active");
    if (match) visible += 1;
  }
  menu.hidden = visible === 0;
}

function closeCombo(input) {
  const menu = comboMenuFor(input);
  if (menu) menu.hidden = true;
}

function pickCombo(li) {
  const menu = li.closest("[data-combo-menu]");
  const input = menu?.closest(".combo")?.querySelector("[data-combo-input]");
  if (!input || li.hidden) return;
  input.value = li.dataset.value;
  closeCombo(input);
  input.focus();
  // A pick sets the value without an `input` event, so anything derived from
  // the field has to be told.
  if (input.id === "mt-project") syncMyTimeProject(input.closest("form"));
  if (input.closest('[data-form="mytime"]')) {
    const form = input.closest("form");
    if (form) updatePreview(form);
  }
}

/** The currently-highlighted (arrow-key) row, or null. */
function comboActive(menu) {
  return menu.querySelector("li.active");
}

function comboMove(input, step) {
  const menu = comboMenuFor(input);
  if (!menu || menu.hidden) return;
  const rows = [...menu.children].filter((li) => !li.hidden);
  if (!rows.length) return;
  const current = comboActive(menu);
  const at = current ? rows.indexOf(current) : -1;
  const next = rows[(at + step + rows.length) % rows.length];
  for (const li of rows) li.classList.toggle("active", li === next);
  next.scrollIntoView({ block: "nearest" });
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
  } else if (state.view === "templates") {
    url.searchParams.delete("project");
    url.searchParams.set("view", "templates");
  } else if (state.view === "time" || state.view === "firm" || state.view === "team") {
    url.searchParams.delete("project");
    url.searchParams.set("view", state.view);
  } else if (state.view === "practice") {
    url.searchParams.delete("project");
    url.searchParams.delete("view");
  }
  const next = `${url.pathname}${url.search}`;
  if (next !== `${location.pathname}${location.search}`) history.replaceState(null, "", next);
}

/** One path into a job, so "recently opened" is always true. */
async function openJob(id, { tab } = {}) {
  if (state.selectedId !== id) state.selectedPhaseRef = null;
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
      // An empty drawing is already shown as hatched paper; no caption needed.
      note.textContent = preview ? "" : "Drawing not loaded";
      if (preview) canvas.closest(".dwg")?.setAttribute("title", "Started, nothing drawn on it yet");
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
          <div class="combo">
            <input id="ph-ref" name="phaseRef" required autocomplete="off"
                   data-combo-input data-lpignore="true" data-1p-ignore data-bwignore
                   data-protonpass-ignore="true"
                   value="" placeholder="${esc(phases[0]?.ref || "Submitted to council")}" />
            <ul class="combo-menu" data-combo-menu hidden>
              ${phases.map((phase) => `<li data-value="${esc(phase.ref)}">${esc(phase.ref)}</li>`).join("")}
            </ul>
          </div>
        </div>
        <div class="field wide">
          <label for="ph-note">Note</label>
          <input id="ph-note" name="note" placeholder="Optional â€” why it moved" />
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
  // `null`, not a summed zero, without the capability - `e.capturedAmount`
  // is already `null` per entry (server/src/store.js's `timeEntryRow`), and
  // summing nulls with `+` would silently coerce each one to 0 and print a
  // real-looking "R0.00" rather than the gap this app's "never invent a
  // number" rule requires.
  const capturedThisMonth = canViewBilled()
    ? state.monthEntries.reduce((sum, e) => sum + e.capturedAmount, 0)
    : null;
  const minutesThisMonth = state.monthEntries.reduce((sum, e) => sum + e.minutes, 0);

  // Only jobs with a fee, because the bar's whole width is the fee. A job with
  // neither a schedule nor a budget estimate has no denominator, and folding it
  // in at zero would leave its captured hours in the numerator - making the
  // practice look further past its fees than it is, off a gap in the register.
  const quotedJobs = canViewBilled()
    ? jobs.filter((p) => p.financials.quoted !== null && p.financials.quoted > 0)
    : [];
  const aggregate = aggregateFinancials(quotedJobs);

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

    ${canViewBilled() && quotedJobs.length ? `
    <h3 class="sec">Against the fee
      <small>every job with a fee, added up &mdash; ${quotedJobs.length} of ${jobs.length}</small>
    </h3>
    ${feeBar(aggregate, { linkTab: false })}
    <p class="note-line">The same bar, the same segments and the same words as a register row and
      a job header; only the width is the whole practice rather than one job.
      ${jobs.length - quotedJobs.length > 0
    ? `${jobs.length - quotedJobs.length} job${jobs.length - quotedJobs.length === 1 ? " has" : "s have"}
       neither a fee schedule nor a budget estimate and ${jobs.length - quotedJobs.length === 1 ? "is" : "are"}
       left out rather than counted at a fee of zero &mdash; which would make every percentage here
       read better than it is.`
    : "Every job in the register has a fee to measure against."}</p>` : ""}

    ${readyToInvoiceHtml()}

    ${unrecoverableReportHtml()}

    ${attentionHtml()}

    ${whereTheWorkIsHtml()}

    ${drawingsHtml()}

    ${recent.length ? `
      <h3 class="sec">Recently opened</h3>
      <table class="grid"><tbody>${recent.map((project) => `
        <tr class="row-link" data-project="${esc(project.id)}">
          <td><span class="code-cell">${esc(project.code || "no code")}</span></td>
          <td>${esc(project.name || "Untitled")}</td>
          <td>${esc(project.clientName || "â€”")}</td>
          <td class="num">${project.financials.burn === null ? "&mdash;"
    : `<span class="real ${project.financials.burn > 1 ? "bad" : "flat"}">${percent(project.financials.burn)}</span>`}</td>
        </tr>`).join("")}</tbody></table>` : ""}`;
}

/**
 * "What can I invoice right now, and how much is it?"
 *
 * The count tile above answers a narrower question - which jobs have never been
 * billed at all - and leaves the owner to open each one to find out what is in
 * it. This is the same figure the register already carries per job
 * (`uncertifiedCaptured`: captured hours on no certificate line), ordered by
 * amount, with the draft it would start attached to the row.
 *
 * Every job with an uncertified tail appears, not only the never-billed ones. A
 * job invoiced every month has the same question asked of it, and it is the one
 * the workbook answered by somebody remembering.
 */
/**
 * Money the firm did the work for and will not be paid for, and why.
 *
 * Two kinds, kept apart because they are different sentences. What has been
 * written down on an issued certificate has a reason on it; what has gone past
 * a fixed or capped fee and has no write-down yet is a loss nobody has named.
 * The second is the one that turns into the first when somebody sits down to
 * invoice, and seeing it here is what makes that a decision instead of a
 * surprise. Built from the register rows the page already holds: no request.
 */
function unrecoverableReportHtml() {
  if (!canViewBilled()) return "";
  const byReason = new Map();
  for (const project of state.projects) {
    for (const { reasonCode, amount } of project.financials.writtenDownByReason ?? []) {
      const entry = byReason.get(reasonCode) ?? { amount: 0, jobs: [] };
      entry.amount = cents(entry.amount + amount);
      entry.jobs.push(project.code || project.name || "no code");
      byReason.set(reasonCode, entry);
    }
  }
  // Past the fee with nothing written down against it yet. A T&M job's overrun
  // is the invoice, so only fixed-fee and capped jobs count.
  const unnamed = state.projects.map((project) => {
    const f = project.financials;
    if (project.billingBasis === "time_and_materials" && !project.feeCeiling) return null;
    if (f.quoted === null || f.captured === null) return null;
    const open = cents(f.captured - f.quoted - (f.writtenDown ?? 0));
    return open > 0 ? { project, open } : null;
  }).filter(Boolean).sort((a, b) => b.open - a.open);

  if (!byReason.size && !unnamed.length) {
    return `<h3 class="sec">Unrecoverable, by reason</h3>
      <div class="empty">Nothing has been written down, and no fixed-fee job is past its fee.</div>`;
  }
  const rows = [...byReason.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const total = cents(rows.reduce((sum, [, entry]) => sum + entry.amount, 0));
  const open = cents(unnamed.reduce((sum, entry) => sum + entry.open, 0));
  const label = (code) => (code === "legacy_unspecified" ? "no reason recorded" : code.replace(/_/g, " "));
  const jobList = (jobs) => {
    const unique = [...new Set(jobs)];
    return `${unique.slice(0, 5).map(esc).join(", ")}${unique.length > 5 ? `, +${unique.length - 5} more` : ""}`;
  };
  return `
    <h3 class="sec">Unrecoverable, by reason
      <small>${money(total)} written down${open ? `, ${money(open)} more past a fee with no reason yet` : ""}</small>
    </h3>
    <table class="grid">
      <thead><tr><th>Reason</th><th>Jobs</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${rows.map(([code, entry]) => `<tr>
          <td>${esc(label(code))}${code === "legacy_unspecified" ? ' <span class="pill err">unexplained</span>' : ""}</td>
          <td>${jobList(entry.jobs)}</td>
          <td class="num">${money(entry.amount)}</td>
        </tr>`).join("")}
        ${unnamed.length ? `<tr class="flagged">
          <td>Past the fee, not yet written down <span class="pill warn">no reason</span></td>
          <td>${jobList(unnamed.map((entry) => entry.project.code || entry.project.name || "no code"))}</td>
          <td class="num">${money(open)}</td>
        </tr>` : ""}
      </tbody>
    </table>
    <p class="note-line">Written-down amounts are from issued certificates only. &ldquo;Past the
      fee&rdquo; is captured beyond the quote on fixed-fee and capped jobs, less anything already
      written down: work the client will not be asked to pay for and that nobody has given a
      reason. Time-and-materials overruns are billable, so they are not counted.</p>`;
}

function readyToInvoiceHtml() {
  if (!canViewBilled()) return "";
  const queue = state.projects
    .filter((p) => (p.financials.uncertifiedCaptured ?? 0) > 0)
    .sort((a, b) => b.financials.uncertifiedCaptured - a.financials.uncertifiedCaptured);
  if (!queue.length) {
    return `<h3 class="sec">Ready to invoice</h3>
      <div class="empty">Every captured hour in the register is on a certificate line.<br />
        Nothing is sitting unbilled.</div>`;
  }
  const total = cents(queue.reduce((sum, p) => sum + p.financials.uncertifiedCaptured, 0));
  return `
    <h3 class="sec">Ready to invoice
      <small>${money(total)} across ${queue.length} job${queue.length === 1 ? "" : "s"}, largest first</small>
    </h3>
    <table class="grid">
      <thead><tr>
        <th>Code</th><th>Job</th><th>Client</th><th>Basis</th>
        <th>Last certificate</th><th class="num">Uncertified</th><th></th>
      </tr></thead>
      <tbody>${queue.map((project) => {
    const f = project.financials;
    const last = project.lastCertificate;
    return `<tr>
        <td><span class="code-cell">${esc(project.code || "no code")}</span></td>
        <td>${esc(project.name || "Untitled")}</td>
        <td>${esc(project.clientName || "â€”")}</td>
        <td>${project.billingBasis === "time_and_materials" ? "T&amp;M" : "Fixed fee"}${
  project.feeCeiling
    ? `<br /><span class="pill warn" title="Draft it pulls every hour, then proposes writing down what is past the ceiling">ceiling${
      f.ceilingRoom === null ? "" : `: ${money(f.ceilingRoom)} left`}</span>` : ""}</td>
        <td>${last
    ? `#${last.seq}${last.periodEnd ? ` to ${esc(last.periodEnd.slice(0, 10))}` : ""}
         ${daysSince(last.issuedAt) === null ? "" : `<em class="muted">issued ${
    daysSince(last.issuedAt) === 0 ? "today" : `${dayCount(daysSince(last.issuedAt))} ago`}</em>`}`
    : '<span class="pill warn">never certified</span>'}</td>
        <td class="num">${money(f.uncertifiedCaptured)}</td>
        <td class="num">
          <button class="btn btn-sm btn-primary" data-ready-draft="${esc(project.id)}"
                  data-from="${esc(last?.periodEnd ? last.periodEnd.slice(0, 10) : "")}"
                  >Draft it</button>
          <button class="btn btn-sm" data-open-tab="time"
                  data-project="${esc(project.id)}">The hours</button>
        </td>
      </tr>`;
  }).join("")}</tbody>
      <tfoot><tr><td colspan="5">Captured and not on any certificate</td>
        <td class="num">${money(total)}</td><td></td></tr></tfoot>
    </table>
    <p class="note-line"><b>Draft it</b> starts a draft certificate and pulls the unbilled hours,
      from the day after the last issued certificate's period ended up to today &mdash; or the
      whole job where none has been issued. The draft is a draft: nothing reaches the client
      until it is issued, and an hour already on a line is skipped, so the range can overlap
      without charging twice.</p>`;
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
  // The bar's width is the phase's quoted fee, so without the gate there is
  // nothing to draw and the column goes rather than standing there empty.
  const showBars = canViewBilled();

  // Each row is a way into that phase's own time and certificate lines, not
  // just a total. Matched the same way the server matches them (trimmed,
  // case-insensitive label), so "click the row" and "what the fee-schedule
  // total was built from" can never name two different sets of entries.
  const rows = lines.map((line) => `
    <tr class="row-link row-phase${line.variance < 0 ? " flagged" : ""}${
      samePhase(state.selectedPhaseRef, line.label) ? " current-phase" : ""}"
        data-phase-filter="${esc(line.label)}">
      <td>${line.seq}</td>
      <td>${esc(line.label)}</td>
      ${showBars ? `<td class="num">${money(line.quoted)}</td>
      <td class="num">${money(line.certified)}</td>
      <td class="num">${line.draft ? money(line.draft) : "&mdash;"}</td>
      <td class="num">${line.variance < 0
        ? `<span class="pill err">${money(line.variance)}</span>`
        : money(line.variance)}</td>` : ""}
      ${showBars ? `<td class="feebar-cell">${feeBar(phaseFinancials(line), {
    size: "compact", basis: project.billingBasis, gapNote: false,
  })}</td>` : ""}
    </tr>`).join("");

  const loose = (unallocated.certified === null || unallocated.draft === null)
    ? null
    : unallocated.certified + unallocated.draft;

  return `
    <h3 class="sec">Fee schedule
      <small>${lines.length ? "the agreed breakdown, against what has been claimed under it â€” click a phase to see its time"
    : "nothing agreed yet"}</small>
    </h3>
    ${lines.length ? `
      <table class="grid">
        <thead><tr>
          <th>#</th><th>Phase</th>
          ${showBars ? `<th class="num">Quoted</th><th class="num">Certified</th>
          <th class="num">On draft</th><th class="num">Left to claim</th>
          <th>Against this phase</th>` : ""}
        </tr></thead>
        <tbody>${rows}</tbody>
        ${showBars ? `<tfoot>
          <tr>
            <td colspan="2">Total</td>
            <td class="num">${money(schedule.quoted)}</td>
            <td class="num">${money(schedule.certified)}</td>
            <td class="num"></td>
            <td class="num">${money(schedule.quoted === null || schedule.certified === null
    ? null
    : cents(schedule.quoted - schedule.certified))}</td>
            <td></td>
          </tr>
        </tfoot>` : ""}
      </table>
      ${loose > 0 ? `<div class="warn-list" style="margin-top:10px"><div class="w med">
        <span class="sev">Watch</span>
        <b>${money(loose)} certified against no phase on this schedule</b>
        <p>Certificate lines whose phase is blank, or names something the schedule does not.
          Counted separately rather than folded into a phase, because a total that quietly
          absorbs it would make every variance above read better than it is.</p>
      </div></div>` : ""}
      ${showBars ? `
      <p class="note-line">Each bar is the same shape as the job's own, one phase wide: a job can
        sit comfortably inside its fee overall and have spent one phase twice over, and the
        second sentence is the one that changes what anybody does. A bar that is all
        &ldquo;not yet earned&rdquo; means nothing has been tagged to that phase, which is not
        the same as nothing having been done: time and certificate lines both carry the phase as
        a field somebody fills in, and an untagged hour counts against the job without counting
        against any phase of it.</p>` : ""}
      <p class="note-line">A negative figure is an overrun on that phase, and it is not an
        error &mdash; it is the number the firm needs before the next one is quoted. The
        quoted total here is what <b>burn</b> is measured against; the register's budget
        estimate${f.budgetEstimate === null
    ? (canViewBilled() ? " (none entered)" : " (hidden from this role)")
    : ` of ${money(f.budgetEstimate)}`} is only used when there is no schedule.</p>`
    : `<div class="empty">No fee schedule on this job.<br />
        Burn is measured against the register's budget estimate
        ${f.budgetEstimate === null
    ? (canViewBilled()
      ? "&mdash; and there isn't one, so it cannot be measured at all."
      : "&mdash; hidden from this role.")
    : `of ${money(f.budgetEstimate)}.`}<br />
        A schedule replaces that single figure with the phases it was built from.</div>`}

    ${canViewBilled() ? `
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
    </form>` : ""}`;
}

// --- the fee bar ------------------------------------------------------------
//
// One shape, three placements: compact in a register row, full in a job
// header, aggregate on the practice dashboard. The server already returns
// every figure below on every register row; what it could not do was stop them
// being read as six independent columns with the arithmetic left to the owner.
//
// The same segment order, the same colours and the same words in all three,
// because a number must not mean one thing in a list and another on a page.

/**
 * The claimed ladder, left to right, summing to the quote.
 *
 * `invoiced` is net of write-downs and `writtenDown` sits immediately after
 * it, so the two together are the certified gross - the notch is inside the
 * span it reduced rather than deducted from somewhere off-screen.
 *
 * Written-down money still consumes the fee: it was claimed once and cannot be
 * claimed again. That is what makes `unearned` agree with 2.2's "fixed fee:
 * quoted - certifiedGross".
 */
const FEE_SEGMENTS = [
  ["invoiced", "Invoiced", "certificates", "Issued certificates, after write-downs"],
  ["writtenDown", "Written down", "certificates", "Claimed and then given up"],
  ["draft", "On a draft", "certificates", "Lines on a certificate nobody has issued"],
  ["ready", "Ready to invoice", "time", "Captured hours not on any certificate line"],
  ["unearned", "Not yet earned", "schedule", "Fee no work has been done against yet"],
];

/**
 * Null when there is no bar to draw honestly: no quote to be a width, or a
 * role the fee is hidden from. Both get a sentence instead of a chart - a bar
 * with no denominator would have to pick one, and picking one is inventing.
 */
function feeSegments(f) {
  if (!canViewBilled()) return null;
  if (f.quoted === null || f.quoted <= 0) return null;
  const draft = f.draftGross ?? 0;
  const ready = f.uncertifiedCaptured ?? 0;
  const claimed = cents((f.certifiedGross ?? 0) + draft + ready);
  return {
    quoted: f.quoted,
    claimed,
    invoiced: f.billed ?? 0,
    writtenDown: f.writtenDown ?? 0,
    draft,
    ready,
    unearned: Math.max(0, cents(f.quoted - claimed)),
    // Drawn as a dashed tail past the end of the bar, never by rescaling the
    // bar to fit it. A bar that renormalises to 142% makes 100% look like the
    // edge of the chart instead of the edge of the agreement.
    over: Math.max(0, cents(claimed - f.quoted)),
  };
}

/**
 * How much of the track's own width the overrun gutter is worth. The track is
 * a fixed share of the row on every bar, so the 100% mark sits at the same
 * place in every one of them and the eye can compare two jobs without reading
 * either axis. An overrun past this much of the fee is clipped and says so;
 * the amount is printed either way, so nothing is lost but the length.
 */
const FEE_TAIL_SHARE = 38 / 62;

/**
 * The reason beside the amount, which is the whole point of storing it. Falls
 * back to the aggregate when the breakdown is not on this row, and names
 * `legacy_unspecified` as the gap it is rather than as a reason.
 */
function writeDownTitle(f) {
  const parts = (f.writtenDownByReason || []).map(({ reasonCode, amount }) => (
    `${reasonCode === "legacy_unspecified" ? "no reason recorded" : reasonCode.replace(/_/g, " ")} ${money(amount)}`
  ));
  if (!parts.length) return `Written down ${money(f.writtenDown)}`;
  return `Written down: ${parts.join(", ")}`;
}

/**
 * "Left to invoice" is two different numbers and the same three words, so the
 * basis is part of the label and the other reading is in the tooltip.
 *
 * Fixed fee: the fee still claimable. Overrun never reaches the client.
 * T&M: the hours not yet certified. Overrun *is* the billable amount.
 */
function leftToInvoice(f, basis) {
  const claimable = f.quoted === null ? null : Math.max(0, cents(f.quoted - (f.certifiedGross ?? 0)));
  const uncertified = f.uncertifiedCaptured;
  const onFee = {
    label: "Left to invoice, on the fee",
    amount: claimable,
    basis: "Fixed fee",
    title: `The fee still claimable, and the most this client can be asked for. On time & materials the same words would mean the uncertified hours, ${money(uncertified)}.`,
  };
  const onHours = {
    label: "Left to invoice, on the hours",
    amount: uncertified,
    basis: "Time &amp; materials",
    title: `Hours captured and not yet on any certificate; an overrun here is billable. On a fixed fee the same words would mean the fee still claimable, ${money(claimable)}.`,
  };
  // An aggregate across the register is not one basis, and picking one would
  // make the same words mean the wrong thing for half the jobs in it. Both, each
  // labelled, rather than a single figure that is right on average.
  if (basis === null) return [onFee, onHours];
  return [basis === "time_and_materials" ? onHours : onFee];
}

/**
 * Money the firm spent and will never bill. Fixed fee only: on T&M an overrun
 * is the invoice, not a loss. This is the number the workbook could not
 * produce, because column K overwrote the evidence that the work cost more.
 */
function unrecoverable(f, basis) {
  if (basis === "time_and_materials") return null;
  if (f.quoted === null || f.captured === null) return null;
  const over = cents(f.captured - f.quoted);
  return over > 0 ? over : null;
}

/**
 * A fee-schedule line in the shape the bar reads, so a phase is a miniature of
 * the job's own bar rather than a second chart with its own arithmetic.
 *
 * `realisation` is per phase and deliberately so: the phase's billed against
 * the time tagged to it. Null when nothing has been tagged, which on a job
 * where nobody fills in the phase field is most of them - and "no time under
 * this phase" is not "this phase realised nothing".
 */
function phaseFinancials(line) {
  return {
    quoted: line.quoted,
    captured: line.captured,
    capturedMinutes: 0,
    certifiedGross: line.certified,
    draftGross: line.draft,
    writtenDown: line.writtenDown,
    unexplainedWrittenDown: 0,
    writtenDownByReason: [],
    billed: line.billed,
    uncertifiedCaptured: line.uncertifiedCaptured,
    brokenRows: 0,
    realisation: line.captured ? asRatio(line.billed, line.captured) : null,
    burn: line.quoted ? asRatio(line.captured, line.quoted) : null,
  };
}

/** The server's own `ratio()`, to four places, so the two never round apart. */
const asRatio = (top, bottom) => (bottom ? Math.round((top / bottom) * 10000) / 10000 : null);

/**
 * The register's rows added into one `financials`-shaped object, so the
 * dashboard's bar is the same component reading the same field names rather
 * than a second implementation that could disagree with it.
 *
 * The two ratios are recomputed from the summed numerators and denominators,
 * never averaged: the mean of twelve realisation percentages is not the
 * practice's realisation, and on a register where one job is most of the money
 * it is not close either. A zero denominator stays null.
 */
function aggregateFinancials(projects) {
  const sum = (pick) => cents(projects.reduce((total, p) => total + (pick(p.financials) ?? 0), 0));
  const quoted = sum((f) => f.quoted);
  const captured = sum((f) => f.captured);
  const certifiedGross = sum((f) => f.certifiedGross);
  const writtenDown = sum((f) => f.writtenDown);
  const billed = cents(certifiedGross - writtenDown);
  const byReason = new Map();
  for (const { financials } of projects) {
    for (const { reasonCode, amount } of financials.writtenDownByReason || []) {
      byReason.set(reasonCode, cents((byReason.get(reasonCode) ?? 0) + amount));
    }
  }
  return {
    quoted,
    quotedSource: "fee_schedule",
    scheduleLines: 0,
    captured,
    capturedMinutes: projects.reduce((total, p) => total + p.financials.capturedMinutes, 0),
    certifiedGross,
    draftGross: sum((f) => f.draftGross),
    writtenDown,
    unexplainedWrittenDown: sum((f) => f.unexplainedWrittenDown),
    writtenDownByReason: [...byReason].map(([reasonCode, amount]) => ({ reasonCode, amount }))
      .sort((a, b) => b.amount - a.amount),
    billed,
    uncertifiedCaptured: sum((f) => f.uncertifiedCaptured),
    brokenRows: projects.reduce((total, p) => total + p.financials.brokenRows, 0),
    realisation: asRatio(billed, captured),
    burn: asRatio(captured, quoted),
  };
}

/**
 * @param f a `financials` object from any register row, job or aggregate.
 * @param size `"compact"` for a register row (bar and one line of words),
 *   `"full"` for a job header or the dashboard (bar, legend, the readings).
 * @param basis the project's `billingBasis`, which decides what "left to
 *   invoice" means. Null for an aggregate across jobs, where it cannot be one
 *   thing - then both readings are shown, each labelled.
 * @param linkTab when set, each segment opens that job at the tab behind it,
 *   because "a count with no way through to the jobs it counted is a poster".
 */
function feeBar(f, { size = "full", basis = null, linkTab = false, gapNote = true } = {}) {
  const s = feeSegments(f);
  if (!s) {
    if (!gapNote) return "";
    return `<div class="feebar-gap">${!canViewBilled()
      ? "The fee is hidden from this role."
      : "No fee to measure this against &mdash; neither a schedule nor a budget estimate."}</div>`;
  }

  const width = (value) => `${(value / s.quoted) * 100}%`;
  const tailWidth = Math.min(1, (s.over / s.quoted) / FEE_TAIL_SHARE) * 100;
  const segment = ([key, label, tab, why]) => {
    if (!s[key]) return "";
    const amount = money(s[key]);
    const title = key === "writtenDown" ? writeDownTitle(f) : `${label} ${amount} â€” ${why}`;
    const attrs = `class="fseg fseg-${key}" style="flex-basis:${width(s[key])}" title="${esc(title)}"`;
    return linkTab
      ? `<button type="button" ${attrs} data-open-tab="${tab}"><span class="sr-only">${esc(title)}</span></button>`
      : `<span ${attrs}><span class="sr-only">${esc(title)}</span></span>`;
  };

  const bar = `
    <div class="feebar-scale">
      <div class="feebar-track">${FEE_SEGMENTS.map(segment).join("")}</div>
      <div class="feebar-gutter">${s.over
    ? `<span class="feebar-tail${tailWidth >= 100 ? " clipped" : ""}" style="width:${tailWidth}%"
             title="${esc(`Over the quote by ${money(s.over)}`)}"></span>
         <em>+${money(s.over)}</em>`
    : ""}</div>
    </div>`;

  const reads = leftToInvoice(f, basis);
  const lost = unrecoverable(f, basis);

  if (size === "compact") {
    const [left] = reads;
    return `<div class="feebar compact">${bar}
      <div class="feebar-read">
        <span title="${esc(left.title)}">${left.amount === null ? "&mdash;" : money(left.amount)} to invoice</span>
        <span class="real ${realisationClass(f.realisation)}"
              title="Billed &divide; captured">${percent(f.realisation)}</span>
      </div></div>`;
  }

  return `<div class="feebar">${bar}
    <div class="feebar-legend">
      ${FEE_SEGMENTS.filter(([key]) => s[key]).map(([key, label, tab]) => {
    const body = `<i class="fsw fseg-${key}"></i>${esc(label)} <b>${money(s[key])}</b>`;
    const title = key === "writtenDown" ? writeDownTitle(f) : "";
    return linkTab
      ? `<button type="button" class="fleg" data-open-tab="${tab}" title="${esc(title)}">${body}</button>`
      : `<span class="fleg" title="${esc(title)}">${body}</span>`;
  }).join("")}
      ${s.over ? `<span class="fleg over"><i class="fsw fsw-over"></i>Over the quote <b>${money(s.over)}</b></span>` : ""}
    </div>
    <div class="feebar-reads">
      ${reads.map((left) => `
      <span><em>${left.label}</em> <b>${left.amount === null ? "&mdash;" : money(left.amount)}</b>
        <small title="${esc(left.title)}">${left.basis}</small></span>`).join("")}
      <span><em>Realisation</em>
        <b class="real ${realisationClass(f.realisation)}">${percent(f.realisation)}</b>
        <small>${f.realisation === null ? "Nothing captured yet" : "Billed &divide; captured"}</small></span>
      ${lost === null ? "" : `<span class="bad"><em>Unrecoverable</em> <b>${money(lost)}</b>
        <small>Spent past a fixed fee &mdash; it will never be billed</small></span>`}
      ${f.unexplainedWrittenDown ? `<span class="bad"><em>Written down, no reason</em>
        <b>${money(f.unexplainedWrittenDown)}</b>
        <small>Imported from the workbook, where the discount survived and the reason did not</small></span>` : ""}
    </div></div>`;
}

/**
 * How the quote compares with the template it started from, as a clause for the
 * Quoted tile. Empty when there is nothing to compare: no template behind the
 * job, or a job registered before the template's price was recorded.
 */
function templateDrift(f) {
  if (f.templateQuote === null || f.templateQuote === undefined || f.vsTemplate === null) return "";
  if (Math.abs(f.vsTemplate) < 0.005) return " &middot; same as the template";
  return ` &middot; ${f.vsTemplate > 0 ? "+" : "&minus;"}${money(Math.abs(f.vsTemplate))} on the template's ${money(f.templateQuote)}`;
}

function overviewHtml(project) {
  const f = project.financials;
  return `
    <h3 class="sec">Where this job stands
      <small>${canViewBilled()
    ? "the full width is the quote &mdash; click a segment for the rows behind it"
    : "hours and progress; the money is an owner's to see"}</small>
    </h3>
    ${feeBar(f, { basis: project.billingBasis, linkTab: true })}

    <div class="kpis">
      <div class="kpi${f.quoted === null ? " dim" : ""}">
        <div class="lbl">Quoted</div>
        <div class="val">${money(f.quoted)}</div>
        <div class="sub">${f.quoted === null
    ? (canViewBilled() ? "No figure entered" : "Hidden from this role")
    : f.quotedSource === "fee_schedule"
      ? `Fee schedule, ${f.scheduleLines} phase${f.scheduleLines === 1 ? "" : "s"}${templateDrift(f)}`
      : "Register budget estimate &mdash; no fee schedule yet"}</div>
      </div>
      <div class="kpi${f.burn !== null && f.burn > 1 ? " flag" : ""}">
        <div class="lbl">Captured</div>
        <div class="val">${money(f.captured)}</div>
        <div class="sub">${duration(f.capturedMinutes)} logged${f.burn === null ? "" : ` &middot; ${percent(f.burn)} of fee`}</div>
      </div>
      ${canViewBilled() ? `
      <div class="kpi${f.projectedProfit === null ? " dim" : (f.projectedProfit < 0 ? " flag" : "")}">
        <div class="lbl">Projected profit</div>
        <div class="val">${money(f.projectedProfit)}</div>
        <div class="sub">${f.projectedCost === null
    ? "No projected cost entered &mdash; set one under Register below"
    : f.projectedProfit === null
      ? `Cost ${money(f.projectedCost)}; no quote to measure it against`
      : `${percent(f.projectedMargin)} margin &middot; quote less projected cost of ${money(f.projectedCost)}`}</div>
      </div>` : ""}
    </div>
    ${canViewBilled() ? `
    <p class="note-line">Billed, written down and realisation are read off the bar above rather
      than repeated here as separate tiles. They are slices of one quote, and four tiles in a row
      left the arithmetic between them to whoever was looking.</p>` : ""}

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
  // A task fee becomes a certificate line through addScheduleLinesFromTasks, so
  // it is billed money and the server nulls it for a role without the gate. The
  // column goes with it rather than standing there full of em dashes: a
  // spreadsheet-era reader takes a blank money cell for "nothing was quoted".
  const showFee = canViewBilled();
  const type = state.reference?.projectTypes.find((t) => t.code === project.typeCode);
  const done = tasks.filter((t) => t.status === "done").length;
  const struck = tasks.filter((t) => t.status === "not_required").length;
  const fromTemplate = tasks.filter((t) => t.templateTaskId !== null).length;
  const added = tasks.length - fromTemplate;

  // Phases the fee schedule already names come first, then any phase that only
  // exists on the task list. Suggesting from the schedule as well keeps a new
  // task from landing under a mistyped phase the schedule cannot match.
  const seen = new Set();
  const phaseSuggestions = [
    ...(state.feeSchedule?.lines || []).map((line) => line.label),
    ...tasks.map((t) => t.phaseLabel),
  ].filter((label) => {
    const key = label && label.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const addForm = `
    <form class="form" data-form="add-task" data-project="${esc(project.id)}" style="margin-top:10px">
      <div class="fields">
        <div class="field wide">
          <label for="nt-description">Add a task</label>
          <input id="nt-description" name="description" required autocomplete="off"
                 data-lpignore="true" data-1p-ignore data-bwignore data-protonpass-ignore="true"
                 placeholder="Respond to the environmental department complaint" />
        </div>
        <div class="field">
          <label for="nt-phase">Phase</label>
          <div class="combo">
            <input id="nt-phase" name="phaseLabel" placeholder="Optional" autocomplete="off"
                   data-combo-input data-lpignore="true" data-1p-ignore data-bwignore
                   data-protonpass-ignore="true" />
            <ul class="combo-menu" data-combo-menu hidden>
              ${phaseSuggestions.map((label) => `<li data-value="${esc(label)}">${esc(label)}</li>`).join("")}
            </ul>
          </div>
        </div>
        ${showFee ? `
        <div class="field">
          <label for="nt-fee">Fee</label>
          <input id="nt-fee" name="defaultFee" type="number" step="0.01" placeholder="Optional"
                 autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore
                 data-protonpass-ignore="true" />
        </div>` : ""}
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
      ? `<tr class="phase-row"><td colspan="${showFee ? 5 : 4}">${esc(task.phaseLabel || "No phase")}</td></tr>`
      : "";
    currentPhase = task.phaseLabel;
    const struckRow = task.status === "not_required";
    const doneRow = task.status === "done";
    const rowClass = struckRow ? "struck" : doneRow ? "done" : "";
    return `${header}
      <tr${rowClass ? ` class="${rowClass}"` : ""}>
        <td>${esc(task.description)}
          ${task.templateTaskId === null ? ' <span class="pill flat">added</span>' : ""}
          ${task.note ? `<div class="task-note">${esc(task.note)}</div>` : ""}</td>
        ${showFee ? `<td class="num">${task.defaultFee === null ? "&mdash;" : money(task.defaultFee)}</td>` : ""}
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
      <small>${fromTemplate} from the ${esc(type?.name || project.typeCode || "job's")} template${
  added ? ` &middot; ${added} added` : ""}
        &middot; ${done} done${struck ? ` &middot; ${struck} struck` : ""}</small>
    </h3>
    <div class="scroller"><table class="grid">
      <thead><tr>
        <th>Task</th>${showFee ? '<th class="num">Fee</th>' : ""}<th>Billed</th><th>Status</th><th></th>
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
        ${canViewBilled() && project ? `
        <div class="field">
          <label for="f-ceiling">Fee ceiling</label>
          <label class="check"><input id="f-ceiling" name="feeCeiling" type="checkbox"${project.feeCeiling ? " checked" : ""} />
            Billing stops at the quoted fee</label>
          <small class="muted">Hours past it stay on the record and are written down as
            &ldquo;fee ceiling&rdquo;. A certificate that would go past it will not issue.</small>
        </div>` : ""}
        ${canViewBilled() ? `
        <div class="field">
          <label for="f-budget">Budget estimate</label>
          <input id="f-budget" name="budgetEstimate" type="number" step="0.01" min="0"
                 value="${project?.budgetEstimate ?? ""}" placeholder="Leave blank if none" />
        </div>
        <div class="field">
          <label for="f-projected-cost">Projected cost</label>
          <input id="f-projected-cost" name="projectedCost" type="number" step="0.01" min="0"
                 value="${project?.projectedCost ?? ""}" placeholder="Leave blank if not costed" />
          <small class="muted">Everything the job is expected to cost the firm: staff, consultants,
            printing, fees you carry. Profit and margin are worked out against the quote.</small>
        </div>` : `
        <!-- Left out of the form entirely, not just disabled: a blank number
             field and a real figure this role cannot see both submit as "",
             and registerFields() treats "" as an explicit instruction to
             clear the budget (a real answer for T&M work with none set).
             An employee saving an unrelated edit here must not be the thing
             that wipes out an owner's real budget estimate. Leaving the
             field name out of the form means it is absent from the submit,
             not blank, and updateRegisterProject() skips absent fields. -->`}
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
  STRATAREPORT: "Copies one phase and its three tasks â€” council documents, the title deed, external reports â€” and a fee schedule of that single line.",
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
    projectedCost: "",
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

/**
 * A one-line variant of `choiceCard`: name plus a short tag, no paragraph.
 * The full explanation moves into `typeDetailHtml`, painted once under
 * whichever row is actually selected, instead of being repeated on every
 * row whether it is chosen or not.
 */
function compactChoice(field, value, checked, name, tag) {
  return `<label class="choice-row">
    <input type="radio" name="${esc(field)}" data-field="${esc(field)}" value="${esc(value)}"${checked ? " checked" : ""} />
    <span class="choice-row-name">${esc(name)}</span>
    <span class="choice-row-tag">${esc(tag)}</span>
  </label>`;
}

/**
 * The scannable fragment shown beside each type before it is selected.
 * Deliberately short: it names what differs (phase count, span, or "empty"),
 * not the full sentence, which four of these five types would otherwise
 * repeat almost word for word.
 */
const TYPE_TAG = {
  STRATAREPORT: "1 phase Â· 3 tasks",
  "CONSENT USE": "5 phases Â· Inception â†’ Promulgation",
  REZONING: "5 phases Â· Inception â†’ Promulgation",
  "REMOVAL OF RESTRICTIONS": "8 phases Â· Briefing â†’ Approval formalities",
  "TOWNSHIP establishment": "5 stages + sundries",
};

function typeTag(type) {
  if (!type) return "Classify later";
  if (type.isPlaceholder) return "Empty list, fill in by hand";
  return TYPE_TAG[type.code] || "Copies a template";
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
  const rows = (list) => list.map((type) => compactChoice(
    "typeCode", type.code, job.typeCode === type.code, type.name, typeTag(type),
  )).join("");
  return `
    <div class="choice-group">
      <h2>Copies a task list and a fee schedule</h2>
      <div class="choices choices-compact">${rows(templated)}</div>
      <div id="detail-templated" class="type-detail-slot"></div>
    </div>
    <div class="choice-group">
      <h2>Registered, with no template yet</h2>
      <p class="note-line" style="margin-top:0">An empty list is the finished state for these, not a missing file. You write the tasks the job actually has.</p>
      <div class="choices choices-compact">${rows(placeholders)}</div>
      <div id="detail-placeholder" class="type-detail-slot"></div>
    </div>
    <div class="choice-group">
      <h2>Or leave it for later</h2>
      <div class="choices choices-compact">${compactChoice(
        "typeCode", "", job.typeCode === "", "Not classified yet", typeTag(null),
      )}</div>
      <div id="detail-none" class="type-detail-slot"></div>
    </div>`;
}

/**
 * The explanation for the currently selected type, painted into whichever of
 * the three `#detail-*` slots (declared in `composerTypeStep`) matches it.
 * The other two slots are cleared, so exactly one explanation is ever on
 * screen, directly under the row that earned it, instead of ten paragraphs
 * stacked above a single preview at the bottom of the page.
 */
function typeDetailHtml(type, job) {
  if (!type) {
    return `<div class="type-detail"><p class="note-line" style="margin-top:0">${typeGuide(null)}</p></div>`;
  }
  if (type.isPlaceholder) {
    return `<div class="type-detail"><p class="note-line" style="margin-top:0">${typeGuide(type)}</p></div>`;
  }
  return `<div class="type-detail">
    <p class="note-line" style="margin-top:0">${typeGuide(type)}</p>
    <div class="roadmap" id="type-roadmap" aria-live="polite">
      <h2>What this type copies</h2>
      <div id="roadmap-body">${roadmapBodyHtml(job)}</div>
    </div>
  </div>`;
}

function paintTypeDetail() {
  const job = state.newJob;
  if (!job) return;
  const type = (state.reference?.projectTypes || []).find((item) => item.code === job.typeCode) || null;
  const slots = ["detail-templated", "detail-placeholder", "detail-none"].map(el);
  for (const node of slots) if (node) node.innerHTML = "";
  if (job.typeCode === "") {
    el("detail-none")?.insertAdjacentHTML("afterbegin", typeDetailHtml(null, job));
  } else if (type?.isPlaceholder) {
    el("detail-placeholder")?.insertAdjacentHTML("afterbegin", typeDetailHtml(type, job));
  } else if (type) {
    el("detail-templated")?.insertAdjacentHTML("afterbegin", typeDetailHtml(type, job));
  }
}

/**
 * Phases of the selected type, in order, with the tasks under each. Fees stay
 * off this step: the question here is whether the sequence fits the job.
 * A placeholder and an unclassified job have no roadmap container at all
 * (see `typeDetailHtml`), so this is only ever asked for a templated type.
 */
function roadmapBodyHtml(job) {
  const code = job.typeCode || "";
  const roadmap = job.roadmap?.typeCode === code ? job.roadmap : null;
  if (!roadmap || roadmap.loading) {
    return `<p class="note-line">Loading the sequenceâ€¦</p>`;
  }
  if (roadmap.error) {
    return `<p class="note-line">The sequence could not be loaded. The type can still be chosen;
      the job is built from it when it is created.</p>`;
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
  return `<ol class="roadmap-phases">${phases}</ol>
    <p class="note-line">This sequence is copied onto the job. Tasks can be added or struck
      afterwards. The firm's template is unchanged.</p>`;
}

function paintRoadmap() {
  const node = el("roadmap-body");
  if (!node || !state.newJob || state.newJob.step !== 1) return;
  // Repaint the phase list in place. Do not auto-scroll or replace the
  // surrounding panel: this sits right under the row the user just picked,
  // and jumping the page when the sequence resolves reads as a glitch
  // rather than a helpful cue.
  node.innerHTML = roadmapBodyHtml(state.newJob);
}

function ensureRoadmap() {
  const job = state.newJob;
  if (!job || job.step !== 1) return;
  const code = job.typeCode || "";
  const type = (state.reference?.projectTypes || []).find((item) => item.code === code);
  if (!code || type?.isPlaceholder) {
    job.roadmap = null;
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
    return "On a fixed fee this is a working figure. The moment a fee schedule exists â€” including one just copied from the type â€” burn is measured against the schedule, and a disagreement with this estimate is shown rather than smoothed over.";
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
      ${canViewBilled() ? `
      <div class="field" style="max-width:280px">
        <label for="nj-projected-cost">Projected cost</label>
        <input id="nj-projected-cost" data-field="projectedCost" type="number" step="0.01" min="0"
               value="${esc(job.projectedCost)}" placeholder="Leave blank to use the type's usual" />
      </div>
      <p class="note-line">What you expect the job to cost the firm, all in. If the type has a
        usual cost share set under Fee templates, a job starts from that and this can stay blank;
        otherwise leave it blank and cost the job later from its page.</p>` : ""}
    </div>`;
}

function composerClientStep(job) {
  const type = (state.reference?.projectTypes || []).find((item) => item.code === job.typeCode);
  const basis = job.billingBasis === "fixed_fee" ? "Fixed fee"
    : job.billingBasis === "time_and_materials" ? "Time & materials"
      : "Basis not decided";
  const row = (label, value) => `<div><dt>${label}</dt><dd>${value || "â€”"}</dd></div>`;
  return `
    <dl class="composer-summary">
      ${row("Code", esc(job.code))}
      ${row("Description", esc(job.name))}
      ${row("Type", job.typeCode ? esc(type?.name || job.typeCode) : "Not classified yet")}
      ${row("Billing", esc(basis))}
      ${row("Budget", job.budgetEstimate === "" ? "None" : money(Number(job.budgetEstimate)))}
      ${canViewBilled() ? row("Projected cost", job.projectedCost === "" ? "From the type, if it has one" : money(Number(job.projectedCost))) : ""}
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
  if (job.step === 1) {
    paintTypeDetail();
    ensureRoadmap();
  }
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
      projectedCost: job.projectedCost,
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
          <input id="t-phase" name="phaseRef" placeholder="Optional"
                 value="${esc(state.selectedPhaseRef || "")}" />
        </div>
        <div class="field">
          <label for="t-prints">A4 prints</label>
          <input id="t-prints" name="printsQty" type="number" min="0" step="1" placeholder="Optional" />
        </div>
        <div class="field">
          <label for="t-travel">Travel km</label>
          <input id="t-travel" name="travelKm" type="number" min="0" step="0.1" placeholder="Optional" />
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
        <span class="note-line" style="margin:0">${canViewBilled()
    ? `Captured ${money(f.captured)} of ${f.quoted === null ? "an unquoted fee" : money(f.quoted)}`
    : `${duration(f.capturedMinutes)} captured so far`}</span>
      </div>
    </form>
    <p class="note-line">Prints and kilometres are recorded against the row but carry no
      money yet: they are quantities waiting on a unit rate, not a priced line. The workbook
      asked for both too, told everyone its macro billed them, and never read either column
      &mdash; so counting them here and saying so is already further than that went.</p>

    ${state.selectedPhaseRef ? `
      <div class="phase-filter-banner">
        <span>Viewing time logged against <b>${esc(state.selectedPhaseRef)}</b></span>
        <button class="btn btn-sm" type="button" data-action="clear-phase-filter">Clear, see all ${state.entries.length}</button>
      </div>` : ""}
    ${(() => {
      const filtered = state.selectedPhaseRef
        ? state.entries.filter((entry) => samePhase(entry.phaseRef, state.selectedPhaseRef))
        : state.entries;
      return `<h3 class="sec">Entries <small>${filtered.length} row${filtered.length === 1 ? "" : "s"}${
        state.selectedPhaseRef && filtered.length !== state.entries.length
          ? ` of ${state.entries.length} on this job` : ""}</small></h3>
    ${filtered.length ? `
      <div class="scroller"><table class="grid">
        <thead><tr>
          <th>Date</th><th>Who</th><th>Activity</th><th>Description</th>
          <th class="num">Time</th><th class="num">Captured</th><th>Billed on</th><th></th>
        </tr></thead>
        <tbody>${filtered.map((entry) => {
          // Clocked on and never off, or time logged and priced at nothing.
          // A duration typed without clock times is the normal case.
          const broken = (entry.start && !entry.end)
            || (entry.minutes > 0 && entry.capturedAmount === 0);
          return `<tr${broken ? ' class="flagged"' : ""}>
            <td>${esc(entry.date)}</td>
            <td>${esc((entry.userEmail || "").split("@")[0])}</td>
            <td>${esc(entry.activityType)}</td>
            <td>${esc(entry.description)}${entry.phaseRef ? ` <span class="pill flat">${esc(entry.phaseRef)}</span>` : ""}${
              entry.printsQty ? ` <span class="pill flat">${entry.printsQty} prints</span>` : ""}${
              entry.travelKm ? ` <span class="pill flat">${entry.travelKm} km</span>` : ""}</td>
            <td class="num">${duration(entry.minutes)}${broken ? ' <span class="pill err">broken</span>' : ""}</td>
            <td class="num">${money(entry.capturedAmount)}</td>
            <td>${entry.certificateId ? '<span class="pill ok">yes</span>' : '<span class="pill flat">not yet</span>'}</td>
            <td class="num"><button class="btn btn-sm" data-action="withdraw-entry"
                data-entry="${esc(entry.id)}">Withdraw</button></td>
          </tr>`;
        }).join("")}</tbody>
        <tfoot><tr>
          <td colspan="4">Captured${state.selectedPhaseRef ? " against this phase" : ", before anything is written down"}</td>
          <td class="num">${duration(filtered.reduce((sum, e) => sum + e.minutes, 0))}</td>
          <td class="num">${money(canViewBilled()
    ? filtered.reduce((sum, e) => sum + e.capturedAmount, 0)
    : null)}</td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table></div>
      <p class="note-line">A wrong row is withdrawn, not corrected: the entry stays, dated and
        attributed, and the total stops counting it. An hour already on an issued certificate
        cannot be withdrawn &mdash; that is a credit, not a deletion.</p>`
    : state.selectedPhaseRef
      ? `<div class="empty">No time logged with a phase matching <b>${esc(state.selectedPhaseRef)}</b>.<br />
          Time is only tagged to a phase when the "Phase or task" field on the log form is
          typed to match the fee schedule's label exactly &mdash; free text, not a picklist.</div>`
      : `<div class="empty">No time logged against this job.<br />
        Captured value is what the work actually cost the firm, whatever is eventually billed.</div>`}`;
    })()}`;
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
            <td>${c.periodStart || c.periodEnd ? `${esc(c.periodStart || "â€¦")} &ndash; ${esc(c.periodEnd || "â€¦")}` : "&mdash;"}</td>
            <td><span class="pill ${c.status === "issued" ? "ok" : "flat"}">${esc(c.status)}</span></td>
            <td class="num">${money(c.subtotal)}</td>
            <td class="num">${c.writtenDown ? money(c.writtenDown) : "&mdash;"}</td>
            <td class="num">${money(c.net)}</td>
            <td class="num"><button class="btn btn-sm" data-action="open-certificate"
                data-certificate="${esc(c.id)}">${open?.id === c.id ? "Close" : "Open"}</button></td>
          </tr>`).join("")}</tbody>
      </table>`
    : `<div class="empty">Nothing has been certified on this job.</div>`}

    ${canViewBilled() ? `
    <div class="actions">
      <button class="btn btn-primary" data-action="new-certificate"
              data-project="${esc(project.id)}">Start a certificate</button>
    </div>` : ""}

    ${open ? certificateHtml(open) : ""}`;
}

/**
 * The top of the printed page: letterhead, then REF / FOR / PROPERTY
 * DESCRIPTION as the workbook's USER INVOICE laid them out. The firm's
 * particulars come from Firm details and are never invented; a block that has
 * not been filled in says so on the page instead of being left blank.
 */
function certificateHeadHtml(certificate) {
  const org = state.orgSettings;
  const project = state.projects.find((p) => p.id === certificate.projectId) || {};
  const draft = certificate.status === "draft";
  const name = org?.tradingName || org?.orgName || state.session?.orgName || "";
  const lines = (org?.addressLines || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dated = draft ? "Draft" : (certificate.issuedAt || "").slice(0, 10);
  const period = certificate.periodStart || certificate.periodEnd
    ? `${certificate.periodStart || "â€¦"} to ${certificate.periodEnd || "â€¦"}` : null;
  const gap = (text) => `<span class="cert-gap">${esc(text)}</span>`;
  return `
    <header class="cert-head">
      <div class="cert-firm">
        <div class="cert-firm-name">${name ? esc(name) : gap("Firm name not entered")}</div>
        ${lines.length ? lines.map((l) => `<div>${esc(l)}</div>`).join("")
    : gap("Address not entered (Firm details)")}
        <div>${org?.vatNumber ? `VAT no. ${esc(org.vatNumber)}` : gap("VAT number not entered")}${
  org?.companyReg ? ` &nbsp;&middot;&nbsp; Reg no. ${esc(org.companyReg)}` : ""}</div>
      </div>
      <div class="cert-title">
        <div class="cert-title-main">${draft ? "Pro forma payment certificate" : "Payment certificate"}</div>
        <div>No. ${certificate.seq} &middot; ${esc(dated)}</div>
        ${period ? `<div>Period ${esc(period)}</div>` : ""}
      </div>
    </header>
    <dl class="cert-meta">
      <dt>Ref:</dt><dd>${project.code ? esc(project.code) : gap("no project code")}${
  project.name ? ` &mdash; ${esc(project.name)}` : ""}</dd>
      <dt>For:</dt><dd>${project.clientName ? esc(project.clientName) : gap("no client on the register")}${
  project.clientAddress ? `<div class="cert-sub">${esc(project.clientAddress)}</div>` : ""}</dd>
      <dt>Property description:</dt><dd>${project.propertyDescription
    ? esc(project.propertyDescription) : gap("not on the register")}</dd>
    </dl>`;
}

/**
 * Where a draft stands against a capped fee, with the write-down that fixes it
 * one click away. Proposed, not applied: giving value up is a decision, and the
 * reason it is recorded under is the whole point of it.
 */
function ceilingNoticeHtml(certificate) {
  const c = certificate.ceiling;
  const over = c.excess > 0;
  return `
    <div class="ceiling-notice${over ? " over" : ""} no-print">
      <div>
        <b>This job's fee is a ceiling: ${money(c.quoted)}.</b>
        ${c.priorNet > 0 ? `Other certificates already claim ${money(c.priorNet)}, leaving ${money(c.room)}.` : ""}
        This certificate nets ${money(c.net)}${over
    ? `, which is <b>${money(c.excess)}</b> past it. It will not issue as it stands.`
    : `; it fits, with ${money(cents(c.room - c.net))} of the ceiling to spare.`}
      </div>
      ${over ? `
        <button class="btn btn-primary" type="button" data-action="apply-ceiling"
                data-certificate="${esc(certificate.id)}" data-amount="${c.proposedWriteDown}"
                data-quoted="${c.quoted}">Write down ${money(c.proposedWriteDown)} as fee ceiling</button>` : ""}
    </div>`;
}

function certificateFootHtml() {
  const org = state.orgSettings;
  const gap = (text) => `<span class="cert-gap">${esc(text)}</span>`;
  const hasBank = org && (org.bankName || org.bankAccountNo);
  return `
    <footer class="cert-foot">
      <div>
        <div class="cert-foot-h">Banking details</div>
        ${hasBank ? `
          <div>${esc(org.bankName || "")}${org.bankBranch ? `, ${esc(org.bankBranch)}` : ""}</div>
          <div>Branch code ${org.bankBranchCode ? esc(org.bankBranchCode) : gap("not entered")}</div>
          <div>Account ${org.bankAccountNo ? esc(org.bankAccountNo) : gap("not entered")}</div>`
    : gap("Banking details not entered (Firm details)")}
      </div>
      <div>
        <div class="cert-foot-h">Contact</div>
        ${org?.contactName || org?.contactCell || org?.contactEmail ? `
          ${org.contactName ? `<div>${esc(org.contactName)}</div>` : ""}
          ${org.contactCell ? `<div>${esc(org.contactCell)}</div>` : ""}
          ${org.contactEmail ? `<div>${esc(org.contactEmail)}</div>` : ""}`
    : gap("Contact details not entered")}
        ${org?.popEmail ? `<div class="cert-sub">Proof of payment to ${esc(org.popEmail)}</div>` : ""}
      </div>
    </footer>`;
}

function certificateHtml(certificate) {
  const draft = certificate.status === "draft";
  const reasons = state.reference?.writeDownReasons || [];
  return `
    <h3 class="sec">Certificate ${certificate.seq}
      <small>${draft ? "draft &mdash; nothing has gone to the client" : `issued ${esc((certificate.issuedAt || "").slice(0, 10))}`}</small>
      ${canViewBilled() ? `<button class="btn btn-sm no-print" type="button" data-action="print-certificate"
        data-certificate="${esc(certificate.id)}">Print</button>` : ""}
    </h3>
    <article class="cert-sheet" id="cert-sheet">
    ${certificateHeadHtml(certificate)}
    <table class="grid">
      <thead><tr>
        <th>#</th><th>Source</th><th>Description</th>
        <th class="num">Hours</th><th class="num">Amount</th>
      </tr></thead>
      <tbody>${certificate.lines.length ? certificate.lines.map((line) => `
        <tr${samePhase(state.selectedPhaseRef, line.phaseRef) ? ' class="current-phase"' : ""}>
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
    ${certificateFootHtml()}
    </article>
    ${draft && certificate.ceiling ? ceilingNoticeHtml(certificate) : ""}

    ${draft && !canViewBilled() ? `
      <p class="note-line">Billing this certificate &mdash; pulling time, adding a line, writing
        down an amount, or issuing it &mdash; is an owner's action.</p>` : ""}
    ${draft && canViewBilled() ? `
      <div class="two" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:16px">
        <form class="form" data-form="lines-from-time" data-certificate="${esc(certificate.id)}">
          <div class="fields">
            <div class="field"><label for="c-from">From</label><input id="c-from" name="from" type="date" /></div>
            <div class="field"><label for="c-to">To</label><input id="c-to" name="to" type="date" /></div>
            <div class="field"><label for="c-user">Whose time</label>
              <select id="c-user" name="userId">
                <option value="">Everyone</option>
                ${state.team.map((member) => `<option value="${esc(member.userId)}">${esc(member.email)}</option>`).join("")}
              </select></div>
          </div>
          <div class="actions" style="margin-bottom:6px">
            <button class="btn btn-sm" type="button" data-action="cert-month" data-which="this">This month</button>
            <button class="btn btn-sm" type="button" data-action="cert-month" data-which="last">Last month</button>
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
      </div>` : ""}
    ${!draft ? `<p class="note-line">Issued, and therefore fixed. The captured time underneath it is
        unchanged: what the work cost the firm and what the client was asked to pay are two
        different numbers, and both are still here.</p>` : ""}`;
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

// --- my time ----------------------------------------------------------------
//
// The workbook gave each person one continuous sheet across every job, and the
// start of each row chained off the end of the one above. The Time tab on a
// job cannot reproduce a day that touches six of them; this can.

const MY_TIME_DAYS = 60;

function ensureMyTime() {
  if (!state.myTime) {
    state.myTime = {
      personId: state.session.userId,
      day: today(),
      entries: [],
      team: [],
      // projectId -> the phase refs /api/projects/:id/phases offers.
      phases: {},
      more: false,
      // Set when the composer has just been rebuilt on purpose, so the old
      // DOM's values are not restored over it.
      fresh: true,
      draft: null,
    };
    state.myTime.draft = blankDraft("");
  }
  return state.myTime;
}

function blankDraft(start) {
  return {
    projectCode: "", activityType: "", start, end: "", minutes: "",
    description: "", printsQty: "", travelKm: "", rule: "tier_1920", band: "",
    phaseSel: "", phaseFree: "",
  };
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

async function loadMyTime() {
  const mt = ensureMyTime();
  if (isOwner() && !mt.team.length) {
    mt.team = (await api.listTeam().catch(() => ({ members: [] }))).members ?? [];
  }
  mt.entries = (await api.listTimeEntries({
    person: mt.personId, from: daysAgo(MY_TIME_DAYS),
  })).entries;
  // First arrival only: later loads (after a withdraw, say) must not throw
  // away what is half-typed.
  if (!mt.loaded) {
    mt.loaded = true;
    resetDraftForDay({ keep: false });
  }
}

const dayOf = (entry) => String(entry.date).slice(0, 10);

/** Rows in a day read like a sheet: earliest first, untimed ones last. */
function sortDay(rows) {
  return rows.slice().sort((a, b) => {
    if (a.start && b.start) return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    if (a.start) return -1;
    if (b.start) return 1;
    return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
  });
}

/** The latest clock time already logged on `day`: where the next row begins. */
function lastEndOn(day) {
  const ends = state.myTime.entries
    .filter((entry) => dayOf(entry) === day && entry.end)
    .map((entry) => String(entry.end).slice(0, 5));
  return ends.length ? ends.sort().at(-1) : "";
}

/**
 * A new day (or person) starts the composer over, with the start time chained
 * from the day's last row. Project and activity stay when `keep` is set,
 * because the next row is usually the same job.
 */
function resetDraftForDay({ keep }) {
  const mt = state.myTime;
  const previous = mt.draft;
  mt.draft = blankDraft(lastEndOn(mt.day));
  if (keep && previous) {
    mt.draft.projectCode = previous.projectCode;
    mt.draft.activityType = previous.activityType;
    mt.draft.phaseSel = previous.phaseSel;
    mt.draft.phaseFree = previous.phaseFree;
    mt.draft.rule = previous.rule;
    mt.draft.band = previous.band;
  }
  mt.fresh = true;
}

function projectByCode(text) {
  const key = String(text || "").trim().toUpperCase();
  if (!key) return null;
  return state.projects.find((project) => (project.code || "").trim().toUpperCase() === key) || null;
}

async function ensurePhases(projectId) {
  const mt = state.myTime;
  if (projectId in mt.phases) return;
  mt.phases[projectId] = [];
  const result = await api.phases(projectId).catch(() => null);
  mt.phases[projectId] = (result?.phases ?? []).map((phase) => phase.ref);
  await loadPhaseSchedule(projectId);
}

/**
 * The phase figures the preview divides by (5.3). Billed-tier, so an employee
 * never fetches it; cached per job for this visit and dropped after a save,
 * since a saved hour changes what the phase has already burned.
 */
async function loadPhaseSchedule(projectId) {
  const mt = state.myTime;
  if (!mt || !canViewBilled()) return;
  mt.schedules ||= {};
  if (projectId in mt.schedules) return;
  mt.schedules[projectId] = null;
  mt.schedules[projectId] = (await api.feeSchedule(projectId).catch(() => null))?.feeSchedule ?? null;
}

function phaseScheduleLine(project, phaseRef) {
  if (!project || !phaseRef || !canViewBilled()) return null;
  const schedule = state.myTime?.schedules?.[project.id]
    ?? (selected()?.id === project.id ? state.feeSchedule : null);
  return schedule?.lines.find((line) => samePhase(phaseRef, line.label) && line.quoted > 0) ?? null;
}

/**
 * Everything that follows from which job is typed: the client beside it, that
 * job's phases, and the descriptions this person has used on it before.
 */
async function syncMyTimeProject(form) {
  if (!form || !state.myTime) return;
  const input = form.querySelector("#mt-project");
  const project = projectByCode(input.value);
  const tag = form.querySelector("#mt-client");
  tag.textContent = project
    ? (project.clientName || "no client on file")
    : (input.value.trim() ? "not on the register" : "");
  tag.classList.toggle("bad", !project && Boolean(input.value.trim()));

  const menu = form.querySelector("#mt-desc-menu");
  const seen = new Set();
  const descriptions = [];
  for (const entry of state.myTime.entries) {
    if (!project || entry.projectId !== project.id || seen.has(entry.description)) continue;
    seen.add(entry.description);
    descriptions.push(entry.description);
    if (descriptions.length === 20) break;
  }
  menu.innerHTML = descriptions
    .map((text) => `<li data-value="${esc(text)}">${esc(text)}</li>`).join("");

  if (project) await ensurePhases(project.id);
  if (form.isConnected) paintPhaseSelect(form, project);
}

function paintPhaseSelect(form, project) {
  const mt = state.myTime;
  const select = form.querySelector("#mt-phase");
  const free = form.querySelector("#mt-phase-free");
  const refs = project ? (mt.phases[project.id] ?? []) : [];
  let want = mt.draft.phaseSel;
  // A phase chosen on another job does not exist on this one.
  if (want && want !== "__other" && !refs.includes(want)) want = "";
  mt.draft.phaseSel = want;
  select.innerHTML = [
    `<option value="">No phase</option>`,
    ...refs.map((ref) => `<option value="${esc(ref)}">${esc(ref)}</option>`),
    `<option value="__other">Other &mdash; type it&hellip;</option>`,
  ].join("");
  select.value = want;
  free.hidden = want !== "__other";
}

function myTimeHtml() {
  const mt = state.myTime;
  const draft = mt.draft;
  const billed = canViewBilled();
  const activities = state.reference?.activityTypes || [];
  const bands = state.reference?.rateBands || [];
  const activity = draft.activityType || activities[0] || "";

  const byDay = new Map();
  for (const entry of mt.entries) {
    const day = dayOf(entry);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  }
  // The day being logged on is always shown, entries or not: that is where
  // the composer lives.
  if (!byDay.has(mt.day)) byDay.set(mt.day, []);
  const days = [...byDay.keys()].sort().reverse();

  const person = mt.team.find((member) => member.userId === mt.personId);
  const label = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });

  const composer = `
    <form class="form mt-composer" data-form="mytime" autocomplete="off">
      <input type="hidden" name="date" value="${esc(mt.day)}" />
      <div class="fields">
        <div class="field">
          <label for="mt-project">Job</label>
          <div class="combo">
            <input id="mt-project" name="projectCode" required autocomplete="off"
                   data-combo-input data-lpignore="true" data-1p-ignore data-bwignore
                   data-protonpass-ignore="true"
                   value="${esc(draft.projectCode)}" placeholder="Code, name or client" />
            <ul class="combo-menu" data-combo-menu hidden>
              ${state.projects.map((project) => `
                <li data-value="${esc(project.code || "")}"
                    data-search="${esc(`${project.name || ""} ${project.clientName || ""}`)}">
                  <b>${esc(project.code || "no code")}</b> ${esc(project.name || "Untitled")}${
  project.clientName ? ` <span class="muted">&middot; ${esc(project.clientName)}</span>` : ""}
                </li>`).join("")}
            </ul>
          </div>
          <span class="client-tag" id="mt-client"></span>
        </div>
        <div class="field">
          <label for="mt-start">Start</label>
          <input id="mt-start" name="start" type="time" value="${esc(draft.start)}" />
        </div>
        <div class="field">
          <label for="mt-end">End</label>
          <input id="mt-end" name="end" type="time" value="${esc(draft.end)}" />
        </div>
        <div class="field">
          <label for="mt-minutes">Minutes</label>
          <input id="mt-minutes" name="minutes" type="number" min="0" step="1" required
                 value="${esc(draft.minutes)}" />
        </div>
        <div class="field">
          <label for="mt-activity">Activity</label>
          <select id="mt-activity" name="activityType" required>
            ${activities.map((a) => `<option value="${esc(a)}"${a === activity ? " selected" : ""}>${esc(a)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="mt-phase">Phase or task</label>
          <select id="mt-phase" name="phaseSel"></select>
          <input id="mt-phase-free" name="phaseFree" placeholder="Phase or task" hidden
                 value="${esc(draft.phaseFree)}" />
        </div>
        <div class="field wide">
          <label for="mt-description">Description on the certificate</label>
          <div class="combo">
            <input id="mt-description" name="description" required autocomplete="off"
                   data-combo-input data-lpignore="true" data-1p-ignore data-bwignore
                   data-protonpass-ignore="true"
                   value="${esc(draft.description)}"
                   placeholder="What the client will read, not &quot;Phone call&quot;" />
            <ul class="combo-menu" data-combo-menu id="mt-desc-menu" hidden></ul>
          </div>
        </div>
      </div>
      <div class="mt-more" id="mt-more"${mt.more || /print|travel/i.test(activity) ? "" : " hidden"}>
        <div class="fields">
          <div class="field">
            <label for="mt-prints">A4 prints</label>
            <input id="mt-prints" name="printsQty" type="number" min="0" step="1"
                   placeholder="Optional" value="${esc(draft.printsQty)}" />
          </div>
          <div class="field">
            <label for="mt-travel">Travel km</label>
            <input id="mt-travel" name="travelKm" type="number" min="0" step="0.1"
                   placeholder="Optional" value="${esc(draft.travelKm)}" />
          </div>
          <div class="field">
            <label for="mt-rule">Pricing</label>
            <select id="mt-rule" name="pricingRule">
              <option value="tier_1920"${draft.rule === "tier_1920" ? " selected" : ""}>Quarter-hour ladder (R480)</option>
              <option value="linear_32"${draft.rule === "linear_32" ? " selected" : ""}>Linear (R32 a minute)</option>
              <option value="band_hourly"${draft.rule === "band_hourly" ? " selected" : ""}>Tariff band</option>
            </select>
          </div>
          <div class="field">
            <label for="mt-band">Band</label>
            <select id="mt-band" name="rateBandCode">
              ${bands.map((b) => `<option value="${esc(b.code)}"${b.code === draft.band ? " selected" : ""}>${esc(b.code)} &middot; ${esc(b.label)}${
  billed ? ` &middot; ${money(b.hourlyRate)}` : ""}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>
      <div class="preview" id="time-preview"><span>Enter a duration to see what it is worth.</span></div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Log it and start the next</button>
        <button class="btn btn-sm" type="button" data-action="mt-more">+ prints / travel</button>
        <div class="spacer"></div>
        <span class="note-line" style="margin:0">Ctrl+Enter also logs. The next row starts where this one ends.</span>
      </div>
    </form>`;

  return `
    <div class="mt-head">
      <div>
        <h1>My time</h1>
        <p class="note-line">${isOwner() && person && mt.personId !== state.session.userId
    ? `${esc(person.email)}'s log` : "Your log"} across every job, the last ${MY_TIME_DAYS} days.
          A wrong row is withdrawn, not corrected.</p>
      </div>
      <div class="mt-controls">
        ${isOwner() ? `
          <div class="field">
            <label for="mt-person">Person</label>
            <select id="mt-person">
              ${mt.team.map((member) => `<option value="${esc(member.userId)}"${member.userId === mt.personId ? " selected" : ""}>${esc(member.email)}</option>`).join("")}
            </select>
          </div>` : ""}
        <div class="field">
          <label for="mt-day">Log on</label>
          <input id="mt-day" type="date" value="${esc(mt.day)}" max="${today()}" />
        </div>
      </div>
    </div>
    ${days.map((day) => {
    const rows = sortDay(byDay.get(day));
    const minutes = rows.reduce((sum, entry) => sum + entry.minutes, 0);
    const money_ = billed ? rows.reduce((sum, entry) => sum + (entry.capturedAmount ?? 0), 0) : null;
    const open = day === mt.day;
    return `
      <section class="mt-day${open ? " open" : ""}">
        <h3 class="sec">${esc(label(day))}${day === today() ? " &middot; today" : ""}
          <small>${rows.length} row${rows.length === 1 ? "" : "s"} &middot; ${duration(minutes)}${
  billed ? ` &middot; ${money(money_)}` : ""}</small>
          ${open ? "" : `<button class="btn btn-sm" type="button" data-action="mt-select-day"
              data-day="${esc(day)}">Log on this day</button>`}
        </h3>
        ${rows.length ? `
        <div class="scroller"><table class="grid">
          <thead><tr>
            <th>Time</th><th class="num">Duration</th><th>Job</th><th>Activity</th><th>Description</th>
            ${billed ? '<th class="num">Captured</th>' : ""}<th></th>
          </tr></thead>
          <tbody>${rows.map((entry) => {
    const broken = (entry.start && !entry.end)
      || (billed && entry.minutes > 0 && entry.capturedAmount === 0);
    return `<tr${broken ? ' class="flagged"' : ""}>
            <td>${entry.start ? `${esc(String(entry.start).slice(0, 5))}&ndash;${entry.end ? esc(String(entry.end).slice(0, 5)) : "?"}` : "&mdash;"}</td>
            <td class="num">${duration(entry.minutes)}${broken ? ' <span class="pill err">broken</span>' : ""}</td>
            <td><b>${esc(entry.projectCode || "")}</b> ${esc(entry.projectName || "")}</td>
            <td>${esc(entry.activityType)}</td>
            <td>${esc(entry.description)}${entry.phaseRef ? ` <span class="pill flat">${esc(entry.phaseRef)}</span>` : ""}${
  entry.printsQty ? ` <span class="pill flat">${entry.printsQty} prints</span>` : ""}${
  entry.travelKm ? ` <span class="pill flat">${entry.travelKm} km</span>` : ""}</td>
            ${billed ? `<td class="num">${money(entry.capturedAmount)}</td>` : ""}
            <td class="num">${entry.certificateId
    ? '<span class="pill ok">billed</span>'
    : `<button class="btn btn-sm" type="button" data-action="withdraw-entry"
                  data-entry="${esc(entry.id)}">Withdraw</button>`}</td>
          </tr>`;
  }).join("")}</tbody>
        </table></div>` : `<div class="empty">Nothing logged on this day yet.</div>`}
        ${open ? composer : ""}
      </section>`;
  }).join("")}`;
}

async function submitMyTime(form, values) {
  const mt = state.myTime;
  const project = projectByCode(values.projectCode);
  if (!project) {
    toast("That code is not on the register. Pick a job from the list.", true);
    form.querySelector("#mt-project").focus();
    return;
  }
  const phaseRef = values.phaseSel === "__other" ? (values.phaseFree || "") : (values.phaseSel || "");
  const asSomeoneElse = isOwner() && mt.personId !== state.session.userId;
  const result = await attempt(() => api.createTimeEntry({
    projectId: project.id,
    date: values.date,
    start: values.start,
    end: values.end,
    minutes: Number(values.minutes),
    activityType: values.activityType,
    description: values.description,
    phaseRef: phaseRef || null,
    printsQty: values.printsQty,
    travelKm: values.travelKm,
    pricingRule: values.pricingRule,
    rateBandCode: values.pricingRule === "band_hourly" ? values.rateBandCode : null,
    ...(asSomeoneElse ? { userId: mt.personId } : {}),
  }));
  if (!result) return;

  const burn = result.financials?.burn;
  toast(canViewBilled() && burn !== null && burn !== undefined && burn > 1
    ? `Logged. ${project.code} is now at ${percent(burn)} of its fee.`
    : canViewBilled() ? `Logged ${money(result.entry.capturedAmount)}.` : "Logged.");

  // The next row: same job, same activity, same phase, starting where this
  // one ended. Only the words and the clock start over.
  mt.entries = (await api.listTimeEntries({
    person: mt.personId, from: daysAgo(MY_TIME_DAYS),
  })).entries;
  await loadProjects();
  if (mt.schedules) delete mt.schedules[project.id];
  await loadPhaseSchedule(project.id);
  mt.draft = {
    ...blankDraft(values.end || lastEndOn(mt.day)),
    projectCode: project.code,
    activityType: values.activityType,
    phaseSel: values.phaseSel,
    phaseFree: values.phaseFree || "",
    rule: values.pricingRule,
    band: values.rateBandCode || "",
  };
  mt.fresh = true;
  renderMain();
  el("main").querySelector("#mt-end")?.focus();
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
      const wanted = params.get("view");
      state.view = wanted === "register" ? "register"
        : wanted === "time" ? "time"
        : wanted === "firm" && isOwner() ? "firm"
        : wanted === "team" && isOwner() ? "team"
        : wanted === "templates" && isOwner() ? "templates"
        : "practice";
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
  if (state.view === "time") {
    await loadMyTime();
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
    // The letterhead is the firm's, owner-only, and changes rarely: read on
    // every visit so an edit under Firm details is on the next certificate.
    if (canViewBilled()) {
      state.orgSettings = (await api.orgSettings().catch(() => null))?.settings ?? null;
      if (!state.team.length) {
        state.team = (await api.listTeam().catch(() => ({ members: [] }))).members ?? [];
      }
    }
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
  // The cross-job composer names its own job; the job page's form is the
  // selected one.
  const project = form.dataset.form === "mytime"
    ? projectByCode(values.projectCode)
    : selected();
  const f = project?.financials;

  // What an hour is worth is billed-tier. The ladder is computed here, so the
  // gate has to be too: without it an employee would read the rate off the
  // preview they are not otherwise shown.
  if (!canViewBilled()) {
    node.className = "preview";
    node.innerHTML = minutes
      ? `<span>This row <strong>${duration(minutes)}</strong></span>`
      : "<span>Enter a duration.</span>";
    return;
  }
  if (amount === null || !minutes) {
    node.className = "preview";
    node.innerHTML = "<span>Enter a duration to see what it is worth.</span>";
    return;
  }
  const after = (f?.captured ?? 0) + amount;
  const burnAfter = f?.quoted ? after / f.quoted : null;
  // 5.3: a row tagged to a phase on the schedule is measured against that
  // phase's fee as well - the job can be well inside its quote while this
  // phase is already spent.
  const phaseRef = form.dataset.form === "mytime"
    ? (values.phaseSel === "__other" ? values.phaseFree : values.phaseSel)
    : values.phaseRef;
  const phaseLine = phaseScheduleLine(project, phaseRef);
  const phaseAfter = phaseLine ? (phaseLine.captured ?? 0) + amount : null;
  const phaseBurn = phaseLine ? phaseAfter / phaseLine.quoted : null;
  const phaseTail = phaseLine
    ? `<span>${esc(phaseLine.label)} <strong>${percent(phaseBurn)}</strong> of its fee${
      phaseBurn > 1 ? " &mdash; past the phase" : ""}</span>`
    : "";
  if (phaseBurn !== null && phaseBurn > 1) node.className = "preview over";
  node.className = burnAfter !== null && burnAfter > 1 ? "preview over" : "preview";
  // On a capped fee the sentence that matters is different: past 100% is not
  // "over budget", it is time that will not be charged for. Say how much of
  // this row falls on the wrong side of the line, because that is the number
  // that changes whether the hour is worth logging as billable work.
  let tail;
  if (burnAfter === null) {
    tail = "<span>No quoted fee to measure against</span>";
  } else if (project?.feeCeiling) {
    const before = f.captured ?? 0;
    const roomLeft = Math.max(0, cents(f.quoted - before));
    const lost = Math.min(amount, Math.max(0, cents(after - f.quoted)));
    tail = `<span>Burn <strong>${percent(burnAfter)}</strong> of a capped fee</span>${
      lost > 0
        ? `<span><strong>${money(lost)}</strong> of this row is past the ceiling and will not be billed</span>`
        : `<span>${money(roomLeft)} of ceiling left before this row</span>`}`;
  } else {
    tail = `<span>Burn <strong>${percent(burnAfter)}</strong>${burnAfter > 1 ? " &mdash; past the fee" : ""}</span>`;
  }
  node.innerHTML = `
    <span>This row <strong>${money(amount)}</strong></span>
    <span>Captured after it <strong>${money(after)}</strong></span>
    ${tail}${phaseTail}`;
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
      paintTypeDetail();
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
  // No `tab` argument: returns to whichever tab was open when the user
  // wandered off, instead of resetting to Overview every time.
  el("current-job").addEventListener("click", () => openJob(state.selectedId));

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
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      const composerForm = document.activeElement?.closest?.('[data-form="mytime"]');
      if (composerForm) {
        event.preventDefault();
        composerForm.requestSubmit();
        return;
      }
    }
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
    const combo = document.activeElement?.matches?.("[data-combo-input]")
      ? document.activeElement
      : null;
    const comboMenu = combo && comboMenuFor(combo);
    if (combo && comboMenu && !comboMenu.hidden) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        comboMove(combo, event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Enter") {
        const active = comboActive(comboMenu);
        if (active) {
          event.preventDefault();
          pickCombo(active);
        }
      } else if (event.key === "Escape") {
        closeCombo(combo);
      }
    }
  });

  const main = el("main");

  main.addEventListener("click", async (event) => {
    // A click on a combo field should (re)open its menu even when the field
    // was already focused - e.g. it was closed with Escape a moment ago, or
    // this click is what focuses it, and `focusin` doesn't fire a second
    // time for a field that never lost focus.
    if (event.target.matches("[data-combo-input]")) filterCombo(event.target);
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
    // A fee-schedule row: drill into that phase's own time, on the Time tab,
    // without moving the job (unlike `data-phase` above, this reads nothing
    // and writes nothing â€” it is a lens, not a fact recorded on the job).
    const phaseFilter = event.target.closest("[data-phase-filter]");
    if (phaseFilter) {
      state.selectedPhaseRef = phaseFilter.dataset.phaseFilter;
      state.tab = "time";
      await loadTab();
      renderMain();
      return;
    }
    // One click for what was a certificate, a date range and a "pull time" -
    // three screens away from the question "what can I invoice right now".
    // Read before the row handler so a button inside a list row still acts.
    const readyDraft = event.target.closest("[data-ready-draft]");
    if (readyDraft) {
      readyDraft.disabled = true;
      // The day *after* the last period ended. Starting on `period_end` itself
      // would re-offer a day already invoiced; an hour on a line is skipped
      // anyway, so this is about the period the client reads, not double
      // charging. Blank means the whole job, which is what "never certified"
      // deserves.
      const from = readyDraft.dataset.from ? dayAfter(readyDraft.dataset.from) : null;
      const created = await attempt(() => api.createCertificate(
        readyDraft.dataset.readyDraft, { periodStart: from, periodEnd: today() },
      ));
      if (!created) {
        if (readyDraft.isConnected) readyDraft.disabled = false;
        return;
      }
      const filled = await attempt(() => api.addLinesFromTime(created.certificate.id, {
        from, to: today(),
      }));
      const draft = filled?.certificate ?? created.certificate;
      const pastCeiling = draft.ceiling?.excess > 0 ? draft.ceiling.excess : 0;
      // Land on the draft itself. openJob() clears `openCertificate` (arriving
      // at a job should not reopen whatever was last on screen), so it is set
      // after the navigation rather than before it.
      await loadProjects();
      await openJob(readyDraft.dataset.readyDraft, { tab: "certificates" });
      state.openCertificate = draft;
      renderMain();
      if (pastCeiling) {
        // The all-hours pull is right for time and materials and is exactly
        // what a capped fee forbids, so the draft opens with the fix proposed
        // rather than looking finished.
        toast(`Draft ${draft.seq} is ${money(pastCeiling)} past this job's fee ceiling. `
          + "Write that down before it can be issued.", true);
        return;
      }
      toast(filled
        ? `Draft ${draft.seq}: ${draft.lines.length} line${
          draft.lines.length === 1 ? "" : "s"} pulled. Nothing has gone to the client.`
        : `Draft ${draft.seq} started, with no lines on it yet.`);
      return;
    }
    // A fee-bar segment: the job, opened at the rows that segment is made of.
    // Read before the row handler below, which would otherwise swallow it and
    // land on Overview - "a count with no way through to the jobs it counted is
    // a poster", and the same goes for a segment.
    const openTab = event.target.closest("[data-open-tab]");
    if (openTab) {
      const owner = openTab.closest("[data-project]");
      if (owner) return openJob(owner.dataset.project, { tab: openTab.dataset.openTab });
      state.tab = openTab.dataset.openTab;
      await loadTab();
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
    } else if (action.action === "cert-month") {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - (action.which === "last" ? 1 : 0), 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const form = event.target.closest("form");
      form.elements.from.value = iso(first);
      form.elements.to.value = iso(last);
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
    } else if (action.action === "apply-ceiling") {
      const result = await attempt(() => api.addWriteDown(action.certificate, {
        amount: Number(action.amount),
        reasonCode: "fee_ceiling",
        note: `Fee ceiling of ${money(Number(action.quoted))} reached`,
      }));
      if (!result) return;
      state.openCertificate = result.certificate;
      toast(`${money(Number(action.amount))} written down as fee ceiling`);
      await refresh();
    } else if (action.action === "print-certificate") {
      // The browser names a saved PDF after the page title, and "StudioPractice
      // - practice operations" is not a file name anybody wants to send a client.
      const project = selected();
      const before = document.title;
      const seq = state.openCertificate?.seq;
      document.title = `${project?.code || "Certificate"} payment certificate ${seq ?? ""}`.trim();
      window.addEventListener("afterprint", () => { document.title = before; }, { once: true });
      window.print();
    } else if (action.action === "mt-select-day") {
      state.myTime.day = action.day;
      resetDraftForDay({ keep: true });
      renderMain();
    } else if (action.action === "mt-more") {
      state.myTime.more = !state.myTime.more;
      const more = main.querySelector("#mt-more");
      if (more) more.hidden = !state.myTime.more;
    } else if (action.action === "withdraw-entry") {
      if (await attempt(() => api.deleteTimeEntry(action.entry))) await refresh();
    } else if (action.action === "clear-phase-filter") {
      state.selectedPhaseRef = null;
      renderMain();
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
    const form = event.target.closest('[data-form="time"], [data-form="mytime"]');
    if (form) updatePreview(form);
    if (event.target.matches("[data-combo-input]")) filterCombo(event.target);
    if (event.target.id === "mt-project") syncMyTimeProject(form);
    if (event.target.id === "mt-phase-free" && state.myTime) {
      state.myTime.draft.phaseFree = event.target.value;
    }
  });

  // Opens the menu the moment a combo field is focused (tab, click, or the
  // caret-restore in restorePendingEdits after an unrelated re-render), and
  // closes it once focus leaves that field - `focusin`/`focusout` bubble,
  // `focus`/`blur` do not, and this whole app is delegated listeners on
  // `main` rather than one per field.
  main.addEventListener("focusin", (event) => {
    if (event.target.matches("[data-combo-input]")) filterCombo(event.target);
  });
  main.addEventListener("focusout", (event) => {
    if (event.target.matches("[data-combo-input]")) closeCombo(event.target);
  });
  // `mousedown`, not `click`: it fires before the input blurs, so
  // `preventDefault` here keeps focus (and the value about to be typed into
  // it) on the field instead of the row that was clicked.
  main.addEventListener("mousedown", (event) => {
    const row = event.target.closest("[data-combo-menu] li");
    if (!row) return;
    event.preventDefault();
    pickCombo(row);
  });

  main.addEventListener("change", async (event) => {
    const target = event.target;
    if (state.view === "time" && state.myTime) {
      const mt = state.myTime;
      if (target.id === "mt-day" && target.value) {
        mt.day = target.value;
        resetDraftForDay({ keep: true });
        renderMain();
      } else if (target.id === "mt-person") {
        mt.personId = target.value;
        await loadMyTime();
        resetDraftForDay({ keep: false });
        renderMain();
      } else if (target.id === "mt-activity") {
        // Print and Travel are the two activities that carry a quantity.
        if (/print|travel/i.test(target.value) && !mt.more) {
          mt.more = true;
          target.closest("form").querySelector("#mt-more").hidden = false;
        }
      } else if (target.id === "mt-phase") {
        mt.draft.phaseSel = target.value;
        target.closest("form").querySelector("#mt-phase-free").hidden = target.value !== "__other";
      }
      return;
    }
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
      // An unchecked box is absent from FormData, which the server reads as
      // "leave it alone" - so a box that exists is sent as an explicit answer.
      const ceiling = form.elements.feeCeiling;
      if (ceiling) values.feeCeiling = ceiling.checked;
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
    } else if (kind === "mytime") {
      await submitMyTime(form, values);
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
  el("who").textContent = `${state.session.email} Â· ${state.session.orgName || "â€”"}`;
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
