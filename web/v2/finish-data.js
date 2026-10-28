// Finish data: the categories the app ships and the normalisers for the
// finish fields on a document. No imports, so model.js can use it without a
// cycle (finish-model.js imports model.js).
//
// A category is a classification, not a priced fact (the same stance as
// SERVICE_SYSTEMS): it says which surfaces it may go on, how it is measured,
// and whether a row of it means anything without a chosen product. Products
// and rates belong to the job and the firm's rate book.

/**
 * `surfaces`: where it may go ("wall" faces, "floor" areas).
 * `unit`: "m2", or "m" for skirting.
 * `needsProduct`: true when a row with no product is only an allowance (a tile
 *   has a size, a supplier and a price; a coat of plaster is a rate).
 * `layer`: "coat" finishes are the face's base coat, so one of them replaces
 *   the computed plaster default over the part it covers.
 */
export const FINISH_CATEGORIES = {
  plaster: { label: "Plaster", surfaces: ["wall"], unit: "m2", needsProduct: false, layer: "coat" },
  render: { label: "Render", surfaces: ["wall"], unit: "m2", needsProduct: false, layer: "coat" },
  facebrick: { label: "Face brick", surfaces: ["wall"], unit: "m2", needsProduct: true, layer: "coat" },
  rhinolite: { label: "Rhinolite", surfaces: ["wall"], unit: "m2", needsProduct: false, layer: null },
  wallTile: { label: "Wall tile", surfaces: ["wall"], unit: "m2", needsProduct: true, layer: null },
  paint: { label: "Paint", surfaces: ["wall"], unit: "m2", needsProduct: false, layer: null },
  waterproofing: { label: "Waterproofing", surfaces: ["wall", "floor"], unit: "m2", needsProduct: false, layer: null },
  skirting: { label: "Skirting", surfaces: ["wall"], unit: "m", needsProduct: true, layer: null },
  screed: { label: "Screed", surfaces: ["floor"], unit: "m2", needsProduct: false, layer: null },
  floorTile: { label: "Floor tile", surfaces: ["floor"], unit: "m2", needsProduct: true, layer: null },
  carpet: { label: "Carpet", surfaces: ["floor"], unit: "m2", needsProduct: true, layer: null },
  vinyl: { label: "Vinyl", surfaces: ["floor"], unit: "m2", needsProduct: true, layer: null },
  timberFloor: { label: "Timber floor", surfaces: ["floor"], unit: "m2", needsProduct: true, layer: null },
  // Not a finish: it states "no finish here", so the computed plaster default
  // can be taken off a face or part of one.
  none: { label: "No finish", surfaces: ["wall"], unit: "m2", needsProduct: false, layer: "coat", virtual: true },
};

export const FINISH_CATEGORY_IDS = Object.keys(FINISH_CATEGORIES);

/**
 * Plan fill for a floor finish. The inspector swatch uses the same colour, so a
 * row and the area it describes read as the same thing.
 */
export const FINISH_SWATCH = {
  screed: "#c4a574",
  floorTile: "#6a8fbf",
  timberFloor: "#8d5a32",
  vinyl: "#3d8f8a",
  carpet: "#8a6a9a",
  waterproofing: "#3c7a52",
  // Wall finishes: the same colours colour the elevation bands and the panel.
  plaster: "#b8b0a0",
  render: "#a89a82",
  facebrick: "#a4472f",
  rhinolite: "#d8cfa8",
  wallTile: "#4f86a8",
  paint: "#d9a441",
  skirting: "#6b4a2d",
  none: "#e8e2d6",
};

export function finishSwatch(category) {
  return FINISH_SWATCH[category] || "#3c7a52";
}

/** Categories a person may pick for a surface; the virtual "none" is wall-only. */
export function categoriesForSurface(surface) {
  return FINISH_CATEGORY_IDS.filter((id) => FINISH_CATEGORIES[id].surfaces.includes(surface));
}

export const EXTERNAL_FINISHES = ["plaster", "render", "facebrick"];
export const RULE_FACES = ["all", "external", "internal"];
export const FINISH_SURFACES = ["wall", "floor"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const known = (c) => (typeof c === "string" && c in FINISH_CATEGORIES ? c : null);

let seq = 0;
export function finishId(prefix) {
  seq += 1;
  return `${prefix}${Math.random().toString(36).slice(2, 7)}${seq}`;
}

export function normalizeFinishProducts(list) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const category = known(p?.category);
    if (!p?.id || !category || seen.has(p.id)) continue;
    seen.add(p.id);
    const coverage = num(p.boxCoverage);
    const waste = num(p.wasteFactor);
    out.push({
      id: p.id,
      category,
      code: str(p.code),
      name: str(p.name),
      size: str(p.size),
      supplier: str(p.supplier),
      boxCoverage: coverage !== null && coverage > 0 ? coverage : null,
      wasteFactor: waste !== null && waste >= 0 ? waste : null,
      rateRef: str(p.rateRef),
    });
  }
  return out;
}

/** One room rule (also the shape inside a preset, where `id` is regenerated on apply). */
export function normalizeFinishRule(r) {
  const surface = FINISH_SURFACES.includes(r?.surface) ? r.surface : null;
  const category = known(r?.category);
  const productId = str(r?.productId);
  if (!surface || !(category || productId)) return null;
  const bottom = num(r.bottom);
  const top = num(r.top);
  return {
    id: str(r.id) || finishId("fr"),
    surface,
    category,
    productId,
    bottom: bottom !== null && bottom >= 0 ? bottom : 0,
    top: top !== null && top > 0 ? top : null,
    faces: RULE_FACES.includes(r.faces) ? r.faces : "all",
  };
}

export function normalizeRoomFinishes(list) {
  return (Array.isArray(list) ? list : []).map(normalizeFinishRule).filter(Boolean);
}

export function normalizeFinishRuns(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    const category = known(r?.category);
    const productId = str(r?.productId);
    if (!r?.id || !(category || productId)) continue;
    const a = num(r.a);
    const b = num(r.b);
    const bottom = num(r.bottom);
    const top = num(r.top);
    out.push({
      id: r.id,
      level: str(r.level),
      roomId: str(r.roomId),
      wallId: str(r.wallId),
      side: r.side === -1 ? -1 : 1,
      // Distance along the wall from its first end; null for both is the whole face.
      a: a !== null && b !== null ? Math.min(a, b) : null,
      b: a !== null && b !== null ? Math.max(a, b) : null,
      bottom: bottom !== null && bottom >= 0 ? bottom : 0,
      top: top !== null && top > 0 ? top : null,
      category,
      productId,
      // Where the run sits on the plan, so it can find its face again when a
      // room-derived wall id changes: both ends, and a point on the viewer's side.
      x1: num(r.x1), y1: num(r.y1), x2: num(r.x2), y2: num(r.y2), vx: num(r.vx), vy: num(r.vy),
    });
    // A shape drawn on the elevation: points are metres along the wall from its
    // first end, and metres up from the wall base. Absent means the run is the
    // rectangle of a, b, bottom and top.
    const outline = (Array.isArray(r.outline) ? r.outline : [])
      .map((p) => [num(p?.[0]), num(p?.[1])])
      .filter((p) => p[0] !== null && p[1] !== null);
    if (outline.length >= 3) out[out.length - 1].outline = outline;
  }
  return out;
}

export function normalizeFinishRegions(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    const category = known(r?.category);
    const productId = str(r?.productId);
    const shape = r?.shape?.kind === "poly" || r?.shape?.kind === "rect" || r?.shape?.kind === "rects" ? r.shape : null;
    if (!r?.id || !shape || !(category || productId)) continue;
    const region = {
      id: r.id,
      level: str(r.level),
      roomId: str(r.roomId),
      slabId: str(r.slabId),
      category,
      productId,
      shape,
    };
    // "Whole floor": the outline is the slab's own, so it is only kept while it names a slab.
    if (r.whole === true && region.slabId) region.whole = true;
    out.push(region);
  }
  return out;
}

export function normalizeFinishPresets(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const name = str(p?.name);
    if (!p?.id || !name) continue;
    const rules = normalizeRoomFinishes(p.rules);
    if (!rules.length) continue;
    out.push({ id: p.id, name, use: str(p.use), rules: rules.map(({ id, ...rest }) => rest) });
  }
  return out;
}

export function normalizeFinishSettings(s) {
  return {
    externalFinish: EXTERNAL_FINISHES.includes(s?.externalFinish) ? s.externalFinish : "plaster",
    // Wall volume stays on the overall thickness until the firm confirms which
    // basis its brick rates use (TEMPLATE-ASKS.md).
    volumeBasis: s?.volumeBasis === "core" ? "core" : "overall",
  };
}
