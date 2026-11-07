import { test } from "node:test";
import assert from "node:assert/strict";

import { arcFromRadius } from "../click-draw.js";
import { applyCircleTrim, planCircleTrim } from "../circle-trim.js";
import { emptyDoc } from "../model.js";

function near(actual, expected, msg = "") {
  assert.ok(Math.abs(actual - expected) < 1e-4, `${msg} ${actual} vs ${expected}`);
}

function skuById(id) {
  if (id === "D1") return { id, category: "door", name: "Door" };
  if (id === "T220") return { id, category: "wall", name: "220", geometry: { thickness: 0.22 } };
  return null;
}

function wall(id, x1, y1, x2, y2, extra = {}) {
  return { kind: "segment", id, sku: "T220", x1, y1, x2, y2, status: "planned", ...extra };
}

function line(id, x1, y1, x2, y2, kind = "line") {
  return { kind, id, x1, y1, x2, y2 };
}

function cutFor(plan, id) {
  return plan.cuts.find((cut) => cut.id === id) || null;
}

test("a circle offset into one quadrant trims that quadrant's arm of each wall", () => {
  const entities = [wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)];
  const plan = planCircleTrim(entities, { x: 2.4, y: 0.5, r: 0.8 });
  assert.equal(plan.cuts.length, 2);
  assert.equal(cutFor(plan, "a").role, "start");
  assert.equal(cutFor(plan, "b").role, "start");
  near(cutFor(plan, "a").point.x, 2);
  near(cutFor(plan, "a").point.y, 0);
  near(cutFor(plan, "b").point.y, 0);

  const doc = { ...emptyDoc(), segments: entities.map((item) => ({ ...item })) };
  const result = applyCircleTrim(doc, plan.cuts, { skuById });
  assert.equal(result.ok, true);
  const a = doc.segments.find((seg) => seg.id === "a");
  const b = doc.segments.find((seg) => seg.id === "b");
  near(a.x1, 2);
  near(a.x2, 4);
  near(a.y1, 0);
  near(b.x1, 2);
  near(b.y1, 0);
  near(b.y2, 2);
});

test("a circle centred on a crossing leaves both arms", () => {
  const plan = planCircleTrim(
    [wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)],
    { x: 2, y: 0, r: 0.8 },
  );
  assert.deepEqual(plan.cuts, []);
});

test("a stem that already ends on the bar is kept, and the bar loses its short side", () => {
  const plan = planCircleTrim(
    [wall("bar", 0, 0, 4, 0), wall("stem", 2, 0, 2, 2)],
    { x: 2.6, y: 0.15, r: 0.7 },
  );
  assert.equal(cutFor(plan, "stem"), null);
  assert.equal(cutFor(plan, "bar").role, "start");
});

test("a line with nothing crossing it inside the circle is left alone", () => {
  const plan = planCircleTrim(
    [line("a", 0, 0, 4, 0), line("b", 0, 1, 4, 1)],
    { x: 2, y: 0, r: 0.5 },
  );
  assert.deepEqual(plan.cuts, []);
});

test("the short middle of a line, between two crossings, is the part removed", () => {
  const entities = [
    line("span", 0, 0, 6, 0),
    line("c1", 2.4, -1, 2.4, 1),
    line("c2", 2.6, -1, 2.6, 1),
  ];
  const plan = planCircleTrim(entities, { x: 2.5, y: 0, r: 0.5 });
  assert.equal(cutFor(plan, "span").role, "middle");
  assert.equal(cutFor(plan, "c1"), null);
  assert.equal(cutFor(plan, "c2"), null);
  const doc = { ...emptyDoc(), lines: entities.map((item) => ({ ...item, kind: "model" })) };
  doc.lines.forEach((item) => { item.kind = "model"; });
  const stored = entities.map((item) => ({ id: item.id, kind: "model", x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 }));
  doc.lines = stored;
  const cuts = plan.cuts.map((cut) => ({ ...cut, kind: "line" }));
  const result = applyCircleTrim(doc, cuts, { skuById });
  assert.equal(result.ok, true);
  assert.equal(doc.lines.length, 4);
  const span = doc.lines.find((item) => item.id === "span");
  const other = doc.lines.find((item) => item.id !== "span" && item.y1 === 0 && item.y2 === 0);
  near(span.x2, 2.4);
  near(other.x1, 2.6);
  near(other.x2, 6);
  assert.equal(span.kind, "model");
});

test("a wall loses the short span between two crossings and keeps both ends", () => {
  const entities = [
    wall("span", 0, 0, 6, 0),
    line("c1", 2.4, -1, 2.4, 1),
    line("c2", 2.6, -1, 2.6, 1),
  ];
  const plan = planCircleTrim(entities, { x: 2.5, y: 0, r: 0.5 });
  assert.equal(cutFor(plan, "span").role, "middle");
  const doc = {
    ...emptyDoc(),
    segments: [{ id: "span", sku: "T220", x1: 0, y1: 0, x2: 6, y2: 0, status: "planned" }],
    lines: [
      { id: "c1", kind: "model", x1: 2.4, y1: -1, x2: 2.4, y2: 1 },
      { id: "c2", kind: "model", x1: 2.6, y1: -1, x2: 2.6, y2: 1 },
    ],
  };
  const result = applyCircleTrim(doc, plan.cuts, { skuById });
  assert.equal(result.ok, true);
  const head = doc.segments.find((seg) => seg.id === "span");
  const tail = doc.segments.find((seg) => seg.id !== "span");
  near(head.x1, 0);
  near(head.x2, 2.4);
  near(tail.x1, 2.6);
  near(tail.x2, 6);
  assert.equal(doc.lines.length, 2);
});

test("a beam and a separation trim the same way as a line", () => {
  const entities = [
    line("beam", 0, 0, 4, 0, "beam"),
    line("sep", 2, -2, 2, 2, "separation"),
  ];
  const plan = planCircleTrim(entities, { x: 2.4, y: 0.5, r: 0.8 });
  const doc = {
    ...emptyDoc(),
    beams: [{ id: "beam", x1: 0, y1: 0, x2: 4, y2: 0 }],
    separations: [{ id: "sep", x1: 2, y1: -2, x2: 2, y2: 2 }],
  };
  const result = applyCircleTrim(doc, plan.cuts, { skuById });
  assert.equal(result.ok, true);
  near(doc.beams[0].x1, 2);
  near(doc.beams[0].x2, 4);
  near(doc.separations[0].y1, 0);
  near(doc.separations[0].y2, 2);
});

test("a door on the arm being removed stops that wall, and the other wall still trims", () => {
  const entities = [wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)];
  const plan = planCircleTrim(entities, { x: 2.4, y: 0.5, r: 0.8 });
  const doc = {
    ...emptyDoc(),
    segments: entities.map((item) => ({ ...item })),
    openings: [{ id: "d1", sku: "D1", wallId: "b", t: 0.2, status: "planned" }],
  };
  const result = applyCircleTrim(doc, plan.cuts, { skuById });
  assert.equal(result.ok, true);
  assert.equal(result.skipped.length, 1);
  assert.match(result.message, /door/);
  near(doc.segments.find((seg) => seg.id === "a").x1, 2);
  near(doc.segments.find((seg) => seg.id === "b").y1, -2);
  near(doc.segments.find((seg) => seg.id === "b").y2, 2);
  assert.equal(doc.openings[0].wallId, "b");
});

test("a door on the part that stays keeps its place on the plan", () => {
  const entities = [wall("a", 0, 0, 4, 0), wall("b", 2, -2, 2, 2)];
  const plan = planCircleTrim(entities, { x: 2.4, y: 0.5, r: 0.8 });
  const doc = {
    ...emptyDoc(),
    segments: entities.map((item) => ({ ...item })),
    openings: [{ id: "d1", sku: "D1", wallId: "b", t: 0.75, status: "planned" }],
  };
  const result = applyCircleTrim(doc, plan.cuts, { skuById });
  assert.equal(result.ok, true);
  assert.equal(result.skipped.length, 0);
  const b = doc.segments.find((seg) => seg.id === "b");
  near(b.y1, 0);
  near(b.y2, 2);
  near(doc.openings[0].t, 0.5);
});

test("a curved wall loses its short end and stays a curve", () => {
  const arc = arcFromRadius(0, 0, 4, 0, 3, 1, false);
  const s = arc.length * 0.82;
  const dir = arc.sweep >= 0 ? 1 : -1;
  const ang = arc.a0 + dir * (s / arc.radius);
  const x = arc.cx + Math.cos(ang) * arc.radius;
  const y = arc.cy + Math.sin(ang) * arc.radius;
  const back = s - 0.3;
  const bang = arc.a0 + dir * (back / arc.radius);
  const bx = arc.cx + Math.cos(bang) * arc.radius;
  const by = arc.cy + Math.sin(bang) * arc.radius;
  const nx = Math.cos(ang);
  const ny = Math.sin(ang);
  const entities = [
    wall("a", 0, 0, 4, 0, { arc: { radius: 3, side: 1 } }),
    line("cut", x - nx, y - ny, x + nx, y + ny),
  ];
  const plan = planCircleTrim(entities, { x: bx, y: by, r: 0.55 });
  const cut = cutFor(plan, "a");
  assert.ok(cut, "the arc has a short end inside the circle");
  assert.equal(cut.role, "end");
  const doc = {
    ...emptyDoc(),
    segments: [{ ...entities[0] }],
    lines: [{ id: "cut", kind: "model", x1: x - nx, y1: y - ny, x2: x + nx, y2: y + ny }],
  };
  const result = applyCircleTrim(doc, plan.cuts, { skuById });
  assert.equal(result.ok, true);
  const kept = doc.segments.find((seg) => seg.id === "a");
  assert.ok(kept.arc);
  near(kept.x2, x);
  near(kept.y2, y);
  near(kept.x1, 0);
  near(kept.y1, 0);
});

test("two ends inside the circle stretch to where the lines would meet", () => {
  const entities = [wall("down", 0, 2, 0, 0.4), wall("diag", 1.2, 0.2, 3, 1.2)];
  const plan = planCircleTrim(entities, { x: 0.5, y: 0, r: 1.3 });
  assert.equal(cutFor(plan, "down").role, "extend-end");
  assert.equal(cutFor(plan, "diag").role, "extend-start");
  const meet = cutFor(plan, "down").point;
  near(cutFor(plan, "diag").point.x, meet.x);
  near(cutFor(plan, "diag").point.y, meet.y);
  const doc = { ...emptyDoc(), segments: entities.map((item) => ({ ...item })) };
  const result = applyCircleTrim(doc, plan.cuts, { skuById });
  assert.equal(result.ok, true);
  assert.match(result.message, /Extended/);
  const down = doc.segments.find((seg) => seg.id === "down");
  const diag = doc.segments.find((seg) => seg.id === "diag");
  near(down.x2, meet.x);
  near(down.y2, meet.y);
  near(diag.x1, meet.x);
  near(diag.y1, meet.y);
  near(down.y1, 2);
  near(diag.x2, 3);
});

test("a meeting outside the circle does not stretch an end the circle covers", () => {
  const plan = planCircleTrim(
    [wall("down", 0, 2, 0, 0.4), wall("diag", 1.2, 0.2, 3, 1.2)],
    { x: 0, y: 0.4, r: 0.25 },
  );
  assert.equal(cutFor(plan, "down"), null);
  assert.equal(cutFor(plan, "diag"), null);
});

test("a line that already reaches the crossing is not stretched", () => {
  const plan = planCircleTrim(
    [wall("bar", 0, 0, 4, 0), wall("stem", 2, 0.5, 2, 2)],
    { x: 2, y: 0.25, r: 0.45 },
  );
  assert.equal(cutFor(plan, "bar"), null);
  assert.equal(cutFor(plan, "stem").role, "extend-start");
  near(cutFor(plan, "stem").point.x, 2);
  near(cutFor(plan, "stem").point.y, 0);
});

test("one arm per line when three lines meet", () => {
  const plan = planCircleTrim(
    [
      wall("h", 0, 0, 4, 0),
      wall("v", 2, -2, 2, 2),
      wall("d", 0, -1, 4, 1),
    ],
    { x: 2.35, y: 0.28, r: 0.7 },
  );
  const ids = plan.cuts.map((cut) => cut.id).sort();
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 1);
  for (const cut of plan.cuts) assert.equal(cut.samples.length >= 2, true);
});
