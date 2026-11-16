// Material takeoff: the bricks, cement, sand and stone a builder orders,
// read off compile()'s measured rows. See MATERIALS-TAKEOFF-BRIEF.md.
//
// A method reads a compiled row's measures and never the geometry, so the
// same method can later run on a hand-entered quantity. The figures it
// multiplies by are published data, each tied to the document it came from.
// Two bodies publish them and disagree; both are carried and the job picks.
// A figure a source does not state is null, and the line says what is
// missing instead of counting it (PHILOSOPHY.md).

/** Mortar joint the published brick figures assume, metres. */
const JOINT = 0.01;

/** How far (core + joint) / (brick + joint) may sit from a whole number of leaves. */
const LEAF_TOLERANCE = 0.1;

export const BRICKS = {
  "222x106x73": { label: "Imperial 222 × 106 × 73 mm", width: 0.106 },
  "290x140x90": { label: "Maxi 290 × 140 × 90 mm", width: 0.14 },
};

export const MASONRY_SOURCES = {
  cba: {
    name: "Clay Brick Association",
    cite: "Clay Bricklaying Made Easy ch. 21 (110 bricks per m² of 220 mm wall); Building Contractors Pocket Handbook (Class II mortar: 3 bags cement + 0.6 m³ sand per 1 000 bricks)",
    bricks: {
      "222x106x73": {
        perM2ByLeaves: { 2: 110 },
        missing: { 1: "gives 52–56 bricks per m² for a single leaf, a range rather than a figure" },
        mortarPer1000: { cement: 3, sand: 0.6 },
      },
    },
  },
  cssa: {
    name: "Concrete Society of Southern Africa",
    cite: "Quantities for ordering building materials (2024), Table 3 (per leaf, 10 mm joints, no waste, collar joint not counted) and Table 2 (Class II mortar: 7 bags cement + 1.35 m³ sand per m³)",
    bricks: {
      "222x106x73": { perLeafM2: 52, mortarM3Per1000: 0.34 },
      "290x140x90": { perLeafM2: 34, mortarM3Per1000: 0.56 },
    },
    mortarMix: { cement: 7, sand: 1.35 },
  },
};

export const STRENGTHS = {
  low: "Low strength",
  medium: "Medium strength",
  high: "High strength",
};

const cssaTable = (table, cement, stone, mixes) => ({
  name: `Concrete Society of Southern Africa, Table ${table} (${cement} cement, ${stone} stone)`,
  cite: `Quantities for ordering building materials (2024), Table ${table}, per m³ of concrete, no waste`,
  stone,
  mixes,
});

export const CONCRETE_SOURCES = {
  cba: {
    name: "Clay Brick Association",
    cite: "Building Contractors Pocket Handbook, concrete mixes per m³ (low and medium strength only)",
    stone: null,
    mixes: {
      low: { cement: 5.5, sand: 0.75, stone: 0.75 },
      medium: { cement: 7, sand: 0.7, stone: 0.7 },
    },
  },
  "cssa-1a": cssaTable("1a", "32,5", "19 mm", {
    low: { cement: 5.8, sand: 0.65, stone: 0.65 },
    medium: { cement: 7.7, sand: 0.62, stone: 0.62 },
    high: { cement: 9.2, sand: 0.6, stone: 0.6 },
  }),
  "cssa-1b": cssaTable("1b", "32,5", "13,2 mm", {
    low: { cement: 6.1, sand: 0.8, stone: 0.5 },
    medium: { cement: 8.4, sand: 0.68, stone: 0.54 },
    high: { cement: 10.2, sand: 0.66, stone: 0.5 },
  }),
  "cssa-1c": cssaTable("1c", "42,5", "19 mm", {
    low: { cement: 5.1, sand: 0.67, stone: 0.67 },
    medium: { cement: 6.6, sand: 0.64, stone: 0.64 },
    high: { cement: 7.8, sand: 0.62, stone: 0.62 },
  }),
  "cssa-1d": cssaTable("1d", "42,5", "13,2 mm", {
    low: { cement: 5.4, sand: 0.79, stone: 0.53 },
    medium: { cement: 7.1, sand: 0.69, stone: 0.58 },
    high: { cement: 8.4, sand: 0.67, stone: 0.55 },
  }),
};

const WASTE_KEYS = ["bricks", "mortar", "concrete"];

function pick(value, table) {
  return typeof value === "string" && Object.hasOwn(table, value) ? value : null;
}

function fraction(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

/** The job's material choices, every unstated one null. */
export function normalizeMaterialSettings(raw) {
  const strength = {};
  if (raw?.concreteStrength && typeof raw.concreteStrength === "object") {
    for (const [sku, value] of Object.entries(raw.concreteStrength)) {
      if (pick(value, STRENGTHS)) strength[sku] = value;
    }
  }
  const waste = {};
  for (const key of WASTE_KEYS) waste[key] = fraction(raw?.waste?.[key]);
  return {
    masonrySource: pick(raw?.masonrySource, MASONRY_SOURCES),
    concreteSource: pick(raw?.concreteSource, CONCRETE_SOURCES),
    brick: pick(raw?.brick, BRICKS),
    concreteStrength: strength,
    waste,
  };
}

/** The job-wide choices in one line, for the BOM to say what it counted by.
 *  An unmade choice says so rather than disappearing from the line. */
export function materialSummary(raw) {
  const s = normalizeMaterialSettings(raw);
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  const waste = WASTE_KEYS.map((key) => `${key} ${s.waste[key] === null ? "not stated" : pct(s.waste[key])}`);
  return [
    s.masonrySource ? `Bricks and mortar per ${MASONRY_SOURCES[s.masonrySource].name}` : "Bricks and mortar source not chosen",
    s.brick ? BRICKS[s.brick].label : "Brick not chosen",
    s.concreteSource ? `Concrete per ${CONCRETE_SOURCES[s.concreteSource].name}` : "Concrete source not chosen",
    `Waste: ${waste.join(", ")}`,
  ].join(" · ");
}

/** Whole leaves of `brick` in a wall core, or null when the core does not divide into them. */
export function leavesFor(coreThickness, brick) {
  const width = BRICKS[brick]?.width;
  if (!(coreThickness > 0) || !width) return null;
  const ratio = (coreThickness + JOINT) / (width + JOINT);
  const leaves = Math.round(ratio);
  return leaves >= 1 && Math.abs(ratio - leaves) <= LEAF_TOLERANCE ? leaves : null;
}

/** Bricks per m² of wall face, or `{ value: null, why }` when the source states none. */
export function bricksPerM2(sourceId, brick, leaves) {
  const figures = MASONRY_SOURCES[sourceId]?.bricks?.[brick];
  if (!figures) return { value: null, why: `states no figures for ${BRICKS[brick]?.label || brick} bricks` };
  if (figures.perLeafM2) return { value: figures.perLeafM2 * leaves, why: null };
  const value = figures.perM2ByLeaves?.[leaves];
  if (value) return { value, why: null };
  return { value: null, why: figures.missing?.[leaves] || `states no figure for a ${leaves}-leaf wall` };
}

/** Cement (bags) and sand (m³) to lay `bricks`, by the source's own route. */
function mortarFor(sourceId, brick, bricks) {
  const source = MASONRY_SOURCES[sourceId];
  const figures = source.bricks[brick];
  if (figures.mortarPer1000) {
    return { cement: (bricks / 1000) * figures.mortarPer1000.cement, sand: (bricks / 1000) * figures.mortarPer1000.sand };
  }
  const volume = (bricks / 1000) * figures.mortarM3Per1000;
  return { cement: volume * source.mortarMix.cement, sand: volume * source.mortarMix.sand };
}

function skuFor(pack, id) {
  return (pack?.skus || []).find((s) => s.id === id) || null;
}

function isMasonry(sku) {
  return (sku?.category === "wall" || sku?.category === "foundation") && sku.drawing?.colourClass === "masonry";
}

function isConcreteFoundation(sku) {
  return sku?.category === "foundation" && sku.drawing?.colourClass === "concrete";
}

function element(row, measure) {
  return {
    id: row.elementId,
    kind: row.kind ?? null,
    level: row.level ?? null,
    status: row.status ?? null,
    length: row.length || 0,
    area: measure === "area" ? row.faceArea || 0 : 0,
    volume: measure === "volume" ? row.volume || 0 : 0,
    count: 1,
  };
}

function line(model, description, unit, wasteKey) {
  return { model, description, unit, wasteKey, qty: 0, elements: [], counted: false };
}

function orderOf(qty, unit, waste) {
  if (waste === null) return null;
  const raw = qty * (1 + waste);
  if (unit === "m3") return Math.ceil(raw * 100 - 1e-9) / 100;
  return Math.ceil(raw - 1e-9);
}

/**
 * The materials behind what was drawn. `rows` are BOM lines (category
 * "Materials"); `gaps` say what stopped a quantity being counted, and a line
 * that is missing part of its quantity carries `incomplete`.
 */
export function materialTakeoff(compiled, pack, rawSettings) {
  const settings = normalizeMaterialSettings(rawSettings);
  const gaps = [];
  const instances = compiled?.instances || [];

  const masonryRows = [];
  const concreteRows = [];
  for (const row of instances) {
    const sku = skuFor(pack, row.model);
    if (isMasonry(sku) && Number.isFinite(row.faceArea)) masonryRows.push({ row, sku });
    else if (isConcreteFoundation(sku) && row.volume > 0) concreteRows.push({ row, sku });
  }

  const lines = [];

  if (masonryRows.length) {
    const source = MASONRY_SOURCES[settings.masonrySource];
    const brick = settings.brick;
    if (!source) gaps.push("Pick a source for bricks and mortar to count them.");
    if (!brick) gaps.push("Pick the brick the walls are built in to count them.");
    if (source && brick) {
      const by = ` (${source.name})`;
      const bricks = line(`MAT-BRICK-${brick}`, `Bricks ${BRICKS[brick].label.replace(/^\S+ /, "")}${by}`, "ea", "bricks");
      const cement = line("MAT-MORTAR-CEMENT", `Common cement, 50 kg, Class II mortar${by}`, "bags", "mortar");
      const sand = line("MAT-MORTAR-SAND", `Building sand, Class II mortar${by}`, "m3", "mortar");
      const skipped = new Map();
      for (const { row, sku } of masonryRows) {
        const leaves = leavesFor(row.coreThickness, brick);
        const per = leaves ? bricksPerM2(settings.masonrySource, brick, leaves) : null;
        if (!per?.value) {
          const why = leaves
            ? `${source.name} ${per.why}`
            : `a ${Math.round((row.coreThickness || 0) * 1000)} mm core is not a whole number of ${BRICKS[brick].label} leaves`;
          const key = `${sku.name}|${why}`;
          skipped.set(key, { name: sku.name, why, n: (skipped.get(key)?.n || 0) + 1 });
          continue;
        }
        const n = row.faceArea * per.value;
        const mortar = mortarFor(settings.masonrySource, brick, n);
        for (const [target, qty] of [[bricks, n], [cement, mortar.cement], [sand, mortar.sand]]) {
          target.qty += qty;
          target.counted = true;
          target.elements.push(element(row, "area"));
        }
      }
      for (const { name, why, n } of skipped.values()) {
        gaps.push(`${n} × ${name} not counted: ${why}.`);
      }
      for (const target of [bricks, cement, sand]) {
        if (skipped.size) target.incomplete = true;
        lines.push(target);
      }
    }
  }

  if (concreteRows.length) {
    const source = CONCRETE_SOURCES[settings.concreteSource];
    if (!source) gaps.push("Pick a source for concrete to count cement, sand and stone.");
    const unstated = [...new Set(concreteRows
      .filter(({ sku }) => !settings.concreteStrength[sku.id])
      .map(({ sku }) => sku.name))];
    for (const name of unstated) gaps.push(`State the concrete strength for ${name}.`);
    if (source) {
      const by = ` (${source.name})`;
      const cement = line("MAT-CONCRETE-CEMENT", `Common cement, 50 kg, concrete${by}`, "bags", "concrete");
      const sand = line("MAT-CONCRETE-SAND", `Concrete sand${by}`, "m3", "concrete");
      const stone = line("MAT-CONCRETE-STONE", `Stone${source.stone ? ` ${source.stone}` : ""}${by}`, "m3", "concrete");
      let missing = unstated.length > 0;
      const noMix = new Set();
      for (const { row, sku } of concreteRows) {
        const strength = settings.concreteStrength[sku.id];
        if (!strength) continue;
        const mix = source.mixes[strength];
        if (!mix) {
          noMix.add(`${source.name} states no ${STRENGTHS[strength].toLowerCase()} mix, so ${sku.name} is not counted.`);
          missing = true;
          continue;
        }
        for (const [target, per] of [[cement, mix.cement], [sand, mix.sand], [stone, mix.stone]]) {
          target.qty += row.volume * per;
          target.counted = true;
          target.elements.push(element(row, "volume"));
        }
      }
      gaps.push(...noMix);
      for (const target of [cement, sand, stone]) {
        if (missing) target.incomplete = true;
        lines.push(target);
      }
    }
  }

  const noWaste = new Set();
  const rows = lines.map(({ wasteKey, counted, ...rest }) => {
    const waste = settings.waste[wasteKey];
    if (counted && waste === null) noWaste.add(wasteKey);
    const description = rest.incomplete ? `${rest.description}, part only: see the notes above` : rest.description;
    return {
      ...rest,
      description,
      category: "Materials",
      family: "",
      type: description,
      material: true,
      qty: counted ? rest.qty : null,
      orderQty: counted ? orderOf(rest.qty, rest.unit, waste) : null,
      count: rest.elements.length,
    };
  });
  if (noWaste.size) {
    gaps.push(`No waste allowance for ${[...noWaste].join(", ")}, so the order quantity is blank.`);
  }
  return { rows, gaps, settings };
}

/** Concrete types the drawing uses, for a strength picker per type. */
export function concreteTypesUsed(compiled, pack) {
  const seen = new Map();
  for (const row of compiled?.instances || []) {
    const sku = skuFor(pack, row.model);
    if (isConcreteFoundation(sku) && row.volume > 0) seen.set(sku.id, sku.name);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}
