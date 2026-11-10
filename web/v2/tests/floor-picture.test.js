// The floor picture reuses the wall elevation strip. These checks stay on
// the picture, the open command, and the inspector list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFinishRegion } from "../finish-model.js";
import { floorOpenHtml } from "../finish-panel.js";
import { pointInPoly } from "../geom.js";
import { alignFloorPoint, faceToPlan, floorBox, floorFaceOf, floorFrameFromHold, floorHoldCentered, floorPictureSvg, planToFace, resolveFloorFinishOpen, trackFloorHold } from "../floor-picture.js";
import { clampElevationView, finishLocate, zoomElevationView } from "../wall-elevation-render.js";
import { applyTypedGap } from "../wall-elevation.js";
import { normalizeDoc, polyShape, roomPolygon } from "../model.js";

const HOST = [[0, 0], [4, 0], [4, 3], [0, 3]];
const TILE = [[1, 1], [3, 1], [3, 2], [1, 2]];
const VINYL = [[1.2, 1.2], [2, 1.2], [2, 1.8], [1.2, 1.8]];

test("a room or a slab opens the floor picture", () => {
  assert.equal(resolveFloorFinishOpen([]).open, false);
  assert.equal(resolveFloorFinishOpen([{ kind: "segment", id: "w" }]).open, false);
  assert.equal(resolveFloorFinishOpen([{ kind: "room", id: "a" }, { kind: "room", id: "b" }]).open, false);
  assert.deepEqual(resolveFloorFinishOpen([{ kind: "room", id: "r" }]), { open: true, host: { kind: "room", id: "r" } });
  assert.deepEqual(resolveFloorFinishOpen([{ kind: "slab", id: "s" }]), { open: true, host: { kind: "slab", id: "s" } });
});

test("a selected finish has handles, including one that follows the outline", () => {
  const covering = floorPictureSvg({
    width: 480,
    height: 320,
    host: HOST,
    regions: [{ id: "screed", category: "screed", label: "Screed", fill: "#c4a574", poly: HOST, areaText: "12 m²", coversHost: true }],
    selectedId: "screed",
  });
  assert.match(covering.svg, /class="elev-handle"/);
  assert.match(covering.svg, /data-floor-edge="/);
  assert.match(covering.svg, /class="elev-measure/);

  const drawn = floorPictureSvg({
    width: 480,
    height: 320,
    host: HOST,
    regions: [
      { id: "screed", category: "screed", label: "Screed", fill: "#c4a574", poly: HOST, areaText: "12 m²", coversHost: true },
      { id: "tile", category: "floorTile", label: "Floor tile", fill: "#6a8fbf", poly: TILE, areaText: "2 m²", coversHost: false },
    ],
    selectedId: "tile",
    edgeMode: "line",
  });
  assert.match(drawn.svg, /class="elev-handle"/);
  assert.match(drawn.svg, /class="elev-measure/);
  assert.match(drawn.svg, /class="elev-coat-line"/);
  assert.match(drawn.svg, />2 finishes</);

  const three = floorPictureSvg({
    width: 480,
    height: 320,
    host: HOST,
    regions: [
      { id: "screed", category: "screed", label: "Screed", fill: "#c4a574", poly: HOST, coversHost: true },
      { id: "tile", category: "floorTile", label: "Floor tile", fill: "#6a8fbf", poly: TILE, coversHost: false },
      { id: "vinyl", category: "vinyl", label: "Vinyl", fill: "#8a8174", poly: VINYL, coversHost: false },
    ],
    selectedId: "vinyl",
  });
  assert.match(three.svg, />3 finishes</);
});

function ringFrom(pointsAttr) {
  return pointsAttr.trim().split(/\s+/).map((pair) => pair.split(",").map(Number));
}

/** Swatch centres of the pile, against the finish polygon drawn for `id`. */
function pileSitsOn(svg, id) {
  const poly = svg.match(new RegExp(`<polygon points="([^"]+)"[^>]*data-floor-fill="${id}"`));
  assert.ok(poly, `${id} is drawn`);
  const ring = ringFrom(poly[1]);
  const swatches = [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"[^>]*class="elev-coat-swatch"/g)];
  assert.ok(swatches.length >= 1, "the pile is drawn");
  for (const swatch of swatches) {
    const x = Number(swatch[1]) + Number(swatch[3]) / 2;
    const y = Number(swatch[2]) + Number(swatch[4]) / 2;
    assert.equal(pointInPoly(x, y, ring), true, "the pile sits on the shared patch");
  }
  return ring;
}

test("the pile sits on a diamond, and the inspector card is colours only", () => {
  const diamond = [[2, 0.2], [3.6, 1.5], [2, 2.8], [0.4, 1.5]];
  const regions = [
    { id: "screed", category: "screed", label: "Screed", fill: "#c4a574", poly: HOST, areaText: "12 m²", coversHost: true },
    { id: "tile", category: "floorTile", label: "Floor tile", fill: "#6a8fbf", poly: diamond, areaText: "2.4 m²", coversHost: false },
  ];
  const open = floorPictureSvg({ width: 480, height: 320, host: HOST, regions });
  assert.match(open.svg, /class="elev-floor-name"/);
  assert.match(open.svg, /class="elev-floor-area"/);
  assert.match(open.svg, />2 finishes</);
  const ring = pileSitsOn(open.svg, "tile");
  const minX = Math.min(...ring.map((p) => p[0]));
  const minY = Math.min(...ring.map((p) => p[1]));
  assert.equal(pointInPoly(minX + 10, minY + 10, ring), false, "the corner of the box is off the diamond");

  const card = floorPictureSvg({ width: 240, height: 132, host: HOST, regions, preview: true });
  assert.match(card.svg, /data-floor-fill="screed"/);
  assert.match(card.svg, /data-floor-fill="tile"/);
  assert.doesNotMatch(card.svg, /elev-floor-name/);
  assert.doesNotMatch(card.svg, /elev-floor-area/);
  assert.doesNotMatch(card.svg, /elev-coat-/);
  assert.doesNotMatch(card.svg, /finishes/);
});

function outlineLeft(svg) {
  const match = svg.match(/<polygon points="([^"]+)" fill="none" class="elev-floor-outline"/);
  assert.ok(match, "floor outline");
  return Math.min(...match[1].trim().split(/\s+/).map((pair) => Number(pair.split(",")[0])));
}

test("zoom stays on the floor when the room is far from the plan origin", () => {
  const near = [[0, 0], [6, 0], [6, 4], [0, 4]];
  const far = [[80, 40], [86, 40], [86, 44], [80, 44]];
  const fittedNear = floorPictureSvg({ width: 640, height: 280, host: near });
  const fitted = floorPictureSvg({ width: 640, height: 280, host: far });
  assert.ok(Math.abs(outlineLeft(fittedNear.svg) - outlineLeft(fitted.svg)) < 1, "both floors sit at the left of the picture");
  assert.equal(fitted.minX, 80);

  const px = 220;
  const py = 90;
  const planX = fitted.minX + (px - fitted.originX) / fitted.scaleX;
  const planY = (py - fitted.originY) / fitted.scaleY;
  const view = zoomElevationView(fitted.fit, { zoom: 1, panX: 0, panY: 0 }, px, py, 2);
  const zoomed = floorPictureSvg({ width: 640, height: 280, host: far, view });
  const x = zoomed.originX + (planX - zoomed.minX) * zoomed.scaleX;
  const y = zoomed.originY + planY * zoomed.scaleY;
  assert.ok(Math.abs(x - px) < 1e-6, "the point under the cursor stays");
  assert.ok(Math.abs(y - py) < 1e-6, "the point's height stays");

  const shoved = clampElevationView(fitted.fit, { zoom: 2, panX: 8000, panY: -8000 }, 640, 280);
  const parked = floorPictureSvg({ width: 640, height: 280, host: far, view: shoved });
  const left = parked.originX;
  const right = left + 6 * parked.scaleX;
  assert.ok(right > 16 && left < 640 - 16, "part of the floor stays in the picture");
});

function outlinePoints(svg) {
  const match = svg.match(/<polygon points="([^"]+)" fill="none" class="elev-floor-outline"/);
  assert.ok(match, "floor outline");
  return match[1].trim().split(/\s+/).map((pair) => pair.split(",").map(Number));
}

test("the open floor uses the plan scale and sits on the frame", () => {
  const host = [[10, 20], [16, 20], [16, 24], [10, 24]];
  const frame = { scale: 20, originX: 80, originY: 50 };
  const drawn = floorPictureSvg({ width: 640, height: 280, host, frame });
  assert.ok(Math.abs(drawn.scaleX - 20) < 1e-6, "width uses the plan scale");
  assert.ok(Math.abs(drawn.scaleY - 20) < 1e-6, "height uses the same scale");
  const pts = outlinePoints(drawn.svg);
  const left = Math.min(...pts.map((p) => p[0]));
  const right = Math.max(...pts.map((p) => p[0]));
  const top = Math.min(...pts.map((p) => p[1]));
  const bottom = Math.max(...pts.map((p) => p[1]));
  assert.ok(Math.abs(left - 80) < 1e-6, "the left of the floor sits on the frame");
  assert.ok(Math.abs(top - 50) < 1e-6, "the top of the floor sits on the frame");
  assert.ok(Math.abs(right - left - 6 * 20) < 1e-6, "six metres stay six metres");
  assert.ok(Math.abs(bottom - top - 4 * 20) < 1e-6, "four metres stay four metres");

  const px = 140;
  const py = 90;
  const planX = drawn.minX + (px - drawn.originX) / drawn.scaleX;
  const planY = (py - drawn.originY) / drawn.scaleY;
  const view = zoomElevationView(drawn.fit, { zoom: 1, panX: 0, panY: 0 }, px, py, 2);
  const zoomed = floorPictureSvg({ width: 640, height: 280, host, frame, view });
  const x = zoomed.originX + (planX - zoomed.minX) * zoomed.scaleX;
  const y = zoomed.originY + planY * zoomed.scaleY;
  assert.ok(Math.abs(x - px) < 1e-6, "zooming keeps the point under the cursor");
  assert.ok(Math.abs(y - py) < 1e-6, "zooming keeps the point's height");
  assert.ok(view.zoom > 1 && view.zoom < 16, "the picture can zoom in past the strip");
  const out = zoomElevationView(drawn.fit, { zoom: 1, panX: 0, panY: 0 }, px, py, 1 / 4);
  assert.ok(out.zoom < 1, "the picture can zoom out past the plan match");
});

test("moving the floor carries the picture, and align puts its centre back", () => {
  const box = floorBox([[0, 0], [6, 0], [6, 4], [0, 4]]);
  const hold = trackFloorHold(null, box, 10, { x: 200, y: 120 });
  const moved = floorBox([[2, -1], [8, -1], [8, 3], [2, 3]]);
  const next = trackFloorHold(hold, moved, 10);
  assert.ok(Math.abs(next.centerX - 220) < 1e-6, "a move to the right moves the picture");
  assert.ok(Math.abs(next.centerY - 110) < 1e-6, "a move up the plan moves the picture up");
  const parked = trackFloorHold(next, moved, 10);
  assert.ok(Math.abs(parked.centerX - next.centerX) < 1e-6, "panning the plan is not a move of the floor");

  const centered = floorHoldCentered(moved, 10, 2, 400, 200);
  const frame = floorFrameFromHold(moved, 10, centered);
  const halfW = moved.spanX / 2 * 10;
  assert.ok(Math.abs(frame.originX + halfW * 2 - 200) < 1e-6, "align keeps the centre at this zoom");
});

test("growing the floor shifts the sample the opposite way from shrinking it", () => {
  const inner = [[2, 1], [4, 1], [4, 3], [2, 3]];
  const picture = (host) => floorPictureSvg({
    width: 640,
    height: 280,
    host,
    regions: [{ id: "tile", category: "floorTile", label: "Floor tile", fill: "#6a8fbf", poly: inner, areaText: "4 m²" }],
  });
  const screenX = (drawn, x) => drawn.originX + (x - drawn.minX) * drawn.scaleX;
  const base = picture([[0, 0], [6, 0], [6, 4], [0, 4]]);
  const smaller = picture([[0, 0], [5, 0], [5, 4], [0, 4]]);
  const bigger = picture([[0, 0], [8, 0], [8, 4], [0, 4]]);
  const at = screenX(base, 3);
  assert.ok(screenX(smaller, 3) > at + 1, "a smaller floor moves the sample sideways");
  assert.ok(screenX(bigger, 3) < at - 1, "a bigger floor moves it the other way");
});

test("opening the floor frames the plan that the strip leaves clear", () => {
  const src = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const start = src.indexOf("function visiblePlanRect(");
  const end = src.indexOf("function heldFloorFrame(");
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  assert.match(body, /canvasWrap \|\| el\.canvas/);
  assert.match(body, /function visiblePlanRect\(\)/);
  assert.doesNotMatch(body, /el\.canvas\.getBoundingClientRect\(\)/);
  assert.match(body, /fitCam/);
});

test("the open picture redraws when the floor outline changes and the finishes do not", () => {
  const src = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const start = src.indexOf("function syncFloorPictureDock()");
  const end = src.indexOf("function syncElevationDock()");
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  const keyAt = body.indexOf("const key = `");
  assert.ok(keyAt >= 0);
  const key = body.slice(keyAt, body.indexOf("`;", keyAt));
  assert.match(key, /JSON\.stringify\(poly\)/);
  assert.match(key, /frameKey/);
  assert.match(body, /heldFloorFrame\(poly\)/);
  assert.match(body, /heldScreenFloorFrame\(poly\)/);
  assert.match(body, /syncElevationAlignState\(true\)/);
  assert.match(body, /v2-elev-second-screen|el\.elevSecondScreen/);
  assert.match(body, /frame,/);
  assert.doesNotMatch(body, /setHidden\(el\.elevAlign, true\)/);
});

test("Show in the plan closes the second window and leaves the elevation or floor open", () => {
  const src = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const start = src.indexOf("function returnFaceToPlan()");
  const end = src.indexOf("/** The second window was closed.");
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  assert.match(body, /stopScreenWatch\(\)/);
  assert.match(body, /elevationHost = "strip"/);
  assert.match(body, /mountFaceInStrip\(\)/);
  assert.match(body, /win\.close\(\)/);
  assert.doesNotMatch(body, /endFace\(\)/);
  assert.doesNotMatch(body, /closeOpenFace\(\)/);
  assert.doesNotMatch(body, /closeFloorPicture\(\)/);
  assert.match(src, /Show in the plan/);
  assert.match(src, /returnFaceToPlan/);
});

test("the floor picture uses the second screen when that window is the host", () => {
  const src = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const start = src.indexOf("if (floorPicture) {");
  const end = src.indexOf("const leavingFloor");
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  assert.match(body, /placeFaceParts\(inScreen\)/);
  assert.doesNotMatch(body, /placeFaceParts\(false\)/);
  assert.match(body, /syncFloorPictureDock\(\)/);
});

test("Floor finishes opens the picture and does not open the floor-type palette", () => {
  const src = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const start = src.indexOf("function openFloorFinishes()");
  const end = src.indexOf("function openWallFinishes()");
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  assert.match(body, /openFloorPicture\(/);
  assert.match(body, /Select a room or a slab\./);
  assert.doesNotMatch(body, /paletteFilter/);
  assert.doesNotMatch(body, /tool = "room"/);
  assert.doesNotMatch(body, /setTypeFlyoutOpen\(true\)/);
});

test("the open floor inspector is one line per finish, with level behind one row", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "r1", name: "Kitchen", level: "01 GFL", shape: polyShape(HOST) }],
  });
  const screed = createFinishRegion(doc, {
    level: "01 GFL",
    roomId: "r1",
    category: "screed",
    shape: polyShape(HOST),
  });
  const patch = createFinishRegion(doc, {
    level: "01 GFL",
    roomId: "r1",
    category: "screed",
    shape: polyShape([[0.05, 0.05], [0.4, 0.05], [0.4, 0.3], [0.05, 0.3]]),
  });
  const tile = createFinishRegion(doc, {
    level: "01 GFL",
    roomId: "r1",
    category: "floorTile",
    shape: polyShape(TILE),
  });
  const html = floorOpenHtml(doc, {
    name: "Kitchen",
    kind: "room",
    levelName: "Ground",
    status: "Proposed",
    wallHeightText: "2700 mm",
    outline: "Polygon. Corners of this floor are edited on the plan.",
    poly: roomPolygon(doc.rooms[0]),
  }, [screed, patch, tile], {
    selectedId: tile.id,
    coversHost: [screed.id],
    floorSelected: false,
  });
  const hostAt = html.indexOf('data-fin-block="host"');
  const finishesBlock = html.indexOf('data-fin-block="finishes"');
  const floorRow = html.indexOf('data-fin="floor-host"');
  assert.ok(hostAt > 0 && finishesBlock > hostAt);
  assert.ok(floorRow > hostAt && floorRow < finishesBlock, "the floor row is its own section");
  assert.match(html.slice(finishesBlock), /Finishes on this floor/);
  assert.doesNotMatch(html.slice(finishesBlock), /data-fin="floor-host"/);
  assert.match(html, /Screed 1 of 2/);
  assert.match(html, /Screed 2 of 2/);
  assert.match(html, /Floor tile on the screed, 2\.00 m²/);
  assert.match(html, /Level and other settings/);
  assert.match(html, /Whole floor, follows the outline/);
  assert.match(html, /Drawn area/);
  assert.match(html, /m²/);
  assert.doesNotMatch(html, /Finish every wall of this room/);
  assert.doesNotMatch(html, /data-fin="region-draw"/);
  assert.doesNotMatch(html, /Openings/);
});

test("the floor list stays while the strip is closed, and a finish on the card opens that finish", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="v2-ctx-floor"/);
  assert.match(html, /id="v2-ctx-floor-screen"/);
  assert.match(html, /Open this floor on the second screen/);
  assert.match(html, /Open floor/);
  const src = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  assert.match(src, /function openFloorPreviewOnSecondScreen/);
  const click = src.slice(src.indexOf("el.ctxFloor?.addEventListener(\"click\""), src.indexOf("el.elevInfoDismiss"));
  assert.match(click, /openFloorPicture\(picked\.host\)/);
  assert.match(click, /data-floor-fill/);
  assert.match(click, /editingRegionId = regionId/);
  const panel = src.slice(src.indexOf("function syncFinishPanel"), src.indexOf("function finishField"));
  assert.match(panel, /if \(room \|\| slab\)/);
  assert.match(panel, /floorOpenHtml/);
  assert.doesNotMatch(panel, /!floorHostNow\(\)/);
  const card = src.slice(src.indexOf("function syncFloorCard"), src.indexOf("function finishFaceModel"));
  assert.match(card, /preview:\s*true/);
  assert.match(src, /function setHoverFloor/);
  assert.match(src, /function markHotFloor/);
  const openSelected = src.slice(src.indexOf("function openSelectedFloor"), src.indexOf("function openSelectedFloor") + 500);
  assert.match(openSelected, /openFloorPicture\(picked\.host\)/);
  const move = src.slice(src.indexOf("function onElevationPointerMove"), src.indexOf("function onElevationPointerMove") + 1800);
  assert.match(move, /floorFinishesAt/);
  assert.match(move, /floorFinishLabel/);
});

test("a selected finish keeps the floor outline still, and Delete follows that finish", () => {
  const src = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const highlights = src.slice(src.indexOf("const showCorners"), src.indexOf("const showCorners") + 180);
  assert.match(highlights, /!editingFinishRegion\(\)/);
  assert.doesNotMatch(src, /editingCoveringFinish/);
  const shaping = src.slice(src.indexOf("const shaping = Boolean(selected"), src.indexOf("const shaping = Boolean(selected") + 120);
  assert.match(shaping, /selected && !floorDraft && !floorAddPending/);
  assert.doesNotMatch(shaping, /regionCoversHost/);
  assert.match(src, /function floorFinishDeletePrompt/);
  assert.match(src, /Delete removes this finish\. The floor stays/);
  assert.match(src, /Corner selected\. Delete removes this corner/);
  const hit = src.slice(src.indexOf("const hit = hitTest(wx, wy);"), src.indexOf("const hit = hitTest(wx, wy);") + 800);
  assert.match(hit, /editingFinishRegion\(\)/);
  assert.match(hit, /selectFloorHost\(\)/);
});

test("a floor corner snaps to the floor box and to another corner", () => {
  const face = floorFaceOf(HOST);
  assert.equal(face.length, 4);
  assert.equal(face.height, 3);
  const edge = alignFloorPoint(0.04, 1.5, face, []);
  assert.equal(edge.x, 0);
  assert.equal(edge.y, 1.5);
  assert.equal(edge.guideS, 0);
  assert.equal(edge.guideZ, null);

  const corner = alignFloorPoint(1.04, 0.96, face, [[1, 1]]);
  assert.equal(corner.x, 1);
  assert.equal(corner.y, 1);
  assert.equal(corner.guideS, 1);
  assert.equal(corner.guideZ, 2);
  assert.deepEqual(planToFace(corner.x, corner.y, face), { s: 1, z: 2 });
  assert.deepEqual(faceToPlan(1, 2, face), { x: 1, y: 1 });
});

test("alignment lines and clearances draw on the picture, not on the inspector card", () => {
  const locate = {
    typeable: true,
    side: { s0: 0, s1: 1, z: 1, pinned: true },
    vert: { z0: 0, z1: 1, s: 1, toward: "base", pinned: true },
  };
  const drawn = floorPictureSvg({
    width: 480,
    height: 320,
    host: HOST,
    regions: [{ id: "tile", category: "floorTile", label: "Floor tile", fill: "#6a8fbf", poly: TILE, areaText: "2 m²" }],
    selectedId: "tile",
    guides: { s: 1, z: 1 },
    locate,
  });
  assert.match(drawn.svg, /class="elev-align"/);
  assert.match(drawn.svg, /data-elev-op="locate-h"/);
  assert.match(drawn.svg, /data-elev-op="locate-v"/);

  const card = floorPictureSvg({
    width: 480,
    height: 320,
    host: HOST,
    regions: [{ id: "tile", category: "floorTile", label: "Floor tile", fill: "#6a8fbf", poly: TILE }],
    selectedId: "tile",
    preview: true,
    guides: { s: 1, z: 1 },
    locate,
  });
  assert.doesNotMatch(card.svg, /elev-align/);
  assert.doesNotMatch(card.svg, /data-elev-op/);
});

test("a typed clearance moves the corner in the floor's face", () => {
  const face = floorFaceOf(HOST);
  const points = TILE.map(([x, y]) => planToFace(x, y, face));
  const spec = finishLocate(points, { mode: "corner", index: 0, length: face.length, height: face.height });
  assert.ok(spec?.side);
  const next = applyTypedGap(
    { kind: "vertex", points, index: 0 },
    "h",
    0.5,
    spec,
    face,
  );
  assert.ok(next?.points);
  const plan = faceToPlan(next.points[0].s, next.points[0].z, face);
  assert.ok(Math.abs(plan.x - 0.5) < 1e-9 || Math.abs(plan.x - (face.length - 0.5)) < 1e-9);
  assert.equal(next.points[1].s, points[1].s);
});
