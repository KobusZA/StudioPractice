// The inspector's finish section: markup only. ui.js owns the events (they
// are delegated on the panel and read `data-fin` attributes) and the undo.
//
// Three blocks, shown as they apply:
//   room       the room's finish rules, presets and floor regions
//   face       what is on the selected wall face, and a form to add a run
//   products   the products on this job and the two job settings

import { finishSwatch } from "./finish-data.js";
import { floorCoverage, FINISH_CATEGORIES, categoriesForSurface, finishProductById, regionsOnSlab } from "./finish-model.js";
import { area as polyArea } from "./geom.js";
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

/** Options for a finish type on a surface; `none` only where a run may say "no finish". */
function surfaceTypeOptions(surface, selected, { none = false } = {}) {
  const ids = categoriesForSurface(surface).filter((id) => none || !FINISH_CATEGORIES[id].virtual);
  return ids.map((id) => (
    `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(FINISH_CATEGORIES[id].label)}</option>`
  )).join("");
}

/** Heights a wall finish usually runs to. `top: null` is the wall top. */
export const HEIGHT_PRESETS = [
  { id: "full", label: "Full height", bottom: 0, top: null },
  { id: "skirting", label: "Skirting (to 100)", bottom: 0, top: 0.1 },
  { id: "dado", label: "Dado (to 1200)", bottom: 0, top: 1.2 },
  { id: "splash", label: "Splashback (900 to 1500)", bottom: 0.9, top: 1.5 },
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
function productNameField(doc, category, { attr, value, listId, label }) {
  return `<input data-fin="${attr}" type="text" value="${esc(value)}" placeholder="Name" list="${esc(listId)}" aria-label="${esc(label)}" autocomplete="off" />
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
      <button type="button" data-fin="region-edit" aria-pressed="${editing ? "true" : "false"}" title="Show this region's corners on the plan: drag a corner, drag an edge to add one, Delete removes a corner">${editing ? "Done" : "Edit corners"}</button>
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
  const both = floorCoverage(host, poly([...defaults, ...added]));
  const addedQty = added.reduce((sum, b) => sum + b.quantity, 0);
  return {
    face: model.length * model.height,
    finished: addedCover.excess >= 0.02 ? addedCover.finished : addedQty,
    plaster: defaults.reduce((sum, b) => sum + b.quantity, 0),
    plasterCategory: defaults[0]?.category || null,
    excess: both.excess,
    hasAdded: added.length > 0,
  };
}

/** What is on this wall face: the face, finishes added once, and the plaster underneath. */
function faceSummaryHtml(model, bands) {
  const cover = faceCoverage(model, bands);
  const byType = new Map();
  for (const b of bands) {
    if (b.source === "default" || b.category === "none") continue;
    const row = byType.get(b.category) || { qty: 0, unit: b.unit };
    row.qty += b.quantity;
    byType.set(b.category, row);
  }
  const order = categoriesForSurface("wall");
  const rows = order.filter((id) => byType.has(id)).map((id) => {
    const row = byType.get(id);
    return `<li class="fin-sum-row"><i class="fin-swatch" style="background:${esc(finishSwatch(id))}"></i><span class="fin-grow">${esc(FINISH_CATEGORIES[id].label)}</span><span>${formatQty(row.qty, row.unit)}</span></li>`;
  }).join("");
  const plasterLabel = cover.plasterCategory ? FINISH_CATEGORIES[cover.plasterCategory]?.label : "Plaster";
  const plaster = cover.plaster >= 0.02
    ? `<li class="fin-sum-row"><i class="fin-swatch" style="background:${esc(finishSwatch(cover.plasterCategory))}"></i><span class="fin-grow">${esc(plasterLabel)}, from the wall type</span><span>${formatM2(cover.plaster)}</span><button type="button" class="fin-bare" data-fin="default-remove">Take off</button></li>`
    : "";
  const finished = cover.hasAdded
    ? `<p class="fin-sum-line"><span>Finished ${formatM2(cover.finished)}</span></p>`
    : "";
  const bare = !plaster && cover.face - cover.finished >= 0.02
    ? `<p class="fin-sum-line"><span>Bare ${formatM2(Math.max(0, cover.face - cover.finished))}</span></p>`
    : "";
  const warn = cover.excess >= 0.02
    ? `<p class="fin-warn">Some of this face is covered more than once (${formatM2(cover.excess)}).</p>`
    : "";
  const list = plaster || rows ? `<ul class="fin-sum-list">${plaster}${rows}</ul>` : "";
  return `<div class="fin-summary" data-fin-summary>
    <p class="fin-sum-head"><span>This face</span><span>${formatM2(cover.face)}</span></p>
    ${finished}
    ${bare}
    ${list}
    ${warn}
  </div>`;
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

/** One sentence for a finish, with no coordinates. A drawn shape is a polygon, so it is not described as four edges. */
function bandPlace(band, model) {
  if (band.category === "none") return "Taken off this face. Remove this to put it back.";
  if (band.outline?.length >= 3) return `Drawn area, ${band.outline.length} corners`;
  const fullLen = band.from <= 0.02 && model.length - band.to <= 0.02;
  const fullH = band.bottom <= 0.02 && model.height - band.top <= 0.02;
  const height = fullH ? "" : heightWords(band.bottom, band.top);
  if (band.source === "rule") return height ? `Every wall of this room, ${height}` : "Every wall of this room";
  if (fullLen && fullH) return "Whole face";
  if (fullLen) return height.charAt(0).toUpperCase() + height.slice(1);
  return height ? `Part of this face, ${height}` : "Part of this face";
}

/** One finish on a wall face: a card like a placed floor finish. */
function bandCardHtml(doc, b, model, { selectedId, savedId, index, total }) {
  const spec = FINISH_CATEGORIES[b.category];
  const product = finishProductById(doc, b.productId);
  const picked = b.id === selectedId;
  const label = spec?.label || b.category;
  const which = total > 1 ? `${label} ${index} of ${total} · ` : "";
  const badge = product || b.category === "none"
    ? ""
    : spec?.needsProduct
      ? `<p class="fin-badge">Needs a product</p>`
      : `<p class="fin-badge fin-badge-soft">No product named</p>`;
  const productField = b.category === "none"
    ? ""
    : `<label class="fin-pick">Product
        <span class="fin-pick-line">
          ${productNameField(doc, b.category, { attr: "band-product-name", value: product ? productChoiceLabel(product) : "", listId: `fin-prod-${b.id}`, label: `Product for this ${label}` })}
          ${savedId === b.id ? `<span class="fin-saved">Saved</span>` : ""}
        </span>
      </label>`;
  const remove = b.source === "rule"
    ? `<button type="button" data-fin="band-remove-rule" title="Removes the rule from every wall of its room">Remove</button>`
    : `<button type="button" data-fin="band-remove">Remove</button>`;
  return `<div class="fin-kind${picked ? " fin-editing" : ""}" data-fin-band="${esc(b.id)}">
    <div class="fin-kind-head">
      <i class="fin-swatch" style="background:${esc(finishSwatch(b.category))}"></i>
      <select data-fin="band-type" aria-label="Finish type">${surfaceTypeOptions("wall", b.category, { none: true })}</select>
      <span class="fin-area">${b.category === "none" ? "" : formatQty(b.quantity, b.unit)}</span>
    </div>
    <p class="fin-where">${esc(which)}${esc(bandPlace(b, model))}</p>
    ${badge}
    ${productField}
    <div class="fin-btns">${remove}</div>
  </div>`;
}

/**
 * The box under the inspector's elevation preview. A click on a finish stays
 * on the graph: this holds the same facts as its card, and Edit opens the
 * elevation under the plan instead of scrolling the card into view.
 */
export function finishCalloutHtml(doc, band, model) {
  const spec = FINISH_CATEGORIES[band.category];
  const product = finishProductById(doc, band.productId);
  const label = spec?.label || band.category;
  const same = (model.finishBands || []).filter((b) => b.source !== "default" && b.category === band.category);
  const index = same.findIndex((b) => b.id === band.id) + 1;
  const which = same.length > 1 && index > 0 ? `${label} ${index} of ${same.length} · ` : "";
  const place = band.source === "default" ? "From the wall type" : bandPlace(band, model);
  const area = band.category === "none" ? "" : formatQty(band.quantity, band.unit);
  const productLine = band.category === "none" || band.source === "default"
    ? ""
    : product
      ? `<p class="fin-name">${esc(productChoiceLabel(product))}</p>`
      : spec?.needsProduct
        ? `<p class="fin-badge">Needs a product</p>`
        : `<p class="fin-badge fin-badge-soft">No product named</p>`;
  return `<div class="elev-callout" data-fin-band="${esc(band.id)}">
    <div class="fin-kind-head">
      <i class="fin-swatch" style="background:${esc(finishSwatch(band.category))}"></i>
      <strong class="fin-grow">${esc(label)}</strong>
      <span class="fin-area">${esc(area)}</span>
    </div>
    <p class="fin-where">${esc(which)}${esc(place)}</p>
    ${productLine}
    <div class="fin-btns">
      <button type="button" data-fin="band-close">Close</button>
      <button type="button" data-fin="band-edit" title="Open this finish on the elevation under the plan">Edit</button>
    </div>
  </div>`;
}

/**
 * Wall face finishes, laid out like the floor panel: a summary, one form to add a
 * finish, then a card for each finish on the face. `opts.selectedId` is the band
 * picked in the list or the elevation, `opts.savedId` the one just saved.
 */
export function faceFinishHtml(doc, model, opts = {}) {
  const bands = (model.finishBands || []).filter((b) => b.source !== "default");
  const counts = new Map();
  const seen = new Map();
  for (const b of bands) counts.set(b.category, (counts.get(b.category) || 0) + 1);
  const cards = bands.map((b) => {
    const n = (seen.get(b.category) || 0) + 1;
    seen.set(b.category, n);
    return bandCardHtml(doc, b, model, { selectedId: opts.selectedId, savedId: opts.savedId, index: n, total: counts.get(b.category) });
  }).join("");
  const first = "wallTile";
  const adding = Boolean(opts.adding);
  return `<section class="fin-sec" data-fin-block="face">
    <h4>Wall finishes</h4>
    <div class="fin-surface" data-fin-surface="face">
      <div class="fin-rest"${adding ? " hidden" : ""}>
        ${faceSummaryHtml(model, model.finishBands || [])}
        <button type="button" class="fin-add-btn" data-fin="add-open">Add a finish</button>
        <div class="fin-drawn">
          <p class="fin-kicker">On this face (${bands.length})</p>
          ${bands.length ? `<div class="fin-kinds">${cards}</div>` : '<p class="fin-note">Nothing added on this face yet.</p>'}
        </div>
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
          ${productNameField(doc, first, { attr: "new-band-product", value: "", listId: "fin-new-band-product", label: "Product for the new finish" })}
        </label>
        <label class="fin-pick">Height
          <select data-fin="band-height" aria-label="Height of the finish">${HEIGHT_PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("")}</select>
        </label>
        <div class="fin-sizes" data-fin-custom hidden>
          <label>Up <input data-fin="run-bottom" type="text" inputmode="decimal" value="0" aria-label="Bottom, mm" /> mm</label>
          <label>to <input data-fin="run-top" type="text" inputmode="decimal" placeholder="top" aria-label="Top, mm" /> mm</label>
        </div>
        <div class="fin-sizes" data-fin-span hidden>
          <p class="fin-note">Along the wall</p>
          <label>From <input data-fin="run-from" type="text" inputmode="decimal" aria-label="From, mm along the wall" /> mm</label>
          <label>to <input data-fin="run-to" type="text" inputmode="decimal" aria-label="To, mm along the wall" /> mm</label>
        </div>
        <div class="fin-btns">
          <button type="button" data-fin="run-add">Whole face</button>
          <button type="button" data-fin="band-draw" title="Click the corners on the elevation, then Enter.">Draw area</button>
        </div>
        <button type="button" class="fin-bare" data-fin="band-part" aria-pressed="false">Part of this face</button>
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
