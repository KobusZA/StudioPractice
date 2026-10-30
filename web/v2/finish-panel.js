// The inspector's finish section: markup only. ui.js owns the events (they
// are delegated on the panel and read `data-fin` attributes) and the undo.
//
// Three blocks, shown as they apply:
//   room       the room's finish rules, presets and floor regions
//   face       what is on the selected wall face, and a form to add a run
//   products   the products on this job and the two job settings

import { finishSwatch } from "./finish-data.js";
import { floorCoverage, FINISH_CATEGORIES, categoriesForSurface, finishProductById, regionsOnSlab } from "./finish-model.js";
import { area as polyArea, clipPolygon } from "./geom.js";
import { finishRegionPolygon, roomPolygon, shapePolygon } from "./model.js";

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const mm = (m) => (Number.isFinite(m) ? String(Math.round(m * 1000)) : "");

// The order the floor panel shows them in. Matches the sentence above the sections.
const FLOOR_FINISH_ORDER = ["screed", "floorTile", "timberFloor", "vinyl", "carpet", "waterproofing"];

/** A product named without its category: the section heading already says which finish it is. */
function productChoiceLabel(p) {
  return [p.name || p.code || "Unnamed product", p.size, p.supplier].filter(Boolean).join(" · ");
}

function regionCategory(doc, region) {
  if (region.category && FINISH_CATEGORIES[region.category]) return region.category;
  return finishProductById(doc, region.productId)?.category || null;
}

/** The picker for what a finish is: a category, or a product on this job. */
export function targetOptions(doc, surface, selected = "") {
  const cats = categoriesForSurface(surface);
  const products = (doc.finishProducts || []).filter((p) => cats.includes(p.category));
  const opt = (value, label) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
  return [
    `<optgroup label="Category (allowance)">${cats.map((c) => opt(`c:${c}`, FINISH_CATEGORIES[c].label)).join("")}</optgroup>`,
    products.length
      ? `<optgroup label="Products on this job">${products.map((p) => opt(`p:${p.id}`, productLabel(p))).join("")}</optgroup>`
      : "",
  ].join("");
}

export function productLabel(p) {
  return [FINISH_CATEGORIES[p.category]?.label, p.name || p.code, p.size].filter(Boolean).join(" · ");
}

/** `c:wallTile` or `p:abc` back to { category, productId }. */
export function parseTarget(value) {
  const [kind, ...rest] = String(value || "").split(":");
  const id = rest.join(":");
  if (kind === "p" && id) return { category: null, productId: id };
  if (kind === "c" && id) return { category: id, productId: null };
  return null;
}

export function ruleTarget(rule) {
  return rule.productId ? `p:${rule.productId}` : `c:${rule.category}`;
}

/** Options for a finish type on a surface; `none` only where a run may say "no finish".
 *  Wall lists split on the category's layer: a coat is what the wall is made of,
 *  and anything else is applied on top of a coat. */
function surfaceTypeOptions(surface, selected, { none = false } = {}) {
  const ids = categoriesForSurface(surface).filter((id) => none || !FINISH_CATEGORIES[id].virtual);
  const opt = (id) => (
    `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(FINISH_CATEGORIES[id].label)}</option>`
  );
  const coat = ids.filter((id) => FINISH_CATEGORIES[id].layer === "coat");
  const applied = ids.filter((id) => FINISH_CATEGORIES[id].layer !== "coat");
  if (!coat.length || !applied.length) return ids.map(opt).join("");
  const group = (label, list) => `<optgroup label="${esc(label)}">${list.map(opt).join("")}</optgroup>`;
  return group("Base coat — what the wall is made of", coat) + group("Applied finish — goes on top of a coat", applied);
}

/** Heights a wall finish usually runs to. `top: null` is the wall top. */
export const HEIGHT_PRESETS = [
  { id: "full", label: "Full height", bottom: 0, top: null },
  { id: "skirting", label: "Skirting (to 100 mm)", bottom: 0, top: 0.1 },
  { id: "dado", label: "Dado (to 1200 mm)", bottom: 0, top: 1.2 },
  { id: "splash", label: "Splashback (900 to 1500 mm)", bottom: 0.9, top: 1.5 },
  { id: "custom", label: "Custom...", bottom: null, top: null },
];

function itemCategory(doc, item) {
  if (item.category && FINISH_CATEGORIES[item.category]) return item.category;
  return finishProductById(doc, item.productId)?.category || null;
}

function ruleRow(doc, room, rule) {
  const wall = rule.surface === "wall";
  const category = itemCategory(doc, rule) || (wall ? "plaster" : "screed");
  const product = finishProductById(doc, rule.productId);
  const listId = `fin-rule-${rule.id}`;
  return `<div class="fin-kind fin-rule" data-fin-rule="${esc(rule.id)}">
    <div class="fin-kind-head">
      <i class="fin-swatch" style="background:${esc(finishSwatch(category))}"></i>
      <select data-fin="rule-type" aria-label="Finish type">${surfaceTypeOptions(rule.surface, category)}</select>
      <button type="button" data-fin="rule-remove" aria-label="Remove this rule">Remove</button>
    </div>
    <p class="fin-where">${wall ? "Every wall of this room, room side" : "Floor of this room"}</p>
    <label class="fin-pick">Product
      ${productNameField(doc, category, { attr: "rule-product-name", value: product ? productChoiceLabel(product) : "", listId, label: "Product for this rule" })}
    </label>
    ${wall ? `<div class="fin-row">
      <label>from <input data-fin="rule-bottom" type="text" inputmode="decimal" value="${mm(rule.bottom)}" aria-label="From height, mm" /></label>
      <label>to <input data-fin="rule-top" type="text" inputmode="decimal" value="${mm(rule.top)}" placeholder="top" aria-label="To height, mm; blank is the wall top" /> mm</label>
      <select data-fin="rule-faces" aria-label="Which walls">
        ${["all", "external", "internal"].map((f) => `<option value="${f}"${rule.faces === f ? " selected" : ""}>${f === "all" ? "all faces" : `${f} walls`}</option>`).join("")}
      </select>
    </div>` : ""}
  </div>`;
}

export function roomFinishHtml(doc, room, editingId = null, opts = {}) {
  const rules = room.finishes || [];
  const presets = (doc.finishPresets || []);
  const regions = (doc.finishRegions || []).filter((r) => r.roomId === room.id);
  return `<section class="fin-sec" data-fin-block="room">
    <h4>Wall finishes · ${esc(room.name)}</h4>
    <div class="fin-kinds">
    ${rules.length ? rules.map((r) => ruleRow(doc, room, r)).join("") : '<p class="fin-note">No rules yet. Walls of a plastered type already get plaster.</p>'}
    </div>
    <div class="fin-add-floor" data-fin-newrule>
      <p class="fin-kicker">Finish every wall of this room</p>
      <label class="fin-pick">Finish
        <select data-fin="new-rule-category" aria-label="Finish to add">${surfaceTypeOptions("wall", "wallTile")}</select>
      </label>
      <label class="fin-pick">Product
        ${productNameField(doc, "wallTile", { attr: "new-rule-product", value: "", listId: "fin-new-rule-product", label: "Product for the new rule" })}
      </label>
      <div class="fin-btns"><button type="button" data-fin="rule-add">Add to walls</button></div>
      <p class="fin-note">Finish one wall only: select that wall.</p>
    </div>
    <div class="fin-row">
      ${presets.length ? `<select data-fin="preset-pick" aria-label="Preset">${presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select>
      <button type="button" data-fin="preset-apply" title="Replace this room's rules with the preset">Apply preset</button>` : ""}
      <input data-fin="preset-name" type="text" placeholder="Preset name" aria-label="Preset name" />
      <button type="button" data-fin="preset-save" ${rules.length ? "" : "disabled"} title="Keep these rules on the job, offered for rooms of this use">Save as preset</button>
    </div>
    ${floorFinishesHtml(doc, regions, editingId, {
      whole: false,
      hostPoly: roomPolygon(room),
      hostLabel: "Room",
      placedTitle: "On this floor",
      bareOn: Boolean(opts.bareOn),
      savedRegionId: opts.savedRegionId || null,
      adding: Boolean(opts.adding),
      drawTitle: "Click the corners of the area, then Enter. It comes out of this room's floor.",
    })}
  </section>`;
}

/** Suggestion list for a product name: products already on the job for this finish. */
export function floorProductSuggestions(doc, category) {
  return (doc.finishProducts || [])
    .filter((p) => p.category === category)
    .map((p) => `<option value="${esc(productChoiceLabel(p))}"></option>`)
    .join("");
}

/** A product name you can type. Existing products of this finish are suggestions, not the only choices. */
function productNameField(doc, category, { attr, value, listId, label, placeholder = "Name" }) {
  return `<input data-fin="${attr}" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" list="${esc(listId)}" aria-label="${esc(label)}" autocomplete="off" />
    <datalist id="${esc(listId)}">${floorProductSuggestions(doc, category)}</datalist>`;
}

function formatM2(m) {
  if (!Number.isFinite(m) || Math.abs(m) < 0.005) return "0 m²";
  const digits = Math.abs(m) >= 10 ? 1 : 2;
  return `${m.toFixed(digits)} m²`;
}

function typeOptions(selected) {
  return FLOOR_FINISH_ORDER.map((id) => (
    `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(FINISH_CATEGORIES[id].label)}</option>`
  )).join("");
}

/** What is already on this floor: area, bare floor, and any overlap. */
function floorSummaryHtml(doc, regions, hostPoly, hostLabel, bareOn) {
  if (!hostPoly || hostPoly.length < 3) return "";
  const polys = regions.map((region) => finishRegionPolygon(doc, region));
  const cover = floorCoverage(hostPoly, polys);
  const byType = new Map();
  regions.forEach((region, i) => {
    const category = regionCategory(doc, region);
    if (!category) return;
    const row = byType.get(category) || { area: 0, count: 0 };
    row.area += cover.clipped[i] || 0;
    row.count += 1;
    byType.set(category, row);
  });
  const rows = FLOOR_FINISH_ORDER.filter((id) => byType.has(id)).map((id) => {
    const row = byType.get(id);
    const areas = row.count === 1 ? "1 area" : `${row.count} areas`;
    return `<li class="fin-sum-row"><i class="fin-swatch" style="background:${esc(finishSwatch(id))}"></i><span class="fin-grow">${esc(FINISH_CATEGORIES[id].label)}</span><span>${formatM2(row.area)}</span><span class="fin-sum-n">${areas}</span></li>`;
  }).join("");
  const bare = cover.bare >= 0.02
    ? `<button type="button" class="fin-bare" data-fin="show-bare" aria-pressed="${bareOn ? "true" : "false"}" title="Show the part of this floor with no finish">${bareOn ? "Hide bare" : "Bare"} ${formatM2(cover.bare)}</button>`
    : `<span>Bare ${formatM2(cover.bare)}</span>`;
  const warn = cover.excess >= 0.02 && cover.overlapCount >= 2
    ? `<p class="fin-warn">${cover.overlapCount} areas overlap; ${formatM2(cover.excess)} is covered more than once.</p>`
    : "";
  return `<div class="fin-summary" data-fin-summary>
    <p class="fin-sum-head"><span>${esc(hostLabel)}</span><span>${formatM2(cover.hostArea)}</span></p>
    <p class="fin-sum-line"><span>Finished ${formatM2(cover.finished)}</span>${bare}</p>
    ${rows ? `<ul class="fin-sum-list">${rows}</ul>` : ""}
    ${warn}
  </div>`;
}

/** One finish that has been placed: its type can change, and it shows its own area. */
function placedFinishHtml(doc, region, editingId, { area, index, total, saved }) {
  const editing = region.id === editingId;
  const category = regionCategory(doc, region);
  const spec = FINISH_CATEGORIES[category];
  const product = finishProductById(doc, region.productId);
  const label = spec?.label || "Finish";
  const where = region.whole
    ? "Covers the whole floor and follows its outline."
    : "Drawn area";
  const which = total > 1 ? `${label} ${index} of ${total} · ` : "";
  const badge = product
    ? ""
    : spec?.needsProduct
      ? `<p class="fin-badge">Needs a product</p>`
      : `<p class="fin-badge fin-badge-soft">No product named</p>`;
  return `<div class="fin-kind${editing ? " fin-editing" : ""}" data-fin-region="${esc(region.id)}">
    <div class="fin-kind-head">
      <i class="fin-swatch" style="background:${esc(finishSwatch(category))}"></i>
      <select data-fin="region-type" aria-label="Finish type">${typeOptions(category)}</select>
      <span class="fin-area">${formatM2(area)}</span>
    </div>
    <p class="fin-where">${esc(which)}${esc(where)}</p>
    ${badge}
    <label class="fin-pick">Product
      <span class="fin-pick-line">
        ${productNameField(doc, category, { attr: "region-product-name", value: product ? productChoiceLabel(product) : "", listId: `fin-prod-${region.id}`, label: `Product for this ${label}` })}
        ${saved ? `<span class="fin-saved">Saved</span>` : ""}
      </span>
    </label>
    <div class="fin-btns">
      <button type="button" data-fin="region-edit" aria-pressed="${editing ? "true" : "false"}" title="Show this region's corners on the plan. Corner adds a point on an edge; Line moves the edge. Hold Shift to use the other one for a single drag. Delete removes a corner.">${editing ? "Done" : "Edit corners"}</button>
      <button type="button" data-fin="region-remove">Remove</button>
    </div>
  </div>`;
}

/** Summary, a form to place one new finish, then a section for each finish already placed. */
function floorFinishesHtml(doc, regions, editingId, opts) {
  const { whole, drawTitle, hostPoly, hostLabel, placedTitle, bareOn, savedRegionId } = opts;
  const first = FLOOR_FINISH_ORDER[0];
  const counts = new Map();
  const seen = new Map();
  for (const region of regions) {
    const category = regionCategory(doc, region) || "";
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  const areas = hostPoly?.length >= 3
    ? floorCoverage(hostPoly, regions.map((region) => finishRegionPolygon(doc, region))).clipped
    : regions.map((region) => polyArea(finishRegionPolygon(doc, region)));
  const cards = regions.map((region, i) => {
    const category = regionCategory(doc, region) || "";
    const n = (seen.get(category) || 0) + 1;
    seen.set(category, n);
    return placedFinishHtml(doc, region, editingId, {
      area: areas[i] || 0,
      index: n,
      total: counts.get(category) || 1,
      saved: region.id === savedRegionId,
    });
  }).join("");
  const placed = regions.length
    ? `<div class="fin-kinds">${cards}</div>`
    : `<p class="fin-note">No finishes on this floor yet.</p>`;
  const hint = whole
    ? "A drawn area stays on this floor and snaps to its edges."
    : "A drawn area comes out of this room's floor.";
  const adding = Boolean(opts.adding);
  return `<div class="fin-surface" data-fin-surface="floor">
    <div class="fin-rest"${adding ? " hidden" : ""}>
      ${floorSummaryHtml(doc, regions, hostPoly, hostLabel, bareOn)}
      <button type="button" class="fin-add-btn" data-fin="add-open">Add a finish</button>
      <div class="fin-drawn">
        <p class="fin-kicker">${esc(placedTitle)} (${regions.length})</p>
        ${placed}
      </div>
    </div>
    <div class="fin-add-floor fin-add-sheet" data-fin-new${adding ? "" : " hidden"}>
      <div class="fin-sheet-head">
        <p class="fin-kicker">Add a finish</p>
        <button type="button" class="fin-bare" data-fin="add-close">Back</button>
      </div>
      <label class="fin-pick">Finish
        <select data-fin="region-category" aria-label="Finish to place">${typeOptions(first)}</select>
      </label>
      <label class="fin-pick">Product
        ${productNameField(doc, first, { attr: "new-product-name", value: "", listId: "fin-new-product", label: "Product for the new finish" })}
      </label>
      <div class="fin-btns">
        <button type="button" data-fin="region-draw" title="${esc(drawTitle)}">Draw area</button>
        ${whole ? `<button type="button" data-fin="region-whole" title="Cover this floor's outline, and keep covering it when the floor changes">Cover whole floor</button>` : ""}
      </div>
      <p class="fin-note">${hint}</p>
    </div>
  </div>`;
}

/** Floor finishes on a selected slab: the plan is the floor, so regions are drawn on it. */
export function slabFinishHtml(doc, slab, editingId = null, opts = {}) {
  const regions = regionsOnSlab(doc, slab);
  return `<section class="fin-sec" data-fin-block="slab">
    <h4>Floor finishes</h4>
    ${floorFinishesHtml(doc, regions, editingId, {
      whole: true,
      hostPoly: shapePolygon(slab.shape),
      hostLabel: "Slab",
      placedTitle: "On this floor",
      bareOn: Boolean(opts.bareOn),
      savedRegionId: opts.savedRegionId || null,
      adding: Boolean(opts.adding),
      drawTitle: "Click corners on this floor. They snap to its edges. Enter closes the shape.",
    })}
  </section>`;
}

function formatQty(quantity, unit) {
  return unit === "m" ? `${quantity.toFixed(2)} m` : formatM2(quantity);
}

/** A band as a polygon on the face, in metres along and up. */
function bandPolygon(band) {
  if (band.outline?.length >= 3) return band.outline;
  if (!(band.to > band.from) || !(band.top > band.bottom)) return null;
  return [[band.from, band.bottom], [band.to, band.bottom], [band.to, band.top], [band.from, band.top]];
}

/**
 * Coverage of this face. Plaster (the computed default) is separate from finishes
 * the user added, so the two are not added together as if they were one layer.
 */
function faceCoverage(model, bands) {
  const host = [[0, 0], [model.length, 0], [model.length, model.height], [0, model.height]];
  const areaBands = (list) => list.filter((b) => b.category !== "none" && b.unit !== "m");
  const added = areaBands(bands.filter((b) => b.source !== "default"));
  const defaults = areaBands(bands.filter((b) => b.source === "default"));
  const poly = (list) => list.map(bandPolygon).filter((p) => p?.length >= 3);
  const addedCover = floorCoverage(host, poly(added));
  const addedQty = added.reduce((sum, b) => sum + b.quantity, 0);
  return {
    face: model.length * model.height,
    finished: addedCover.excess >= 0.02 ? addedCover.finished : addedQty,
    plaster: defaults.reduce((sum, b) => sum + b.quantity, 0),
    plasterCategory: defaults[0]?.category || null,
    hasAdded: added.length > 0,
  };
}

/** What is on this wall face, before the finishes themselves: the face and the plaster underneath.
 *  Leaving it bare asks first. The commit button is only there while that question is open. */
function faceSummaryHtml(model, bands, { confirming = false } = {}) {
  const cover = faceCoverage(model, bands);
  const plasterLabel = cover.plasterCategory ? FINISH_CATEGORIES[cover.plasterCategory]?.label : "Plaster";
  const coat = plasterLabel.toLowerCase();
  const ask = confirming
    ? `<p class="fin-where">Leave this face bare? The ${esc(coat)} the wall type adds comes off this face. Paint and tile stay.</p>
       <div class="fin-btns">
         <button type="button" data-fin="default-remove">Leave bare</button>
         <button type="button" data-fin="default-keep">Keep it</button>
       </div>`
    : "";
  const button = confirming
    ? ""
    : `<button type="button" class="fin-bare" data-fin="default-ask" title="Removes the ${esc(coat)} the wall type adds on this face. Paint and tile stay.">Leave bare</button>`;
  const plaster = cover.plaster >= 0.02
    ? `<ul class="fin-sum-list"><li class="fin-sum-row"><i class="fin-swatch" style="background:${esc(finishSwatch(cover.plasterCategory))}"></i><span class="fin-grow">${esc(plasterLabel)}, from the wall type</span><span>${formatM2(cover.plaster)}</span>${button}</li></ul>${ask}`
    : "";
  const finished = cover.hasAdded
    ? `<p class="fin-sum-line"><span>Finished ${formatM2(cover.finished)}</span></p>`
    : "";
  const bare = !plaster && cover.face - cover.finished >= 0.02
    ? `<p class="fin-sum-line"><span>Bare ${formatM2(Math.max(0, cover.face - cover.finished))}</span></p>`
    : "";
  return `<div class="fin-summary" data-fin-summary>
    <p class="fin-sum-head"><span>This face</span><span>${formatM2(cover.face)}</span></p>
    ${finished}
    ${bare}
    ${plaster}
  </div>`;
}

/** The box a band occupies, in metres along the face and up it. */
function bandBox(band) {
  const poly = bandPolygon(band);
  if (!poly) return null;
  let from = Infinity;
  let to = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const [s, z] of poly) {
    from = Math.min(from, s);
    to = Math.max(to, s);
    bottom = Math.min(bottom, z);
    top = Math.max(top, z);
  }
  if (!(to > from) || !(top > bottom)) return null;
  return { from, to, bottom, top };
}

/** Left to right, then low to high: the order the cards read, matching the elevation. */
function compareBands(a, b) {
  const ba = bandBox(a);
  const bb = bandBox(b);
  if (!ba && !bb) return 0;
  if (!ba) return 1;
  if (!bb) return -1;
  if (Math.abs(ba.from - bb.from) > 0.02) return ba.from - bb.from;
  if (Math.abs(ba.bottom - bb.bottom) > 0.02) return ba.bottom - bb.bottom;
  return 0;
}

function sideWords(box, length) {
  if (box.to <= length / 2 + 0.02) return "Left side";
  if (box.from >= length / 2 - 0.02) return "Right side";
  return "Across the middle";
}

/** The opening this patch belongs to, when one opening explains it better than a side of the wall. */
function nearestOpening(box, model) {
  let best = null;
  for (const opening of model.openings || []) {
    if (!(opening.width > 0) || !(opening.height > 0)) continue;
    const oFrom = opening.offset;
    const oTo = opening.offset + opening.width;
    const oBottom = opening.sill || 0;
    const oTop = oBottom + opening.height;
    const name = opening.category === "door" ? "door" : "window";
    const bandW = box.to - box.from;
    const openW = opening.width;
    const hOverlap = Math.min(box.to, oTo) - Math.max(box.from, oFrom);
    const vOverlap = Math.min(box.top, oTop) - Math.max(box.bottom, oBottom);
    const horizShare = hOverlap / Math.min(bandW, openW);
    const vertShare = vOverlap / Math.min(box.top - box.bottom, opening.height);
    const extendsPast = Math.max(0, oFrom - box.from) + Math.max(0, box.to - oTo);
    const close = extendsPast <= Math.max(0.45, openW);
    const candidates = [];
    const underGap = oBottom - box.top;
    if (underGap >= -0.05 && underGap <= 0.3 && horizShare >= 0.5 && close) candidates.push({ kind: "under", name, gap: Math.abs(underGap) });
    const aboveGap = box.bottom - oTop;
    if (aboveGap >= -0.05 && aboveGap <= 0.3 && horizShare >= 0.5 && close) candidates.push({ kind: "above", name, gap: Math.abs(aboveGap) });
    const leftGap = oFrom - box.to;
    if (leftGap >= -0.05 && leftGap <= 0.35 && vertShare >= 0.35) candidates.push({ kind: "left", name, gap: Math.abs(leftGap) });
    const rightGap = box.from - oTo;
    if (rightGap >= -0.05 && rightGap <= 0.35 && vertShare >= 0.35) candidates.push({ kind: "right", name, gap: Math.abs(rightGap) });
    for (const candidate of candidates) {
      if (!best || candidate.gap < best.gap) best = candidate;
    }
  }
  return best;
}

/** Where a finish sits, in words. A drawn shape uses its box, the same way a rectangle uses its height. */
function placePhrase(band, model) {
  const box = bandBox(band);
  if (!box || !(model.length > 0) || !(model.height > 0)) return "";
  const fullLen = box.from <= 0.02 && model.length - box.to <= 0.02;
  const fullH = box.bottom <= 0.02 && model.height - box.top <= 0.02;
  if (fullLen && fullH) return "Whole face";
  const height = fullH ? "" : heightWords(box.bottom, box.top);
  const opening = nearestOpening(box, model);
  if (opening) {
    const where = {
      under: `Under the ${opening.name}`,
      above: `Above the ${opening.name}`,
      left: `Left of the ${opening.name}`,
      right: `Right of the ${opening.name}`,
    }[opening.kind];
    return height ? `${where}, ${height}` : where;
  }
  if (fullLen) return height.charAt(0).toUpperCase() + height.slice(1);
  const side = sideWords(box, model.length);
  if (side && height) return `${side}, ${height}`;
  return side || (height ? height.charAt(0).toUpperCase() + height.slice(1) : "");
}

/** A height in words: "up to 1.2 m", "up to 100 mm", "0.9 m to 1.5 m". */
function heightWords(bottom, top) {
  const say = (m) => {
    const rounded = Math.round(m * 1000);
    if (rounded % 1000 === 0) return `${rounded / 1000} m`;
    if (rounded < 1000) return `${rounded} mm`;
    const text = (rounded / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `${text} m`;
  };
  if (bottom <= 0.02) return `up to ${say(top)}`;
  return `${say(bottom)} to ${say(top)}`;
}

/** One sentence for a finish, with no coordinates. */
function bandPlace(band, model) {
  if (band.source === "rule") {
    const box = bandBox(band);
    const fullH = !box || (box.bottom <= 0.02 && model.height - box.top <= 0.02);
    const height = !box || fullH ? "" : heightWords(box.bottom, box.top);
    return height ? `Every wall of this room, ${height}` : "Every wall of this room";
  }
  const place = placePhrase(band, model);
  if (band.category === "none") {
    if (!place || place === "Whole face") return "The finish from the wall type is off this face.";
    return `The finish from the wall type is off, ${place.charAt(0).toLowerCase()}${place.slice(1)}.`;
  }
  return place || "On this face";
}

/** The face in miniature. `shape` is optional: an empty draft still shows the wall and its openings. */
function faceMiniSvg(model, shape = "") {
  if (!(model.length > 0) || !(model.height > 0)) return "";
  const y = (z) => model.height - z;
  const openings = (model.openings || []).filter((o) => o.width > 0 && o.height > 0).map((o) => {
    const top = (o.sill || 0) + o.height;
    return `<rect x="${o.offset}" y="${y(top)}" width="${o.width}" height="${o.height}" class="fin-mini-opening"/>`;
  }).join("");
  return `<svg class="fin-mini" viewBox="0 0 ${model.length} ${model.height}" aria-hidden="true"><rect class="fin-mini-face" x="0" y="0" width="${model.length}" height="${model.height}"/>${shape}${openings}</svg>`;
}

function bandShape(band, model) {
  const poly = bandPolygon(band);
  if (!poly) return "";
  const y = (z) => model.height - z;
  const pts = poly.map(([s, z]) => `${s},${y(z)}`).join(" ");
  return `<polygon points="${pts}" class="fin-mini-shape" style="fill:${esc(finishSwatch(band.category))}"/>`;
}

/** The face in miniature, with this finish on it, so two similar sentences still look different. */
function bandMiniHtml(band, model) {
  const shape = bandShape(band, model);
  if (!shape) return "";
  return faceMiniSvg(model, shape);
}

/** Live picture of a finish that has not been added yet. Invalid numbers draw the face only. */
export function draftBandPreviewHtml(model, draft) {
  if (!model) return "";
  const shape = draft && draft.to > draft.from && draft.top > draft.bottom ? bandShape(draft, model) : "";
  return faceMiniSvg(model, shape);
}

/** One finish on a wall face. Resting rows are a line; the selected row opens the fields. */
function bandCardHtml(doc, b, model, { selectedId, savedId, index, total }) {
  const spec = FINISH_CATEGORIES[b.category];
  const product = finishProductById(doc, b.productId);
  const picked = b.id === selectedId;
  const label = spec?.label || b.category;
  const which = total > 1 ? `${label} ${index} of ${total}` : "";
  const place = bandPlace(b, model);
  const area = b.category === "none" ? "" : formatQty(b.quantity, b.unit);
  const named = Boolean(product) && b.category !== "none";
  const needs = !named && b.category !== "none" && Boolean(spec?.needsProduct);
  const productLine = !picked && named
    ? `<p class="fin-product-line">${esc(productChoiceLabel(product))}</p>`
    : "";
  const badge = needs ? `<p class="fin-badge">Needs a product</p>` : "";
  const productField = b.category === "none"
    ? ""
    : `<label class="fin-pick">Product
        <span class="fin-pick-line">
          ${productNameField(doc, b.category, { attr: "band-product-name", value: product ? productChoiceLabel(product) : "", listId: `fin-prod-${b.id}`, label: `Product for this ${label}` })}
          ${savedId === b.id ? `<span class="fin-saved">Saved</span>` : ""}
        </span>
      </label>`;
  const remove = b.category === "none"
    ? `<button type="button" data-fin="band-remove" title="Puts the finish from the wall type back on this part">Put it back</button>`
    : b.source === "rule"
      ? `<button type="button" data-fin="band-remove-rule" title="Removes the rule from every wall of its room">Remove</button>`
      : `<button type="button" data-fin="band-remove">Remove</button>`;
  const head = picked
    ? `<div class="fin-kind-head">
        <select data-fin="band-type" aria-label="Finish type">${surfaceTypeOptions("wall", b.category, { none: true })}</select>
        <span class="fin-area">${area}</span>
      </div>`
    : `<div class="fin-kind-head">
        <span class="fin-kind-name">${esc(which || label)}</span>
        <span class="fin-area">${area}</span>
      </div>`;
  const where = picked && which ? `${which} · ${place}` : place;
  return `<div class="fin-kind fin-kind-face${picked ? " fin-editing" : ""}" data-fin-band="${esc(b.id)}">
    ${bandMiniHtml(b, model)}
    <div class="fin-kind-main">
      ${head}
      <p class="fin-where">${esc(where)}</p>
      ${productLine}
      ${badge}
      ${picked || needs ? productField : ""}
      ${picked ? `<div class="fin-btns">${remove}</div>` : ""}
    </div>
  </div>`;
}

/**
 * A short pointer under the inspector's elevation picture. The selected row
 * below holds the fields. Edit opens this finish on the strip under the plan.
 */
export function finishCalloutHtml(doc, band, model) {
  const spec = FINISH_CATEGORIES[band.category];
  const product = finishProductById(doc, band.productId);
  const label = spec?.label || band.category;
  const same = (model.finishBands || [])
    .filter((b) => b.source !== "default" && b.category === band.category)
    .sort(compareBands);
  const index = same.findIndex((b) => b.id === band.id) + 1;
  const bare = band.category === "none";
  const named = Boolean(product) && !bare && band.source !== "default";
  const duplicate = same.length > 1 && index > 0 ? `${label} ${index} of ${same.length}` : "";
  const place = band.source === "default" ? "From the wall type" : bandPlace(band, model);
  const heading = bare ? "Bare" : (duplicate || label);
  const detail = [named ? productChoiceLabel(product) : "", place].filter(Boolean).join(" · ");
  const area = band.category === "none" ? "" : formatQty(band.quantity, band.unit);
  return `<div class="elev-callout" data-fin-band="${esc(band.id)}">
    <div class="elev-callout-top">
      <p class="fin-callout-line"><strong>${esc(heading)}</strong>${detail ? ` · ${esc(detail)}` : ""}${area ? ` <span class="fin-area">${esc(area)}</span>` : ""}</p>
      <button type="button" class="elev-callout-x" data-fin="callout-close" aria-label="Close">×</button>
    </div>
    <div class="fin-btns">
      ${bare ? `<button type="button" data-fin="bare-restore">Put it back</button>` : ""}
      <button type="button" data-fin="band-edit" title="${bare ? "Change how much of the face is bare" : "Open this finish on the elevation under the plan"}">${bare ? "Change the area" : "Edit"}</button>
    </div>
  </div>`;
}

/**
 * The same temporary note for a window or door on the inspector graph.
 * That graph does not move the opening; Edit opens the elevation that does.
 */
export function openingCalloutHtml(opening) {
  const kind = opening.category === "door" ? "Door" : "Window";
  const name = opening.name || kind;
  const size = `${mm(opening.width)} × ${mm(opening.height)}`;
  const place = [];
  if (opening.category !== "door" && opening.sill > 0.005) place.push(`Sill ${mm(opening.sill)} mm`);
  if (Number.isFinite(opening.offset)) place.push(`${mm(Math.max(0, opening.offset))} mm from the left`);
  const note = opening.nonStandard ? `<p class="fin-badge">Non-standard size</p>` : "";
  return `<div class="elev-callout" data-elev-callout="opening" data-opening-id="${esc(opening.id)}">
    <div class="elev-callout-top">
      <div class="fin-kind-head">
        <strong class="fin-grow">${esc(name)}</strong>
        <span class="fin-area">${esc(size)}</span>
      </div>
      <button type="button" class="elev-callout-x" data-fin="callout-close" aria-label="Close">×</button>
    </div>
    ${place.length ? `<p class="fin-where">${esc(place.join(" · "))}</p>` : ""}
    ${note}
    <div class="fin-btns">
      <button type="button" data-fin="opening-edit" title="Open the elevation under the plan. The opening can be moved there.">Edit</button>
    </div>
  </div>`;
}

function polygonArea(poly) {
  return poly?.length >= 3 ? Math.abs(polyArea(poly)) : 0;
}

function unionOnFace(model, polygons) {
  const polys = (polygons || []).filter((p) => p?.length >= 3);
  if (!polys.length || !(model.length > 0) || !(model.height > 0)) return 0;
  const host = [[0, 0], [model.length, 0], [model.length, model.height], [0, model.height]];
  return floorCoverage(host, polys).finished;
}

/** Area of `pieces` after the cut polygons (openings, coats) are taken out once. */
function netArea(model, pieces, cuts) {
  const kept = (pieces || []).filter((p) => p?.length >= 3);
  if (!kept.length) return 0;
  const islands = [];
  for (const piece of kept) {
    for (const cut of cuts || []) {
      if (cut?.length >= 3) islands.push(...clipPolygon(piece, cut));
    }
  }
  const cutArea = islands.length ? unionOnFace(model, islands) : 0;
  return Math.max(0, unionOnFace(model, kept) - cutArea);
}

function openingPolys(model) {
  return (model.openings || [])
    .filter((o) => o.width > 0 && o.height > 0)
    .map((o) => {
      const bottom = o.sill || 0;
      const top = bottom + o.height;
      return [[o.offset, bottom], [o.offset + o.width, bottom], [o.offset + o.width, top], [o.offset, top]];
    });
}

/**
 * Which finishes sit on which. A finish on a coat is said quietly ("Paint on
 * the plaster"). Two coats, or two finishes of the same kind, are a warning.
 * The plaster drawn under a coat is the coat's own area, so that pair is not
 * reported again.
 */
function overlapNotesHtml(model, bands) {
  const areaBands = (bands || []).filter((b) => b.category !== "none" && b.unit !== "m" && bandPolygon(b));
  const defaults = areaBands.filter((b) => b.source === "default");
  const coats = areaBands.filter((b) => b.source !== "default" && FINISH_CATEGORIES[b.category]?.layer === "coat");
  const finishes = areaBands.filter((b) => b.source !== "default" && FINISH_CATEGORIES[b.category]?.layer !== "coat");
  const openings = openingPolys(model);
  const coatPolys = coats.map(bandPolygon);
  const labelOf = (b) => FINISH_CATEGORIES[b.category]?.label || b.category;
  const quiet = new Map();
  const warns = new Map();

  const finishCats = [...new Set(finishes.map((b) => b.category))];
  for (const category of finishCats) {
    const ofType = finishes.filter((b) => b.category === category);
    const onDefault = [];
    for (const finish of ofType) {
      const poly = bandPolygon(finish);
      for (const def of defaults) onDefault.push(...clipPolygon(poly, bandPolygon(def)));
    }
    const onPlaster = netArea(model, onDefault, [...openings, ...coatPolys]);
    if (onPlaster >= 0.02 && defaults.length) {
      const coatLabel = labelOf(defaults[0]).toLowerCase();
      quiet.set(`on:${category}:default`, { text: `${labelOf(ofType[0])} on the ${coatLabel}`, area: onPlaster });
    }
    const coatCats = [...new Set(coats.map((b) => b.category))];
    for (const coatCategory of coatCats) {
      const pieces = [];
      for (const finish of ofType) {
        for (const coat of coats) {
          if (coat.category !== coatCategory) continue;
          pieces.push(...clipPolygon(bandPolygon(finish), bandPolygon(coat)));
        }
      }
      const area = netArea(model, pieces, openings);
      if (area < 0.02) continue;
      const coatLabel = (FINISH_CATEGORIES[coatCategory]?.label || coatCategory).toLowerCase();
      quiet.set(`on:${category}:${coatCategory}`, { text: `${labelOf(ofType[0])} on the ${coatLabel}`, area });
    }
  }

  const stack = [...coats, ...finishes];
  const order = categoriesForSurface("wall");
  const seen = new Set();
  for (let i = 0; i < stack.length; i += 1) {
    for (let j = i + 1; j < stack.length; j += 1) {
      const a = stack[i];
      const b = stack[j];
      const coatA = FINISH_CATEGORIES[a.category]?.layer === "coat";
      const coatB = FINISH_CATEGORIES[b.category]?.layer === "coat";
      if (coatA !== coatB) continue;
      const [first, second] = order.indexOf(a.category) <= order.indexOf(b.category) ? [a, b] : [b, a];
      const key = `${first.category}|${second.category}`;
      if (!seen.has(key)) {
        seen.add(key);
        warns.set(key, { pieces: [], first, second });
      }
      warns.get(key).pieces.push(...clipPolygon(bandPolygon(a), bandPolygon(b)));
    }
  }

  const quietHtml = [...quiet.values()]
    .filter((row) => row.area >= 0.02)
    .map((row) => `<p class="fin-on">${esc(row.text)}, ${formatM2(row.area)}.</p>`)
    .join("");
  const warnHtml = [...warns.values()].map((row) => {
    const area = netArea(model, row.pieces, openings);
    if (area < 0.02) return "";
    const a = labelOf(row.first);
    const b = labelOf(row.second);
    const text = row.first.category === row.second.category
      ? `${a} areas overlap`
      : `${a} overlaps ${b.toLowerCase()}`;
    return `<p class="fin-warn">${esc(text)}, ${formatM2(area)}.</p>`;
  }).join("");
  return quietHtml + warnHtml;
}

function countWords(n, unit) {
  const noun = unit === "m" ? "length" : "area";
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

/** Cards under their type, in the order they sit along the wall. */
function faceGroupsHtml(doc, model, opts) {
  const added = (model.finishBands || []).filter((b) => b.source !== "default").sort(compareBands);
  const byCat = new Map();
  for (const b of added) {
    const list = byCat.get(b.category) || [];
    list.push(b);
    byCat.set(b.category, list);
  }
  const known = categoriesForSurface("wall");
  const ids = [...known.filter((id) => byCat.has(id)), ...[...byCat.keys()].filter((id) => !known.includes(id))];
  return ids.map((id) => {
    const list = byCat.get(id);
    const spec = FINISH_CATEGORIES[id];
    const label = spec?.label || id;
    const unit = list[0]?.unit || spec?.unit;
    const qty = list.reduce((sum, b) => sum + (b.category === "none" ? 0 : b.quantity), 0);
    const cards = list.map((b, i) => bandCardHtml(doc, b, model, {
      selectedId: opts.selectedId,
      savedId: opts.savedId,
      index: i + 1,
      total: list.length,
    })).join("");
    const amount = id === "none" ? "" : `<span>${formatQty(qty, unit)}</span>`;
    const head = list.length > 1
      ? `<div class="fin-sum-row"><i class="fin-swatch" style="background:${esc(finishSwatch(id))}"></i><span class="fin-grow">${esc(label)}</span>${amount}<span class="fin-sum-n">${countWords(list.length, unit)}</span></div>`
      : "";
    return `<section class="fin-group">
      ${head}
      <div class="fin-kinds">${cards}</div>
    </section>`;
  }).join("");
}

/**
 * Wall face finishes: a summary, then each finish under its type, in the order
 * it sits on the wall. `opts.selectedId` is the band picked in the list or the
 * elevation, `opts.savedId` the one just saved.
 */
export function faceFinishHtml(doc, model, opts = {}) {
  const bands = model.finishBands || [];
  const first = "wallTile";
  const adding = Boolean(opts.adding);
  const groups = faceGroupsHtml(doc, model, opts);
  return `<section class="fin-sec" data-fin-block="face">
    <h4>Wall finishes</h4>
    <div class="fin-surface" data-fin-surface="face">
      <div class="fin-rest"${adding ? " hidden" : ""}>
        ${faceSummaryHtml(model, bands, { confirming: Boolean(opts.bareAsk) })}
        ${groups || '<p class="fin-note">Nothing added on this face yet.</p>'}
        ${overlapNotesHtml(model, bands)}
        <button type="button" class="fin-add-btn" data-fin="add-open">Add a finish</button>
      </div>
      <div class="fin-add-floor fin-add-sheet" data-fin-newband${adding ? "" : " hidden"}>
        <div class="fin-sheet-head">
          <p class="fin-kicker">Add a finish</p>
          <button type="button" class="fin-bare" data-fin="add-close">Back</button>
        </div>
        <label class="fin-pick">Finish
          <select data-fin="band-category" aria-label="Finish to add">${surfaceTypeOptions("wall", first, { none: true })}</select>
        </label>
        <label class="fin-pick">Product
          ${productNameField(doc, first, { attr: "new-band-product", value: "", listId: "fin-new-band-product", label: "Product for the new finish", placeholder: "Product name" })}
        </label>
        <p class="fin-note fin-hint" data-fin-hint>Wall tile needs a product name. You can add it now, or on the card after.</p>
        <label class="fin-pick">Height
          <select data-fin="band-height" aria-label="Height of the finish">${HEIGHT_PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("")}</select>
        </label>
        <button type="button" class="fin-part" data-fin="band-part" aria-pressed="false">Part of this face</button>
        <div class="fin-dim-row">
          <div class="fin-dim fin-dim-up" data-fin-custom hidden>
            <p class="fin-dim-head">Up the wall</p>
            <label>bottom <input data-fin="run-bottom" type="text" inputmode="decimal" value="0" aria-label="Bottom, mm up the wall" /> mm</label>
            <label>top <input data-fin="run-top" type="text" inputmode="decimal" placeholder="wall top" aria-label="Top, mm up the wall" /> mm</label>
            <p class="fin-note">Blank top is the top of the wall.</p>
          </div>
          <div class="fin-dim fin-dim-along" data-fin-span hidden>
            <p class="fin-dim-head">Along the wall</p>
            <label>from <input data-fin="run-from" type="text" inputmode="decimal" aria-label="From, mm along the wall" /> mm</label>
            <label>to <input data-fin="run-to" type="text" inputmode="decimal" aria-label="To, mm along the wall" /> mm</label>
          </div>
        </div>
        <div class="fin-live">
          <p class="fin-note" data-fin-live-note>Wall tile on the whole face.</p>
          <div data-fin-live>${draftBandPreviewHtml(model, { category: first, from: 0, to: model.length, bottom: 0, top: model.height })}</div>
        </div>
        <p class="fin-warn" data-fin-form-error hidden></p>
        <div class="fin-btns">
          <button type="button" class="fin-commit" data-fin="run-add" title="Covers this face.">Whole face</button>
          <button type="button" data-fin="band-draw" title="Click the corners on the elevation. Double-click or Esc finishes the shape. The height and millimetres in this form are not used.">Draw area</button>
        </div>
        <p class="fin-note">Draw area is a free shape on the elevation. The height and the millimetres here are not used.</p>
      </div>
    </div>
  </section>`;
}

export function productsHtml(doc, { open = false } = {}) {
  const cats = Object.keys(FINISH_CATEGORIES).filter((c) => !FINISH_CATEGORIES[c].virtual);
  const products = doc.finishProducts || [];
  const settings = doc.finishSettings || {};
  const groups = cats
    .map((c) => ({ category: c, items: products.filter((p) => p.category === c) }))
    .filter((g) => g.items.length);
  return `<details class="fin-sec" data-fin-block="products"${open ? " open" : ""}>
    <summary>Products on this job (${products.length})</summary>
    ${groups.map((g) => g.items.map((p) => `<div class="fin-row" data-fin-product="${esc(p.id)}">
      <span class="fin-grow">${esc(productLabel(p))}${p.boxCoverage ? ` · ${p.boxCoverage} m²/box` : ""}${p.wasteFactor !== null ? ` · ${Math.round(p.wasteFactor * 100)}% waste` : ""}${p.rateRef ? ` · ${esc(p.rateRef)}` : ""}</span>
      <button type="button" data-fin="product-library" title="Add this product to the firm's rate book, unpriced (owner only)">Save to firm library</button>
      <button type="button" data-fin="product-remove">Remove</button>
    </div>`).join("")).join("")}
    <div data-fin-new-product>
      <label class="fin-pick">Finish
        <select data-fin="p-category" aria-label="Finish">${cats.map((c) => `<option value="${c}">${esc(FINISH_CATEGORIES[c].label)}</option>`).join("")}</select>
      </label>
      <label class="fin-pick">Product
        <input data-fin="p-name" type="text" placeholder="Name" aria-label="Product name" />
      </label>
    <div class="fin-grid">
      <input data-fin="p-code" type="text" placeholder="Code" aria-label="Code" />
      <input data-fin="p-size" type="text" placeholder="Size" aria-label="Size" />
      <input data-fin="p-supplier" type="text" placeholder="Supplier" aria-label="Supplier" />
      <input data-fin="p-coverage" type="text" inputmode="decimal" placeholder="m² per box" aria-label="Box coverage, m2" />
      <input data-fin="p-waste" type="text" inputmode="decimal" placeholder="waste %" aria-label="Waste percent" />
      <button type="button" data-fin="product-add">Add product</button>
    </div>
    </div>
    <div class="fin-row">
      <label>External finish
        <select data-fin="external-finish">${[["plaster", "Plaster"], ["render", "Render"], ["facebrick", "Face brick"]].map(([v, l]) => `<option value="${v}"${settings.externalFinish === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label>Wall volume at
        <select data-fin="volume-basis">
          <option value="overall"${settings.volumeBasis !== "core" ? " selected" : ""}>overall thickness</option>
          <option value="core"${settings.volumeBasis === "core" ? " selected" : ""}>core thickness</option>
        </select>
      </label>
    </div>
  </details>`;
}
