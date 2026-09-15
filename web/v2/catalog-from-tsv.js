// Turn Revit's family report (Category / Family / Type / Kind / Placed) into an
// sp.catalog/1 document.
//
// That report is all we have until someone runs Export Catalog in Revit, and it
// carries names and counts but no parameters or materials. The output therefore
// has empty typeParams, which is honest: build-pack.js falls back to parsing the
// firm's dimensional type names and reports everything it had to assume.
//
//   node web/v2/catalog-from-tsv.js ../samples/tsp-template-families.tsv

import { readFileSync, writeFileSync } from "node:fs";

/**
 * The family report lists Levels as an annotation category with a placed count,
 * never names or elevations, so real storeys are not recoverable from it. A
 * placed cast-in-place stair is direct evidence of a second storey though, and
 * the level switcher is unusable to test with only one level on offer. This is
 * therefore a placeholder pending Export Catalog, clearly labelled "inferred"
 * in both the level names and the build report, never presented as fact.
 */
function inferLevels(types) {
  const hasStair = types.some((t) => t.category === "Stairs" && t.placedCount > 0);
  if (!hasStair) {
    return { levels: [{ id: "01 GFL", name: "Ground floor", elevation: 0 }], inferred: false };
  }
  return {
    levels: [
      { id: "01 GFL", name: "Ground floor (inferred)", elevation: 0 },
      { id: "02 FFL", name: "First floor (inferred)", elevation: 2.8 },
    ],
    inferred: true,
  };
}

export function catalogFromTsv(text, { title = "TSP template (family report)" } = {}) {
  const types = [];
  let n = 0;

  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.startsWith("#")) continue;
    const [category, family, type, kind, placed] = row.split("\t");
    if (!category || !type) continue;
    types.push({
      id: `tsv-${++n}`,
      category: category.trim(),
      builtInCategory: "",
      family: (family || "").trim(),
      type: type.trim(),
      kind: (kind || "Component").trim(),
      placedCount: Number(placed) || 0,
      structureWidth: null,
      layers: [],
      materials: [],
      typeParams: {},
      instanceParams: {},
    });
  }

  const { levels, inferred } = inferLevels(types);

  return {
    schema: "sp.catalog/1",
    title,
    path: "(family report transcription)",
    extractedAt: new Date().toISOString(),
    // Matches the real Export Catalog output's convention (see
    // Models/TypeCatalogPayload.cs's units note) even though this placeholder
    // catalog carries no typeParams to actually convert.
    units: "millimeters (lengths, widths, structure) / meters (level elevations)",
    levels,
    levelsInferred: inferred,
    types,
    titleBlocks: [],
    views: [],
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath) {
    console.error("usage: node catalog-from-tsv.js <families.tsv> [catalog.json]");
    process.exit(1);
  }
  const catalog = catalogFromTsv(readFileSync(inPath, "utf8"));
  const target = outPath || inPath.replace(/\.tsv$/, "-catalog.json");
  writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`wrote ${target}: ${catalog.types.length} types, ${catalog.levels.length} levels`);
  if (catalog.levelsInferred) {
    console.log('  levels are INFERRED from a placed stair, not read from the template - confirm with Export Catalog');
  }
}
