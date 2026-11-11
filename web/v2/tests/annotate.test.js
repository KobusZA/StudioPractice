import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  STANDARD_COLOURS,
  cleanDimensionText,
  dimensionDirFor,
  dimensionGeometry,
  dimensionLabel,
  offsetThrough,
  textShiftThrough,
} from "../notes.js";
import { cleanLineArc, knownLineArrow, lineArrowHeads, rectangleSides } from "../line-styles.js";
import { emptyDoc, normalizeDoc } from "../model.js";
import { mirrorSelection } from "../modify.js";
import { exportDxf } from "../dxf.js";
import { normalizePackUnits } from "../schema.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);

test("a horizontal dimension measures only the distance across", () => {
  const dim = { x1: 0, y1: 0, x2: 3, y2: 4, dir: "horizontal" };
  const g = dimensionGeometry(dim);
  near(g.length, 3);
  assert.equal(dimensionLabel(dim).measured, dimensionLabel({ x1: 0, y1: 0, x2: 3, y2: 0 }).measured);
  near(g.a.y, g.b.y);
});

test("a vertical dimension measures only the distance up and down", () => {
  const dim = { x1: 0, y1: 0, x2: 3, y2: -4, dir: "vertical" };
  const g = dimensionGeometry(dim);
  near(g.length, 4);
  near(g.a.x, g.b.x);
});

test("a horizontal dimension's line goes through the point it was placed at", () => {
  const dim = { x1: 0, y1: 0, x2: 3, y2: 4, dir: "horizontal" };
  dim.offset = offsetThrough(dim, { x: 1, y: 6 });
  const g = dimensionGeometry(dim);
  near(g.a.y, 6);
  near(g.b.y, 6);
  near(g.a.x, 0);
  near(g.b.x, 3);
});

test("pulling the line above or below picks horizontal, to the side vertical", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 3, y: 4 };
  assert.equal(dimensionDirFor(a, b, { x: 1.5, y: 6 }), "horizontal");
  assert.equal(dimensionDirFor(a, b, { x: -2, y: 2 }), "vertical");
  assert.equal(dimensionDirFor(a, b, { x: 1.5, y: 2 }), "aligned");
  assert.equal(dimensionDirFor(a, { x: 3, y: 0 }, { x: 1, y: 5 }), "aligned");
});

test("the number sits mid-line until it is dragged, then has a leader to the line", () => {
  const dim = { x1: 0, y1: 0, x2: 4, y2: 0 };
  const plain = dimensionGeometry(dim);
  assert.deepEqual(plain.label, plain.mid);
  assert.equal(plain.leaderTo, null);
  const shift = textShiftThrough(dim, { x: 3, y: 1 });
  assert.deepEqual(shift, { along: 1, off: 1 });
  const moved = dimensionGeometry({ ...dim, textShift: shift });
  near(moved.label.x, 3);
  near(moved.label.y, 1);
  near(moved.leaderTo.x, 3);
  near(moved.leaderTo.y, 0);
});

test("a number dropped near the middle of its line goes back on it", () => {
  const dim = { x1: 0, y1: 0, x2: 4, y2: 0 };
  assert.equal(textShiftThrough(dim, { x: 2.05, y: 0.04 }, 0.1), null);
  assert.deepEqual(textShiftThrough(dim, { x: 3, y: 0.04 }, 0.1), { along: 1, off: 0 });
});

test("direction and the number's place are saved, and nothing when they are the default", () => {
  assert.deepEqual(cleanDimensionText({ dir: "vertical", textShift: { along: 0.5, off: 0 } }), { dir: "vertical", textShift: { along: 0.5, off: 0 } });
  assert.deepEqual(cleanDimensionText({ dir: "aligned", textShift: { along: 0, off: 0 } }), {});
  assert.deepEqual(cleanDimensionText({ dir: "sideways" }), {});
});

test("a fill keeps its words and where they were dragged", () => {
  const doc = normalizeDoc({
    ...emptyDoc(),
    regions: [{ id: "r1", shape: { kind: "rect", x: 0, y: 0, w: 4, h: 2 }, text: "  Concrete  ", textDx: 0.4, textDy: 0 }],
  });
  assert.equal(doc.regions[0].text, "Concrete");
  assert.equal(doc.regions[0].textDx, 0.4);
  assert.equal(doc.regions[0].textDy, undefined);
});

test("the standard colours are six distinct hex colours, black first", () => {
  assert.equal(STANDARD_COLOURS.length, 6);
  assert.equal(STANDARD_COLOURS[0].hex, "#1a1612");
  assert.equal(new Set(STANDARD_COLOURS.map((c) => c.hex)).size, 6);
  for (const c of STANDARD_COLOURS) assert.match(c.hex, /^#[0-9a-f]{6}$/);
});

test("a rectangle is four sides that close", () => {
  const sides = rectangleSides({ x: 0, y: 0 }, { x: 2, y: 1 });
  assert.equal(sides.length, 4);
  for (let i = 0; i < 4; i += 1) {
    const next = sides[(i + 1) % 4];
    assert.equal(sides[i].x2, next.x1);
    assert.equal(sides[i].y2, next.y1);
  }
});

test("arrowheads point out of the line's ends", () => {
  const line = { x1: 0, y1: 0, x2: 2, y2: 0, arrow: "both" };
  const [start, end] = lineArrowHeads(line);
  assert.deepEqual([start.x, start.y], [0, 0]);
  near(start.dir.x, -1);
  assert.deepEqual([end.x, end.y], [2, 0]);
  near(end.dir.x, 1);
  assert.deepEqual(lineArrowHeads({ ...line, arrow: "none" }), []);
  assert.equal(lineArrowHeads({ ...line, arrow: "end" }).length, 1);
});

test("an arc's arrowhead follows the curve at its end", () => {
  // Quarter circle about the origin from (1,0) to (0,1), y down.
  const arc = { cx: 0, cy: 0, radius: 1, a0: 0, sweep: Math.PI / 2 };
  const [end] = lineArrowHeads({ x1: 1, y1: 0, x2: 0, y2: 1, arrow: "end" }, arc);
  near(end.dir.x, -1, 1e-9);
  near(end.dir.y, 0, 1e-9);
});

test("a line keeps its arrows and arc through a save, and drops bad ones", () => {
  const doc = normalizeDoc({
    ...emptyDoc(),
    lines: [
      { id: "l1", kind: "annotation", x1: 0, y1: 0, x2: 2, y2: 0, arrow: "end", arc: { radius: 1.5, side: -1, major: true } },
      { id: "l2", kind: "annotation", x1: 0, y1: 0, x2: 2, y2: 0, arrow: "up", arc: { radius: -1, side: 1 } },
    ],
  });
  assert.equal(doc.lines[0].arrow, "end");
  assert.deepEqual(doc.lines[0].arc, { radius: 1.5, side: -1, major: true });
  assert.equal(doc.lines[1].arrow, undefined);
  assert.equal(doc.lines[1].arc, undefined);
  assert.equal(knownLineArrow("both"), "both");
  assert.equal(cleanLineArc({ radius: 2, side: 0 }), null);
});

test("mirroring an arc keeps its bow on the mirrored side", () => {
  const doc = normalizeDoc({
    ...emptyDoc(),
    lines: [{ id: "l1", kind: "annotation", x1: 0, y1: 0, x2: 2, y2: 0, arc: { radius: 1.5, side: 1 } }],
  });
  mirrorSelection(doc, [{ kind: "line", id: "l1" }], { axis: "h" });
  assert.equal(doc.lines[0].arc.side, -1);
});

test("mirroring a dimension keeps its line on the mirrored side", () => {
  const doc = normalizeDoc({
    ...emptyDoc(),
    dimensions: [{ id: "d1", x1: 0, y1: 0, x2: 4, y2: 0, offset: 1 }],
  });
  const before = dimensionGeometry(doc.dimensions[0]);
  mirrorSelection(doc, [{ kind: "dimension", id: "d1" }], { axis: "h" });
  const dim = doc.dimensions[0];
  const after = dimensionGeometry(dim);
  near(after.a.y - dim.y1, -(before.a.y - 0), 1e-6);
});

test("an arced model line goes to the DXF as an ARC", () => {
  const pack = normalizePackUnits(JSON.parse(readFileSync(new URL("../../samples/tsp-pack.json", import.meta.url))));
  const doc = normalizeDoc({
    packId: pack.id,
    lines: [{ id: "l1", kind: "model", x1: 0, y1: 0, x2: 2, y2: 0, arc: { radius: 1, side: 1 } }],
  });
  const { text, report } = exportDxf(doc, pack);
  assert.equal(report.counts.lines, 1);
  const rows = text.split("\n");
  const at = rows.findIndex((row, i) => row === "0" && rows[i + 1] === "ARC");
  assert.ok(at >= 0, "an ARC entity");
  const radius = rows[rows.indexOf("40", at) + 1];
  assert.equal(radius, "1000.000");
});
