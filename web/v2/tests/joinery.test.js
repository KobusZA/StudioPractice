import { test } from "node:test";
import assert from "node:assert/strict";

import { buildPack } from "../build-pack.js";
import { catalogFromTsv } from "../catalog-from-tsv.js";
import { readFileSync } from "node:fs";
import {
  JOINERY_SKUS,
  applyJoineryEdit,
  commitJoineryRun,
  elevationJoinery,
  furnitureCrossesWall,
  furnitureIsRug,
  furnitureOverlapsRect,
  joineryDashed,
  joineryDepth,
  joineryDepthGaps,
  joineryDraftAt,
  joineryHandlePoints,
  joineryHeights,
  joineryIsRun,
  joineryLabel,
  joineryPolygon,
  joinerySideGaps,
  mergeJoinerySkus,
  rehostJoineryAfterSplit,
  slideJoineryRun,
  stretchJoineryDepth,
  stretchJoineryRun,
} from "../joinery.js";
import { wallFootprint } from "../drawing-defaults.js";
import { elevationSvg } from "../wall-elevation-render.js";
import { compile } from "../compile.js";
import { normalizePackUnits, validatePack } from "../schema.js";

const tsv = readFileSync(new URL("../../samples/tsp-template-families.tsv", import.meta.url), "utf8");
const { pack: rawPack } = buildPack(catalogFromTsv(tsv));
const pack = normalizePackUnits(rawPack);

function wall(id = "w1") {
  return { id, drawn: true, x1: 0, y1: 0, x2: 4, y2: 0, length: 4, thickness: 0.22, height: 2.7, level: "01 GFL" };
}

function sku(id) {
  return pack.skus.find((s) => s.id === id);
}

test("joinery types validate and fill an empty furniture list", () => {
  const result = validatePack(rawPack);
  assert.deepEqual(result.errors, []);
  assert.ok(sku("TSP_CAS_BIC"));
  assert.ok(sku("TSP_CAS_KU_WALL"));
  assert.ok(sku("TSP_FUR_BED_QUEEN"));
  assert.equal(sku("TSP_CAS_BIC").drawing.colourClass, "timber");
  assert.equal(sku("TSP_FUR_SOFA").category, "furniture");
  assert.equal(sku("TSP_FUR_SOFA").name, "Sofa, 3-seat");
  assert.equal(sku("TSP_FUR_BED_QUEEN").drawing.plan, "bed");
  assert.equal(sku("TSP_FUR_TABLE").drawing.plan, "dining-6");
  assert.equal(sku("TSP_FUR_TABLE").geometry.width, 2.6);
  assert.equal(sku("TSP_FUR_FRIDGE").drawing.plan, "fridge");
  assert.equal(sku("TSP_FUR_DESK").drawing.plan, "desk");
  assert.equal(furnitureIsRug(sku("TSP_FUR_RUG_SQ_24")), true);
  assert.equal(furnitureIsRug(sku("TSP_FUR_RUG_RD_18")), true);
  assert.equal(furnitureIsRug(sku("TSP_FUR_BED_QUEEN")), false);
  assert.equal(sku("TSP_FUR_RUG_RD_18").geometry.width, 1.8);
});

test("merging twice does not duplicate", () => {
  const once = mergeJoinerySkus({ skus: [{ id: "TSP_CAS_600MM", category: "casework" }] });
  const twice = mergeJoinerySkus(once);
  assert.equal(twice.skus.filter((s) => s.id === "TSP_CAS_BIC").length, 1);
  assert.equal(twice.skus.length, once.skus.length);
});

test("a BIC is a floor-standing run; a wall unit is dashed; an island is not a run", () => {
  assert.equal(joineryIsRun(sku("TSP_CAS_BIC")), true);
  assert.equal(joineryDashed(sku("TSP_CAS_BIC")), false);
  assert.equal(joineryLabel(sku("TSP_CAS_BIC")), "BIC");
  assert.equal(joineryIsRun(sku("TSP_CAS_KU_WALL")), true);
  assert.equal(joineryDashed(sku("TSP_CAS_KU_WALL")), true);
  assert.equal(joineryIsRun(sku("TSP_CAS_KU_ISLAND")), false);
  assert.equal(joineryIsRun(sku("TSP_FUR_BED_QUEEN")), false);
});

test("a click on a wall drafts a run, and two stations make a footprint into the room", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const draft = joineryDraftAt([w], bic, 1, 0.2);
  assert.equal(draft.wallId, "w1");
  assert.equal(draft.side, 1);
  const item = commitJoineryRun({ sku: bic, start: draft, endT: 0.5, wall: w, status: "planned", level: "01 GFL", id: "i1" });
  assert.equal(item.host, "joinery");
  assert.ok(item.t1 - item.t0 > 0.2);
  const poly = joineryPolygon(item, bic, w);
  assert.equal(poly.length, 4);
  const depths = poly.map((p) => p[1]);
  assert.ok(Math.max(...depths) > 0.5);
  assert.equal(item.bottom, 0);
  assert.equal(item.top, null);
});

test("a wall unit sits off the floor; a kitchen base sits on it", () => {
  const wallU = sku("TSP_CAS_KU_WALL");
  const base = sku("TSP_CAS_KU_BASE");
  const hung = joineryHeights({}, wallU, 2.7);
  assert.equal(hung.bottom, 1.5);
  assert.ok(Math.abs(hung.top - 2.22) < 1e-6);
  const floor = joineryHeights({}, base, 2.7);
  assert.equal(floor.bottom, 0);
  assert.ok(Math.abs(floor.top - 0.9) < 1e-6);
});

test("a click far from any wall does not draft a cupboard", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  assert.equal(joineryDraftAt([w], bic, 2, 4), null);
  assert.ok(joineryDraftAt([w], bic, 1, 0.1));
});

test("sliding a run keeps its length and stays on the wall", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0.1, side: 1 }, endT: 0.4, wall: w, id: "i1" });
  const span = item.t1 - item.t0;
  slideJoineryRun(item, w, bic, 3, 0.2);
  assert.ok(Math.abs((item.t1 - item.t0) - span) < 1e-6);
  assert.ok(item.t1 <= 1);
  assert.ok(item.t0 >= 0);
});

test("stretching an end changes the length and keeps the other station", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0.2, side: 1 }, endT: 0.5, wall: w, id: "i1" });
  const kept = item.t0;
  stretchJoineryRun(item, w, bic, "end", 3.2, 0.2);
  assert.equal(item.t0, kept);
  assert.ok(Math.abs(item.t1 - 0.8) < 0.02);
  const handles = joineryHandlePoints(item, bic, w);
  assert.equal(handles.length, 3);
  assert.deepEqual(handles.map((h) => h.end), ["start", "end", "depth"]);
});

test("stretching an end with no tolerance tracks the pointer exactly, same as before", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0, side: 1 }, endT: 0.3, wall: w, id: "i1" });
  stretchJoineryRun(item, w, bic, "end", 0.899, 0);
  assert.ok(Math.abs(item.t1 * w.length - 0.899) < 1e-6);
});

test("stretching an end with a tolerance pulls the length onto a round millimetre", () => {
  // The reported bug: dragging to 899 mm landed off-grid instead of
  // snapping onto 900 mm the way a wall does while it is drawn.
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0, side: 1 }, endT: 0.3, wall: w, id: "i1" });
  stretchJoineryRun(item, w, bic, "end", 0.899, 0, 0.01);
  assert.ok(Math.abs(item.t1 * w.length - 0.9) < 1e-6);
  // The fixed end never moves.
  assert.equal(item.t0, 0);
});

test("stretching the start end keeps the far station fixed while the length snaps", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0.5, side: 1 }, endT: 0.8, wall: w, id: "i1" });
  const kept = item.t1;
  stretchJoineryRun(item, w, bic, "start", kept * w.length - 0.899, 0, 0.01);
  assert.equal(item.t1, kept);
  assert.ok(Math.abs((kept - item.t0) * w.length - 0.9) < 1e-6);
});

test("the depth magnet pulls a dragged face onto a round millimetre too", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0.1, side: 1 }, endT: 0.4, wall: w, id: "i1" });
  // y is measured from the wall centreline; half the 0.22 m thickness (0.11)
  // is the face the cupboard actually stands off, so y = 0.899 + 0.11 puts
  // the raw depth (before snapping) at 899 mm.
  stretchJoineryDepth(item, w, bic, 2, 0.899 + w.thickness / 2, 0.01);
  assert.ok(Math.abs(item.depth - 0.9) < 1e-6);
});

test("side gaps measure the run and the leftover to each wall end", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0.25, side: 1 }, endT: 0.5, wall: w, id: "i1" });
  const gaps = joinerySideGaps(w, item);
  assert.equal(gaps.length, 3);
  assert.ok(Math.abs(Math.hypot(gaps[0].x2 - gaps[0].x1, gaps[0].y2 - gaps[0].y1) - 1) < 1e-6);
  assert.ok(gaps[1].own);
  assert.ok(Math.abs(Math.hypot(gaps[1].x2 - gaps[1].x1, gaps[1].y2 - gaps[1].y1) - 1) < 1e-6);
  assert.ok(Math.abs(Math.hypot(gaps[2].x2 - gaps[2].x1, gaps[2].y2 - gaps[2].y1) - 2) < 1e-6);
});

test("depth gaps run from the wall face out into the room", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0.25, side: 1 }, endT: 0.5, wall: w, id: "i1" });
  const depths = joineryDepthGaps(item, bic, w);
  assert.equal(depths.length, 2);
  for (const gap of depths) {
    assert.ok(Math.abs(Math.hypot(gap.x2 - gap.x1, gap.y2 - gap.y1) - 0.6) < 1e-6);
    assert.ok(Math.abs(gap.x2 - gap.x1) < 1e-6);
    assert.ok(gap.y2 > gap.y1);
  }
});

test("depth can be typed or dragged, and stays on the item", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0.1, side: 1 }, endT: 0.4, wall: w, id: "i1" });
  assert.ok(Math.abs(joineryDepth(item, bic) - 0.6) < 1e-6);
  applyJoineryEdit(item, bic, w, { depth: 0.45 }, w.height);
  assert.ok(Math.abs(item.depth - 0.45) < 1e-6);
  stretchJoineryDepth(item, w, bic, 2, 1.0);
  assert.ok(item.depth > 0.7);
});

test("a typed bottom and top stay on the item, and the elevation lists the run on that face", () => {
  const w = wall();
  const ku = sku("TSP_CAS_KU_BASE");
  const item = commitJoineryRun({ sku: ku, start: { t: 0.1, side: 1 }, endT: 0.4, wall: w, id: "i1" });
  applyJoineryEdit(item, ku, w, { bottom: 0, top: 0.9 }, w.height);
  const doc = { items: [item] };
  const rows = elevationJoinery(doc, pack, w, 1, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "KU");
  assert.equal(rows[0].dashed, false);
  assert.ok(Math.abs(rows[0].bottom) < 1e-9);
  assert.ok(Math.abs(rows[0].top - 0.9) < 1e-9);
  const otherFace = elevationJoinery(doc, pack, w, -1, false);
  assert.equal(otherFace.length, 0);
});

test("splitting the wall keeps the run on the piece it sits on", () => {
  const item = { host: "joinery", wallId: "head", t0: 0.6, t1: 0.9, side: 1 };
  const doc = { items: [item] };
  rehostJoineryAfterSplit(doc, "head", "tail", 2, 4);
  assert.equal(item.wallId, "tail");
  assert.ok(item.t0 >= 0 && item.t1 <= 1);
});

test("the dishwasher already in the template is not replaced", () => {
  assert.equal(JOINERY_SKUS.some((s) => s.id === "TSP_CAS_600MM"), false);
  assert.ok(rawPack.skus.some((s) => s.id === "TSP_CAS_600MM"));
});

test("the elevation drawing paints a BIC as a timber band, and a wall unit dashed", () => {
  const w = wall();
  const bic = sku("TSP_CAS_BIC");
  const item = commitJoineryRun({ sku: bic, start: { t: 0.1, side: 1 }, endT: 0.4, wall: w, id: "i1" });
  const rows = elevationJoinery({ items: [item] }, pack, w, 1, false);
  const drawn = elevationSvg({
    length: 4, height: 2.7, top: 2.7, base: 0, levels: [], openings: [], finishBands: [], foundations: [],
    joinery: rows,
  }, { width: 240, height: 160, selectedId: "i1" });
  assert.ok(drawn.svg.includes("elev-joinery"));
  assert.ok(drawn.svg.includes("BIC"));
  assert.equal(drawn.svg.includes("stroke-dasharray"), false);

  const hung = commitJoineryRun({
    sku: sku("TSP_CAS_KU_WALL"), start: { t: 0.1, side: 1 }, endT: 0.3, wall: w, id: "i2",
  });
  const wallRows = elevationJoinery({ items: [hung] }, pack, w, 1, false);
  const wallDrawn = elevationSvg({
    length: 4, height: 2.7, top: 2.7, base: 0, levels: [], openings: [], finishBands: [], foundations: [],
    joinery: wallRows,
  }, { width: 240, height: 160 });
  assert.ok(wallDrawn.svg.includes("stroke-dasharray"));
  assert.ok(wallDrawn.svg.includes("KU"));
});

test("a kitchen run reports its length on the takeoff", () => {
  const w = wall();
  const ku = sku("TSP_CAS_KU_BASE");
  const item = commitJoineryRun({ sku: ku, start: { t: 0, side: 1 }, endT: 0.5, wall: w, id: "i1" });
  const wallSku = pack.skus.find((s) => s.category === "wall");
  const doc = {
    schema: "sp.doc/1",
    items: [item],
    segments: [{ id: "w1", sku: wallSku.id, level: "01 GFL", x1: 0, y1: 0, x2: 4, y2: 0 }],
    openings: [],
    rooms: [],
    slabs: [],
  };
  const payload = compile(doc, pack);
  const row = payload.instances.find((r) => r.elementId === "i1");
  assert.ok(row);
  assert.ok(Math.abs((row.length || 0) - 2) < 1e-6);
});

test("furniture that cuts a wall overlaps it, and a piece flush with the face does not", () => {
  const poly = wallFootprint({ x1: 0, y1: 0, x2: 4, y2: 0, thickness: 0.22 }).map((p) => [p.x, p.y]);
  assert.equal(furnitureCrossesWall({ x: 1, y: 0.2, w: 1.6, h: 2 }, [poly]), false);
  assert.equal(furnitureCrossesWall({ x: 1, y: 0.11, w: 1.6, h: 2 }, [poly]), false);
  assert.equal(furnitureCrossesWall({ x: 1, y: -0.05, w: 1.6, h: 2 }, [poly]), true);
});

test("furniture that cuts another piece overlaps it, and pieces that only touch do not", () => {
  const bed = { x: 1, y: 1, w: 1.6, h: 2 };
  assert.equal(furnitureOverlapsRect(bed, { x: 2, y: 2, w: 2, h: 0.9 }), true);
  assert.equal(furnitureOverlapsRect(bed, { x: 3, y: 1, w: 2, h: 0.9 }), false);
});
