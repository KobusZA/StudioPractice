// Practice operations: the register, the timesheet, and payment certificates.
//
// Deliberately not part of web/v2. That is the drawing app, and the drawing
// app is one activity that logs time against a job rather than the product.
// What these three screens replace is a spreadsheet the whole firm is run
// from, so the rules that matter are the ones about money: captured value is
// never edited, a write-down carries a reason, and a gap in the data is shown
// rather than filled in with a plausible zero.

import { ApiError, api } from "./api.js";

const state = {
  session: null,
  reference: null,
  projects: [],
  selectedId: null,
  tab: "overview",
  entries: [],
  certificates: [],
  openCertificate: null,
  feeSchedule: null,
  tasks: [],
  monthEntries: [],
  signUpMode: false,
  returnId: null,
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

// --- the rail ---------------------------------------------------------------

/**
 * The rail is ordered by what is going wrong, not by what was touched last.
 * A list in date order answers "what did I open yesterday", which nobody needs
 * a register to tell them; the question this screen exists for is which job is
 * losing money, and that job is rarely the most recent one.
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

function renderRail() {
  const list = el("rail-list");
  if (!state.projects.length) {
    list.innerHTML = `<div class="empty" style="margin:14px">No jobs yet.<br />
      The register is the spine: a job here needs no drawing, no template and no fee.</div>`;
    return;
  }
  list.innerHTML = `<p class="rail-note">Worst realisation and deepest burn first.
    A job in trouble is rarely the one opened most recently.</p>`
    + state.projects.map((project) => {
    const { realisation, burn } = project.financials;
    const badge = realisation === null && burn === null ? "&mdash;"
      : realisation !== null ? percent(realisation) : percent(burn);
    const cls = realisation !== null ? realisationClass(realisation)
      : burn !== null && burn > 1 ? "bad" : "flat";
    return `<button class="proj" data-project="${esc(project.id)}"
              aria-current="${project.id === state.selectedId}">
        <b>${esc(project.code || "no code")} &middot; ${esc(project.name || "Untitled")}</b>
        <span class="real ${cls}" title="${realisation !== null ? "Realisation" : "Burn"}">${badge}</span>
        <em>${esc(project.clientName || "No client recorded")}</em>
      </button>`;
    }).join("");
}

// --- the main panel ---------------------------------------------------------

function selected() {
  return state.projects.find((project) => project.id === state.selectedId) || null;
}

function renderMain() {
  const composing = state.selectedId === "new";
  el("composer").hidden = !composing;
  el("workspace").inert = composing;
  if (composing) {
    renderComposer();
    syncAddress();
    return;
  }
  const main = el("main");
  const project = selected();
  if (!project) {
    main.innerHTML = `<div class="panel">${firmHtml()}</div>`;
    syncAddress();
    return;
  }
  const type = state.reference?.projectTypes.find((t) => t.code === project.typeCode);
  const drawingLabel = project.drawingId ? "Open drawing" : "Start a drawing";
  main.innerHTML = `
    <div class="proj-head">
      <div class="proj-head-row">
        <div>
          <div class="code">${esc(project.code || "NO CODE")}</div>
          <h1>${esc(project.name || "Untitled")}</h1>
        </div>
        <button class="btn" type="button" data-action="drawing">${drawingLabel}</button>
      </div>
      <div class="facts">
        <span>Client <b>${esc(project.clientName || "—")}</b></span>
        <span>Type <b>${esc(type?.name || project.typeCode || "—")}</b></span>
        <span>Basis <b>${project.billingBasis === "time_and_materials" ? "Time &amp; materials" : project.billingBasis === "fixed_fee" ? "Fixed fee" : "—"}</b></span>
        <span>Status <b>${esc(project.status || "—")}</b></span>
      </div>
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
  syncAddress();
}

/** So a return from the planner lands on this job, and a refresh stays here. */
function syncAddress() {
  const url = new URL(location.href);
  const id = state.selectedId && state.selectedId !== "new" ? state.selectedId : "";
  if (id) url.searchParams.set("project", id);
  else url.searchParams.delete("project");
  const next = `${url.pathname}${url.search}`;
  if (next !== `${location.pathname}${location.search}`) history.replaceState(null, "", next);
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

const TABS = [
  ["overview", "Overview"],
  ["schedule", "Fee schedule"],
  ["time", "Time"],
  ["certificates", "Certificates"],
];

/**
 * The practice, not one job. The rail and every tab beside it answer questions
 * about a single project; this is the only place that can say how the firm is
 * doing, and it costs nothing because the register already carries each job's
 * money with it.
 */
function firmHtml() {
  const jobs = state.projects;
  if (!jobs.length) {
    return `<div class="empty">No jobs yet.<br />
      A job needs only a code to exist &mdash; client, type, fee and drawing can all arrive later.
      Press <b>New job</b> and it will walk through each of those choices.</div>`;
  }
  const open = jobs.filter((p) => p.status === "open");
  const overFee = jobs.filter((p) => p.financials.burn !== null && p.financials.burn > 1);
  const uncertified = jobs.filter((p) => p.financials.captured > 0
    && p.financials.certifiedGross === 0 && p.financials.draftGross === 0);
  const capturedThisMonth = state.monthEntries.reduce((sum, e) => sum + e.capturedAmount, 0);
  const minutesThisMonth = state.monthEntries.reduce((sum, e) => sum + e.minutes, 0);

  const jobList = (list) => (list.length
    ? `<div class="sub">${list.slice(0, 4).map((p) => esc(p.code || "no code")).join(", ")}${
      list.length > 4 ? ` and ${list.length - 4} more` : ""}</div>`
    : '<div class="sub">None.</div>');

  return `
    <h3 class="sec">The practice <small>every job, not the one you have open</small></h3>
    <div class="kpis">
      <div class="kpi">
        <div class="lbl">Open jobs</div>
        <div class="val">${open.length}</div>
        <div class="sub">${jobs.length} in the register altogether</div>
      </div>
      <div class="kpi">
        <div class="lbl">Captured this month</div>
        <div class="val">${money(capturedThisMonth)}</div>
        <div class="sub">${duration(minutesThisMonth)} logged since ${esc(monthStart())}</div>
      </div>
      <div class="kpi${overFee.length ? " flag" : ""}">
        <div class="lbl">Past the fee</div>
        <div class="val">${overFee.length}</div>
        ${jobList(overFee)}
      </div>
      <div class="kpi${uncertified.length ? " flag" : ""}">
        <div class="lbl">Worked, never billed</div>
        <div class="val">${uncertified.length}</div>
        ${jobList(uncertified)}
      </div>
    </div>
    <p class="note-line">Time captured and no certificate at all is the gap the workbook could
      not show: each invoice was compiled by hand from whichever rows somebody noticed, so an
      unbilled job looked exactly like a quiet one. Select a job from the rail to open it.</p>`;
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
  if (state.selectedId !== "new") {
    state.returnId = state.selectedId;
    state.newJob = blankNewJob();
  }
  state.selectedId = "new";
  renderRail();
  renderMain();
}

function closeNewJob() {
  state.selectedId = state.returnId ?? state.projects[0]?.id ?? null;
  state.returnId = null;
  state.newJob = null;
  renderRail();
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
        The description is the name people see on the rail; it can wait.</p>
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
  state.selectedId = created.project.id;
  state.returnId = null;
  state.newJob = null;
  state.tab = "overview";
  toast(`${created.project.code} created`);
  await refresh();
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

async function loadProjects({ keepSelection = true } = {}) {
  const { projects } = await api.listRegister();
  // Sorted here rather than in SQL: the ordering is a reading of four figures
  // the server already sends, and the day somebody wants it by code instead,
  // that is a click rather than a migration.
  state.projects = projects.slice().sort(byRisk);
  if (!keepSelection) {
    const requested = new URLSearchParams(location.search).get("project");
    state.selectedId = projects.some((p) => p.id === requested)
      ? requested
      : (projects[0]?.id ?? null);
  } else if (state.selectedId !== "new" && !projects.some((p) => p.id === state.selectedId)) {
    state.selectedId = projects[0]?.id ?? null;
  }
  renderRail();
}

async function loadTab() {
  const project = selected();
  if (!project) {
    // The landing state is firm-wide, and the one figure the register rows do
    // not already carry is what was captured this month.
    state.monthEntries = state.projects.length
      ? (await api.listTimeEntries({ from: monthStart(), to: today() })).entries
      : [];
    return;
  }
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
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selectedId === "new" && !state.newJob?.saving) {
      closeNewJob();
    }
  });

  el("rail-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-project]");
    if (!button) return;
    state.selectedId = button.dataset.project;
    state.openCertificate = null;
    renderRail();
    await loadTab();
    renderMain();
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
    const action = event.target.closest("[data-action]")?.dataset;
    if (!action) return;

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
  await loadProjects({ keepSelection: false });
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
