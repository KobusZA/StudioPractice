// The rate book: what a BOQ prices a drawing against.
//
// Owner-only. The nav button is hidden for anyone else (hide, don't disable)
// and the server refuses the write regardless - see replaceRateBook in
// server/src/store.js.
//
// A job records the book it was registered against, so nothing edited here
// re-prices a job that has already been quoted. The page says so, the same way
// the quote-template page says it about a running job.
//
// The draft lives in module state rather than in the DOM so that a re-render
// from elsewhere in the app does not eat half-typed work; it is only replaced
// by a load, a save or a discard.

import { api } from "./api.js";

/** Exactly what qtyForUnit() in web/v2/schedule.js measures. */
const UNITS = [
  ["ea", "each"],
  ["m", "per metre"],
  ["m2", "per m²"],
  ["m3", "per m³"],
];

const draft = {
  books: [],
  id: null,
  name: "",
  effectiveFrom: "",
  isDefault: false,
  note: "",
  symbol: "R",
  lines: null, // [{ model, category, description, unit, rate: string }]
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
  return `${draft.symbol}\u2009${whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009")}.${cents}`;
}

/**
 * While a rate is being typed it is digits and one decimal point only. A comma
 * is the decimal point. Two fractional digits is all a rand amount has.
 */
function rateTyping(text) {
  const cleaned = String(text).replace(/,/g, ".").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  const whole = cleaned.slice(0, dot);
  const frac = cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  return `${whole}.${frac}`;
}

/** Blank, or a non-negative number the server will accept. */
function rateCommit(text) {
  const typed = rateTyping(text);
  if (typed === "" || typed === ".") return "";
  const parsed = Number(typed);
  if (!Number.isFinite(parsed)) return "";
  return String(Math.round(parsed * 100) / 100);
}

/** Settled rates read as rand. An empty one stays empty so its placeholder shows. */
function rateDisplay(text) {
  if (String(text).trim() === "") return "";
  const parsed = Number(text);
  return Number.isFinite(parsed) ? rands(parsed) : "";
}

/** Keep the field numeric and return what should be stored while typing. */
function writeRate(input) {
  const typed = rateTyping(input.value);
  if (input.value !== typed) {
    const fromEnd = input.value.length - (input.selectionStart ?? input.value.length);
    input.value = typed;
    const pos = Math.max(0, typed.length - fromEnd);
    input.setSelectionRange(pos, pos);
  }
  return typed;
}

const current = () => draft.books.find((book) => book.id === draft.id) || null;

/**
 * A category groups this list and, on a line with no SKU of its own, is the
 * fallback price for everything in it. Named groups first, in the order a
 * price list reads; lines nobody has filed yet last, under their own heading.
 */
function grouped() {
  const groups = new Map();
  draft.lines.forEach((line, index) => {
    const key = String(line.category || "").trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ line, index });
  });
  return [...groups.entries()].sort(([a], [b]) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });
}

async function loadBooks() {
  draft.loading = true;
  draft.error = "";
  try {
    draft.books = (await api.listRateBooks()).rateBooks;
    if (!draft.books.some((book) => book.id === draft.id)) {
      draft.id = (draft.books.find((book) => book.isDefault) || draft.books[0])?.id ?? null;
    }
  } catch (error) {
    draft.error = error.message;
  }
  draft.loading = false;
}

async function load(id) {
  draft.id = id;
  draft.loading = true;
  draft.error = "";
  draft.dirty = false;
  draft.lines = null;
  try {
    const { rateBook } = await api.rateBook(id);
    draft.name = rateBook.name;
    draft.effectiveFrom = String(rateBook.effectiveFrom || "").slice(0, 10);
    draft.isDefault = rateBook.isDefault;
    draft.note = asText(rateBook.note);
    draft.symbol = rateBook.symbol || "R";
    draft.lines = rateBook.rates.map((rate) => ({
      model: asText(rate.model),
      category: asText(rate.category),
      description: asText(rate.description),
      unit: rate.unit,
      rate: asText(rate.rate),
    }));
  } catch (error) {
    draft.error = error.message;
  }
  draft.loading = false;
}

function toPayload() {
  return {
    name: draft.name,
    effectiveFrom: draft.effectiveFrom,
    note: draft.note,
    symbol: draft.symbol,
    rates: draft.lines.map((line) => ({
      model: line.model,
      category: line.category,
      description: line.description,
      unit: line.unit,
      rate: line.rate,
    })),
  };
}

function lineHtml({ line, index }) {
  const fallback = String(line.model).trim() === "";
  const who = line.model.trim() || line.category.trim() || "this line";
  return `
    <div class="tpl-task" data-i="${index}">
      <span class="tpl-task-main">
        <span class="tpl-num"${fallback ? ' title="Used when the SKU itself has no price in this book"' : ""}>${fallback ? "fallback" : index + 1}</span>
        <input type="text" data-f="model" value="${esc(line.model)}" aria-label="SKU code" placeholder="SKU code (blank = category fallback)" />
        <input type="text" data-f="description" value="${esc(line.description)}" aria-label="Description" placeholder="Description" />
        <input type="text" data-f="category" value="${esc(line.category)}" aria-label="Category" placeholder="Category" />
      </span>
      <select data-f="unit" aria-label="Priced per">
        ${UNITS.map(([unit, label]) => `<option value="${unit}"${line.unit === unit ? " selected" : ""}>${label}</option>`).join("")}
      </select>
      <input type="text" inputmode="decimal" class="tpl-fee" data-f="rate" value="${esc(rateDisplay(line.rate))}" aria-label="Rate" placeholder="no rate" />
      <span class="tpl-tools">
        <button type="button" class="btn btn-sm tpl-remove" data-act="remove" aria-label="${esc(`Remove ${who}`)}">Remove</button>
      </span>
    </div>`;
}

function html() {
  const options = draft.books.map((book) => (
    `<option value="${esc(book.id)}"${book.id === draft.id ? " selected" : ""}>${esc(book.name)}${book.isDefault ? " (default)" : ""}</option>`
  )).join("");

  let body;
  if (draft.loading) {
    body = `<p class="note-line">Loading&hellip;</p>`;
  } else if (!draft.lines) {
    body = `<p class="note-line">${esc(draft.error || "Pick a rate book.")}</p>`;
  } else if (!draft.lines.length) {
    body = `<div class="empty">This book prices nothing, so every line of a BOQ run against it
      reads "&mdash;". Add a rate to give it something to price.</div>`;
  } else {
    body = grouped().map(([category, rows]) => `
      <section class="tpl-phase">
        <div class="tpl-phase-head">
          <h3 class="sec">${esc(category || "Not filed under a category")}</h3>
          <p class="tpl-phase-hint ok">${category
    ? `A line here with no SKU code is the ${esc(category)} fallback: what a ${esc(category).toLowerCase()} costs when its own SKU has no rate in this book.`
    : "A category groups this list, and gives the things in it a fallback price. These lines price their own SKU and nothing else."}</p>
        </div>
        ${rows.map(lineHtml).join("")}
        <div class="tpl-add"><button type="button" class="btn btn-sm" data-act="add" data-category="${esc(category)}">+ Rate${category ? ` in ${esc(category)}` : ""}</button></div>
      </section>`).join("");
  }

  const book = current();
  const ready = Boolean(draft.lines) && !draft.loading;
  return `
    <div class="tpl">
      <h1>Rate book</h1>
      <p class="note-line">What a BOQ prices a drawing against. The drawing app measures the
        quantities; this says what each one costs. A job prices against the book it was registered
        with, so editing a book here does not re-price a job that has already been quoted.</p>
      <p class="note-line">A SKU with no line prices at "&mdash;" on the BOQ, and is left out of
        the total. That is deliberate: a blank gets queried, a wrong number gets built.</p>
      <div class="tpl-bar">
        <label for="rate-book">Rate book</label>
        <select id="rate-book">${options}</select>
        <span class="tpl-total">${draft.lines ? `${draft.lines.length} ${draft.lines.length === 1 ? "line" : "lines"}` : "&mdash;"}</span>
      </div>
      ${ready ? `
      <div class="tpl-bar">
        <label for="rate-name">Name</label>
        <input type="text" id="rate-name" value="${esc(draft.name)}" placeholder="2026 prices" />
        <label for="rate-from">Effective from</label>
        <input type="date" id="rate-from" value="${esc(draft.effectiveFrom)}" />
        ${draft.isDefault
    ? `<span class="pill" title="New jobs are registered against this book">default</span>`
    : `<button type="button" class="btn btn-sm" data-act="make-default">Make default</button>`}
        <button type="button" class="btn btn-sm" data-act="duplicate">Duplicate book</button>
        ${book && book.projects === 0 && !draft.isDefault
    ? `<button type="button" class="btn btn-sm tpl-remove" data-act="delete">Delete book</button>` : ""}
      </div>
      <div class="tpl-bar">
        <label for="rate-note">Note</label>
        <input type="text" id="rate-note" value="${esc(draft.note)}" placeholder="Where these prices came from" />
      </div>
      <p class="note-line">Next year's prices are this year's book duplicated and edited, not typed
        over: the jobs quoted off the old one still point at it.${book && book.projects
    ? ` ${book.projects} ${book.projects === 1 ? "job prices" : "jobs price"} against this book.` : ""}</p>` : ""}
      ${draft.error && draft.lines ? `<p class="note-line tpl-error">${esc(draft.error)}</p>` : ""}
      ${body}
      ${ready ? `
      <div class="actions">
        <button type="button" class="btn btn-primary" data-act="save"${draft.dirty && !draft.saving ? "" : " disabled"}>${draft.saving ? "Saving&hellip;" : "Save rate book"}</button>
        <button type="button" class="btn" data-act="discard"${draft.dirty ? "" : " disabled"}>Discard changes</button>
      </div>` : ""}
    </div>`;
}

/** Update only the figures, so typing in a rate does not lose focus. */
function refreshTotals(host) {
  const total = host.querySelector(".tpl-total");
  if (total) total.textContent = `${draft.lines.length} ${draft.lines.length === 1 ? "line" : "lines"}`;
  for (const button of host.querySelectorAll('[data-act="save"], [data-act="discard"]')) {
    button.disabled = !draft.dirty || (button.dataset.act === "save" && draft.saving);
  }
}

/**
 * Paint into `host`. `ctx` = { toast }. Handlers are attached to the host once
 * per mount; the host's innerHTML is replaced, never the host.
 */
export async function mountRateBook(host, ctx) {
  if (!host.dataset.ratesBound) {
    host.dataset.ratesBound = "1";
    bind(host, ctx);
  }
  if (!draft.books.length || !draft.id) {
    host.innerHTML = `<div class="tpl"><h1>Rate book</h1><p class="note-line">Loading&hellip;</p></div>`;
    await loadBooks();
    if (!draft.id) {
      host.innerHTML = `<div class="tpl"><h1>Rate book</h1><p class="note-line">${esc(draft.error || "This firm has no rate book.")}</p></div>`;
      return;
    }
  }
  if (draft.lines === null && !draft.loading) await load(draft.id);
  host.innerHTML = html();
}

/** The rate string this input is editing, or undefined when it is not a rate field. */
function rateOf(input) {
  if (input.dataset?.f !== "rate") return undefined;
  return draft.lines?.[Number(input.closest("[data-i]")?.dataset.i)]?.rate;
}

function bind(host, ctx) {
  const repaint = () => { host.innerHTML = html(); };

  host.addEventListener("input", (event) => {
    if (!draft.lines) return;
    if (event.target.id === "rate-name") draft.name = event.target.value;
    else if (event.target.id === "rate-note") draft.note = event.target.value;
    else {
      const field = event.target.dataset?.f;
      if (!field) return;
      const line = draft.lines[Number(event.target.closest("[data-i]")?.dataset.i)];
      if (!line) return;
      // The category is not repainted while it is being typed: moving the row
      // into its new group mid-word would take the field out from under the
      // cursor. The next repaint files it.
      if (field === "rate") line.rate = writeRate(event.target);
      else line[field] = event.target.value;
    }
    draft.dirty = true;
    refreshTotals(host);
  });

  // `focusin` / `focusout` bubble; `focus` / `blur` do not, and this editor
  // listens on the host rather than on each field.
  host.addEventListener("focusin", (event) => {
    const value = rateOf(event.target);
    if (value === undefined) return;
    event.target.value = value;
    event.target.select();
  });

  host.addEventListener("focusout", (event) => {
    if (event.target.dataset?.f !== "rate" || !draft.lines) return;
    const line = draft.lines[Number(event.target.closest("[data-i]")?.dataset.i)];
    if (!line) return;
    line.rate = rateCommit(event.target.value);
    event.target.value = rateDisplay(line.rate);
  });

  host.addEventListener("change", async (event) => {
    if (event.target.id === "rate-from" && draft.lines) {
      draft.effectiveFrom = event.target.value;
      draft.dirty = true;
      refreshTotals(host);
      return;
    }
    if (event.target.dataset?.f === "unit" && draft.lines) {
      const line = draft.lines[Number(event.target.closest("[data-i]")?.dataset.i)];
      if (line) line.unit = event.target.value;
      draft.dirty = true;
      refreshTotals(host);
      return;
    }
    if (event.target.id !== "rate-book") return;
    const next = event.target.value;
    if (draft.dirty && !window.confirm("Discard your unsaved changes to this rate book?")) {
      event.target.value = draft.id;
      return;
    }
    draft.id = next;
    draft.lines = null;
    draft.loading = true;
    repaint();
    await load(next);
    repaint();
  });

  host.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || button.disabled || !draft.lines) return;
    const act = button.dataset.act;
    const index = Number(button.closest("[data-i]")?.dataset.i);

    if (act === "add") {
      draft.lines.push({
        model: "", category: button.dataset.category || "", description: "", unit: "ea", rate: "",
      });
      draft.dirty = true;
      repaint();
      host.querySelector(".tpl-task:last-of-type [data-f=\"model\"]")?.focus();
      return;
    }
    if (act === "remove") {
      draft.lines.splice(index, 1);
      draft.dirty = true;
      repaint();
      return;
    }
    if (act === "discard") {
      await load(draft.id);
      repaint();
      return;
    }
    if (act === "save") {
      draft.saving = true;
      draft.error = "";
      repaint();
      try {
        await api.putRateBook(draft.id, toPayload());
        await loadBooks();
        await load(draft.id);
        ctx.toast("Rate book saved. Jobs already quoted keep the prices they were quoted at.");
      } catch (error) {
        draft.error = error.message;
      }
      draft.saving = false;
      repaint();
      return;
    }
    if (act === "make-default") {
      try {
        await api.setDefaultRateBook(draft.id);
        await loadBooks();
        draft.isDefault = true;
        ctx.toast("New jobs will be registered against this book.");
      } catch (error) {
        draft.error = error.message;
      }
      repaint();
      return;
    }
    if (act === "duplicate") {
      if (draft.dirty && !window.confirm("Your unsaved changes are not copied. Duplicate the saved book?")) return;
      const name = window.prompt("Name for the copy", `${draft.name} (copy)`);
      if (name === null) return;
      try {
        const { rateBook } = await api.duplicateRateBook(draft.id, { name });
        await loadBooks();
        await load(rateBook.id);
        ctx.toast("Copied. Edit the copy, then make it the default when it is ready.");
      } catch (error) {
        draft.error = error.message;
      }
      repaint();
      return;
    }
    if (act === "delete") {
      if (!window.confirm(`Delete "${draft.name}"?`)) return;
      try {
        await api.deleteRateBook(draft.id);
        draft.id = null;
        draft.lines = null;
        await loadBooks();
        if (draft.id) await load(draft.id);
        ctx.toast("Rate book deleted.");
      } catch (error) {
        draft.error = error.message;
      }
      repaint();
    }
  });
}

/** Leaving the page with edits pending is the one thing worth interrupting. */
export const rateBookDirty = () => draft.dirty;
