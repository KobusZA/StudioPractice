// SKU pack v2 schema.
//
// Design rules (see SCHEMA.md before changing anything here):
//  1. A SKU carries physical FACTS only. It never carries an interpretation of a
//     regulation. "220mm, plastered, surface density 470" belongs here;
//     "complies with XA" belongs in the rule pack.
//  2. Geometry, cost, compliance, drawing and schedule concerns live in separate
//     blocks so each can be sourced, reviewed and versioned by a different party.
//  3. Rates are referenced, never embedded. The rate book is a separate document
//     so pricing can change without reissuing the pack.
//  4. Unknown compliance facts are null, never guessed. Null means "ask the firm"
//     and shows up in the gap report.
//  5. Units (see UNITS-MIGRATION-PLAN.md and SCHEMA.md's changelog): every SKU's
//     `geometry.*` field and `system.wallHeight` are millimetres in the pack/JSON
//     representation (sp.pack/3+), matching the QS workbook and the firm's own
//     wall-type naming ("220mm Foundation Perimeter"). Everything that consumes a
//     pack at runtime (walls.js, compile.js, openings.js, dimensions.js, modify.js,
//     snap.js) keeps working in metres as before - `normalizePackUnits()` below is
//     the one place mm becomes m, so none of those files needed to change.
//     `pack.levels[].elevation/.floorToFloor/.floorToCeiling` stay metres: a level
//     is a position in the plan's coordinate space, not a named dimension.

export const PACK_SCHEMA = "sp.pack/3";

/** Every SKU geometry key that is millimetres in the pack/JSON representation. */
export const GEOMETRY_LENGTH_KEYS = [
  "thickness", "width", "height", "depth", "sill", "diameter", "riser", "going",
];

/**
 * Convert a loaded pack (sp.pack/3, geometry in millimetres) into the shape
 * every internal consumer already expects (geometry in metres) - see the
 * units note above. Non-destructive: returns a new pack, the argument is
 * untouched. Call this once, right after parsing a pack's JSON, before handing
 * it to anything else in web/v2.
 */
export function normalizePackUnits(pack) {
  if (!pack || typeof pack !== "object") return pack;
  const next = { ...pack };
  if (next.system) {
    next.system = { ...next.system };
    if (isNum(next.system.wallHeight)) next.system.wallHeight = next.system.wallHeight / 1000;
  }
  if (Array.isArray(next.skus)) {
    next.skus = next.skus.map((sku) => {
      if (!sku.geometry) return sku;
      const geometry = { ...sku.geometry };
      for (const key of GEOMETRY_LENGTH_KEYS) {
        if (isNum(geometry[key])) geometry[key] = geometry[key] / 1000;
      }
      return { ...sku, geometry };
    });
  }
  return next;
}

export const CATEGORIES = [
  "wall",
  "foundation",
  "floor",
  "ceiling",
  "roof",
  "door",
  "window",
  "beam",
  "column",
  "stair",
  "sanitary",
  "waterheater",
  "drainage",
  "electrical",
  "furniture",
  "casework",
  "boundarywall",
  "pool",
  "carport",
];

// How the authoring UI creates the object. Decoupled from category because a
// boundary wall and an internal wall draw identically but schedule differently.
export const DRAW_VERBS = [
  "wall",
  "fill",
  "roof",
  "door",
  "window",
  "beam",
  "box",
  "stair",
  "point",
  "pipe",
  "hidden",
];

// NBR A8 / SANS 10400-A colour notation classes. The renderer maps class to
// colour; the pack never stores a hex value, because the mapping is a
// regulation and regulations live in rule packs.
export const COLOUR_CLASSES = [
  "masonry",
  "concrete",
  "steel",
  "timber",
  "glass",
  "other",
  "drain",
  "waste",
  "soilvent",
  "wastevent",
  "stormwater",
];

export const SCHEDULE_MEASURES = ["count", "length", "area", "volume", "perimeter"];

// Which measures each category must report, derived from the TSP schedules in
// calculators/. This is the seven-column contract with the QS workbook.
export const REQUIRED_MEASURES = {
  wall: ["length", "area", "volume", "count"],
  foundation: ["length", "volume", "count"],
  floor: ["area", "volume", "perimeter", "count"],
  ceiling: ["area", "count"],
  roof: ["area", "count"],
  door: ["count"],
  window: ["count"],
  beam: ["length", "count"],
  column: ["length", "count"],
  stair: ["count"],
  sanitary: ["count"],
  waterheater: ["count"],
  drainage: ["length", "count"],
  electrical: ["count"],
  furniture: ["count"],
  casework: ["count"],
  boundarywall: ["length", "area", "volume", "count"],
  pool: ["area", "volume", "count"],
  carport: ["area", "count"],
};

// Required geometry keys per category. Anything else is optional.
const REQUIRED_GEOMETRY = {
  wall: ["thickness", "height"],
  foundation: ["thickness", "width", "depth"],
  floor: ["thickness"],
  ceiling: ["thickness"],
  roof: ["thickness"],
  door: ["width", "height"],
  window: ["width", "height", "sill"],
  beam: ["width", "height"],
  column: ["width", "depth"],
  stair: ["width", "riser", "going"],
  sanitary: ["width", "depth", "height"],
  waterheater: ["width", "depth", "height"],
  drainage: ["diameter"],
  electrical: ["width", "depth", "height"],
  furniture: ["width", "depth", "height"],
  casework: ["width", "depth", "height"],
  boundarywall: ["thickness", "height"],
  pool: ["depth"],
  carport: ["height"],
};

// Compliance facts per category. `null` is a legal value and means unknown.
// Every key here is a physical property someone can measure or certify, never
// a pass/fail judgement.
const COMPLIANCE_FACTS = {
  wall: [
    "rValue", // m2.K/W, total assembly
    "surfaceDensity", // kg/m2 - selects which XA table applies
    "plastered", // internally plastered
    "rendered", // externally rendered
    "cavity",
    "loadBearing",
    "thermalBreakRValue", // required where metal elements touch
  ],
  boundarywall: ["loadBearing"],
  foundation: ["loadBearing"],
  floor: ["rValue", "suspended", "exposed"],
  ceiling: ["rValue"],
  roof: ["rValue", "insulationRValue", "underlay", "radiantBarrier", "compressible"],
  door: ["uValue", "external", "sealed", "providesVentilation", "openableAreaFraction"],
  window: [
    "uValue",
    "shgc",
    "glazingLayers",
    "sealed",
    "providesLight",
    "providesVentilation",
    "openableAreaFraction", // fraction of the opening that actually opens
    "safetyGlazed", // Part N
  ],
  beam: ["loadBearing"],
  column: ["loadBearing"],
  stair: [
    "solidRisers",
    "treadOverlap",
    "landingLength",
    "maxFlightRise",
    "winders",
  ],
  sanitary: [
    "dischargeType", // "soil" | "waste" | null
    "trapDiameter",
    "fixtureUnits",
    "requiresGully",
    "requiresVent",
  ],
  waterheater: ["capacityLitres", "heatSource", "nonResistanceFraction"],
  drainage: ["minGradient", "ventDiameter"],
  electrical: [],
  furniture: [],
  casework: [],
  pool: [],
  carport: [],
};

const VALID_HEAT_SOURCES = ["resistance", "heatpump", "solar", "gas", null];
const VALID_DISCHARGE = ["soil", "waste", null];

export function requiredGeometryFor(category) {
  return REQUIRED_GEOMETRY[category] || [];
}

export function complianceFactsFor(category) {
  return COMPLIANCE_FACTS[category] || [];
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isBoolOrNull(v) {
  return v === null || typeof v === "boolean";
}

function isNumOrNull(v) {
  return v === null || isNum(v);
}

/**
 * Validate a v2 pack. Returns { ok, errors, warnings }.
 * Errors block loading. Warnings are things the firm still has to supply.
 */
export function validatePack(pack) {
  const errors = [];
  const warnings = [];
  const at = (path, msg) => errors.push(`${path}: ${msg}`);

  if (!pack || typeof pack !== "object") {
    return { ok: false, errors: ["pack: not an object"], warnings };
  }
  if (pack.schema !== PACK_SCHEMA) {
    at("schema", `expected "${PACK_SCHEMA}", got ${JSON.stringify(pack.schema)}`);
  }
  for (const key of ["id", "name", "version", "revision"]) {
    if (!pack[key] || typeof pack[key] !== "string") {
      at(key, "required string");
    }
  }

  // --- locale -------------------------------------------------------------
  const locale = pack.locale;
  if (!locale || typeof locale !== "object") {
    at("locale", "required object");
  } else {
    if (locale.country !== "ZA") {
      warnings.push(`locale.country: only ZA rule packs exist today, got ${locale.country}`);
    }
    if (locale.energyZone === null || locale.energyZone === undefined) {
      warnings.push("locale.energyZone: needed to select SANS 10400-XA R-value tables");
    }
    if (!locale.municipality) {
      warnings.push("locale.municipality: needed to select submission requirements and scales");
    }
  }

  // --- levels -------------------------------------------------------------
  const levels = Array.isArray(pack.levels) ? pack.levels : null;
  if (!levels || !levels.length) {
    at("levels", "at least one level required");
  } else {
    levels.forEach((lvl, i) => {
      if (!lvl.id) at(`levels[${i}].id`, "required");
      if (!isNum(lvl.elevation)) at(`levels[${i}].elevation`, "required number");
      if (!isNum(lvl.floorToFloor)) {
        warnings.push(`levels[${i}].floorToFloor: needed for sections and Part C heights`);
      }
    });
  }
  const levelIds = new Set((levels || []).map((l) => l.id));

  // --- system -------------------------------------------------------------
  const sys = pack.system;
  if (!sys || typeof sys !== "object") {
    at("system", "required object");
  } else {
    if (!isNum(sys.wallHeight)) at("system.wallHeight", "required number");
    if (sys.defaultLevel && !levelIds.has(sys.defaultLevel)) {
      at("system.defaultLevel", `unknown level ${sys.defaultLevel}`);
    }
  }

  // --- skus ---------------------------------------------------------------
  const skus = Array.isArray(pack.skus) ? pack.skus : null;
  if (!skus || !skus.length) {
    at("skus", "at least one SKU required");
    return { ok: false, errors, warnings };
  }

  const ids = new Set();
  skus.forEach((sku, i) => {
    const p = `skus[${i}]`;
    if (!sku.id || typeof sku.id !== "string") {
      at(`${p}.id`, "required string");
      return;
    }
    if (ids.has(sku.id)) at(`${p}.id`, `duplicate ${sku.id}`);
    ids.add(sku.id);

    const q = `skus[${sku.id}]`;
    if (!sku.name) at(`${q}.name`, "required");
    if (!CATEGORIES.includes(sku.category)) {
      at(`${q}.category`, `unknown category ${JSON.stringify(sku.category)}`);
      return;
    }
    if (!DRAW_VERBS.includes(sku.draw)) {
      at(`${q}.draw`, `unknown draw verb ${JSON.stringify(sku.draw)}`);
    }
    if (!sku.unit) at(`${q}.unit`, "required");

    // geometry
    const geom = sku.geometry;
    if (!geom || typeof geom !== "object") {
      at(`${q}.geometry`, "required object");
    } else {
      for (const key of requiredGeometryFor(sku.category)) {
        if (!isNum(geom[key])) {
          at(`${q}.geometry.${key}`, `required number for category ${sku.category}`);
        }
      }
    }

    // cost
    const cost = sku.cost;
    if (!cost || typeof cost !== "object") {
      at(`${q}.cost`, "required object");
    } else {
      if (!cost.rateRef) {
        warnings.push(`${q}.cost.rateRef: no rate reference, SKU will price at zero`);
      }
      if (!isNumOrNull(cost.wasteFactor)) {
        at(`${q}.cost.wasteFactor`, "number or null");
      }
    }

    // schedule
    const sched = sku.schedule;
    if (!sched || typeof sched !== "object") {
      at(`${q}.schedule`, "required object");
    } else if (!Array.isArray(sched.report)) {
      at(`${q}.schedule.report`, "required array");
    } else {
      for (const m of sched.report) {
        if (!SCHEDULE_MEASURES.includes(m)) {
          at(`${q}.schedule.report`, `unknown measure ${m}`);
        }
      }
      for (const m of REQUIRED_MEASURES[sku.category] || []) {
        if (!sched.report.includes(m)) {
          at(`${q}.schedule.report`, `category ${sku.category} must report ${m}`);
        }
      }
    }

    // drawing
    const draw = sku.drawing;
    if (!draw || typeof draw !== "object") {
      at(`${q}.drawing`, "required object");
    } else if (!COLOUR_CLASSES.includes(draw.colourClass)) {
      at(`${q}.drawing.colourClass`, `unknown colour class ${JSON.stringify(draw.colourClass)}`);
    }

    // compliance
    const comp = sku.compliance;
    const facts = complianceFactsFor(sku.category);
    if (facts.length && (!comp || typeof comp !== "object")) {
      at(`${q}.compliance`, "required object");
    } else if (comp) {
      for (const key of Object.keys(comp)) {
        if (!facts.includes(key)) {
          at(`${q}.compliance.${key}`, `not a compliance fact for category ${sku.category}`);
        }
      }
      for (const key of facts) {
        if (!(key in comp)) {
          at(`${q}.compliance.${key}`, "must be present (use null if unknown)");
        } else if (comp[key] === null) {
          warnings.push(`${q}.compliance.${key}: unknown, firm must supply`);
        }
      }
      if ("heatSource" in comp && !VALID_HEAT_SOURCES.includes(comp.heatSource)) {
        at(`${q}.compliance.heatSource`, `must be one of ${VALID_HEAT_SOURCES.join(", ")}`);
      }
      if ("dischargeType" in comp && !VALID_DISCHARGE.includes(comp.dischargeType)) {
        at(`${q}.compliance.dischargeType`, `must be one of ${VALID_DISCHARGE.join(", ")}`);
      }
      for (const key of ["plastered", "rendered", "cavity", "loadBearing", "sealed", "underlay",
        "radiantBarrier", "compressible", "suspended", "exposed", "external", "providesLight",
        "providesVentilation", "safetyGlazed", "solidRisers", "winders", "requiresGully",
        "requiresVent"]) {
        if (key in comp && !isBoolOrNull(comp[key])) {
          at(`${q}.compliance.${key}`, "boolean or null");
        }
      }
    }

    if (sku.defaultLevel && !levelIds.has(sku.defaultLevel)) {
      at(`${q}.defaultLevel`, `unknown level ${sku.defaultLevel}`);
    }
  });

  // --- referential integrity ---------------------------------------------
  const known = (id) => ids.has(id);
  for (const key of ["defaultWallSku", "defaultFloorSku", "defaultFoundationSku", "defaultRoofSku",
    "defaultCeilingSku"]) {
    const v = sys?.[key];
    if (v && !known(v)) at(`system.${key}`, `unknown SKU ${v}`);
  }

  const recipes = pack.recipes || {};
  (recipes.requires || []).forEach((rule, i) => {
    if (!known(rule.whenSku)) at(`recipes.requires[${i}].whenSku`, `unknown SKU ${rule.whenSku}`);
    if (!known(rule.addSku)) at(`recipes.requires[${i}].addSku`, `unknown SKU ${rule.addSku}`);
    if (!["wallLength", "roomArea", "roomPerimeter", "count"].includes(rule.per)) {
      at(`recipes.requires[${i}].per`, `unknown driver ${rule.per}`);
    }
  });
  for (const [skuId, hosts] of Object.entries(recipes.allowedHosts || {})) {
    if (!known(skuId)) at(`recipes.allowedHosts.${skuId}`, "unknown SKU");
    for (const h of hosts) {
      if (!known(h)) at(`recipes.allowedHosts.${skuId}`, `unknown host SKU ${h}`);
    }
  }
  for (const group of ["maxSpan", "minLength"]) {
    for (const [skuId, v] of Object.entries(recipes[group] || {})) {
      if (!known(skuId)) at(`recipes.${group}.${skuId}`, "unknown SKU");
      if (!isNum(v)) at(`recipes.${group}.${skuId}`, "required number");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Every compliance fact that is null, grouped for the firm to fill in. */
export function complianceGaps(pack) {
  const gaps = [];
  for (const sku of pack.skus || []) {
    const missing = Object.entries(sku.compliance || {})
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    if (missing.length) {
      gaps.push({ id: sku.id, name: sku.name, category: sku.category, missing });
    }
  }
  return gaps;
}
