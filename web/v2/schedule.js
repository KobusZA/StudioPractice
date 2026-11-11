// BOQ (bill of quantities) and BOM (bill of materials) rollups over compile()'s
// instance rows.
//
// Both read the same payload - compile.js's contract with the QS workbook -
// and never re-derive a quantity of their own. The only difference between
// the two outputs:
//   BOQ - one line per SKU, quantity in its priced unit, joined against a rate
//         book (rate, amount), so a QS can price the job.
//   BOM - the same rollup with no money attached, for whoever is counting or
//         ordering materials rather than pricing them.
//
// Rates are referenced, not embedded (SCHEMA.md #4), so a rate book is always
// a second, separate argument - never baked into the pack or the compiled
// row. A SKU with no rate on file prices at `null`, not `0`: a blank gets
// queried, a wrong number gets built (PHILOSOPHY.md).

import { compareMarks, formatMarks, sizedTypeName } from "./marks.js";

/** The measure a schedule unit reads off a rolled-up row, mirroring v1's
 *  extras.js convention so a QS sees the same numbers in both apps. */
export function qtyForUnit(row, unit) {
  if (unit === "m3") return row.volume || 0;
  if (unit === "m2") return row.area || 0;
  if (unit === "m") return row.length || 0;
  return row.count || 0;
}

/**
 * Look up a rate for a rolled-up row: by SKU id first (`rateRef`, falling
 * back to `model` for a row that never had one), then by category as a last
 * resort for a rate book that only states fallbacks (Doors, Windows, ...).
 */
export function findRate(rateBook, row) {
  const rates = rateBook?.rates || [];
  const model = (row.rateRef || row.model || "").trim();
  if (model) {
    const hit = rates.find((rate) => rate.model === model);
    if (hit) return hit;
  }
  const category = (row.category || "").trim();
  return rates.find((rate) => !rate.model && rate.category === category) || null;
}

/** Whole boxes to order, only where a product states its box coverage. */
function boxFields(group) {
  return Number.isFinite(group.boxesExact) ? { boxes: Math.ceil(group.boxesExact - 1e-9) } : {};
}

function openingFamily(row) {
  return row?.marks?.length && row.family ? row.family : "";
}

function sortByCategoryModel(a, b) {
  const byCategory = (a.category || "").localeCompare(b.category || "");
  if (byCategory) return byCategory;
  const byFamily = openingFamily(a).localeCompare(openingFamily(b));
  if (byFamily) return byFamily;
  if (a.marks?.length && b.marks?.length) return compareMarks(a.marks[0], b.marks[0]);
  return (a.model || "").localeCompare(b.model || "");
}

/**
 * The model column. A window or door line is its mark (W1, or D1–D3), because
 * the catalogue code carries a size the opening may no longer have. `model`
 * stays that catalogue code, which is what the rate book is keyed on.
 */
export function scheduleCode(row) {
  return row?.code || row?.model || "";
}

/** A family subheading where two or more window or door lines share a family. */
export function familyHeadingAt(rows, index) {
  const row = rows?.[index];
  const family = openingFamily(row);
  if (!family) return null;
  const count = rows.filter((other) => other.category === row.category && openingFamily(other) === family).length;
  if (count < 2) return null;
  const prev = rows[index - 1];
  if (prev && prev.category === row.category && openingFamily(prev) === family) return null;
  return family;
}

/**
 * Which line a row rolls up into. A window is one line per type mark (W1, W2),
 * whatever its catalogue product. A door, numbered on its own, rolls up with
 * the doors of the same product and actual size. The type name carries that
 * size, so a resized door is never counted under its catalogue size.
 */
export function scheduleLineKey(row) {
  const base = row.model || row.category || "unmodelled";
  if (row.kind !== "opening") return base;
  if (row.markKind === "window" && row.mark) return `${base}|${row.mark}`;
  return `${base}|${row.type || ""}`;
}

/** "Window-Fixed — 600 x 900mm" under family "Window-Fixed" reads once, not twice. */
function familyAndType(group) {
  const family = String(group.family || "").trim();
  const type = String(group.type || "").trim();
  if (family && type.toLowerCase().startsWith(family.toLowerCase())) return type;
  return `${family} ${type}`.trim();
}

/**
 * A line's description. The mark is the model column, not repeated here. An
 * opening states the size it is drawn at, also when the text comes from a rate
 * book written against the catalogue size. A size off the catalogue names the
 * product it was priced from.
 */
function describe(group, text) {
  const sized = group.openingSize ? sizedTypeName({ name: text }, group.openingSize) : text;
  if (!group.nonStandardSize) return sized;
  const basis = group.model ? `; based on ${group.model}` : "";
  return `${sized} (non-standard size, firm to confirm${basis})`.trim();
}

function codeField(group) {
  return group.marks?.length ? { code: formatMarks(group.marks) } : {};
}

/**
 * Group compile()'s per-element instance rows into one line per SKU.
 *
 * `elements` keeps one entry per drawn element behind the line - id, the
 * selection kind (see compile.js's `row.kind` note), its level and status -
 * so a schedule can list what actually makes up "3.9 m3 of 110mm wall"
 * rather than only the rolled-up number, and can select/locate any one of
 * them on the plan. An element with `kind: null` (a room-derived wall, a
 * recipe-implied quantity) has nothing to click through to; it is still
 * listed, just not clickable.
 */
function groupByModel(instances) {
  const groups = new Map();
  for (const row of instances || []) {
    const key = scheduleLineKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        model: row.model || "",
        category: row.category || "",
        family: row.family || "",
        type: row.type || "",
        unit: row.unit || "ea",
        rateRef: row.rateRef ?? null,
        // A line compile.js derived (a bend counted from the route, with no
        // fitting type in the template) rather than one the drawing placed.
        derived: Boolean(row.derived),
        marks: [],
        count: 0,
        length: 0,
        area: 0,
        volume: 0,
        elements: [],
      });
    }
    const group = groups.get(key);
    group.count += row.count || 0;
    group.length += row.length || 0;
    group.area += row.area || 0;
    group.volume += row.volume || 0;
    // Material wastage on a measured length (compile.js: only where the SKU
    // states a wasteFactor). Kept beside `length`, never inside it.
    if (Number.isFinite(row.orderLength)) group.orderLength = (group.orderLength || 0) + row.orderLength;
    // Finishes (finish-model.js): an allowance is flagged, and the product's
    // waste is carried beside the measured quantity, never inside it.
    if (row.pcAllowance) group.pcAllowance = true;
    if (row.mark && !group.marks.includes(row.mark)) group.marks.push(row.mark);
    if (row.nonStandardSize) group.nonStandardSize = true;
    if (row.openingSize && !group.openingSize) group.openingSize = row.openingSize;
    if (Number.isFinite(row.orderQuantity)) group.orderQuantity = (group.orderQuantity || 0) + row.orderQuantity;
    if (Number.isFinite(row.boxes)) group.boxesExact = (group.boxesExact || 0) + row.boxes;
    if (row.elementId) {
      group.elements.push({
        id: row.elementId,
        ...(row.mark ? { mark: row.mark } : {}),
        kind: row.kind ?? null,
        ...(row.pickKind ? { pickKind: row.pickKind } : {}),
        ...(row.wallId ? { wallId: row.wallId } : {}),
        ...(row.side === 1 || row.side === -1 ? { side: row.side } : {}),
        ...(row.roomId ? { roomId: row.roomId } : {}),
        level: row.level ?? null,
        status: row.status ?? null,
        length: row.length || 0,
        area: row.area || 0,
        volume: row.volume || 0,
        count: row.count || 0,
        // Only where the row states them: a bend's deflection, a run's grade.
        ...(Number.isFinite(row.angle) ? { angle: row.angle } : {}),
        ...(row.gradient ? { gradient: row.gradient } : {}),
      });
    }
  }
  return [...groups.values()];
}

/**
 * BOM: the takeoff, unpriced. One row per SKU, quantity read off whichever
 * measure its own unit states.
 */
export function bomRows(compiled) {
  return groupByModel(compiled?.instances)
    .map((group) => ({
      ...group,
      ...boxFields(group),
      ...codeField(group),
      description: describe(group, familyAndType(group)),
      qty: qtyForUnit(group, group.unit),
      // What to order once the SKU's wastage is added to the measured qty.
      // Present only when a SKU states a wasteFactor; qty stays measured.
      ...(group.orderLength !== undefined && group.unit === "m" ? { orderQty: group.orderLength } : {}),
    }))
    .sort(sortByCategoryModel);
}

/**
 * BOQ: the same rollup, joined against a rate book. `rate` and `amount` stay
 * `null` (never `0`) when nothing on file prices this SKU, and `priced`
 * records which is which so a renderer can print "-" honestly instead of a
 * zero that would look like a free item.
 */
export function boqRows(compiled, rateBook) {
  return groupByModel(compiled?.instances)
    .map((group) => {
      const rate = findRate(rateBook, group);
      const unit = rate?.unit || group.unit;
      const qty = qtyForUnit(group, unit);
      return {
        ...group,
        ...boxFields(group),
        ...codeField(group),
        unit,
        qty,
        description: describe(group, rate?.description || familyAndType(group)),
        rate: rate ? rate.rate : null,
        amount: rate ? qty * rate.rate : null,
        priced: Boolean(rate),
      };
    })
    .sort(sortByCategoryModel);
}

/** Total of every priced line; unpriced lines contribute nothing (not 0 masquerading as a real subtotal - they are simply absent from the sum). */
export function scheduleTotal(rows) {
  return rows.reduce((sum, row) => sum + (row.amount || 0), 0);
}
