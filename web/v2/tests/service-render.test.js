import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = { devicePixelRatio: 1 };

import { normalizeDoc } from "../model.js";
import { routeProfile } from "../services.js";
import { drawServiceProfile } from "../service-render.js";

const pack = {
  system: { defaultLevel: "L0" },
  levels: [
    { id: "L1", name: "First", elevation: 3 },
    { id: "L2", name: "Second", elevation: 5.8 },
  ],
};

// A horizontal run and a riser at the same plan point, so two profile nodes
// share a chainage and only their height tells them apart.
function riserProfile() {
  const doc = normalizeDoc({
    serviceNetworks: [{ id: "n1", name: "DR-01", system: "drainage", status: "planned" }],
    serviceNodes: [
      { id: "a", networkId: "n1", x: 0, y: 0, level: "L1", offset: 0.3 },
      { id: "b", networkId: "n1", x: 14.6, y: 0, level: "L1", offset: 0.3 },
      { id: "c", networkId: "n1", x: 14.6, y: 0, level: "L2", offset: -0.1 },
    ],
    serviceEdges: [
      { id: "run", networkId: "n1", fromNode: "a", toNode: "b", sku: "DRAIN110", mode: "measured" },
      { id: "riser", networkId: "n1", fromNode: "b", toNode: "c", sku: "DRAIN110", mode: "measured" },
    ],
  });
  return routeProfile(doc, pack, "run");
}

function mockCanvas() {
  const rings = [];
  let path = [];
  const texts = [];
  const ctx = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    globalAlpha: 1,
    _stack: [],
    setTransform() {},
    clearRect() {},
    fillRect() {},
    save() {
      ctx._stack.push({ strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle, lineWidth: ctx.lineWidth, globalAlpha: ctx.globalAlpha });
    },
    restore() {
      Object.assign(ctx, ctx._stack.pop());
    },
    beginPath() { path = []; },
    moveTo() {},
    lineTo() {},
    closePath() {},
    rect() {},
    arc(x, y, r) { path.push({ x, y, r }); },
    stroke() {
      if (ctx.lineWidth === 2.4) {
        for (const p of path) if (p.r === 10) rings.push({ ...p, strokeStyle: ctx.strokeStyle });
      }
    },
    fill() {},
    clip() {},
    strokeRect() {},
    fillText(text, x, y) {
      texts.push({ text, x, y, align: ctx.textAlign, baseline: ctx.textBaseline, width: ctx.measureText(text).width });
    },
    measureText(text) { return { width: String(text).length * 6 }; },
    setLineDash() {},
  };
  return {
    canvas: { clientWidth: 480, clientHeight: 200, width: 0, height: 0, getContext: () => ctx },
    rings: () => rings,
    texts: () => texts,
  };
}

function inkBox(label) {
  const left = label.align === "right" ? label.x - label.width : label.align === "center" ? label.x - label.width / 2 : label.x;
  const top = label.baseline === "middle" ? label.y - 6 : label.y - 9;
  return { x: left, y: top, w: label.width, h: 12, text: label.text };
}

function inkHits(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function ringFor(selectedNodeIds, extra = {}) {
  const view = mockCanvas();
  drawServiceProfile(view.canvas, riserProfile(), {
    selectionColour: "#243044",
    selectedNodeIds,
    ...extra,
  });
  return view.rings();
}

test("the profile rings the selected node, and a higher node sits above a lower one", () => {
  assert.equal(ringFor([]).length, 0);
  const low = ringFor(["b"]);
  const high = ringFor(["c"]);
  assert.equal(low.length, 1);
  assert.equal(high.length, 1);
  assert.equal(low[0].strokeStyle, "#243044");
  assert.ok(Math.abs(low[0].x - high[0].x) < 0.01, "the riser nodes share a chainage");
  assert.ok(high[0].y < low[0].y, "the upper node is highlighted above the lower one");
  const start = ringFor(["a"]);
  assert.ok(start[0].x < low[0].x, "the start node is highlighted further back along the route");
});

test("obstruction captions share the profile without painting over each other", () => {
  const view = mockCanvas();
  const wall = (name, s0, s1) => ({
    known: true,
    name,
    z0: 3,
    z1: 6,
    through: [],
    holes: [],
    head: [{ s0, s1 }],
  });
  drawServiceProfile(view.canvas, riserProfile(), {
    obstructions: {
      walls: [
        wall("Masonry wall 110mm (plaster)", 0, 10),
        wall("Masonry wall 110mm (plaster)", 4.5, 14.6),
        wall("Party wall", 0, 14.6),
      ],
      roofs: [{ name: "Roof", runs: [[{ s: 0, z: 6 }, { s: 14.6, z: 6 }]] }],
      openings: [
        { kind: "window", known: true, z0: 4.2, z1: 5, s0: 1, s1: 2.5, distance: 0 },
        { kind: "window", known: true, z0: 4.3, z1: 5.1, s0: 2.55, s1: 4, distance: 0 },
      ],
      unknownCount: 0,
    },
  });
  const boxes = view.texts().map(inkBox);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.equal(inkHits(boxes[i], boxes[j]), false, `${boxes[i].text} overlaps ${boxes[j].text}`);
    }
  }
  const masonry = boxes.filter((b) => b.text.startsWith("Masonry wall 110mm (plaster) head"));
  assert.deepEqual(masonry.map((b) => b.text), ["Masonry wall 110mm (plaster) head 6.00"]);
  assert.equal(boxes.filter((b) => b.text.startsWith("Party wall head")).length, 1);
  assert.equal(boxes.filter((b) => b.text === "4.20–5.00").length, 1);
  assert.equal(boxes.filter((b) => b.text === "4.30–5.10").length, 0);
});

test("a level run is labelled with its height above the floor, with no riser", () => {
  const doc = normalizeDoc({
    serviceNetworks: [{ id: "n1", name: "GS-01", system: "gas", status: "planned" }],
    serviceNodes: [
      { id: "a", networkId: "n1", x: 0, y: 0, level: "L1", offset: 1.77 },
      { id: "b", networkId: "n1", x: 8, y: 0, level: "L1", offset: 1.77 },
    ],
    serviceEdges: [
      { id: "run", networkId: "n1", fromNode: "a", toNode: "b", sku: "GAS", mode: "measured" },
    ],
  });
  const view = mockCanvas();
  const layout = drawServiceProfile(view.canvas, routeProfile(doc, pack, "run"));
  const texts = view.texts().map((t) => t.text);
  assert.ok(texts.includes("1.77 m above floor"));
  assert.equal(texts.some((t) => t.startsWith("Rise") || t.startsWith("Drop")), false);
  // The floor of this storey stays on the scale, so the gap under the pipe is real.
  assert.ok(layout.zLo < 3, "the scale reaches below the First floor datum");
});

test("a route with a riser still names the level run's height off the floor", () => {
  const view = mockCanvas();
  drawServiceProfile(view.canvas, riserProfile());
  const texts = view.texts().map((t) => t.text);
  assert.ok(texts.includes("0.30 m above floor"));
  assert.equal(texts.filter((t) => t.startsWith("Rise")).length, 1);
});

test("dragging a selected profile node moves its ring to the new height", () => {
  const rested = ringFor(["b"]);
  const lifted = ringFor(["b"], { drag: { nodeId: "b", z: 6, mode: "slope" } });
  assert.equal(lifted.length, 1);
  assert.ok(lifted[0].y < rested[0].y);
});
