import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fixtureFrame,
  fixturePrimitives,
  fixtureSymbolKind,
  paintFixture,
} from "../plan-symbols.js";

function sku(category, name, family = "") {
  return { category, name, family, geometry: { width: 0.5, depth: 0.7 } };
}

function extent(parts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const p of parts) {
    if (p.op === "rect" || p.op === "roundRect") {
      add(p.x, p.y);
      add(p.x + p.w, p.y + p.h);
    } else if (p.op === "ellipse") {
      add(p.cx - p.rx, p.cy - p.ry);
      add(p.cx + p.rx, p.cy + p.ry);
    } else if (p.op === "circle") {
      add(p.cx - p.r, p.cy - p.r);
      add(p.cx + p.r, p.cy + p.r);
    } else if (p.op === "line") {
      add(p.x1, p.y1);
      add(p.x2, p.y2);
    } else if (p.op === "polyline") {
      for (const [x, y] of p.pts) add(x, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

test("sanitary names pick the SANS 10143 symbol", () => {
  assert.equal(fixtureSymbolKind(sku("sanitary", "TSP Closed Couple WC — Closed Couple", "TSP Closed Couple WC")), "wc");
  assert.equal(fixtureSymbolKind(sku("sanitary", "TSP Toilet 3D Wall Based — Closed Couple", "TSP Toilet 3D Wall Based")), "wc");
  assert.equal(fixtureSymbolKind(sku("sanitary", "Wall hung pan")), "wc-wall");
  assert.equal(fixtureSymbolKind(sku("sanitary", "TSP_Minimal_Hand_Wash_Basin_16201 — WHB")), "basin");
  assert.equal(fixtureSymbolKind(sku("sanitary", "TSP Washing Machine — Washing Machine")), "washer");
  assert.equal(fixtureSymbolKind(sku("sanitary", "TSP_Bath Tub - Maestro — 1675 mmx915 mm - Built in")), "bath");
  assert.equal(fixtureSymbolKind(sku("sanitary", "TSP_Tub-Free Standing-3D — 760 x 1525mm")), "bath-free");
  assert.equal(fixtureSymbolKind(sku("sanitary", "TSP_Shower Stall - Rectangular — 915 mmx915 mm")), "shower");
  assert.equal(fixtureSymbolKind(sku("sanitary", "TSP_Sink - Kitchen - Double — 1065 mmx535 mm")), "sink-double");
  assert.equal(fixtureSymbolKind(sku("sanitary", "TSP_Sink Vanity-Round — 482 x 482mm")), "basin-round");
  assert.equal(fixtureSymbolKind(sku("casework", "TSP_Dishwasher — 600mm")), "dishwasher");
  assert.equal(fixtureSymbolKind(sku("furniture", "Desk")), null);
});

test("a close-coupled WC has its cistern against the wall and the pan in front", () => {
  const parts = fixturePrimitives("wc", 0.507, 0.793);
  const cistern = parts.find((p) => p.op === "rect");
  const pan = parts.find((p) => p.op === "polyline");
  assert.ok(cistern);
  assert.equal(cistern.y, 0);
  assert.ok(cistern.h < 0.793 * 0.4);
  assert.ok(pan.pts.length > 4);
  const front = Math.max(...pan.pts.map((p) => p[1]));
  const back = Math.min(...pan.pts.map((p) => p[1]));
  assert.ok(front > cistern.h);
  assert.ok(back < cistern.h);
});

test("a wall-hung pan has no cistern", () => {
  const parts = fixturePrimitives("wc-wall", 0.38, 0.54);
  assert.equal(parts.some((p) => p.op === "rect"), false);
  assert.ok(parts.some((p) => p.op === "polyline"));
});

test("symbols stay inside the measured footprint", () => {
  const samples = [
    ["wc", 0.507, 0.793],
    ["wc-wall", 0.38, 0.54],
    ["basin", 0.54, 0.519],
    ["basin-round", 0.482, 0.482],
    ["vanity", 0.9, 0.48],
    ["bath", 1.675, 0.915],
    ["bath-free", 0.76, 1.525],
    ["shower", 0.915, 0.915],
    ["washer", 0.594, 0.639],
    ["dishwasher", 0.6, 0.6],
    ["sink", 1.0, 0.5],
    ["sink-double", 1.065, 0.535],
    ["bidet", 0.38, 0.6],
    ["urinal", 0.35, 0.4],
    ["geyser", 0.55, 0.55],
  ];
  for (const [kind, w, d] of samples) {
    const box = extent(fixturePrimitives(kind, w, d));
    assert.ok(box.minX >= -0.002, `${kind} left`);
    assert.ok(box.minY >= -0.002, `${kind} back`);
    assert.ok(box.maxX <= w + 0.002, `${kind} right ${box.maxX}`);
    assert.ok(box.maxY <= d + 0.002, `${kind} front ${box.maxY}`);
  }
});

test("a built-in bath is drawn to its stated size, with a rim inside", () => {
  const parts = fixturePrimitives("bath", 1.675, 0.915);
  const outer = parts.find((p) => p.op === "rect");
  const rim = parts.find((p) => p.op === "roundRect");
  assert.equal(outer.w, 1.675);
  assert.equal(outer.h, 0.915);
  assert.ok(rim.w < outer.w);
  assert.ok(rim.h < outer.h);
  assert.equal(parts.filter((p) => p.op === "circle").length, 3);
});

test("a washing machine is a rectangle with a door, a shower is a crossed tray", () => {
  const washer = fixturePrimitives("washer", 0.594, 0.639);
  assert.ok(washer.some((p) => p.op === "rect"));
  const door = washer.find((p) => p.op === "circle");
  assert.ok(door.r > 0.1 && door.r < 0.32);
  const shower = fixturePrimitives("shower", 0.915, 0.915);
  const diagonals = shower.filter((p) => p.op === "line");
  assert.equal(diagonals.length, 2);
  assert.ok(shower.some((p) => p.op === "circle"));
});

test("rotation turns the wall side and stays in the placed box", () => {
  const w = 0.507;
  const d = 0.793;
  const back = (rotation) => {
    const f = fixtureFrame(rotation, w, d);
    return {
      x: f.a * (w / 2) + f.c * 0 + f.e,
      y: f.b * (w / 2) + f.d * 0 + f.f,
    };
  };
  assert.equal(back(0).y, 0);
  assert.ok(Math.abs(back(180).y - d) < 1e-9);
  assert.equal(back(90).x, 0);
  assert.ok(Math.abs(back(270).x - d) < 1e-9);
  for (const rotation of [0, 90, 180, 270]) {
    const f = fixtureFrame(rotation, w, d);
    const swapped = rotation === 90 || rotation === 270;
    const bw = swapped ? d : w;
    const bd = swapped ? w : d;
    for (const [u, v] of [[0, 0], [w, 0], [w, d], [0, d]]) {
      const x = f.a * u + f.c * v + f.e;
      const y = f.b * u + f.d * v + f.f;
      assert.ok(x >= -1e-9 && x <= bw + 1e-9, `${rotation} x ${x}`);
      assert.ok(y >= -1e-9 && y <= bd + 1e-9, `${rotation} y ${y}`);
    }
  }
});

test("paintFixture strokes a WC and leaves a desk alone", () => {
  const ops = [];
  const ctx = {
    beginPath() { ops.push("begin"); },
    moveTo() {},
    lineTo() {},
    rect() { ops.push("rect"); },
    arc() { ops.push("arc"); },
    ellipse() { ops.push("ellipse"); },
    arcTo() {},
    closePath() {},
    stroke() { ops.push("stroke"); },
  };
  const drawn = paintFixture(
    ctx,
    { x: 1, y: 2, rotation: 0 },
    sku("sanitary", "Closed Couple WC"),
    (x, y) => [x * 100, y * 100],
    100,
  );
  assert.equal(drawn, true);
  assert.ok(ops.includes("rect"));
  assert.ok(ops.includes("stroke"));
  assert.equal(paintFixture(ctx, { x: 0, y: 0 }, sku("furniture", "Desk"), (x, y) => [x, y], 10), false);
});
