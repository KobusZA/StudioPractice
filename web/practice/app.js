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
  signUpMode: false,
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
  if (project.billingBasis === "fixed_fee" && project.budgetEstimate === null) {
    out.push({
      level: "med",
      title: "Fixed fee with no quoted figure",
      body: "Burn cannot be reported against a quote that does not exist, so this job is "
        + "invisible to every overrun warning until a figure is entered.",
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

function renderRail() {
  const list = el("rail-list");
  if (!state.projects.length) {
    list.innerHTML = `<div class="empty" style="margin:14px">No jobs yet.<br />
      The register is the spine: a job here needs no drawing, no template and no fee.</div>`;
    return;
  }
  list.innerHTML = state.projects.map((project) => {
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
  const main = el("main");
  if (state.selectedId === "new") {
    main.innerHTML = registerFormHtml(null);
    return;
  }
  const project = selected();
  if (!project) {
    main.innerHTML = `<div class="panel"><div class="empty">
      Select a job, or create one. A job needs only a code to exist; everything else
      &mdash; client, type, fee, drawing &mdash; can arrive later.</div></div>`;
    return;
  }
  const type = state.reference?.projectTypes.find((t) => t.code === project.typeCode);
  main.innerHTML = `
    <div class="proj-head">
      <div class="code">${esc(project.code || "NO CODE")}</div>
      <h1>${esc(project.name || "Untitled")}</h1>
      <div class="facts">
        <span>Client <b>${esc(project.clientName || "—")}</b></span>
        <span>Type <b>${esc(type?.name || project.typeCode || "—")}</b></span>
        <span>Basis <b>${project.billingBasis === "time_and_materials" ? "Time &amp; materials" : project.billingBasis === "fixed_fee" ? "Fixed fee" : "—"}</b></span>
        <span>Status <b>${esc(project.status || "—")}</b></span>
      </div>
    </div>
    <div class="tabs">
      ${["overview", "time", "certificates"].map((tab) => `
        <button data-tab="${tab}" aria-selected="${state.tab === tab}">
          ${tab === "overview" ? "Overview" : tab === "time" ? "Time" : "Certificates"}
        </button>`).join("")}
    </div>
    <div class="panel">${
      state.tab === "overview" ? overviewHtml(project)
        : state.tab === "time" ? timeHtml(project)
          : certificatesHtml(project)
    }</div>`;
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
        <div class="sub">${f.quoted === null ? "No figure entered" : "Register budget estimate"}</div>
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

    <h3 class="sec">Register</h3>
    ${registerFormHtml(project)}`;
}

function registerFormHtml(project) {
  const creating = !project;
  const types = state.reference?.projectTypes || [];
  const value = (key) => esc(project?.[key] ?? "");
  const option = (list, current) => list.map((item) => {
    const code = typeof item === "string" ? item : item.code;
    const label = typeof item === "string" ? item : item.name;
    const placeholder = typeof item === "object" && item.isPlaceholder ? " (no template yet)" : "";
    return `<option value="${esc(code)}"${code === current ? " selected" : ""}>${esc(label)}${placeholder}</option>`;
  }).join("");

  return `${creating ? '<div class="panel"><h3 class="sec">New job</h3>' : ""}
    <form class="form" data-form="${creating ? "create" : "update"}"
          ${creating ? "" : `data-project="${esc(project.id)}"`}>
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
        <button class="btn btn-primary" type="submit">${creating ? "Create job" : "Save"}</button>
        ${creating ? '<button class="btn" type="button" data-action="cancel-create">Cancel</button>' : ""}
      </div>
      <p class="note-line">A project code is unique within the firm, compared ignoring case and
        surrounding spaces &mdash; the source workbook carried <code>P078</code> twice and
        <code>C036&nbsp;</code> beside <code>CO36.9</code>.</p>
    </form>
    ${creating ? "</div>" : ""}`;
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

// --- loading ----------------------------------------------------------------

async function loadProjects({ keepSelection = true } = {}) {
  const { projects } = await api.listRegister();
  state.projects = projects;
  if (!keepSelection || (state.selectedId !== "new"
    && !projects.some((p) => p.id === state.selectedId))) {
    state.selectedId = projects[0]?.id ?? null;
  }
  renderRail();
}

async function loadTab() {
  const project = selected();
  if (!project) return;
  if (state.tab === "time") {
    state.entries = (await api.listTimeEntries({ project: project.id })).entries;
  } else if (state.tab === "certificates") {
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

  el("new-project").addEventListener("click", () => {
    state.selectedId = "new";
    renderRail();
    renderMain();
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

    if (action.action === "cancel-create") {
      state.selectedId = state.projects[0]?.id ?? null;
      renderRail();
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

  main.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const kind = form.dataset.form;
    const values = formValues(form);

    if (kind === "create") {
      const created = await attempt(() => api.createRegisterProject(values));
      if (!created) return;
      state.selectedId = created.project.id;
      state.tab = "overview";
      toast(`${created.project.code} created`);
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
