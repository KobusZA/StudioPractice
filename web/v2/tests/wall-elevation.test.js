// Phase C: the wall elevation model and the edits made from it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import { deriveWalls } from "../walls.js";
import { createFinishRun } from "../finish-model.js";
import { addFoundationUnderWall, alignOutlineShift, applyOpeningEdit, applyTypedGap, applyWallTopEdit, axisAlignedOutline, dropGuideZ, elevationModel, faceRefForSelection, foundationTypes, includeDropGuide, maxTypedGap, openingSnapEdges, resizeOpeningCorner, snapElevation, translateOutlineEdge } from "../wall-elevation.js";
import { elevationSvg } from "../wall-elevation-render.js";

test("a guideline is measured down from the top of the wall and is a snap target", () => {
  assert.equal(dropGuideZ(2.4, 750), 1.65);
  assert.equal(dropGuideZ(2.4, 0), null);
  assert.equal(dropGuideZ(2.4, 3000), null);
  assert.deepEqual(includeDropGuide([0, 2.4], 1.65), [0, 2.4, 1.65]);
  const drawn = elevationSvg({
    length: 4, height: 2.4, top: 2.4, base: 0, levels: [], openings: [], finishBands: [], foundations: [],
  }, { width: 240, height: 160, dropGuide: 1.65 });
  assert.ok(drawn.svg.includes("elev-drop-guide"));
  assert.ok(drawn.svg.includes("750 mm down"));
});

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

function drawnDoc(openings = []) {
  return normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "01 GFL", x1: 0, y1: 0, x2: 6, y2: 0 }],
    openings,
  });
}

test("the model gives the face's length, base, top and its openings", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const m = elevationModel(doc, pack, { wallId: "w1", side: 1 });
  assert.equal(m.length, 6);
  assert.equal(m.top - m.base, m.height);
  assert.ok(m.height > 0);
  assert.equal(m.openings.length, 1);
  const o = m.openings[0];
  assert.equal(o.width, 1.2);
  assert.equal(o.height, 1.2);
  assert.equal(o.sill, 0.9);
  assert.ok(Math.abs(o.offset - 2.4) < 1e-9);
  assert.ok(m.levels.length >= 1);
});

test("the other side mirrors offsets", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.25 }]);
  const a = elevationModel(doc, pack, { wallId: "w1", side: 1 }).openings[0];
  const b = elevationModel(doc, pack, { wallId: "w1", side: -1 }).openings[0];
  assert.ok(Math.abs(a.offset + b.offset + a.width - 6) < 1e-9);
});

test("an opening's own size and sill show in the model", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5, width: 1.5, sill: 1.1 }]);
  const o = elevationModel(doc, pack, { wallId: "w1" }).openings[0];
  assert.equal(o.width, 1.5);
  assert.equal(o.sill, 1.1);
  assert.equal(o.nonStandard, true);
});

test("a foundation on this line is drawn below the wall, and the other side mirrors it", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc();
  doc.segments.push({
    id: "f1", sku: "TSP_CON052", level: "01 GFL",
    x1: 1, y1: 0, x2: 4, y2: 0, baseOffset: -0.6,
  });
  doc.segments.push({
    id: "aside", sku: "TSP_CON052", level: "01 GFL",
    x1: 0, y1: 2, x2: 6, y2: 2, baseOffset: -0.6,
  });
  doc.segments.push({
    id: "past", sku: "TSP_CON052", level: "01 GFL",
    x1: 7, y1: 0, x2: 9, y2: 0, baseOffset: -0.6,
  });
  const face = elevationModel(doc, pack, { wallId: "w1", side: 1 });
  assert.equal(face.foundations.length, 1);
  assert.equal(face.foundationOffer, null);
  const foot = face.foundations[0];
  assert.equal(foot.id, "f1");
  assert.ok(Math.abs(foot.from - 1) < 1e-9);
  assert.ok(Math.abs(foot.to - 4) < 1e-9);
  assert.ok(Math.abs(foot.base - -0.6) < 1e-9);
  assert.ok(Math.abs(foot.top) < 1e-9);
  assert.ok(Math.abs(foot.depth - 0.6) < 1e-9);
  const back = elevationModel(doc, pack, { wallId: "w1", side: -1 });
  assert.ok(Math.abs(back.foundations[0].from - 2) < 1e-9);
  assert.ok(Math.abs(back.foundations[0].to - 5) < 1e-9);
  const bare = elevationModel(drawnDoc(), pack, { wallId: "w1" });
  assert.equal(bare.foundations.length, 0);
  const svg = elevationSvg(face, { width: 640, height: 280, interactive: true });
  assert.match(svg.svg, /data-elev-foundation="f1"/);
  assert.match(svg.svg, /1 foundation below/);
  assert.doesNotMatch(svg.svg, /data-elev-add-foundation/);
  assert.equal(bare.foundationOffer?.skuId, "TSP_CON052");
  assert.doesNotMatch(elevationSvg(bare, { width: 640, height: 280 }).svg, /elev-foundation/);
});

test("a bare ground-floor wall can gain the default foundation under it", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc();
  const bare = elevationModel(doc, pack, { wallId: "w1" });
  assert.ok(Math.abs(bare.foundationOffer.depth - 0.6) < 1e-9);
  assert.ok(Math.abs(bare.foundationOffer.base - -0.6) < 1e-9);
  assert.ok(Math.abs(bare.foundationOffer.top) < 1e-9);
  const open = elevationSvg(bare, { width: 640, height: 280, interactive: true });
  assert.match(open.svg, /data-elev-add-foundation="1"/);
  assert.match(open.svg, /\+ Foundation/);
  const picking = elevationSvg(bare, { width: 640, height: 280, interactive: true, foundationPicking: true });
  assert.match(picking.svg, /600/);
  assert.doesNotMatch(picking.svg, /\+ Foundation/);
  const added = addFoundationUnderWall(doc, pack, { wallId: "w1" });
  assert.equal(added.name, bare.foundationOffer.name);
  const seg = doc.segments.find((s) => s.id === added.id);
  assert.equal(seg.sku, "TSP_CON052");
  assert.equal(seg.level, "01 GFL");
  assert.ok(Math.abs(seg.baseOffset - -0.6) < 1e-9);
  assert.equal(seg.x1, 0);
  assert.equal(seg.x2, 6);
  const faced = elevationModel(doc, pack, { wallId: "w1" });
  assert.equal(faced.foundationOffer, null);
  assert.equal(faced.foundations.length, 1);
  assert.ok(Math.abs(faced.foundations[0].from) < 1e-9);
  assert.ok(Math.abs(faced.foundations[0].to - 6) < 1e-9);
  assert.ok(Math.abs(faced.foundations[0].base - -0.6) < 1e-9);
  assert.equal(addFoundationUnderWall(doc, pack, { wallId: "w1" }), null);
});

test("the elevation can preview and place a chosen foundation type", () => {
  const doc = drawnDoc();
  const types = foundationTypes(pack);
  assert.ok(types.some((t) => t.id === "TSP_CON052"));
  assert.ok(types.some((t) => t.id === "TSP_EW132"));
  const alt = {
    ...pack,
    skus: pack.skus.map((s) => (s.id === "TSP_EW132"
      ? { ...s, geometry: { ...s.geometry, height: 0.4 } }
      : s)),
  };
  const preview = elevationModel(doc, alt, { wallId: "w1" }, null, "TSP_EW132");
  assert.equal(preview.foundationOffer.skuId, "TSP_EW132");
  assert.equal(preview.foundationOffer.name, "Masonry 220mm foundation (no plaster)");
  assert.ok(Math.abs(preview.foundationOffer.depth - 0.4) < 1e-9);
  assert.ok(Math.abs(preview.foundationOffer.base - -0.4) < 1e-9);
  const added = addFoundationUnderWall(doc, alt, { wallId: "w1" }, null, "TSP_EW132");
  const seg = doc.segments.find((s) => s.id === added.id);
  assert.equal(seg.sku, "TSP_EW132");
  assert.ok(Math.abs(seg.baseOffset - -0.4) < 1e-9);
  const unknown = elevationModel(drawnDoc(), pack, { wallId: "w1" }, null, "not-a-foundation");
  assert.equal(unknown.foundationOffer.skuId, "TSP_CON052");
});

test("a wall that starts on the next floor is not offered a foundation", () => {
  const doc = normalizeDoc({
    segments: [{ id: "w1", sku: "TSP_MAS009", level: "02 L1", x1: 0, y1: 0, x2: 6, y2: 0 }],
  });
  const m = elevationModel(doc, pack, { wallId: "w1" });
  assert.equal(m.foundationOffer, null);
  assert.equal(addFoundationUnderWall(doc, pack, { wallId: "w1" }), null);
  assert.equal(doc.segments.length, 1);
});

test("the new footing is filed on the foundation storey when the pack has one", () => {
  const doc = drawnDoc();
  const withHome = {
    ...pack,
    levels: [{ id: "00 FND", name: "00 FND", elevation: -0.6 }, ...pack.levels],
  };
  const added = addFoundationUnderWall(doc, withHome, { wallId: "w1" });
  const seg = doc.segments.find((s) => s.id === added.id);
  assert.equal(seg.level, "00 FND");
  assert.ok(Math.abs(seg.baseOffset) < 1e-9);
  const faced = elevationModel(doc, withHome, { wallId: "w1" });
  assert.equal(faced.foundations.length, 1);
  assert.ok(Math.abs(faced.foundations[0].base - -0.6) < 1e-9);
  assert.ok(Math.abs(faced.foundations[0].top) < 1e-9);
});

test("a wall's own height sets the top", () => {
  const doc = drawnDoc();
  doc.segments[0].height = 2.4;
  const m = elevationModel(doc, pack, { wallId: "w1" });
  assert.ok(Math.abs(m.height - 2.4) < 1e-9);
});

test("openings on a room-derived wall are found, and a missing wall gives null", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "r", name: "r", level: "01 GFL", rect: { x: 0, y: 0, w: 4, h: 3 } }],
    openings: [{ id: "o1", sku: "TSP_WN1212", roomId: "r", edgeIndex: 0, t: 0.5 }],
  });
  const walls = deriveWalls(doc, pack);
  const top = walls.find((w) => !w.drawn && Math.abs(w.y1) < 1e-9 && Math.abs(w.y2) < 1e-9);
  const m = elevationModel(doc, pack, { wallId: top.id, side: 1 }, walls);
  assert.equal(m.openings.length, 1);
  assert.equal(elevationModel(doc, pack, { wallId: "gone" }), null);
});

test("a selection resolves to a face, keeping a flipped side on the same wall", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const walls = deriveWalls(doc, pack);
  assert.deepEqual(faceRefForSelection(doc, pack, walls, { kind: "opening", id: "o1" }), { wallId: "w1", side: 1 });
  assert.deepEqual(
    faceRefForSelection(doc, pack, walls, { kind: "segment", id: "w1" }, { wallId: "w1", side: -1 }),
    { wallId: "w1", side: -1 },
  );
  assert.equal(faceRefForSelection(doc, pack, walls, { kind: "room", id: "r" }), null);
});

test("moving an opening snaps to 50 mm and stays on the wall", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const face = { wallId: "w1", side: 1 };
  applyOpeningEdit(doc, pack, face, "o1", { left: 1.234, sill: 1.04 });
  const o = elevationModel(doc, pack, face).openings[0];
  assert.ok(Math.abs(o.offset - 1.25) < 1e-9);
  assert.ok(Math.abs(o.sill - 1.05) < 1e-9);
  applyOpeningEdit(doc, pack, face, "o1", { left: 99 });
  const far = elevationModel(doc, pack, face).openings[0];
  assert.ok(Math.abs(far.offset + far.width - 6) < 1e-9);
});

test("moving on the mirrored face moves the same opening the other way in plan", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  applyOpeningEdit(doc, pack, { wallId: "w1", side: -1 }, "o1", { left: 0 });
  // Left on the mirrored face is the wall's far end.
  assert.ok(doc.openings[0].t > 0.5);
  const o = elevationModel(doc, pack, { wallId: "w1", side: -1 }).openings[0];
  assert.ok(Math.abs(o.offset) < 1e-9);
});

test("resizing writes overrides, and typing the type's own size clears them", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const face = { wallId: "w1", side: 1 };
  applyOpeningEdit(doc, pack, face, "o1", { left: 2.1, width: 1.5, height: 1.0 });
  assert.equal(doc.openings[0].width, 1.5);
  assert.equal(doc.openings[0].height, 1.0);
  applyOpeningEdit(doc, pack, face, "o1", { width: 1.2, height: 1.2 });
  assert.equal(doc.openings[0].width, null);
  assert.equal(doc.openings[0].height, null);
});

test("a resize cannot push the opening through the top of the wall", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const face = { wallId: "w1", side: 1 };
  const m = elevationModel(doc, pack, face);
  const r = applyOpeningEdit(doc, pack, face, "o1", { height: 9 });
  assert.ok(r.sill + r.height <= m.height + 1e-9);
});

test("moving an edge keeps its length, and a nudged rectangle stays a rectangle", () => {
  const rect = [
    { s: 1, z: 0 },
    { s: 4, z: 0 },
    { s: 4, z: 2 },
    { s: 1, z: 2 },
  ];
  const lifted = translateOutlineEdge(rect, 2, 0.4, 0.3, 6, 3);
  assert.ok(Math.abs(lifted[2].s - 4.4) < 1e-9 && Math.abs(lifted[3].s - 1.4) < 1e-9);
  assert.ok(Math.abs(lifted[2].z - 2.3) < 1e-9 && Math.abs(lifted[3].z - 2.3) < 1e-9);
  assert.deepEqual(lifted[0], { s: 1, z: 0 });
  assert.equal(axisAlignedOutline(lifted), null, "the sides have slanted");

  const straight = translateOutlineEdge(rect, 2, 0, 0.5, 6, 2.2);
  assert.ok(Math.abs(straight[2].z - 2.2) < 1e-9, "the line stops at the top of the wall");
  assert.deepEqual(axisAlignedOutline(straight), { from: 1, to: 4, bottom: 0, top: 2.2 });
  assert.deepEqual(axisAlignedOutline(rect), { from: 1, to: 4, bottom: 0, top: 2 });
});

test("alignOutlineShift lines a moved corner up with the nearest target", () => {
  const origin = [{ s: 1, z: 0 }, { s: 2, z: 1 }];
  const hit = alignOutlineShift(origin, 0.04, 0.2, [0, 3, 1.05], [0, 2.7], 0.1);
  assert.ok(Math.abs(hit.ds - 0.05) < 1e-9);
  assert.equal(hit.guideS, 1.05);
  assert.equal(hit.dz, 0.2);
  assert.equal(hit.guideZ, null);
});

test("alignOutlineShift leaves a move that misses every target", () => {
  const hit = alignOutlineShift([{ s: 1, z: 1 }], 0.4, -0.4, [0, 5], [0, 3], 0.1);
  assert.equal(hit.ds, 0.4);
  assert.equal(hit.dz, -0.4);
  assert.equal(hit.guideS, null);
  assert.equal(hit.guideZ, null);
});

test("snapElevation rounds to 50 mm", () => {
  assert.equal(snapElevation(0.126), 0.15);
  assert.equal(snapElevation(0.12), 0.1);
});

test("a window corner keeps the opposite edge and at least 200 mm", () => {
  const face = { length: 6, height: 2.7 };
  const orig = { offset: 1.8, width: 1.2, sill: 0.9, height: 1.2 };
  const bl = resizeOpeningCorner(orig, "bl", 0.4, 0.3, face);
  assert.ok(Math.abs(bl.left - 0.4) < 1e-9);
  assert.ok(Math.abs(bl.left + bl.width - 3) < 1e-9, "the right edge stays");
  assert.ok(Math.abs(bl.sill - 0.3) < 1e-9);
  assert.ok(Math.abs(bl.sill + bl.height - 2.1) < 1e-9, "the head stays");

  const tight = resizeOpeningCorner(orig, "bl", 2.95, 2.05, face);
  assert.ok(Math.abs(tight.width - 0.2) < 1e-9);
  assert.ok(Math.abs(tight.height - 0.2) < 1e-9);
  assert.ok(Math.abs(tight.left + tight.width - 3) < 1e-9);
  assert.ok(Math.abs(tight.sill + tight.height - 2.1) < 1e-9);

  const tr = resizeOpeningCorner(orig, "tr", 4, 2.4, face);
  assert.equal(tr.left, orig.offset);
  assert.equal(tr.sill, orig.sill);
  assert.ok(Math.abs(tr.width - (4 - orig.offset)) < 1e-9);
  assert.ok(Math.abs(tr.height - (2.4 - orig.sill)) < 1e-9);

  const door = resizeOpeningCorner({ offset: 1, width: 0.9, sill: 0, height: 2.1 }, "t", 1, 2.2, face);
  assert.equal(door.width, 0.9, "a door head does not change the width");
  assert.equal(door.sill, 0);
  assert.ok(Math.abs(door.height - 2.2) < 1e-9);

  const edges = openingSnapEdges(orig, { s: orig.offset, z: orig.sill });
  assert.deepEqual(edges.s, [orig.offset + orig.width], "the left corner is not a target for itself");
  assert.deepEqual(edges.z, [orig.sill + orig.height], "the sill is not a target for itself");
});

test("the SVG draws the wall and each opening, with handles only when interactive and selected", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const m = elevationModel(doc, pack, { wallId: "w1" });
  const plain = elevationSvg(m, { width: 300, height: 130 });
  assert.match(plain.svg, /elev-wall/);
  assert.match(plain.svg, /data-elev-id="o1"/);
  assert.doesNotMatch(plain.svg, /data-elev-op="move"/, "the preview opening is not a move handle");
  assert.doesNotMatch(plain.svg, /elev-handle/);
  const live = elevationSvg(m, { width: 600, height: 200, interactive: true, selectedId: "o1" });
  assert.match(live.svg, /data-elev-op="move"/);
  assert.match(live.svg, /data-elev-op="tl"/);
  assert.match(live.svg, /data-elev-op="tr"/);
  assert.match(live.svg, /data-elev-op="bl"/);
  assert.match(live.svg, /data-elev-op="br"/);
  assert.doesNotMatch(live.svg, /data-elev-op="l"/, "a window is resized from its corners, not the side midpoints");
  assert.doesNotMatch(live.svg, /data-elev-op="r"/);
  assert.doesNotMatch(live.svg, /data-elev-op="wall-top"/, "a selected window does not change the wall height");
  const idle = elevationSvg(m, { width: 600, height: 200, interactive: true });
  assert.doesNotMatch(idle.svg, /data-elev-op="wall-top"/, "the height handle waits until the wall is clicked");
  const picked = elevationSvg(m, { width: 600, height: 200, interactive: true, wallSelected: true });
  assert.match(picked.svg, /data-elev-op="wall-top"/);
  assert.ok(live.scale > 0);
});

test("a selected door can be moved, and has no handles that change its width", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc([{ id: "d1", sku: "TSP_DR900", wallId: "w1", t: 0.5 }]);
  const m = elevationModel(doc, pack, { wallId: "w1" });
  const live = elevationSvg(m, { width: 600, height: 200, interactive: true, selectedId: "d1" });
  assert.match(live.svg, /data-elev-op="move"/);
  assert.match(live.svg, /data-elev-op="t"/);
  assert.doesNotMatch(live.svg, /data-elev-op="wall-top"/, "a selected door does not change the wall height");
  assert.doesNotMatch(live.svg, /data-elev-op="tl"/, "a door keeps its width, so it has no corner handles");
  assert.doesNotMatch(live.svg, /data-elev-op="l"/);
  assert.doesNotMatch(live.svg, /data-elev-op="r"/);
  assert.doesNotMatch(live.svg, /data-elev-op="b"/);
});

function fillTag(svg, id) {
  const at = svg.indexOf(`data-elev-fill="${id}"`);
  assert.ok(at > 0, `fill ${id}`);
  return svg.slice(svg.lastIndexOf("<", at), svg.indexOf(">", at) + 1);
}

function ringsOf(tag) {
  const d = tag.match(/d="([^"]+)"/);
  if (!d) return [];
  return d[1].split(/[Zz]/).map((part) => {
    const nums = part.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  }).filter((ring) => ring.length >= 3);
}

function span(pts, i) {
  const v = pts.map((p) => p[i]);
  return Math.max(...v) - Math.min(...v);
}

test("a finish fill is cut where a window overlaps it, and a length is not", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const walls = deriveWalls(doc, pack);
  const wall = walls.find((w) => w.id === "w1");
  const paint = createFinishRun(doc, wall, 1, { category: "paint", bottom: 0, top: 2.4 });
  const clear = createFinishRun(doc, wall, 1, { category: "paint", bottom: 0, top: 0.4 });
  const skirt = createFinishRun(doc, wall, 1, { category: "skirting", bottom: 0, top: 0.12 });
  const m = elevationModel(doc, pack, { wallId: "w1", side: 1 }, walls);
  const svg = elevationSvg(m, { width: 640, height: 280 }).svg;
  const idOf = (run) => m.finishBands.find((b) => b.sourceId === run.id).id;

  const cut = fillTag(svg, idOf(paint));
  assert.match(cut, /fill-rule="evenodd"/);
  const rings = ringsOf(cut);
  assert.equal(rings.length, 2, "the window is a hole in the paint");
  const outer = rings[0];
  const hole = rings[1];
  assert.ok(Math.abs(span(hole, 0) / span(outer, 0) - 1.2 / 6) < 0.02, "the hole is the window width");
  assert.ok(Math.abs(span(hole, 1) / span(outer, 1) - 1.2 / 2.4) < 0.02, "the hole is the window height");

  const below = fillTag(svg, idOf(clear));
  assert.match(below, /^<rect /);
  assert.doesNotMatch(below, /fill-rule/);

  const skirting = fillTag(svg, idOf(skirt));
  assert.match(skirting, /^<rect /);

  const doorDoc = drawnDoc([{ id: "d1", sku: "TSP_DR900", wallId: "w1", t: 0.5 }]);
  const doorWalls = deriveWalls(doorDoc, pack);
  const doorSkirt = createFinishRun(doorDoc, doorWalls[0], 1, { category: "skirting", bottom: 0, top: 0.12 });
  const doorModel = elevationModel(doorDoc, pack, { wallId: "w1", side: 1 }, doorWalls);
  const doorSvg = elevationSvg(doorModel, { width: 640, height: 280 }).svg;
  const doorFill = fillTag(doorSvg, doorModel.finishBands.find((b) => b.sourceId === doorSkirt.id).id);
  assert.match(doorFill, /fill-rule="evenodd"/);
});

test("a selected rectangular finish offers corners, and a click target on each edge", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const walls = deriveWalls(doc, pack);
  const run = createFinishRun(doc, walls[0], 1, { category: "paint", from: 1, to: 5, bottom: 0, top: 2.4 });
  const m = elevationModel(doc, pack, { wallId: "w1", side: 1 }, walls);
  const bandId = m.finishBands.find((b) => b.sourceId === run.id).id;
  const idle = elevationSvg(m, { width: 640, height: 280, interactive: true, selectedId: "o1" }).svg;
  assert.doesNotMatch(idle, /data-elev-op="outline-vertex"/);
  assert.doesNotMatch(idle, /data-elev-op="band-top"/, "a selected window is the only shape being edited");
  const open = elevationSvg(m, { width: 640, height: 280, interactive: true }).svg;
  assert.doesNotMatch(open, /data-elev-op="wall-top"/);
  const editing = elevationSvg(m, { width: 640, height: 280, interactive: true, selectedBandId: bandId }).svg;
  assert.doesNotMatch(editing, /data-elev-op="wall-top"/, "a selected finish does not leave the wall height handle");
  const svg = elevationSvg(m, { width: 640, height: 280, interactive: true, selectedBandId: bandId }).svg;
  assert.equal(svg.match(/data-elev-op="outline-vertex"/g).length, 4);
  assert.equal(svg.match(/data-elev-op="outline-edge"/g).length, 4);
  assert.match(svg, /pointer-events="stroke"/);
  assert.match(svg, /is-add/);
  assert.equal(svg.match(/4000 mm/g).length, 1, "a rectangle labels its width once");
  assert.equal(svg.match(/2400 mm/g).length, 1, "a rectangle labels its height once");
  const both = elevationSvg(m, { width: 640, height: 280, interactive: true, selectedId: "o1", selectedBandId: bandId }).svg;
  assert.doesNotMatch(both, /data-elev-op="outline-vertex"/, "the window edit clears the finish corners");
  assert.doesNotMatch(both, /data-elev-op="band-top"/);
  assert.match(both, /data-elev-op="tl"/, "the window corner handles stay");
  const lineSvg = elevationSvg(m, { width: 640, height: 280, interactive: true, selectedBandId: bandId, edgeMode: "line" }).svg;
  assert.equal(lineSvg.match(/elev-outline-edge is-ns/g).length, 2, "a horizontal edge resizes up and down, like the wall top");
  assert.equal(lineSvg.match(/elev-outline-edge is-ew/g).length, 2, "a vertical edge resizes sideways");
  assert.doesNotMatch(lineSvg, /is-add/);
  assert.doesNotMatch(svg, new RegExp(`data-elev-op="band-top"[^>]*data-elev-band="${bandId}"`));
});

test("a drawn finish is cut to the part of the window inside the shape", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const walls = deriveWalls(doc, pack);
  const outline = [[2, 0.5], [5, 0.5], [5, 2.2], [2, 2.2]];
  const run = createFinishRun(doc, walls[0], 1, { category: "paint", outline });
  const m = elevationModel(doc, pack, { wallId: "w1", side: 1 }, walls);
  const svg = elevationSvg(m, { width: 640, height: 280 }).svg;
  const tag = fillTag(svg, m.finishBands.find((b) => b.sourceId === run.id).id);
  const rings = ringsOf(tag);
  assert.equal(rings.length, 2);
  const outer = rings[0];
  const hole = rings[1];
  // Window is x 2.4–3.6, z 0.9–2.1, inside the outline, so the hole matches it.
  assert.ok(Math.abs(span(hole, 0) / span(outer, 0) - 1.2 / 3) < 0.02);
  assert.ok(Math.abs(span(hole, 1) / span(outer, 1) - 1.2 / 1.7) < 0.02);
  const shaped = elevationSvg(m, {
    width: 640,
    height: 280,
    interactive: true,
    selectedBandId: m.finishBands.find((b) => b.sourceId === run.id).id,
    edgeMode: "line",
  }).svg;
  assert.equal(shaped.match(/3000 mm/g).length, 2, "a drawn outline labels both horizontal edges");
  assert.equal(shaped.match(/1700 mm/g).length, 2, "a drawn outline labels both vertical edges");
});

test("a selected window is dimensioned with the sill below and the height to the ceiling", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5, width: 0.55, height: 1.1, sill: 0.95 }]);
  const m = elevationModel(doc, pack, { wallId: "w1" });
  const o = m.openings[0];
  const live = elevationSvg(m, { width: 640, height: 280, interactive: true, selectedId: "o1" });
  assert.match(live.svg, /550 × 1100/);
  assert.doesNotMatch(live.svg, /sill 950/);

  const sillTag = live.svg.match(/<text[^>]*data-elev-dim="sill"[^>]*>/);
  const ceilTag = live.svg.match(/<text[^>]*data-elev-dim="ceiling"[^>]*>/);
  assert.ok(sillTag, "sill dimension");
  assert.ok(ceilTag, "ceiling dimension");
  assert.match(sillTag[0], />/);
  assert.match(live.svg, /data-elev-dim="sill">950</);
  const gap = Math.round((m.height - o.sill - o.height) * 1000);
  assert.match(live.svg, new RegExp(`data-elev-dim="ceiling">${gap}<`));

  const frame = live.svg.match(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)" class="elev-opening/);
  const head = Number(frame[1]);
  const sillLine = head + Number(frame[2]);
  const yOf = (tag) => Number(tag[0].match(/y="([^"]+)"/)[1]);
  assert.ok(yOf(sillTag) > sillLine, "sill height sits below the opening");
  assert.ok(yOf(ceilTag) < head, "height to the ceiling sits above the head");

  const plain = elevationSvg(m, { width: 640, height: 280, selectedId: null });
  assert.doesNotMatch(plain.svg, /data-elev-dim=/);
});

test("a short wall still shows the next floor, and the top storey shows the roof", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc();
  doc.segments[0].height = 1.5;
  doc.segments[0].top = null;
  const ground = elevationModel(doc, pack, { wallId: "w1" });
  assert.equal(ground.guide.kind, "floor");
  assert.equal(ground.guide.name, "02 L1");
  const svg = elevationSvg(ground, { width: 640, height: 280 });
  assert.match(svg.svg, /02 L1 \+2\.800/);
  assert.match(svg.svg, /elev-wall-ghost/);
  assert.doesNotMatch(svg.svg, /data-elev-op="wall-top"/);
  const open = elevationSvg(ground, { width: 640, height: 280, interactive: true, wallSelected: true });
  assert.match(open.svg, /data-elev-op="wall-top"/);
  const drawing = elevationSvg(ground, { width: 640, height: 280, interactive: true, draft: { points: [], category: "paint" } });
  assert.doesNotMatch(drawing.svg, /data-elev-op="wall-top"/);
  assert.doesNotMatch(drawing.svg, /elev-wall-top-handle/);

  const full = elevationModel(drawnDoc(), pack, { wallId: "w1" });
  const fullSvg = elevationSvg(full, { width: 640, height: 280 });
  assert.doesNotMatch(fullSvg.svg, /elev-wall-ghost/);
  assert.doesNotMatch(fullSvg.svg, /data-elev-op="wall-top"/);

  const topDoc = drawnDoc();
  topDoc.segments[0].level = "02 L1";
  topDoc.segments[0].height = 1.5;
  const top = elevationModel(topDoc, pack, { wallId: "w1" });
  assert.equal(top.guide.kind, "roof");
  assert.ok(Math.abs(top.guide.elevation - 5.6) < 1e-9);
  const roof = elevationSvg(top, { width: 640, height: 280 });
  assert.match(roof.svg, /Roof \+5\.600/);
  assert.match(roof.svg, /elev-wall-ghost/);
});

test("a long wall keeps the next floor above the wall", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc();
  doc.segments[0].x2 = 40;
  doc.segments[0].height = 2.4;
  const drawn = elevationSvg(elevationModel(doc, pack, { wallId: "w1" }), { width: 240, height: 130 });
  assert.ok(drawn.scaleX < drawn.scaleY, "length compresses, the storey does not");

  const wall = drawn.svg.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" class="elev-wall"/);
  const label = drawn.svg.match(/<text x="([^"]+)" y="([^"]+)" text-anchor="end" class="elev-level-label">02 L1 \+2\.800</);
  assert.ok(wall, "wall rect");
  assert.ok(label, "next-floor label");
  const wallTop = Number(wall[2]);
  const wallRight = Number(wall[1]) + Number(wall[3]);
  const labelY = Number(label[2]);
  assert.ok(wallTop > labelY + 8, "the next floor sits above the wall");
  assert.ok(Math.abs(Number(wall[1]) - 7) < 1 && Math.abs(wallRight - 233) < 1, "the wall spans the level lines");
  assert.ok(wallTop >= 0 && wallTop + Number(wall[4]) <= 130, "the wall stays inside the preview");

  const fitted = elevationSvg(elevationModel(drawnDoc(), pack, { wallId: "w1" }), { width: 640, height: 130 });
  const fittedWall = fitted.svg.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="[^"]+" class="elev-wall"/);
  const fittedRight = Number(fittedWall[1]) + Number(fittedWall[3]);
  assert.ok(Math.abs(Number(fittedWall[1]) - 7) < 1 && Math.abs(fittedRight - 633) < 1, "a shorter wall fills the width too");
});

test("zooming keeps the point under the cursor, and zooming out restores the fit", async () => {
  const { elevationSvg, zoomElevationView } = await import("../wall-elevation-render.js");
  const model = elevationModel(drawnDoc(), pack, { wallId: "w1" });
  const fitted = elevationSvg(model, { width: 640, height: 280, interactive: true });
  const px = 200;
  const py = 100;
  const s = (px - fitted.originX) / fitted.scaleX;
  const z = model.base + (fitted.originY - py) / fitted.scaleY;
  const view = zoomElevationView(fitted.fit, { zoom: 1, panX: 0, panY: 0 }, px, py, 2);
  assert.ok(Math.abs(view.zoom - 2) < 1e-9);
  const zoomed = elevationSvg(model, { width: 640, height: 280, interactive: true, view });
  const x = zoomed.originX + s * zoomed.scaleX;
  const y = zoomed.originY - (z - model.base) * zoomed.scaleY;
  assert.ok(Math.abs(x - px) < 1e-6, "the cursor's point stays under the cursor");
  assert.ok(Math.abs(y - py) < 1e-6, "the cursor's height stays under the cursor");
  assert.ok(Math.abs(zoomed.scaleX / fitted.scaleX - 2) < 1e-9);
  assert.ok(Math.abs(zoomed.scaleY / fitted.scaleY - 2) < 1e-9);

  const back = zoomElevationView(fitted.fit, view, px, py, 0.01);
  assert.deepEqual(back, { zoom: 1, panX: 0, panY: 0 });
  const restored = elevationSvg(model, { width: 640, height: 280, interactive: true, view: back });
  assert.equal(restored.originX, fitted.originX);
  assert.equal(restored.originY, fitted.originY);
  assert.equal(restored.scaleX, fitted.scaleX);
  assert.equal(restored.scaleY, fitted.scaleY);

  const { clampElevationView } = await import("../wall-elevation-render.js");
  const shoved = clampElevationView(fitted.fit, { zoom: 2, panX: 5000, panY: -5000 }, 640, 280);
  assert.ok(shoved.panX < 5000, "the wall cannot be panned clear of the strip");
  assert.equal(shoved.zoom, 2);
  const parked = elevationSvg(model, { width: 640, height: 280, interactive: true, view: shoved });
  const wallLeft = parked.originX;
  const wallRight = parked.originX + model.length * parked.scaleX;
  assert.ok(wallRight > 16 && wallLeft < 640 - 16, "part of the wall stays in frame");
});

test("dragging the wall top sets a fixed height and will not pass the next floor", () => {
  const doc = drawnDoc();
  const face = { wallId: "w1", side: 1 };
  applyWallTopEdit(doc, pack, face, 2.4);
  assert.equal(doc.segments[0].height, 2.4);
  assert.equal(doc.segments[0].top, null);
  assert.ok(Math.abs(elevationModel(doc, pack, face).height - 2.4) < 1e-9);

  applyWallTopEdit(doc, pack, face, 9);
  const capped = elevationModel(doc, pack, face);
  assert.ok(Math.abs(capped.height - 2.8) < 1e-6, "stops at the next floor");
  assert.equal(doc.segments[0].height, null);
  assert.equal(doc.segments[0].top, "level-above");
});

test("a drag that shortens a room wall draws that wall only", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "r", name: "r", level: "01 GFL", rect: { x: 0, y: 0, w: 4, h: 3 } }],
  });
  const walls = deriveWalls(doc, pack);
  const top = walls.find((w) => !w.drawn && Math.abs(w.y1) < 1e-9 && Math.abs(w.y2) < 1e-9);
  const same = applyWallTopEdit(doc, pack, { wallId: top.id, side: 1 }, top.height, walls);
  assert.equal(same.wallId, top.id);
  assert.equal(doc.segments.length, 0);

  const applied = applyWallTopEdit(doc, pack, { wallId: top.id, side: 1 }, 2.2, walls);
  assert.notEqual(applied.wallId, top.id);
  const next = deriveWalls(doc, pack);
  const edited = next.find((w) => w.id === applied.wallId);
  assert.ok(Math.abs(edited.height - 2.2) < 1e-9);
  const others = next.filter((w) => w.id !== edited.id);
  assert.ok(others.length >= 1);
  assert.ok(others.every((w) => Math.abs(w.height - top.height) < 1e-6));
});

test("a finish that reached the top of the wall moves when the wall does", async () => {
  const doc = drawnDoc();
  const wall = deriveWalls(doc, pack).find((w) => w.id === "w1");
  const before = elevationModel(doc, pack, { wallId: "w1", side: 1 });
  createFinishRun(doc, wall, 1, { category: "paint", bottom: 0 });
  createFinishRun(doc, wall, 1, { category: "paint", bottom: 0, top: 1.2 });
  createFinishRun(doc, wall, 1, {
    category: "paint",
    outline: [[0.2, 0], [1.2, 0], [1.2, before.height], [0.2, before.height]],
  });
  applyWallTopEdit(doc, pack, { wallId: "w1", side: 1 }, before.height - 0.4);
  const m = elevationModel(doc, pack, { wallId: "w1", side: 1 });
  assert.ok(Math.abs(m.height - (before.height - 0.4)) < 1e-6);
  const runs = m.finishBands.filter((b) => b.source === "run");
  const open = runs.find((b) => !b.outline && b.top > 2);
  const dado = runs.find((b) => !b.outline && Math.abs(b.top - 1.2) < 1e-6);
  const drawn = runs.find((b) => b.outline);
  assert.ok(open, "the finish with no top of its own is still on the face");
  assert.ok(Math.abs(open.top - m.height) < 1e-6, "a blank top stays at the wall top");
  assert.ok(dado, "the lower finish is still there");
  assert.ok(Math.abs(dado.top - 1.2) < 1e-6, "a finish that stopped lower stays there");
  assert.ok(drawn.outline.some((p) => Math.abs(p[1] - m.height) < 1e-6), "a corner that was on the old top moves with the wall");
  assert.ok(drawn.outline.some((p) => Math.abs(p[1]) < 1e-6), "a corner on the floor stays on the floor");
  const { elevationSvg } = await import("../wall-elevation-render.js");
  assert.match(elevationSvg(m, { width: 640, height: 280, interactive: true, wallSelected: true }).svg, /elev-wall-top-handle is-wall-selected/);
  assert.doesNotMatch(elevationSvg(m, { width: 640, height: 280, interactive: true }).svg, /is-wall-selected/);
});

test("a wall top drag cannot cut through an opening", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  applyWallTopEdit(doc, pack, { wallId: "w1", side: 1 }, 1.0);
  const m = elevationModel(doc, pack, { wallId: "w1" });
  const head = m.openings[0].sill + m.openings[0].height;
  assert.ok(m.height + 1e-9 >= head);
});

test("drawing a finish marks the pointer and previews the edge back to the start", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const m = elevationModel(drawnDoc(), pack, { wallId: "w1", side: 1 });
  const waiting = elevationSvg(m, {
    width: 640,
    height: 280,
    interactive: true,
    draft: { points: [], hover: { s: 1, z: 1 }, category: "paint" },
  }).svg;
  assert.match(waiting, /class="elev-draft-cursor"/);
  const shaping = elevationSvg(m, {
    width: 640,
    height: 280,
    interactive: true,
    draft: {
      points: [{ s: 0, z: 0 }, { s: 2, z: 0 }],
      hover: { s: 2, z: 1.5 },
      category: "paint",
    },
  }).svg;
  assert.match(shaping, /class="elev-draft-cursor"/);
  assert.match(shaping, /class="elev-draft-close"/);
});

test("dragging a finish corner dimensions the gap to the side and to the top", async () => {
  const { elevationSvg, finishLocate } = await import("../wall-elevation-render.js");
  const points = [
    { s: 0.8, z: 0 },
    { s: 4, z: 0 },
    { s: 4, z: 2.2 },
    { s: 0.8, z: 2.2 },
  ];
  const length = 6;
  const height = 2.7;
  const corner = finishLocate(points, { mode: "corner", index: 3, length, height });
  assert.deepEqual(corner.side, { s0: 0, s1: 0.8, z: 2.2 });
  assert.equal(corner.vert.toward, "top");
  assert.equal(corner.vert.z0, 2.2);
  assert.equal(corner.vert.z1, height);
  assert.equal(corner.vert.s, 0.8, "the height to the top is taken at the corner, not along the edge");

  const sloped = [
    { s: 1.45, z: 0 },
    { s: 7.4, z: 0 },
    { s: 7.4, z: 2.2 },
    { s: 1.8, z: 1.5 },
  ];
  const low = finishLocate(sloped, { mode: "corner", index: 3, length: 7.405, height: 3 });
  assert.equal(low.side.s1, 1.8);
  assert.equal(low.side.z, 1.5);
  assert.equal(low.vert.z0, 1.5, "the low corner is not given the high end's gap");
  assert.equal(low.vert.s, 1.8);
  assert.ok(Math.abs((3 - low.vert.z0) - 1.5) < 1e-9);

  const side = finishLocate(points, { mode: "edge", index: 3, length, height });
  assert.ok(side.side);
  assert.equal(side.vert, undefined, "a vertical edge is only the gap to the side");

  const top = finishLocate(points, { mode: "edge", index: 2, length, height });
  assert.equal(top.side, undefined, "a horizontal edge is only the gap to the top");
  assert.equal(top.vert.toward, "top");

  const floor = finishLocate(points, { mode: "edge", index: 0, length, height });
  assert.equal(floor, null, "an edge already on the floor has no clearance to draw");

  const placing = finishLocate(null, { mode: "point", point: { s: 0.8, z: 2.2 }, length, height });
  assert.equal(placing.side.s1, 0.8);
  assert.equal(placing.vert.toward, "top");

  const m = elevationModel(drawnDoc(), pack, { wallId: "w1", side: 1 });
  const svg = elevationSvg(m, { width: 640, height: 280, interactive: true, locate: corner }).svg;
  assert.match(svg, /data-elev-dim="side">800 mm</);
  assert.match(svg, /data-elev-dim="top">500 mm</);
  assert.match(svg, /class="elev-dim-line"/);
  const idle = elevationSvg(m, { width: 640, height: 280, interactive: true }).svg;
  assert.doesNotMatch(idle, /data-elev-dim="side"/);
  assert.doesNotMatch(idle, /data-elev-dim="top"/);

  const pinned = finishLocate(points, {
    mode: "corner",
    index: 3,
    length,
    height,
    pin: { h: "right", v: "down" },
  });
  assert.equal(pinned.side.s0, 0.8);
  assert.equal(pinned.side.s1, length);
  assert.equal(pinned.side.pinned, true);
  assert.equal(pinned.vert.toward, "base");
  assert.equal(pinned.vert.z0, 0);
  assert.equal(pinned.vert.z1, 2.2);
  assert.equal(pinned.vert.pinned, true);

  const flush = [
    { s: 0, z: 0 },
    { s: 2, z: 0 },
    { s: 2, z: 1 },
    { s: 0, z: 1 },
  ];
  const zero = finishLocate(flush, { mode: "corner", index: 3, length, height, pin: { h: "left" } });
  assert.equal(zero.side.s1 - zero.side.s0, 0);
  assert.equal(zero.side.pinned, true, "a forced gap is kept even when the corner is already on that side");

  const ccwLeft = finishLocate(points, { mode: "edge", index: 3, length, height });
  assert.equal(ccwLeft.side.s0, 0, "a counter-clockwise left edge faces the left end of the wall");
  const cw = [points[3], points[2], points[1], points[0]];
  const cwLeft = finishLocate(cw, { mode: "edge", index: 3, length, height });
  assert.equal(cwLeft.side.s0, 0, "reversing the ring keeps the outward side, because the winding flips with the travel");
  const forced = finishLocate(points, { mode: "edge", index: 3, length, height, pin: { h: "right" } });
  assert.equal(forced.side.s0, 0.8);
  assert.equal(forced.side.s1, length);
  assert.equal(forced.side.pinned, true);

  const typing = elevationSvg(m, {
    width: 640,
    height: 280,
    interactive: true,
    locate: { ...corner, typeable: true, typing: { axis: "h", text: "600" } },
  }).svg;
  assert.match(typing, /data-elev-op="locate-h"/);
  assert.match(typing, /is-editing/);
  assert.match(typing, /600\u2502/);
  const forcedZero = elevationSvg(m, {
    width: 640,
    height: 280,
    interactive: true,
    locate: { side: { s0: 0, s1: 0, z: 1, pinned: true }, typeable: true },
  }).svg;
  assert.match(forcedZero, /data-elev-dim="side"[^>]*>0 mm</);
});

test("a typed gap moves the corner or edge to that clearance", () => {
  const face = { length: 6, height: 2.7 };
  const rect = { kind: "rect-edge", from: 1, to: 3, bottom: 0, top: 1.2 };
  const fromLeft = applyTypedGap(rect, "h", 0.6, { side: { s0: 0, s1: 1, z: 1 } }, face);
  assert.equal(fromLeft.from, 0.6);
  assert.equal(fromLeft.to, 3);
  const tooWide = applyTypedGap(rect, "h", 2.98, { side: { s0: 0, s1: 1, z: 1 } }, face);
  assert.ok(Math.abs(tooWide.from - (3 - 0.05)) < 1e-9, "a finish keeps at least 50 mm");
  const fromTop = applyTypedGap(
    rect,
    "v",
    0.5,
    { vert: { z0: 1.2, z1: 2.7, s: 1, toward: "top" } },
    face,
  );
  assert.ok(Math.abs(fromTop.top - 2.2) < 1e-9);
  assert.equal(maxTypedGap(rect, "h", { side: { s0: 0, s1: 1, z: 1 } }, face), 3 - 0.05);

  const opening = { kind: "opening", corner: "bl", offset: 1.8, width: 1.2, sill: 0.9, height: 1.2 };
  const left = applyTypedGap(opening, "h", 0.6, { side: { s0: 0, s1: 1.8, z: 0.9 } }, face);
  assert.ok(Math.abs(left.offset - 0.6) < 1e-9);
  assert.ok(Math.abs(left.offset + left.width - 3) < 1e-9, "the right edge stays put");
  const tight = applyTypedGap(opening, "h", 2.95, { side: { s0: 0, s1: 1.8, z: 0.9 } }, face);
  assert.ok(Math.abs(tight.offset - 2.8) < 1e-9, "a window keeps at least 200 mm");
  assert.equal(maxTypedGap(opening, "h", { side: { s0: 0, s1: 1.8, z: 0.9 } }, face), 3 - 0.2);

  const points = [
    { s: 1, z: 0 },
    { s: 3, z: 0 },
    { s: 3, z: 1 },
    { s: 1, z: 1 },
  ];
  const edge = applyTypedGap(
    { kind: "edge", points, index: 3 },
    "h",
    0.4,
    { side: { s0: 0, s1: 1, z: 1 } },
    face,
  );
  assert.equal(edge.points[3].s, 0.4);
  assert.equal(edge.points[0].s, 0.4);
  assert.equal(edge.points[1].s, 3, "the opposite edge stays");

  const vertex = applyTypedGap(
    { kind: "vertex", points, index: 3 },
    "v",
    0.5,
    { vert: { z0: 1, z1: 2.7, s: 1, toward: "top" } },
    face,
  );
  assert.ok(Math.abs(vertex.points[3].z - (2.7 - 0.5)) < 1e-9);
  assert.equal(vertex.points[0].z, 0);

  const door = applyTypedGap(
    { kind: "opening", corner: "t", offset: 1, width: 0.9, sill: 0, height: 2.1, door: true },
    "v",
    0.4,
    { vert: { z0: 2.1, z1: 2.7, s: 1, toward: "top" } },
    face,
  );
  assert.ok(Math.abs(door.height - (2.7 - 0.4)) < 1e-9);
  assert.equal(door.width, 0.9, "a door's width stays with the door");
  assert.equal(applyTypedGap(
    { kind: "opening", corner: "t", offset: 1, width: 0.9, sill: 0, height: 2.1, door: true },
    "h",
    0.4,
    { side: { s0: 0, s1: 1, z: 2.1 } },
    face,
  ), null);
});

test("shared area is marked as finishes, including a partial overlap, and nothing is hatched", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const base = elevationModel(drawnDoc(), pack, { wallId: "w1", side: 1 });
  const band = (id, category, extra) => ({ id, source: "run", category, unit: "m2", editable: true, ...extra });
  const draw = (finishBands) => elevationSvg({ ...base, openings: [], finishBands }, { width: 640, height: 280, interactive: true }).svg;

  const partial = draw([
    band("a", "paint", { from: 0, to: 2, bottom: 0, top: 1.2 }),
    band("b", "wallTile", { from: 1, to: 3, bottom: 0, top: 1.5 }),
  ]);
  assert.match(partial, />2 finishes</, "paint and tile share part of the face");
  assert.match(partial, /class="elev-coat-line"/);
  assert.match(partial, /class="elev-coat-halo"/);
  assert.doesNotMatch(partial, /elev-clash/);

  const coats = draw([
    band("a", "plaster", { from: 0, to: 2, bottom: 0, top: 2 }),
    band("b", "render", { from: 1, to: 3, bottom: 0, top: 2 }),
  ]);
  assert.match(coats, />2 finishes</, "two finishes share part of the face");
  assert.doesNotMatch(coats, /elev-clash/);

  const drawn = draw([
    band("a", "paint", { outline: [[0, 0], [2, 0], [2, 1.2], [0, 1.2]] }),
    band("b", "paint", { outline: [[1, 0], [3, 0], [3, 1.2], [1, 1.2]] }),
  ]);
  assert.match(drawn, />2 finishes</, "drawn shapes that share area");

  assert.doesNotMatch(draw([
    band("a", "paint", { from: 0, to: 2, bottom: 0, top: 2, outline: [[0, 0], [2, 0], [0, 2]] }),
    band("b", "wallTile", { from: 0, to: 2, bottom: 0, top: 2, outline: [[2, 0.5], [2, 2], [1.6, 2]] }),
  ]), />2 finishes</, "drawn shapes whose boxes overlap but whose areas do not");

  assert.doesNotMatch(draw([
    band("a", "plaster", { source: "default", from: 0, to: 3, bottom: 0, top: 2 }),
    band("b", "paint", { from: 0, to: 3, bottom: 0, top: 2 }),
  ]), />2 finishes</, "paint on the wall-type plaster is not a second finish");

  const triple = draw([
    band("a", "plaster", { from: 0, to: 2, bottom: 0, top: 1.2 }),
    band("b", "paint", { from: 0, to: 2, bottom: 0, top: 1.2 }),
    band("c", "paint", { from: 0, to: 2, bottom: 0, top: 1.2 }),
  ]);
  assert.match(triple, />3 finishes</);
  assert.doesNotMatch(triple, />2 finishes</, "the same patch is one stack, not a pile of pairs");
  assert.equal(triple.match(/class="elev-coat-line"/g)?.length, 2, "each buried coat keeps its own line");
});

test("a coat and a paint on the same rectangle read as two finishes", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const base = elevationModel(drawnDoc(), pack, { wallId: "w1", side: 1 });
  const band = (id, category, extra) => ({ id, source: "run", category, unit: "m2", editable: true, label: category === "plaster" ? "Plaster" : "Paint", ...extra });
  const svg = elevationSvg({
    ...base,
    openings: [],
    finishBands: [
      band("coat", "plaster", { from: 0, to: 2, bottom: 0, top: 1.2 }),
      band("paint", "paint", { from: 0, to: 2, bottom: 0.01, top: 1.2 }),
      band("other", "paint", { from: 3, to: 4.2, bottom: 0, top: 1 }),
    ],
  }, { width: 640, height: 280, interactive: true }).svg;
  assert.equal(svg.match(/class="elev-coat-line"/g)?.length, 1);
  assert.match(svg, /Plaster is under the finish on top/);
  assert.match(svg, />2 finishes</);
  assert.doesNotMatch(svg, />3 finishes</);
  const preview = elevationSvg({
    ...base,
    openings: [],
    finishBands: [
      band("coat", "plaster", { from: 0, to: 2, bottom: 0, top: 1.2 }),
      band("paint", "paint", { from: 0, to: 2, bottom: 0, top: 1.2 }),
    ],
  }, { width: 280, height: 160, interactive: false }).svg;
  assert.match(preview, /data-elev-fill="coat"/, "the preview still draws each finish");
  assert.match(preview, /data-elev-fill="paint"/);
  assert.doesNotMatch(preview, /elev-coat-/, "the stack mark is only on the open elevation");
  assert.doesNotMatch(preview, />\d+ finishes</);
});
