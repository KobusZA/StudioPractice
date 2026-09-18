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

function sortByCategoryModel(a, b) {
  return (a.category || "").localeCompare(b.category || "")
    || (a.model || "").localeCompare(b.model || "");
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
    const key = row.model || row.category || "unmodelled";
    if (!groups.has(key)) {
      groups.set(key, {
        model: row.model || "",
        category: row.category || "",
        family: row.family || "",
        type: row.type || "",
        unit: row.unit || "ea",
        rateRef: row.rateRef ?? null,
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
    if (row.elementId) {
      group.elements.push({
        id: row.elementId,
        kind: row.kind ?? null,
        level: row.level ?? null,
        status: row.status ?? null,
        length: row.length || 0,
        area: row.area || 0,
        volume: row.volume || 0,
        count: row.count || 0,
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
      description: `${group.family} ${group.type}`.trim(),
      qty: qtyForUnit(group, group.unit),
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
        unit,
        qty,
        description: rate?.description || `${group.family} ${group.type}`.trim(),
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
