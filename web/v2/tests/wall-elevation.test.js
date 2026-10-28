// Phase C: the wall elevation model and the edits made from it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import { deriveWalls } from "../walls.js";
import { applyOpeningEdit, applyWallTopEdit, elevationModel, faceRefForSelection, snapElevation } from "../wall-elevation.js";

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
  const svg = elevationSvg(ground, { width: 640, height: 280, dragTop: true });
  assert.match(svg.svg, /02 L1 \+2\.800/);
  assert.match(svg.svg, /elev-wall-ghost/);
  assert.match(svg.svg, /data-elev-op="wall-top"/);

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
  const roof = elevationSvg(top, { width: 640, height: 280, dragTop: true });
  assert.match(roof.svg, /Roof \+5\.600/);
  assert.match(roof.svg, /elev-wall-ghost/);
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
