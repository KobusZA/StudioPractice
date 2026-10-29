// Phase C: the wall elevation model and the edits made from it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import { deriveWalls } from "../walls.js";
import { createFinishRun } from "../finish-model.js";
import { applyOpeningEdit, applyWallTopEdit, axisAlignedOutline, elevationModel, faceRefForSelection, snapElevation, translateOutlineEdge } from "../wall-elevation.js";

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

test("snapElevation rounds to 50 mm", () => {
  assert.equal(snapElevation(0.126), 0.15);
  assert.equal(snapElevation(0.12), 0.1);
});

test("the SVG draws the wall and each opening, with handles only when interactive and selected", async () => {
  const { elevationSvg } = await import("../wall-elevation-render.js");
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  const m = elevationModel(doc, pack, { wallId: "w1" });
  const plain = elevationSvg(m, { width: 300, height: 130 });
  assert.match(plain.svg, /elev-wall/);
  assert.match(plain.svg, /data-elev-id="o1"/);
  assert.doesNotMatch(plain.svg, /elev-handle/);
  const live = elevationSvg(m, { width: 600, height: 200, interactive: true, selectedId: "o1" });
  assert.match(live.svg, /elev-handle-r/);
  assert.ok(live.scale > 0);
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
  const svg = elevationSvg(m, { width: 640, height: 280, interactive: true, selectedId: "o1", selectedBandId: bandId }).svg;
  assert.equal(svg.match(/data-elev-op="outline-vertex"/g).length, 4);
  assert.equal(svg.match(/data-elev-op="outline-edge"/g).length, 4);
  assert.match(svg, /pointer-events="stroke"/);
  assert.match(svg, /elev-outline-edge is-add/);
  const lineSvg = elevationSvg(m, { width: 640, height: 280, interactive: true, selectedId: "o1", selectedBandId: bandId, edgeMode: "line" }).svg;
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
  const open = elevationSvg(ground, { width: 640, height: 280, interactive: true });
  assert.match(open.svg, /data-elev-op="wall-top"/);

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

test("a wall top drag cannot cut through an opening", () => {
  const doc = drawnDoc([{ id: "o1", sku: "TSP_WN1212", wallId: "w1", t: 0.5 }]);
  applyWallTopEdit(doc, pack, { wallId: "w1", side: 1 }, 1.0);
  const m = elevationModel(doc, pack, { wallId: "w1" });
  const head = m.openings[0].sill + m.openings[0].height;
  assert.ok(m.height + 1e-9 >= head);
});
