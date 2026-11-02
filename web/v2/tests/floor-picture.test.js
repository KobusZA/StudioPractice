// The floor picture reuses the wall elevation strip. These checks stay on
// the picture, the open command, and the inspector list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFinishRegion } from "../finish-model.js";
import { floorOpenHtml } from "../finish-panel.js";
import { pointInPoly } from "../geom.js";
import { alignFloorPoint, faceToPlan, floorFaceOf, floorPictureSvg, planToFace, resolveFloorFinishOpen } from "../floor-picture.js";
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
  assert.match(html, /Open floor/);
  const src = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const click = src.slice(src.indexOf("el.ctxFloor?.addEventListener(\"click\""), src.indexOf("el.elevInfoDismiss"));
  assert.match(click, /openFloorPicture\(/);
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
  const hit = src.slice(src.indexOf("const hit = hitTest(wx, wy);"), src.indexOf("const hit = hitTest(wx, wy);") + 500);
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
