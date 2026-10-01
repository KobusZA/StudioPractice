// Fee templates: what each kind of job is quoted from, edited by the firm.
//
// Owner-only. The nav button is hidden for anyone else (hide, don't disable)
// and the server refuses the write regardless - see replaceFeeTemplate in
// server/src/store.js.
//
// A template is only ever a starting point. A job copies it when it is
// registered, so nothing here reaches a job that already exists. The page says
// so, because "I changed the fee and the running job did not move" is the
// first thing anybody will ask.
//
// The draft lives in module state rather than in the DOM so that a re-render
// from elsewhere in the app does not eat half-typed work; it is only replaced
// by a load, a save, a discard or a reset.

import { api } from "./api.js";

const draft = {
  code: null,
  phases: null, // [{ name, fee: string, tasks: [{ description, fee: string }] }]
  costPct: "", // what a job of this type usually costs, as a percent of its fee, typed
  costMode: "cost", // how the box is read: "cost" (% of fee) or "margin" (profit % of fee); display only
  loading: false,
  saving: false,
  dirty: false,
  error: "",
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

const asText = (value) => (value === null || value === undefined ? "" : String(value));

function rands(value) {
  const [whole, cents] = Math.abs(value).toFixed(2).split(".");
  return `R\u2009${whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009")}.${cents}`;
}

/**
 * While a fee is being typed it is digits and one decimal point only. A comma
 * is the decimal point. Two fractional digits is all a rand amount has.
 */
function feeTyping(text) {
  const cleaned = String(text).replace(/,/g, ".").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  const whole = cleaned.slice(0, dot);
  const frac = cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  return `${whole}.${frac}`;
}

/** Blank, or a non-negative number the server will accept. */
function feeCommit(text) {
  const typed = feeTyping(text);
  if (typed === "" || typed === ".") return "";
  const parsed = Number(typed);
  if (!Number.isFinite(parsed)) return "";
  return String(Math.round(parsed * 100) / 100);
}

/** Settled fees read as rand. An empty fee stays empty so its placeholder shows. */
function feeDisplay(text) {
  if (String(text).trim() === "") return "";
  const parsed = Number(text);
  return Number.isFinite(parsed) ? rands(parsed) : "";
}

const cents = (text) => {
  const parsed = Number(String(text).replace(/[\s\u2009,]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const taskCents = (phase) => phase.tasks.reduce((sum, task) => sum + cents(task.fee), 0);

const phaseHasOwnFee = (phase) => String(phase.fee).trim() !== "";

/** A phase with no fee of its own is worth the sum of its tasks. */
function phaseCents(phase) {
  if (phaseHasOwnFee(phase)) return cents(phase.fee);
  return taskCents(phase);
}

/**
 * A blank phase fee already says "sum of tasks" in its placeholder, and the
 * column beside it carries that sum. A typed fee hides the placeholder, so
 * the line under the phase says what the number means.
 */
/** Text under a typed phase fee, and whether the task sum exceeds that fee. */
function phaseHint(phase) {
  if (!phaseHasOwnFee(phase)) return { text: "", over: false };
  const tasks = taskCents(phase);
  return {
    text: `Tasks add to ${rands(tasks / 100)}. Not used in the phase total.`,
    over: tasks > cents(phase.fee),
  };
}

const totalCents = () => (draft.phases ?? []).reduce((sum, phase) => sum + phaseCents(phase), 0);

/** The server's template, as editable strings. A summed phase stays blank. */
function fromTemplate(template) {
  return template.phases.map((phase) => {
    const taskSum = phase.tasks.reduce((sum, task) => sum + Math.round((task.defaultFee ?? 0) * 100), 0);
    const derived = phase.tasks.length > 0
      && phase.tasks.every((task) => task.defaultFee !== null)
      && taskSum === Math.round((phase.defaultFee ?? 0) * 100);
    return {
      name: phase.name,
      fee: derived ? "" : asText(phase.defaultFee),
      tasks: phase.tasks.map((task) => ({
        description: task.description,
        fee: asText(task.defaultFee),
      })),
    };
  });
}

/** The server holds a fraction (0.65); the firm thinks in percent (65). */
function costPctFromTemplate(template) {
  const share = template.costPct;
  return share === null || share === undefined ? "" : String(Math.round(share * 10000) / 100);
}

/** Percent while typing: digits and one decimal point, nothing else. */
function pctTyping(text) {
  const cleaned = String(text).replace(/,/g, ".").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}

const costPctNumber = () => {
  const parsed = Number(draft.costPct);
  return String(draft.costPct).trim() === "" || !Number.isFinite(parsed) ? null : parsed;
};

const fmtPct = (n) => String(Math.round(n * 100) / 100);

/** Cost share is what is stored; the box may show it as a profit margin (100 - cost). */
function typedFromCost() {
  const share = costPctNumber();
  if (share === null || draft.costMode === "cost") return draft.costPct;
  return fmtPct(100 - share);
}

function costFromTyped(typed) {
  if (draft.costMode === "cost") return typed;
  const n = Number(typed);
  return typed.trim() === "" || !Number.isFinite(n) ? "" : fmtPct(100 - n);
}

/** What the share comes to on a job priced exactly at the template. Null when no share is set. */
const impliedCostCents = () => {
  const share = costPctNumber();
  return share === null ? null : Math.round(totalCents() * share / 100);};

const impliedCostText = () => {
  const cost = impliedCostCents();
  return cost === null
    ? "No cost share set, so new jobs of this type start without a projected cost."
    : (() => {
        const margin = totalCents() - cost;
        const outcome = margin < 0 ? `a loss of ${rands(-margin / 100)}` : `a profit of ${rands(margin / 100)}`;
        return `On the template total that is a projected cost of ${rands(cost / 100)} and ${outcome}.`;
      })();
};

function toPayload() {
  const share = costPctNumber();
  return {
    costPct: share === null ? null : Math.round(share * 100) / 10000,
    phases: draft.phases.map((phase) => ({
      name: phase.name,
      fee: String(phase.fee).trim() === "" ? null : phase.fee,
      tasks: phase.tasks.map((task) => ({
        description: task.description,
        fee: String(task.fee).trim() === "" ? null : task.fee,
      })),
    })),
  };
}

async function load(code) {
  draft.code = code;
  draft.loading = true;
  draft.error = "";
  draft.dirty = false;
  draft.phases = null;
  draft.costPct = "";
  try {
    const { template } = await api.feeTemplate(code);
    draft.phases = fromTemplate(template);
    draft.costPct = costPctFromTemplate(template);
  } catch (error) {
    draft.error = error.message;
  }
  draft.loading = false;
}

function html(ctx) {
  const types = ctx.projectTypes;
  const options = types.map((type) => (
    `<option value="${esc(type.code)}"${type.code === draft.code ? " selected" : ""}>${esc(type.name)}${type.isPlaceholder ? " (no template yet)" : ""}</option>`
  )).join("");

  let body;
  if (draft.loading) {
    body = `<p class="note-line">Loading&hellip;</p>`;
  } else if (!draft.phases) {
    body = `<p class="note-line">${esc(draft.error || "Pick a project type.")}</p>`;
  } else if (!draft.phases.length) {
    body = `<div class="empty">This type has no template, so a new job of this type starts with a
      blank fee schedule that you fill in by hand. Add a phase to give it one.</div>`;
  } else {
    body = draft.phases.map((phase, p) => {
      const rows = phase.tasks.map((task, t) => {
        const num = `${p + 1}.${t + 1}`;
        return `
        <div class="tpl-task" data-p="${p}" data-t="${t}">
          <span class="tpl-task-main">
            <span class="tpl-num">${num}</span>
            <input type="text" data-f="task-description" value="${esc(task.description)}" aria-label="Task ${num}" placeholder="Task" />
          </span>
          <input type="text" inputmode="decimal" class="tpl-fee" data-f="task-fee" value="${esc(feeDisplay(task.fee))}" aria-label="Task fee" placeholder="no fee" />
          ${rowTools({ kind: "task", index: t, count: phase.tasks.length, name: task.description })}
        </div>`;
      }).join("");
      const hint = phaseHint(phase);
      const phaseWho = phase.name.trim() || "this phase";
      return `
      <section class="tpl-phase" data-p="${p}">
        <div class="tpl-phase-head" data-p="${p}">
          <input type="text" data-f="phase-name" value="${esc(phase.name)}" aria-label="Phase name" placeholder="Phase name" />
          <input type="text" inputmode="decimal" class="tpl-fee" data-f="phase-fee" value="${esc(feeDisplay(phase.fee))}" aria-label="Phase fee" aria-describedby="phase-hint-${p}" placeholder="sum of tasks" />
          <span class="tpl-phase-aside" data-aside-for="${p}" title="Sum of the tasks in this phase">${phaseHasOwnFee(phase) ? "" : rands(taskCents(phase) / 100)}</span>
          ${rowTools({
            kind: "phase",
            index: p,
            count: draft.phases.length,
            name: phase.name,
            removeLabel: phase.tasks.length ? `Remove ${phaseWho} and its tasks` : `Remove ${phaseWho}`,
          })}
          <p class="tpl-phase-hint${hint.over ? " over" : hint.text ? " ok" : ""}" id="phase-hint-${p}" data-hint-for="${p}"${hint.text ? "" : " hidden"}>${esc(hint.text)}</p>
        </div>
        ${rows}
        <div class="tpl-add"><button type="button" class="btn btn-sm" data-act="task-add" data-p="${p}">+ Task</button></div>
      </section>`;
    }).join("");
  }

  const ready = Boolean(draft.phases) && !draft.loading;
  return `
    <div class="tpl">
      <h1>Fee templates</h1>
      <p class="note-line">What a new job of each type is quoted from. A job copies its template
        when it is registered, so changing a template never changes a job that already exists.
        Leave a phase's fee blank and it is worth the sum of its tasks; type one and it is worth
        that, whatever the tasks add up to.</p>
      <div class="tpl-bar">
        <label for="tpl-type">Project type</label>
        <select id="tpl-type">${options}</select>
        <span class="tpl-total">Template total <b id="tpl-total">${rands(totalCents() / 100)}</b></span>
      </div>
      ${ready ? `
      <div class="tpl-bar">
        <label for="tpl-cost-mode">Enter the</label>
        <select id="tpl-cost-mode">
          <option value="cost"${draft.costMode === "cost" ? " selected" : ""}>Usual cost, % of the fee</option>
          <option value="margin"${draft.costMode === "margin" ? " selected" : ""}>Profit margin, % of the fee</option>
        </select>
        <input type="text" inputmode="decimal" id="tpl-cost-pct" class="tpl-fee" value="${esc(typedFromCost())}" aria-label="${draft.costMode === "margin" ? "Profit margin, percent of the fee" : "Usual cost, percent of the fee"}" placeholder="not set" />
        <span class="note-line" id="tpl-cost-note" style="margin:0">${esc(impliedCostText())}</span>
      </div>
      <p class="note-line">What the firm usually spends to deliver a job of this type, staff and
        everything else. A new job copies it as its projected cost, and you can change it on the
        job. Leave it blank if you would rather cost each job yourself.</p>` : ""}
      ${draft.error && draft.phases ? `<p class="note-line tpl-error">${esc(draft.error)}</p>` : ""}
      ${body}
      ${ready ? `
      <div class="tpl-add"><button type="button" class="btn btn-sm" data-act="phase-add">+ Phase</button></div>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-act="save"${draft.dirty && !draft.saving ? "" : " disabled"}>${draft.saving ? "Saving&hellip;" : "Save template"}</button>
        <button type="button" class="btn" data-act="discard"${draft.dirty ? "" : " disabled"}>Discard changes</button>
        <button type="button" class="btn" data-act="reset">Restore the workbook's version</button>
      </div>` : ""}
    </div>`;
}

/**
 * Move and remove stay apart. Up and down are a harmless reorder; Remove
 * deletes the line, and for a phase it deletes every task under it. The same
 * button style for both is how a mis-click happens. Arrows at the ends are
 * disabled so the control that cannot move does not look like it can.
 */
function rowTools({ kind, index, count, name, removeLabel }) {
  const who = name.trim() || (kind === "phase" ? "this phase" : "this task");
  const upOff = index === 0 ? " disabled" : "";
  const downOff = index === count - 1 ? " disabled" : "";
  const remove = removeLabel || `Remove ${who}`;
  return `
    <span class="tpl-tools">
      <span class="tpl-moves">
        <button type="button" class="btn btn-sm" data-act="${kind}-up"${upOff} aria-label="${esc(`Move ${who} up`)}" title="Move up">&uarr;</button>
        <button type="button" class="btn btn-sm" data-act="${kind}-down"${downOff} aria-label="${esc(`Move ${who} down`)}" title="Move down">&darr;</button>
      </span>
      <button type="button" class="btn btn-sm tpl-remove" data-act="${kind}-remove" aria-label="${esc(remove)}">Remove</button>
    </span>`;
}

function move(list, index, by) {
  const to = index + by;
  if (to < 0 || to >= list.length) return false;
  [list[index], list[to]] = [list[to], list[index]];
  return true;
}

/** After a move the row is repainted, so focus has to be put back on it. */
function focusMoved(host, act, phaseIndex, itemIndex) {
  const root = act.startsWith("phase-")
    ? host.querySelector(`.tpl-phase-head[data-p="${itemIndex}"]`)
    : host.querySelector(`.tpl-task[data-p="${phaseIndex}"][data-t="${itemIndex}"]`);
  if (!root) return;
  const same = root.querySelector(`[data-act="${act}"]`);
  const otherAct = act.endsWith("-up") ? act.replace(/-up$/, "-down") : act.replace(/-down$/, "-up");
  const other = root.querySelector(`[data-act="${otherAct}"]`);
  (same && !same.disabled ? same : other)?.focus();
}

/** Update only the figures, so typing in a fee does not lose focus. */
function refreshTotals(host) {
  host.querySelector("#tpl-total").textContent = rands(totalCents() / 100);
  const costNote = host.querySelector("#tpl-cost-note");
  if (costNote) costNote.textContent = impliedCostText();
  draft.phases.forEach((phase, p) => {
    const aside = host.querySelector(`[data-aside-for="${p}"]`);
    if (aside) aside.textContent = phaseHasOwnFee(phase) ? "" : rands(taskCents(phase) / 100);
    const hint = host.querySelector(`[data-hint-for="${p}"]`);
    if (!hint) return;
    const state = phaseHint(phase);
    hint.textContent = state.text;
    hint.hidden = state.text === "";
    hint.classList.toggle("over", state.over);
    hint.classList.toggle("ok", state.text !== "" && !state.over);
  });
  for (const button of host.querySelectorAll('[data-act="save"], [data-act="discard"]')) {
    button.disabled = !draft.dirty || (button.dataset.act === "save" && draft.saving);
  }
}

/**
 * Paint into `host`. `ctx` = { projectTypes, toast }. Handlers are attached
 * to the host once per mount; the host's innerHTML is replaced, never the host.
 */
export async function mountTemplateEditor(host, ctx) {
  if (!host.dataset.tplBound) {
    host.dataset.tplBound = "1";
    bind(host, ctx);
  }
  if (!draft.code || !ctx.projectTypes.some((type) => type.code === draft.code)) {
    const first = ctx.projectTypes.find((type) => !type.isPlaceholder) ?? ctx.projectTypes[0];
    if (!first) {
      host.innerHTML = `<div class="tpl"><h1>Fee templates</h1><p class="note-line">No project types.</p></div>`;
      return;
    }
    host.innerHTML = html({ ...ctx });
    await load(first.code);
  } else if (draft.phases === null && !draft.loading) {
    await load(draft.code);
  }
  host.innerHTML = html(ctx);
}

/** The fee string this input is editing, or undefined when it is not a fee field. */
function feeOf(input) {
  const field = input.dataset?.f;
  const phase = draft.phases?.[Number(input.closest("[data-p]")?.dataset.p)];
  if (!phase) return undefined;
  if (field === "phase-fee") return phase.fee;
  if (field === "task-fee") return phase.tasks[Number(input.closest("[data-t]")?.dataset.t)]?.fee;
  return undefined;
}

/** Keep the field numeric and return what should be stored while typing. */
function writeFee(input) {
  const typed = feeTyping(input.value);
  if (input.value !== typed) {
    const fromEnd = input.value.length - (input.selectionStart ?? input.value.length);
    input.value = typed;
    const pos = Math.max(0, typed.length - fromEnd);
    input.setSelectionRange(pos, pos);
  }
  return typed;
}

function bind(host, ctx) {
  const repaint = () => { host.innerHTML = html(ctx); };

  host.addEventListener("input", (event) => {
    if (event.target.id === "tpl-cost-pct" && draft.phases) {
      let typed = pctTyping(event.target.value);
      if (draft.costMode === "margin" && Number(typed) > 100) typed = "100";
      if (event.target.value !== typed) event.target.value = typed;
      draft.costPct = costFromTyped(typed);
      draft.dirty = true;
      refreshTotals(host);
      return;
    }
    const field = event.target.dataset?.f;
    if (!field || !draft.phases) return;
    const p = Number(event.target.closest("[data-p]")?.dataset.p);
    const t = Number(event.target.closest("[data-t]")?.dataset.t);
    const phase = draft.phases[p];
    if (!phase) return;
    if (field === "phase-name") phase.name = event.target.value;
    else if (field === "phase-fee") phase.fee = writeFee(event.target);
    else if (field === "task-description") phase.tasks[t].description = event.target.value;
    else if (field === "task-fee") phase.tasks[t].fee = writeFee(event.target);
    draft.dirty = true;
    refreshTotals(host);
  });

  // `focusin` / `focusout` bubble; `focus` / `blur` do not, and this editor
  // listens on the host rather than on each field.
  host.addEventListener("focusin", (event) => {
    const field = event.target.dataset?.f;
    if (field !== "phase-fee" && field !== "task-fee") return;
    const current = feeOf(event.target);
    if (current === undefined) return;
    event.target.value = current;
    event.target.select();
  });

  host.addEventListener("focusout", (event) => {
    const field = event.target.dataset?.f;
    if ((field !== "phase-fee" && field !== "task-fee") || !draft.phases) return;
    const phase = draft.phases[Number(event.target.closest("[data-p]")?.dataset.p)];
    if (!phase) return;
    const committed = feeCommit(event.target.value);
    if (field === "phase-fee") phase.fee = committed;
    else {
      const task = phase.tasks[Number(event.target.closest("[data-t]")?.dataset.t)];
      if (!task) return;
      task.fee = committed;
    }
    event.target.value = feeDisplay(committed);
    refreshTotals(host);
  });

  host.addEventListener("change", async (event) => {
    if (event.target.id === "tpl-cost-mode") {
      draft.costMode = event.target.value === "margin" ? "margin" : "cost";
      repaint();
      host.querySelector("#tpl-cost-pct")?.focus();
      return;
    }
    if (event.target.id !== "tpl-type") return;
    const next = event.target.value;
    if (draft.dirty && !window.confirm("Discard your unsaved changes to this template?")) {
      event.target.value = draft.code;
      return;
    }
    draft.code = next;
    draft.phases = null;
    draft.loading = true;
    repaint();
    await load(next);
    repaint();
  });

  host.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || button.disabled || !draft.phases) return;
    const act = button.dataset.act;
    const p = Number(button.closest("[data-p]")?.dataset.p ?? button.dataset.p);
    const t = Number(button.closest("[data-t]")?.dataset.t);
    const phase = draft.phases[p];

    if (act === "phase-add") draft.phases.push({ name: "", fee: "", tasks: [] });
    else if (act === "phase-remove") {
      const taskCount = phase.tasks.length;
      const taskWord = taskCount === 1 ? "task" : "tasks";
      if (taskCount && !window.confirm(`Remove "${phase.name || "this phase"}" and its ${taskCount} ${taskWord}?`)) return;
      draft.phases.splice(p, 1);
    } else if (act === "phase-up") move(draft.phases, p, -1);
    else if (act === "phase-down") move(draft.phases, p, 1);
    else if (act === "task-add") phase.tasks.push({ description: "", fee: "" });
    else if (act === "task-remove") phase.tasks.splice(t, 1);
    else if (act === "task-up") move(phase.tasks, t, -1);
    else if (act === "task-down") move(phase.tasks, t, 1);
    else if (act === "discard") {
      await load(draft.code);
      repaint();
      return;
    } else if (act === "save") {
      draft.saving = true;
      draft.error = "";
      repaint();
      try {
        const { template } = await api.putFeeTemplate(draft.code, toPayload());
        draft.phases = fromTemplate(template);
        draft.costPct = costPctFromTemplate(template);
        draft.dirty = false;
        ctx.toast("Template saved. New jobs of this type will use it.");
      } catch (error) {
        draft.error = error.message;
      }
      draft.saving = false;
      repaint();
      return;
    } else if (act === "reset") {
      if (!window.confirm("Replace this template with the version from the original workbook? Your edits to it will be lost.")) return;
      try {
        const { template } = await api.resetFeeTemplate(draft.code);
        draft.phases = fromTemplate(template);
        draft.costPct = costPctFromTemplate(template);
        draft.dirty = false;
        ctx.toast("Template restored.");
      } catch (error) {
        draft.error = error.message;
      }
      repaint();
      return;
    }
    if (["phase-add", "phase-remove", "phase-up", "phase-down", "task-add", "task-remove", "task-up", "task-down"].includes(act)) {
      draft.dirty = true;
      repaint();
      if (act === "task-add") host.querySelector(`.tpl-phase[data-p="${p}"] .tpl-task:last-of-type [data-f="task-description"]`)?.focus();
      if (act === "phase-add") host.querySelector(".tpl-phase:last-of-type [data-f=\"phase-name\"]")?.focus();
      if (act === "phase-up" || act === "phase-down" || act === "task-up" || act === "task-down") {
        const from = act.startsWith("phase") ? p : t;
        const itemIndex = from + (act.endsWith("-up") ? -1 : 1);
        focusMoved(host, act, act.startsWith("phase") ? itemIndex : p, itemIndex);
      }
    }
  });
}

/** Leaving the page with edits pending is the one thing worth interrupting. */
export const templateEditorDirty = () => draft.dirty;
