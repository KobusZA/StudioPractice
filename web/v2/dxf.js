// Export a v2 document as a DXF drawing Revit can insert with no add-in.
//
// File → Open will not load this — that command only lists Revit projects, the
// same trap as IFC. What Revit *will* do, with no extra software, is
// Insert → Link CAD / Import CAD on a DXF. The result is 2D linework the user
// traces in their own template, not native walls. That is the cost of a format
// Autodesk's importer already understands; we do not pretend it is a .rvt.
//
// Geometry comes from compile() so wall lengths and opening positions match the
// BOQ. Coordinates are millimetres with $INSUNITS=4, because a metric Revit
// template that auto-detects units will otherwise read a 6 m wall as 6 mm.
// Canvas +y is screen-down; DXF +Y is north, so y is negated on the way out
// (the same flip ifc.js makes).

import { compile } from "./compile.js";
import { skuById } from "./openings.js";

const MM = 1000;

function mm(metres) {
  return Number.isFinite(metres) ? metres * MM : 0;
}

function flip(point) {
  return [point[0], -point[1]];
}

function layerName(kind, levelName) {
  const level = String(levelName || "LEVEL")
    .replace(/[<>/\\":;?*|=,`]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return `${kind}-${level}`;
}

function dxfString(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").slice(0, 250);
}

class DxfFile {
  constructor() {
    this.layers = new Map();
    this.entities = [];
  }

  layer(name, color = 7) {
    if (!this.layers.has(name)) this.layers.set(name, color);
    return name;
  }

  push(pairs) {
    for (const [code, value] of pairs) {
      this.entities.push(String(code), String(value));
    }
  }

  lwpoly(layer, points, { closed = true } = {}) {
    if (!points.length) return;
    this.layer(layer);
    this.push([
      [0, "LWPOLYLINE"],
      [8, layer],
      [90, points.length],
      [70, closed ? 1 : 0],
    ]);
    for (const [x, y] of points) {
      this.push([[10, x.toFixed(3)], [20, y.toFixed(3)]]);
    }
  }

  line(layer, a, b) {
    this.layer(layer);
    this.push([
      [0, "LINE"],
      [8, layer],
      [10, a[0].toFixed(3)],
      [20, a[1].toFixed(3)],
      [11, b[0].toFixed(3)],
      [21, b[1].toFixed(3)],
    ]);
  }

  arc(layer, cx, cy, radius, startDeg, endDeg) {
    if (!(radius > 0)) return;
    this.layer(layer);
    this.push([
      [0, "ARC"],
      [8, layer],
      [10, cx.toFixed(3)],
      [20, cy.toFixed(3)],
      [40, radius.toFixed(3)],
      [50, startDeg.toFixed(3)],
      [51, endDeg.toFixed(3)],
    ]);
  }

  text(layer, x, y, height, value) {
    const label = dxfString(value);
    if (!label) return;
    this.layer(layer, 2);
    this.push([
      [0, "TEXT"],
      [8, layer],
      [10, x.toFixed(3)],
      [20, y.toFixed(3)],
      [40, height.toFixed(3)],
      [1, label],
    ]);
  }

  toString() {
    const tables = [];
    tables.push("0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(this.layers.size + 1));
    tables.push("0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS");
    for (const [name, color] of this.layers) {
      tables.push("0", "LAYER", "2", name, "70", "0", "62", String(color), "6", "CONTINUOUS");
    }
    tables.push("0", "ENDTAB", "0", "ENDSEC");

    return [
      "0", "SECTION",
      "2", "HEADER",
      "9", "$ACADVER",
      "1", "AC1015",
      "9", "$INSUNITS",
      "70", "4",
      "9", "$MEASUREMENT",
      "70", "1",
      "0", "ENDSEC",
      ...tables,
      "0", "SECTION",
      "2", "ENTITIES",
      ...this.entities,
      "0", "ENDSEC",
      "0", "EOF",
      "",
    ].join("\n");
  }
}

function wallFootprint(curve, thickness) {
  const [x1, y1] = flip(curve.start);
  const [x2, y2] = flip(curve.end);
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (!(len > 1e-9) || !(thickness > 0)) return null;
  const nx = (-(y2 - y1) / len) * (thickness / 2);
  const ny = ((x2 - x1) / len) * (thickness / 2);
  return {
    length: len,
    mid: [(x1 + x2) / 2, (y1 + y2) / 2],
    poly: [
      [x1 + nx, y1 + ny],
      [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny],
      [x1 - nx, y1 - ny],
    ].map(([x, y]) => [mm(x), mm(y)]),
  };
}

function toMmPts(points) {
  return points.map((p) => {
    const [x, y] = flip(p);
    return [mm(x), mm(y)];
  });
}

function atanDeg(cx, cy, x, y) {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}

/**
 * @returns {{ text: string, fileName: string, report: object }} or `null`
 */
export function exportDxf(doc, pack) {
  const out = compile(doc, pack);
  if (!out) return null;

  const report = {
    counts: { levels: 0, walls: 0, doors: 0, windows: 0, rooms: 0 },
    skipped: [],
    notExported: [
      ["floors and slabs", (doc?.slabs || []).length],
      ["roofs", (doc?.roofs || []).length],
      ["beams", (doc?.beams || []).length],
      ["stairs", (doc?.stairs || []).length],
      ["placed items", (doc?.items || []).length],
    ].filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`),
    warnings: [
      ...(out.warnings || []),
      "This is a 2D CAD drawing, not a Revit model. Walls, doors and rooms arrive as linework to trace, not as native elements.",
    ],
  };

  const formsById = new Map((out.sketchForms || []).map((f) => [f.elementId, f]));
  const rowsById = new Map((out.instances || []).map((row) => [row.elementId, row]));
  const levelNameOf = (id) => (pack.levels || []).find((l) => l.id === id)?.name || id || "LEVEL";

  const dxf = new DxfFile();
  report.counts.levels = (pack.levels || []).length;

  for (const wall of out.walls || []) {
    const sku = skuById(pack, wall.sku);
    const form = formsById.get(wall.id);
    const curve = form?.profileLoops?.[0]?.curves?.[0];
    const label = sku?.name || wall.sku || wall.id;
    if (!curve) {
      report.skipped.push(`Wall "${label}" has no drawn line and was left out.`);
      continue;
    }
    const footprint = wallFootprint(curve, wall.thickness);
    if (!footprint) {
      report.skipped.push(`Wall "${label}" has no thickness or length, so no outline could be written.`);
      continue;
    }
    const layer = layerName("A-WALL", levelNameOf(wall.level));
    dxf.lwpoly(layer, footprint.poly, { closed: true });
    dxf.text(
      layerName("A-ANNO", levelNameOf(wall.level)),
      mm(footprint.mid[0]),
      mm(footprint.mid[1]),
      150,
      label,
    );
    report.counts.walls += 1;
  }

  for (const opening of doc?.openings || []) {
    const form = formsById.get(opening.id);
    const row = rowsById.get(opening.id);
    if (!form || !row) continue;
    const sku = skuById(pack, opening.sku);
    const label = sku?.name || opening.sku || opening.id;
    const curve = form.profileLoops?.[0]?.curves?.[0];
    const width = form.profileLoops?.[0]?.length ?? 0;
    if (!curve || !(width > 1e-6)) {
      report.skipped.push(`${label} states no width, so no CAD opening was written.`);
      continue;
    }
    const hostLevel = (out.walls || []).find((w) => w.id === row.hostWallId)?.level;
    const isWindow = sku?.category === "window";
    const layer = layerName(isWindow ? "A-WIND" : "A-DOOR", levelNameOf(hostLevel));
    const a = toMmPts([curve.start])[0];
    const b = toMmPts([curve.end])[0];
    dxf.line(layer, a, b);

    const arc = (form.profileLoops?.[0]?.curves || []).find((c) => c.kind === "Arc");
    if (arc && !isWindow) {
      const hinge = a;
      const leaf = toMmPts([arc.end])[0];
      const radius = Math.hypot(b[0] - hinge[0], b[1] - hinge[1]);
      dxf.line(layer, hinge, leaf);
      dxf.arc(layer, hinge[0], hinge[1], radius, atanDeg(hinge[0], hinge[1], b[0], b[1]), atanDeg(hinge[0], hinge[1], leaf[0], leaf[1]));
    }

    dxf.text(layerName("A-ANNO", levelNameOf(hostLevel)), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 120, label);
    if (isWindow) report.counts.windows += 1;
    else report.counts.doors += 1;
  }

  for (const room of out.rooms || []) {
    const form = formsById.get(room.id);
    const loop = form?.profileLoops?.[0]?.curves || [];
    if (loop.length < 3) {
      report.skipped.push(`Room "${room.name || room.id}" has no closed outline and was left out.`);
      continue;
    }
    const layer = layerName("A-ROOM", levelNameOf(room.level));
    const pts = toMmPts(loop.map((c) => c.start));
    dxf.lwpoly(layer, pts, { closed: true });
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    dxf.text(layerName("A-ANNO", levelNameOf(room.level)), cx, cy, 200, room.name || room.id);
    report.counts.rooms += 1;
  }

  const base = (pack?.name || "plan").replace(/[^\w\-. ]+/g, "").trim() || "plan";
  return { text: dxf.toString(), fileName: `${base}.dxf`, report };
}
