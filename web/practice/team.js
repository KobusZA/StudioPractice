// Team: the owner's view of what every person did, on which jobs, and what it
// was worth. Owner-only (the server refuses anyone else, and the nav button is
// absent for them).
//
// Value is CAPTURED value - hours x rate when logged - not money received, and
// nobody is credited with a share of a certificate. The screen says so.

import { api } from "./api.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

const money = (value) => {
  if (value === null || value === undefined) return "&mdash;";
  const [whole, cents] = Math.abs(value).toFixed(2).split(".");
  return `${value < 0 ? "-" : ""}R\u2009${whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009")}.${cents}`;
};
const pct = (value) => (value === null || value === undefined ? "&mdash;" : `${Math.round(value * 100)}%`);
const hrs = (value) => (value === null || value === undefined ? "&mdash;" : `${value.toFixed(1)}h`);
const name = (email) => String(email || "").split("@")[0] || "Unknown";

const iso = (date) => date.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());
const shift = (isoDate, days) => iso(new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000));

/** Period presets. Monday-start weeks, matching the 40-hour Mon-Fri standard. */
export function presetRange(preset, today = todayIso()) {
  if (preset === "week") {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    return { from: shift(today, -((day + 6) % 7)), to: today };
  }
  if (preset === "last-month") {
    const first = `${today.slice(0, 7)}-01`;
    const to = shift(first, -1);
    return { from: `${to.slice(0, 7)}-01`, to };
  }
  if (preset === "90") return { from: shift(today, -89), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

const PRESETS = [
  ["month", "This month"], ["last-month", "Last month"], ["week", "This week"], ["90", "Last 90 days"],
];

const view = { tab: "performance", roster: null, editing: null, adding: false, preset: "month", range: null, report: null, open: null, entries: {}, sort: "captured" };

const SORTS = {
  captured: (a, b) => b.captured - a.captured,
  hours: (a, b) => b.minutes - a.minutes,
  utilisation: (a, b) => (b.utilisation ?? -1) - (a.utilisation ?? -1),
  rate: (a, b) => (b.capturedPerHour ?? -1) - (a.capturedPerHour ?? -1),
  name: (a, b) => String(a.email).localeCompare(String(b.email)),
};

export async function mountTeam(host, ctx = {}) {
  view.range ??= presetRange(view.preset);
  if (!host.dataset.teamBound) {
    host.dataset.teamBound = "1";
    host.addEventListener("click", (event) => onClick(host, event, ctx));
    host.addEventListener("submit", (event) => {
      const kind = event.target.dataset.form;
      if (kind === "member-add" || kind === "member-edit") {
        event.preventDefault();
        saveMember(host, ctx, event.target, kind);
        return;
      }
      if (kind !== "team-range") return;
      event.preventDefault();
      const { from, to } = event.target.elements;
      if (!from.value || !to.value || from.value > to.value) {
        ctx.toast?.("Pick a start that is on or before the end.", true);
        return;
      }
      view.preset = "custom";
      view.range = { from: from.value, to: to.value };
      load(host, ctx);
    });
  }
  await (view.tab === "people" ? loadRoster(host, ctx) : load(host, ctx));
}

async function loadRoster(host, ctx) {
  host.innerHTML = `<p class="note-line">Loading&hellip;</p>`;
  try {
    view.roster = (await api.teamRoster()).members;
  } catch (error) {
    host.innerHTML = `<p class="note-line">${esc(error.message)}</p>`;
    return;
  }
  paintRoster(host);
}

/** "2 yrs 3 mo", "5 mo", "12 days" - how long someone has been in the firm. */
export function tenure(startIso, today = todayIso()) {
  if (!startIso) return "";
  const a = new Date(`${String(startIso).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || b < a) return "";
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  if (months < 1) {
    const days = Math.round((b - a) / 86400000);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} yr${years === 1 ? "" : "s"}` : "", rest ? `${rest} mo` : ""].filter(Boolean).join(" ");
}

async function saveMember(host, ctx, form, kind) {
  const data = Object.fromEntries(new FormData(form));
  try {
    if (kind === "member-add") {
      const { email, password, role, ...details } = data;
      const { member } = await api.inviteTeamMember({ email, password, role });
      const filled = Object.fromEntries(Object.entries(details).filter(([, v]) => String(v).trim()));
      if (Object.keys(filled).length) await api.updateTeamMember(member.userId, filled);
      ctx.toast?.(`${email} can now sign in as ${role === "owner" ? "an owner" : "an employee"}.`);
      view.adding = false;
    } else {
      await api.updateTeamMember(form.dataset.user, data);
      view.editing = null;
    }
  } catch (error) {
    ctx.toast?.(error.message, true);
    return;
  }
  await loadRoster(host, ctx);
}

async function removeMember(host, ctx, userId) {
  const member = view.roster.find((m) => m.userId === userId);
  const label = member?.fullName || member?.email || "this person";
  if (!window.confirm(`Remove ${label} from the firm?\n\nThey will be signed out and can no longer sign in. `
    + "Their logged time stays in your records.")) return;
  try {
    view.roster = (await api.removeTeamMember(userId)).members;
    view.editing = null;
    ctx.toast?.(`${label} removed.`);
  } catch (error) {
    ctx.toast?.(error.message, true);
    return;
  }
  paintRoster(host);
}

const tabsHtml = () => `<div class="tm-bar" role="tablist">
  <button type="button" class="btn btn-sm${view.tab === "performance" ? " btn-primary" : ""}" data-tab="performance">Performance</button>
  <button type="button" class="btn btn-sm${view.tab === "people" ? " btn-primary" : ""}" data-tab="people">People</button>
</div>`;

// One row per role, one column per thing that role can do; the radio picks the
// role. Mirrors server/src/permissions.js - the server still enforces it.
const ROLE_GRID = [
  { role: "employee", label: "Employee", can: [true, true, false, false] },
  { role: "owner", label: "Owner", can: [true, true, true, true] },
];
const ROLE_COLUMNS = ["Edit work & log time", "See hours & progress", "See fees & billed amounts", "See costs, manage team"];

function roleGrid(selected) {
  return `<fieldset class="wide tm-roles"><legend>Permission level</legend>
    <table class="grid tm-role-grid">
      <thead><tr><th></th>${ROLE_COLUMNS.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${ROLE_GRID.map((r) => `<tr>
        <td><label class="tm-role-pick"><input type="radio" name="role" value="${r.role}"${r.role === selected ? " checked" : ""} /> ${r.label}</label></td>
        ${r.can.map((c) => `<td class="tm-role-cell">${c ? "&#10003;" : "&ndash;"}</td>`).join("")}
      </tr>`).join("")}</tbody>
    </table></fieldset>`;
}

function memberForm(m) {
  const f = (field, label, value, type = "text") => `<label>${label}
    <input type="${type}" name="${field}" value="${esc(value || "")}" /></label>`;
  return `<form data-form="member-edit" data-user="${esc(m.userId)}" class="tm-member-form">
    ${f("fullName", "Full name", m.fullName)}
    ${f("jobTitle", "Job title", m.jobTitle)}
    ${f("phone", "Phone", m.phone, "tel")}
    ${f("startDate", "Joined the firm", m.startDate, "date")}
    ${m.isYou ? "" : roleGrid(m.role)}
    <label class="wide">Notes (only owners can see these)
      <textarea name="notes" rows="2">${esc(m.notes || "")}</textarea></label>
    <div class="wide"><button class="btn btn-sm btn-primary" type="submit">Save</button>
      <button class="btn btn-sm" type="button" data-member-cancel>Cancel</button></div>
  </form>`;
}

function paintRoster(host) {
  const rows = view.roster || [];
  const today = todayIso();
  host.innerHTML = `
    <div class="tpl team">
      <h1>Team</h1>
      ${tabsHtml()}
      <p class="note-line">Everyone in the firm. Only owners can see this page, the personal details on it,
        or add and remove people.</p>
      <p><button type="button" class="btn btn-sm" data-member-add>${view.adding ? "Cancel" : "+ Add team member"}</button></p>
      ${view.adding ? `<form data-form="member-add" class="tm-member-form">
        <label>Email<input type="email" name="email" required autocomplete="off" /></label>
        <label>Password (10+ characters)<input type="text" name="password" required minlength="10" autocomplete="off" /></label>
        <label>Full name<input name="fullName" /></label>
        <label>Job title<input name="jobTitle" /></label>
        <label>Phone<input type="tel" name="phone" /></label>
        <label>Joined the firm<input type="date" name="startDate" value="${today}" /></label>
        ${roleGrid("employee")}
        <p class="note-line wide">Share the password with them directly &mdash; there is no email invite yet.</p>
        <div class="wide"><button class="btn btn-sm btn-primary" type="submit">Add</button></div>
      </form>` : ""}
      <table class="grid tm-people">
        <thead><tr><th>Person</th><th>Role</th><th>Phone</th><th>Joined</th><th>Time in team</th><th></th></tr></thead>
        <tbody>${rows.map((m) => {
    const joined = m.startDate || String(m.createdAt || "").slice(0, 10);
    return `
          <tr>
            <td>${esc(m.fullName || name(m.email))}${m.isYou ? " <em>(you)</em>" : ""}
              <em>${esc(m.email)}${m.jobTitle ? ` &middot; ${esc(m.jobTitle)}` : ""}</em></td>
            <td>${esc(m.role)}</td>
            <td>${esc(m.phone || "")}</td>
            <td>${esc(joined)}</td>
            <td>${esc(tenure(joined, today))}</td>
            <td class="num"><button type="button" class="btn btn-sm" data-member-edit="${esc(m.userId)}">Details</button>
              ${m.role === "owner" || m.isYou ? "" : `<button type="button" class="btn btn-sm" data-member-remove="${esc(m.userId)}">Remove</button>`}</td>
          </tr>
          ${view.editing === m.userId ? `<tr class="tm-drill-row"><td colspan="6">${memberForm(m)}</td></tr>` : ""}`;
  }).join("")}
        </tbody>
      </table>
    </div>`;
}

async function load(host, ctx) {
  host.innerHTML = `<p class="note-line">Loading&hellip;</p>`;
  try {
    view.report = (await api.teamReport(view.range)).report;
    view.entries = {};
    view.open = null;
  } catch (error) {
    host.innerHTML = `<p class="note-line">${esc(error.message)}</p>`;
    return;
  }
  paint(host);
}

async function onClick(host, event, ctx) {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    view.tab = tab.dataset.tab;
    await (view.tab === "people" ? loadRoster(host, ctx) : load(host, ctx));
    return;
  }
  if (event.target.closest("[data-member-add]")) {
    view.adding = !view.adding;
    paintRoster(host);
    return;
  }
  const edit = event.target.closest("[data-member-edit]");
  if (edit) {
    view.editing = view.editing === edit.dataset.memberEdit ? null : edit.dataset.memberEdit;
    paintRoster(host);
    return;
  }
  if (event.target.closest("[data-member-cancel]")) {
    view.editing = null;
    paintRoster(host);
    return;
  }
  const remove = event.target.closest("[data-member-remove]");
  if (remove) {
    await removeMember(host, ctx, remove.dataset.memberRemove);
    return;
  }
  const preset = event.target.closest("[data-preset]");
  if (preset) {
    view.preset = preset.dataset.preset;
    view.range = presetRange(view.preset);
    await load(host, ctx);
    return;
  }
  const sort = event.target.closest("[data-sort]");
  if (sort) {
    view.sort = sort.dataset.sort;
    paint(host);
    return;
  }
  const row = event.target.closest("[data-person]");
  if (!row) return;
  const id = row.dataset.person;
  if (view.open === id) {
    view.open = null;
    paint(host);
    return;
  }
  view.open = id;
  if (!view.entries[id]) {
    try {
      view.entries[id] = (await api.listTimeEntries({
        person: id, from: view.range.from, to: view.range.to,
      })).entries;
    } catch (error) {
      ctx.toast?.(error.message, true);
      view.open = null;
    }
  }
  paint(host);
}

function tile(label, value, sub, cls = "") {
  return `<div class="kpi ${cls}"><div class="lbl">${esc(label)}</div>
    <div class="val">${value}</div><div class="sub">${sub}</div></div>`;
}

function utilCell(person) {
  if (person.utilisation === null) return "&mdash;";
  const width = Math.min(person.utilisation, 1.5) / 1.5 * 100;
  const cls = person.utilisation > 1.05 ? "over" : person.utilisation < 0.6 ? "low" : "";
  return `<div class="tm-util ${cls}" title="${person.hours}h of the standard week"><i style="width:${width}%"></i></div>
    <span>${pct(person.utilisation)}</span>`;
}

function flags(person) {
  const out = [];
  if (!person.entries) out.push(["err", "nothing logged"]);
  if (person.daysMissing > 0 && person.entries) out.push(["warn", `${person.daysMissing} weekday${person.daysMissing === 1 ? "" : "s"} empty`]);
  if (person.thinEntries) out.push(["warn", `${person.thinEntries} thin description${person.thinEntries === 1 ? "" : "s"}`]);
  if (person.lateEntries) out.push(["warn", `${person.lateEntries} logged late`]);
  if (person.weekendHours) out.push(["flat", `${person.weekendHours}h weekend`]);
  if (person.staleUnbilled > 0) out.push(["err", `${money(person.staleUnbilled)} unbilled 30d+`]);
  return out.map(([cls, text]) => `<span class="pill ${cls}">${text}</span>`).join(" ");
}

function drillHtml(person) {
  const entries = view.entries[person.userId];
  if (!entries) return `<p class="note-line">Loading&hellip;</p>`;
  const jobs = person.projects.map((p) => `
    <tr><td><span class="code-cell">${esc(p.code || "no code")}</span> <em>${esc(p.name || "")}</em></td>
      <td class="num">${hrs(p.minutes / 60)}</td><td class="num">${money(p.captured)}</td></tr>`).join("");
  const mix = person.activities.map((a) => `
    <span class="pill ${a.internal ? "flat" : "ok"}">${esc(a.activityType)} ${hrs(a.minutes / 60)}</span>`).join(" ");
  const days = new Map();
  for (const entry of entries) {
    if (!days.has(entry.date)) days.set(entry.date, []);
    days.get(entry.date).push(entry);
  }
  const log = [...days].map(([date, rows]) => `
    <div class="tm-day"><h4>${esc(date)} <small>${hrs(rows.reduce((s, r) => s + r.minutes, 0) / 60)}</small></h4>
      ${rows.map((r) => `<div class="tm-entry">
        <span class="muted">${esc(r.projectCode || "")}</span>
        <span>${esc(r.description)}</span>
        <span class="muted">${esc(r.activityType)}${r.phaseRef ? ` &middot; ${esc(r.phaseRef)}` : ""}</span>
        <span class="num">${hrs(r.minutes / 60)}</span>
        <span class="num">${money(r.capturedAmount)}</span></div>`).join("")}
    </div>`).join("");
  return `
    <div class="tm-drill">
      <div class="tm-mix">${mix || `<span class="muted">No time logged in this period.</span>`}</div>
      ${jobs ? `<table class="grid"><thead><tr><th>Job</th><th class="num">Hours</th><th class="num">Captured</th></tr></thead>
        <tbody>${jobs}</tbody></table>` : ""}
      <h3 class="sec">What they wrote</h3>
      ${log || `<p class="note-line">Nothing to show.</p>`}
    </div>`;
}

function paint(host) {
  const { report } = view;
  const { firm, period } = report;
  const people = report.people.slice().sort(SORTS[view.sort]);
  const th = (key, label, cls = "num") => `<th class="sortable ${cls}" data-sort="${key}"${
    view.sort === key ? ' aria-sort="descending"' : ""}>${label}</th>`;

  host.innerHTML = `
    <div class="tpl team">
      <h1>Team</h1>
      ${tabsHtml()}
      <p class="note-line">What everybody did, on which jobs, and what it was worth. Value is
        <b>captured</b> (hours &times; rate when logged), not money received. Utilisation is logged hours
        over an ${period.standardDayHours}-hour weekday (a 40-hour week); leave and public holidays are not known,
        so an empty weekday means leave <i>or</i> an unfilled timesheet.</p>

      <div class="tm-bar">
        ${PRESETS.map(([key, label]) => `<button type="button" class="btn btn-sm${
          view.preset === key ? " btn-primary" : ""}" data-preset="${key}">${label}</button>`).join("")}
        <form data-form="team-range" class="tm-range">
          <input type="date" name="from" value="${esc(view.range.from)}" aria-label="From" />
          <span class="muted">to</span>
          <input type="date" name="to" value="${esc(view.range.to)}" aria-label="To" />
          <button class="btn btn-sm" type="submit">Apply</button>
        </form>
      </div>
      <p class="note-line">${esc(period.from)} to ${esc(period.through)}: ${period.weekdays} weekdays,
        ${period.standardHours}h standard per person.</p>

      <div class="kpis">
        ${tile("Captured", money(firm.captured), `${money(firm.capturedPerHour)} per logged hour`)}
        ${tile("Hours logged", hrs(firm.hours), `${hrs(firm.billableHours)} client work &middot; ${hrs(firm.internalHours)} internal`)}
        ${tile("Team utilisation", pct(firm.utilisation), `${firm.activePeople} of ${firm.people} people logged time`,
    firm.utilisation !== null && firm.utilisation < 0.6 ? "flag" : "")}
        ${tile("Billable share", pct(firm.billablePct), "of logged time is client work")}
        ${tile("Billed of captured", pct(firm.billedPct), `${money(firm.billed)} on issued certificates`)}
        ${tile("Not yet billed", money(firm.unbilled), `${money(firm.staleUnbilled)} older than 30 days`,
    firm.staleUnbilled > 0 ? "flag" : "dim")}
        ${tile("Jobs worked on", String(firm.projectCount), `${firm.entries} time entries`)}
        ${tile("Description quality", String(firm.thinEntries), `thin entries &middot; ${firm.lateEntries} logged late`,
    firm.thinEntries || firm.lateEntries ? "flag" : "dim")}
      </div>

      <h3 class="sec">People</h3>
      <table class="grid tm-people">
        <thead><tr>
          ${th("name", "Person", "")}
          ${th("hours", "Hours")}
          ${th("utilisation", "Utilisation", "")}
          <th class="num">Billable</th>
          ${th("captured", "Captured")}
          ${th("rate", "Per hour")}
          <th class="num">Billed</th>
          <th class="num">Jobs</th>
          <th>Top job</th>
          <th>Flags</th>
        </tr></thead>
        <tbody>
          ${people.map((p) => `
            <tr class="row-link${view.open === p.userId ? " current-phase" : ""}" data-person="${esc(p.userId)}"
                aria-expanded="${view.open === p.userId}">
              <td>${esc(name(p.email))}<em>${esc(p.role || "")}${p.lastEntryDate ? ` &middot; last ${esc(p.lastEntryDate)}` : ""}</em></td>
              <td class="num">${hrs(p.hours)}</td>
              <td class="tm-util-cell">${utilCell(p)}</td>
              <td class="num">${pct(p.billablePct)}</td>
              <td class="num">${money(p.captured)}</td>
              <td class="num">${money(p.capturedPerHour)}</td>
              <td class="num">${pct(p.billedPct)}</td>
              <td class="num">${p.projectCount}</td>
              <td>${p.topProject ? `${esc(p.topProject.code || p.topProject.name || "")} <em>${pct(p.topProject.share)} of their time</em>` : "&mdash;"}</td>
              <td>${flags(p)}</td>
            </tr>
            ${view.open === p.userId ? `<tr class="tm-drill-row"><td colspan="10">${drillHtml(p)}</td></tr>` : ""}`).join("")}
        </tbody>
      </table>

      <h3 class="sec">Jobs by person</h3>
      ${report.projects.length ? `
      <table class="grid">
        <thead><tr><th>Job</th><th class="num">Hours</th><th class="num">Captured</th><th>Who worked on it</th></tr></thead>
        <tbody>${report.projects.map((job) => `
          <tr><td><span class="code-cell">${esc(job.code || "no code")}</span><em>${esc(job.name || "")}</em></td>
            <td class="num">${hrs(job.hours)}</td><td class="num">${money(job.captured)}</td>
            <td>${job.people.map((p) => `<span class="pill flat">${esc(name(p.email))} ${hrs(p.minutes / 60)} &middot; ${money(p.captured)}</span>`).join(" ")}</td></tr>`).join("")}
        </tbody></table>` : `<p class="note-line">No time was logged in this period.</p>`}

      <h3 class="sec">Where the hours went</h3>
      <div class="tm-mix">${firm.activities.map((a) => `
        <span class="pill ${a.internal ? "flat" : "ok"}">${esc(a.activityType)} ${hrs(a.minutes / 60)}</span>`).join(" ")
    || `<span class="muted">Nothing logged.</span>`}</div>
    </div>`;
}
