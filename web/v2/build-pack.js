// Build a v2 SKU pack from a raw Revit type catalog (sp.catalog/1).
//
// The add-in's Export Catalog button dumps the firm's template verbatim; this
// file owns every judgement about what becomes a SKU, so the mapping can be
// tested without Revit and reviewed without reading C#.
//
// Three rules, inherited from migrate-pack.js:
//   1. Compliance facts are only ever derived from what the template states.
//      Everything else is null and lands in the gap report.
//   2. Dimensions may fall back to the type name or a category default, because
//      the schema requires them, but every fallback is reported as assumed.
//   3. A Revit category we do not map is reported, never silently dropped.
//
//   node web/v2/build-pack.js ../../output/type-catalog.json ../samples/tsp-pack.json

import { readFileSync, writeFileSync } from "node:fs";
import {
  complianceFactsFor,
  REQUIRED_MEASURES,
  requiredGeometryFor,
  validatePack,
  complianceGaps,
} from "./schema.js";

// --- category mapping ------------------------------------------------------

// Revit category -> our category, or a function when the type name decides.
const CATEGORY_MAP = {
  Walls: (t) => {
    const n = `${t.family} ${t.type}`.toLowerCase();
    if (n.includes("foundation")) return "foundation";
    if (n.includes("boundary")) return "boundarywall";
    return "wall";
  },
  "Structural Foundations": "foundation",
  Floors: "floor",
  Ceilings: "ceiling",
  Roofs: "roof",
  Doors: "door",
  Windows: "window",
  "Structural Framing": "beam",
  "Structural Columns": "column",
  Columns: "column",
  Stairs: "stair",
  "Plumbing Fixtures": (t) => {
    const n = `${t.family} ${t.type}`.toLowerCase();
    if (n.includes("pipe") || n.includes("supply line")) return "drainage";
    return "sanitary";
  },
  "Electrical Fixtures": (t) => {
    const n = `${t.family} ${t.type}`.toLowerCase();
    if (n.includes("geyser")) return "waterheater";
    return "electrical";
  },
  "Electrical Equipment": "electrical",
  "Lighting Fixtures": "electrical",
  Furniture: "furniture",
  "Furniture Systems": "furniture",
  Casework: "casework",
  "Specialty Equipment": "casework",
  "Curtain Wall Panels": "wall",
};

// Categories the template carries that are deliberately not SKUs. Listed so the
// report can say "known and excluded" rather than "unmapped".
const EXCLUDED = new Set([
  "Railings", "Balusters", "Top Rails", "Handrails", "Supports", "Runs", "Landings",
  "Treads/Risers", "Cut Marks", "Stair Paths", "Stair Tread/Riser Numbers",
  "Toposolid", "Property Lines", "Mass", "Mass Floors", "Mass Roof", "Mass Walls",
  "Mass Shade", "Mass Opening", "Mass Windows and Skylights",
  "Conduits", "Conduit Fittings", "Conduit Standards", "Cable Trays", "Cable Tray Fittings",
  "Ducts", "Duct Fittings", "Duct Systems", "Duct Insulations", "Duct Linings", "Flex Ducts",
  "Pipes", "Pipe Fittings", "Pipe Insulations", "Pipe Materials", "Pipe Schedules",
  "Pipe Connections", "Piping Systems", "Flex Pipes", "Fluids",
  "Wires", "Wire Insulations", "Wire Materials", "Wire Temperature Ratings",
  "Voltages", "Distribution Systems", "Mechanical Equipment Sets",
  "Curtain Systems", "Curtain Panels", "Division Rules", "Raster Images",
  "Generic Models", "Profiles", "Reveals", "Wall Sweeps", "Fascias", "Gutters",
  "Roof Soffits", "Slab Edges", "Stacked Walls", "Cover Type",
  "Structural Beam Systems", "Structural Connections", "Structural Fabric Areas",
  "Structural Fabric Reinforcement", "Structural Rebar Bending Details", "Ramps",
]);

const DRAW_BY_CATEGORY = {
  wall: "wall", boundarywall: "wall", foundation: "wall",
  floor: "fill", pool: "fill", ceiling: "fill", roof: "roof",
  door: "door", window: "window", beam: "beam", column: "beam",
  stair: "stair", drainage: "pipe", carport: "roof",
  sanitary: "box", waterheater: "box", electrical: "point",
  furniture: "box", casework: "box",
};

const UNIT_BY_CATEGORY = {
  wall: "m3", boundarywall: "m3", foundation: "m3", floor: "m2", ceiling: "m2",
  roof: "m2", pool: "m2", carport: "m2", beam: "m", column: "m", drainage: "m",
};

// --- colour notation -------------------------------------------------------

const MATERIAL_PATTERNS = [
  [/concrete|screed|cast.?in.?place|precast/i, "concrete"],
  [/brick|masonry|masonary|block|plaster/i, "masonry"],
  [/timber|wood|pine|meranti|hardboard/i, "timber"],
  [/steel|metal|aluminium|aluminum|galvani/i, "steel"],
  [/glass|glazing|glazed/i, "glass"],
];

const COLOUR_BY_CATEGORY = {
  wall: "masonry", boundarywall: "masonry", foundation: "concrete",
  floor: "concrete", ceiling: "other", roof: "concrete", beam: "concrete",
  column: "concrete", stair: "concrete", window: "glass", door: "other",
  drainage: "drain", sanitary: "other", waterheater: "other",
  electrical: "other", furniture: "other", casework: "timber",
  pool: "concrete", carport: "other",
};

function colourClassFor(type, category) {
  const haystack = [...(type.materials || []), type.family, type.type].join(" ");
  for (const [pattern, cls] of MATERIAL_PATTERNS) {
    if (pattern.test(haystack)) return cls;
  }
  return COLOUR_BY_CATEGORY[category] || "other";
}

// --- dimensions ------------------------------------------------------------

// Revit parameter names to try, in order, per geometry key.
const PARAM_ALIASES = {
  thickness: ["Thickness", "Default Thickness", "Structural Thickness"],
  width: ["Width", "Rough Width", "b", "Foundation Width"],
  height: ["Height", "Rough Height", "Unconnected Height", "h", "Foundation Thickness"],
  depth: ["Depth", "Foundation Thickness", "d"],
  sill: ["Sill Height", "Default Sill Height"],
  diameter: ["Diameter", "Nominal Diameter", "Outside Diameter"],
  riser: ["Actual Riser Height", "Maximum Riser Height"],
  going: ["Actual Tread Depth", "Minimum Tread Depth", "Tread Depth"],
};

// Used only where nothing in the template states a value. Every one of these is
// reported, so a wrong default gets queried rather than shipped silently.
// Millimetres, matching the geometry block's units (see schema.js's units note).
const DEFAULTS = {
  wall: { height: 2800, thickness: 220 },
  boundarywall: { height: 1800, thickness: 220 },
  foundation: { thickness: 200, width: 600, depth: 200 },
  floor: { thickness: 170 },
  ceiling: { thickness: 9 },
  roof: { thickness: 125 },
  door: { width: 900, height: 2100 },
  window: { width: 900, height: 900, sill: 900 },
  beam: { width: 220, height: 300 },
  column: { width: 450, depth: 450 },
  stair: { width: 900, riser: 175, going: 250 },
  drainage: { diameter: 110 },
  sanitary: { width: 600, depth: 400, height: 400 },
  waterheater: { width: 600, depth: 600, height: 1500 },
  electrical: { width: 86, depth: 86, height: 86 },
  furniture: { width: 600, depth: 600, height: 750 },
  casework: { width: 600, depth: 600, height: 900 },
  pool: { depth: 1500 },
  carport: { height: 2400 },
};

// Categories whose type names are dimensional by convention. Electrical point
// families are excluded: "TSP 16x3 SWA Elect Feeder Cable" is a cable spec, not
// a footprint, and parsing it would put nonsense in the pack.
const NAME_DIMS_OK = new Set([
  "wall", "boundarywall", "foundation", "floor", "ceiling", "roof",
  "door", "window", "beam", "column", "drainage", "sanitary", "casework",
]);

const PAIR = /(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*[x×X]\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?/;
const SINGLE = /(\d+(?:[.,]\d+)?)\s*mm/;
const DIA = /(\d+(?:[.,]\d+)?)\s*(?:dia|Ø)/i;

// The type name already states millimetres, matching the geometry block's own
// units (see schema.js's units note) - no conversion needed, just parse the number.
function parseMm(value) {
  return Math.round(Number(String(value).replace(",", ".")));
}

/** Dimensions the firm encoded in the type name, e.g. "900 x 2100mm". */
function nameDims(name) {
  const dia = DIA.exec(name);
  if (dia) return { diameter: parseMm(dia[1]) };
  const pair = PAIR.exec(name);
  if (pair) return { a: parseMm(pair[1]), b: parseMm(pair[2]) };
  const single = SINGLE.exec(name);
  if (single) return { single: parseMm(single[1]) };
  return {};
}

function paramLookup(type, key) {
  for (const alias of PARAM_ALIASES[key] || []) {
    const fromType = type.typeParams?.[alias];
    if (Number.isFinite(fromType) && fromType > 0) return fromType;
    const fromInstance = type.instanceParams?.[alias];
    if (Number.isFinite(fromInstance) && fromInstance > 0) return fromInstance;
  }
  return null;
}

function geometryFor(type, category, assumed) {
  const keys = requiredGeometryFor(category);
  const name = `${type.family} ${type.type}`;
  const dims = NAME_DIMS_OK.has(category) ? nameDims(name) : {};
  const out = {};

  for (const key of keys) {
    const fromParam = paramLookup(type, key);
    if (fromParam !== null) {
      out[key] = Math.round(fromParam);
      continue;
    }

    if (key === "thickness" && Number.isFinite(type.structureWidth) && type.structureWidth > 0) {
      out[key] = type.structureWidth;
      continue;
    }
    if (key === "diameter" && dims.diameter) {
      out[key] = dims.diameter;
      continue;
    }
    // A "900 x 2100mm" pair is width then height for an opening, width then
    // depth for anything that sits on the floor.
    if (dims.a !== undefined) {
      if (key === "width") { out[key] = dims.a; continue; }
      if (key === "height" && (category === "door" || category === "window")) { out[key] = dims.b; continue; }
      if (key === "depth" && category !== "door" && category !== "window") { out[key] = dims.b; continue; }
      // A strip footing is as thick as it is deep: "600X200" is width by depth.
      if (key === "thickness" && category === "foundation") { out[key] = dims.b; continue; }
    }
    if (dims.single !== undefined && (key === "thickness" || key === "diameter")) {
      out[key] = dims.single;
      continue;
    }

    const fallback = DEFAULTS[category]?.[key];
    if (fallback !== undefined) {
      out[key] = fallback;
      assumed.push({ id: type.id, name, key, value: fallback });
    }
  }

  return out;
}

// --- compliance ------------------------------------------------------------

function complianceFor(type, category, notes) {
  const facts = complianceFactsFor(category);
  const out = {};
  for (const key of facts) out[key] = null;
  const name = `${type.family} ${type.type}`;
  const lower = name.toLowerCase();
  const note = (field, reason) => notes.push({ id: type.id, name, field, reason });

  if ("plastered" in out) {
    if (lower.includes("no-plaster") || lower.includes("no plaster")) {
      out.plastered = false;
      note("compliance.plastered", 'type name states "no-plaster"');
    } else if (lower.includes("plaster")) {
      out.plastered = true;
      note("compliance.plastered", 'type name contains "plaster"');
    }
  }
  if ("cavity" in out && lower.includes("cavity")) {
    out.cavity = true;
    note("compliance.cavity", 'type name contains "cavity"');
  }
  if (category === "foundation") {
    out.loadBearing = true;
    note("compliance.loadBearing", "a foundation is load bearing by definition");
  }
  if (category === "window") {
    out.providesLight = true;
    note("compliance.providesLight", "glazed fenestration admits light");
    // Part O counts openable area, so a fixed pane is worth nothing here. The
    // firm's own family naming is the only evidence we will act on.
    if (/fixed/i.test(name)) {
      out.providesVentilation = false;
      out.openableAreaFraction = 0;
      note("compliance.providesVentilation", 'family name contains "Fixed", a fixed pane does not open');
    } else if (/casement|awning|top.?hung|side.?hung|sliding|pivot/i.test(name)) {
      out.providesVentilation = true;
      note("compliance.providesVentilation", "family name states an opening action; openable fraction still unknown");
    }
  }
  if (category === "door") {
    out.providesVentilation = true;
    const sliding = /sliding|pocket/i.test(name);
    out.openableAreaFraction = sliding ? 0.5 : 1;
    note("compliance.openableAreaFraction", sliding
      ? "a sliding or pocket leaf clears half its opening"
      : "a hinged leaf clears its full opening");
  }
  if (category === "sanitary") {
    if (/\bwc\b|toilet|closed couple/i.test(name)) {
      out.dischargeType = "soil";
      out.requiresGully = false;
      note("compliance.dischargeType", "a WC discharges soil water direct to the soil pipe");
    } else if (/basin|sink|bath|shower|washing machine|dishwasher/i.test(name)) {
      out.dischargeType = "waste";
      out.requiresGully = true;
      note("compliance.dischargeType", "a waste fixture discharges through a trapped gully");
    }
  }
  if (category === "waterheater") {
    const litres = /(\d{2,4})\s*l\b/i.exec(name);
    if (litres) {
      out.capacityLitres = Number(litres[1]);
      note("compliance.capacityLitres", `type name states ${litres[1]} litres`);
    }
    if (/solar/i.test(name)) {
      out.heatSource = "solar";
      note("compliance.heatSource", 'type name contains "Solar"');
    } else if (/electr/i.test(name)) {
      out.heatSource = "resistance";
      note("compliance.heatSource", 'type name contains "Electrical"');
    }
  }
  return out;
}

// --- ids and names ---------------------------------------------------------

const ID_PREFIX = {
  wall: "WAL", boundarywall: "BND", foundation: "FND", floor: "FLR", ceiling: "CLG",
  roof: "ROF", door: "DOR", window: "WIN", beam: "BEA", column: "COL", stair: "STR",
  sanitary: "SAN", waterheater: "GEY", drainage: "DRN", electrical: "ELE",
  furniture: "FUR", casework: "CAS", pool: "POL", carport: "CAR",
};

function slug(text) {
  return String(text)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
}

function makeId(type, category, taken) {
  const base = `TSP_${ID_PREFIX[category] || "GEN"}_${slug(type.type || type.family)}`;
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

// A system family name like "Basic Wall" or "Floor" carries no information, so
// the type name alone is the display name.
const GENERIC_FAMILIES = new Set(["Basic Wall", "Floor", "Basic Roof", "Compound Ceiling",
  "Basic Ceiling", "Wall Foundation", "Foundation Slab", "Stair", "Cast-In-Place Stair"]);

function displayName(type) {
  if (!type.family || GENERIC_FAMILIES.has(type.family)) return type.type;
  if (type.type === type.family) return type.type;
  if (/^(standard|default)$/i.test(type.type)) return type.family;
  return `${type.family} — ${type.type}`;
}

// --- build -----------------------------------------------------------------

export function buildPack(catalog, { includeUnplaced = false, id, name, version } = {}) {
  const notes = [];
  const assumed = [];
  const skipped = new Map();
  const taken = new Set();

  const candidates = (catalog.types || []).filter((t) => includeUnplaced || t.placedCount > 0);

  const skus = [];
  for (const type of candidates) {
    const mapping = CATEGORY_MAP[type.category];
    if (!mapping) {
      const bucket = EXCLUDED.has(type.category) ? "excluded" : "unmapped";
      const key = `${bucket}:${type.category}`;
      skipped.set(key, (skipped.get(key) || 0) + 1);
      continue;
    }
    const category = typeof mapping === "function" ? mapping(type) : mapping;

    skus.push({
      id: makeId(type, category, taken),
      name: displayName(type),
      family: type.family || undefined,
      category,
      unit: UNIT_BY_CATEGORY[category] || "ea",
      draw: DRAW_BY_CATEGORY[category] || "box",
      revit: { category: type.category, family: type.family, type: type.type, placedCount: type.placedCount },
      geometry: geometryFor(type, category, assumed),
      cost: { rateRef: null, wasteFactor: null },
      compliance: complianceFor(type, category, notes),
      drawing: { colourClass: colourClassFor(type, category), hatch: null, symbol: null },
      schedule: { report: [...(REQUIRED_MEASURES[category] || ["count"])], scheduleName: null },
    });
  }

  const levels = buildLevels(catalog, notes);
  const system = buildSystem(skus, levels);

  return {
    pack: {
      schema: "sp.pack/3",
      id: id || "tsp-template",
      name: name || catalog.title || "TSP template",
      version: version || "2.1.0",
      revision: new Date().toISOString().slice(0, 10),
      builtFrom: { schema: catalog.schema, title: catalog.title, extractedAt: catalog.extractedAt },
      locale: { country: "ZA", municipality: null, energyZone: null },
      system,
      levels,
      skus,
      recipes: buildRecipes(skus),
    },
    notes,
    assumed,
    skipped,
  };
}

/**
 * A placed ceiling's "Height Offset From Level" is the firm's own storey
 * height once you know which level it is hosted on. Grouped by level name so
 * a storey with several ceiling types placed averages to one number.
 */
function ceilingOffsetsByLevel(catalog) {
  const byLevel = new Map();
  for (const type of catalog.types || []) {
    if (type.category !== "Ceilings" || !(type.placedCount > 0)) continue;
    const offsetMm = type.instanceParams?.["Height Offset From Level"];
    if (!Number.isFinite(offsetMm) || offsetMm <= 0 || !type.instanceLevel) continue;
    if (!byLevel.has(type.instanceLevel)) byLevel.set(type.instanceLevel, []);
    // The catalog states every length-typed instance param in millimetres (see
    // schema.js's units note), but `floorToCeiling` is a level field and those
    // stay metres - a position in the plan's coordinate space, not a named
    // dimension - so this is the one place that converts back.
    byLevel.get(type.instanceLevel).push(offsetMm / 1000);
  }
  return byLevel;
}

function average(values) {
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
}

/** The offset value placed most often across all levels, for storeys the template has no ceiling on. */
function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function buildLevels(catalog, notes) {
  const source = (catalog.levels || []).filter((l) => Number.isFinite(l.elevation));
  if (!source.length) {
    return [{ id: "01 GFL", name: "Ground floor", elevation: 0, floorToFloor: 2.8, floorToCeiling: null }];
  }

  const offsetsByLevel = ceilingOffsetsByLevel(catalog);
  const allOffsets = [...offsetsByLevel.values()].flat();
  const fallback = allOffsets.length ? mostCommon(allOffsets) : null;

  return source.map((level, i) => {
    const next = source[i + 1];
    const id = level.name || level.id;
    const measured = offsetsByLevel.get(id);

    let floorToCeiling = null;
    if (measured?.length) {
      floorToCeiling = average(measured);
      notes.push({
        id, name: id, field: "floorToCeiling",
        reason: `Ceilings "Height Offset From Level" measured on this level (${measured.length} instance${measured.length > 1 ? "s" : ""})`,
      });
    } else if (fallback !== null) {
      floorToCeiling = fallback;
      notes.push({
        id, name: id, field: "floorToCeiling",
        reason: `no ceiling placed on this level; assumed the ${fallback}m offset measured elsewhere in the template`,
      });
    }

    return {
      id,
      name: id,
      elevation: level.elevation,
      floorToFloor: next ? Number((next.elevation - level.elevation).toFixed(4)) : 2.8,
      floorToCeiling,
    };
  });
}

/** The most-used type in a category is the firm's own default. */
function mostPlaced(skus, category) {
  return skus
    .filter((s) => s.category === category)
    .sort((a, b) => (b.revit?.placedCount || 0) - (a.revit?.placedCount || 0))[0]?.id ?? null;
}

/**
 * The level the app opens on and stamps new objects with when none is chosen.
 * `levels[0]` (physically lowest) is wrong once a foundation level exists: its
 * elevation is below the datum by construction, so picking it as "default"
 * would put ordinary walls, rooms and ceilings underground unless the user
 * remembers to switch first - the exact "level switcher left on the wrong
 * storey" failure mode. Elevation >= 0 is a physical fact the template states
 * (a foundation level's whole purpose is to sit below datum), not a guess
 * about naming, so it is safe to use as the tie-breaker.
 */
function defaultLevelId(levels) {
  const atOrAboveDatum = levels.find((l) => l.elevation >= 0);
  return (atOrAboveDatum ?? levels[0])?.id ?? null;
}

function buildSystem(skus, levels) {
  const defaultWall = mostPlaced(skus, "wall");
  // Millimetres - matches geometry.height, since this is that same value promoted
  // to a document-wide default (see schema.js's units note and walls.js's
  // `sku.geometry.height ?? pack.system.wallHeight` fallback, which needs both
  // sides in the same unit).
  const wallHeight = skus.find((s) => s.id === defaultWall)?.geometry?.height ?? 2800;
  return {
    wallHeight,
    defaultWallSku: defaultWall,
    defaultFloorSku: mostPlaced(skus, "floor"),
    defaultFoundationSku: mostPlaced(skus, "foundation"),
    defaultRoofSku: mostPlaced(skus, "roof"),
    defaultCeilingSku: mostPlaced(skus, "ceiling"),
    defaultLevel: defaultLevelId(levels),
  };
}

/**
 * Openings host in any wall thick enough to take them, and every wall gets its
 * foundation. Both are structural facts of the catalog, not design choices, so
 * they can be generated; anything judgemental stays out.
 */
function buildRecipes(skus) {
  const walls = skus.filter((s) => s.category === "wall" || s.category === "boundarywall");
  const foundation = mostPlaced(skus, "foundation");
  const allowedHosts = {};

  for (const sku of skus) {
    if (sku.category !== "door" && sku.category !== "window") continue;
    const hosts = walls
      .filter((w) => (w.geometry.thickness || 0) >= (sku.geometry.depth || 100) - 1)
      .map((w) => w.id);
    if (hosts.length && hosts.length < walls.length) allowedHosts[sku.id] = hosts;
  }

  const requires = foundation
    ? walls
        .filter((w) => w.category === "wall" && !/foundation/i.test(w.name))
        .map((w) => ({ whenSku: w.id, addSku: foundation, per: "wallLength" }))
    : [];

  return { requires, allowedHosts, maxSpan: {}, minLength: {} };
}

// --- CLI -------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const [, , inPath, outPath, ...flags] = process.argv;
  if (!inPath) {
    console.error("usage: node build-pack.js <type-catalog.json> [pack.json] [--all]");
    process.exit(1);
  }

  const catalog = JSON.parse(readFileSync(inPath, "utf8"));
  const { pack, notes, assumed, skipped } = buildPack(catalog, { includeUnplaced: flags.includes("--all") });
  const result = validatePack(pack);

  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`);
    console.log(`wrote ${outPath}`);
  }

  const byCategory = new Map();
  for (const sku of pack.skus) byCategory.set(sku.category, (byCategory.get(sku.category) || 0) + 1);

  console.log(`\nSKUs built: ${pack.skus.length} from ${catalog.types?.length ?? 0} template types`);
  console.log([...byCategory].sort().map(([c, n]) => `  ${c.padEnd(14)} ${n}`).join("\n"));
  console.log(`\nLevels: ${pack.levels.map((l) => l.name).join(", ")}${catalog.levelsInferred ? " (INFERRED - confirm with Export Catalog)" : ""}`);
  console.log(`\nValidation: ${result.ok ? "PASS" : "FAIL"}`);
  for (const err of result.errors) console.log(`  ERROR  ${err}`);

  const unmapped = [...skipped].filter(([k]) => k.startsWith("unmapped:"));
  if (unmapped.length) {
    console.log(`\nUnmapped Revit categories (${unmapped.length}) - decide whether these are SKUs:`);
    for (const [key, n] of unmapped) console.log(`  ${key.slice(9).padEnd(30)} ${n} placed types`);
  }

  console.log(`\nDerived from the template, confirm each (${notes.length}):`);
  for (const row of notes.slice(0, 40)) {
    console.log(`  ${row.name.slice(0, 44).padEnd(46)} ${row.field.padEnd(32)} ${row.reason}`);
  }
  if (notes.length > 40) console.log(`  … ${notes.length - 40} more`);

  console.log(`\nDimensions assumed, the template states no value (${assumed.length}):`);
  const assumedByKey = new Map();
  for (const row of assumed) {
    const key = `${row.key} = ${row.value}`;
    if (!assumedByKey.has(key)) assumedByKey.set(key, []);
    assumedByKey.get(key).push(row.name);
  }
  for (const [key, names] of assumedByKey) {
    console.log(`  ${key.padEnd(22)} ${names.length} SKUs, e.g. ${names[0]}`);
  }

  const gaps = complianceGaps(pack);
  const totalMissing = gaps.reduce((s, g) => s + g.missing.length, 0);
  console.log(`\nCompliance facts the firm must supply: ${totalMissing} across ${gaps.length} SKUs`);
}
