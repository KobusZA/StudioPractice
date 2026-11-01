import test from "node:test";
import assert from "node:assert/strict";

import { LADDERS, maxStep, planSteps, shrinkKey } from "../ribbon-fit.js";
import { RIBBON, SIMPLE_TABS } from "../ribbon.js";

// A toy width model: each group's width depends on its kind and step, so the
// planner can be exercised without a browser. Wider = nicer.
const WIDTHS = {
  large: [130, 110, 90, 40],
  stack: [260, 220, 190, 90, 40],
  mixed: [300, 260, 240, 220, 190, 170, 100, 40],
};
const widthOf = (g, step) => WIDTHS[g.kind][step];
const total = (groups, steps) => groups.reduce((sum, g, i) => sum + widthOf(g, steps[i]), 0);
const fitsIn = (groups, limit) => (steps) => total(groups, steps) <= limit;

const GROUPS = [
  { kind: "mixed", prio: 2 }, // Add drawing
  { kind: "stack", prio: 1 }, // Levels
  { kind: "stack", prio: -1 }, // Walls
  { kind: "stack", prio: 3 }, // Finishes
  { kind: "stack", prio: 3 }, // Floors & roofs
  { kind: "stack", prio: 3 }, // Ceilings
  { kind: "large", prio: 3 }, // Openings
  { kind: "stack", prio: 0 }, // Services
];

test("only Openings opts into large buttons", () => {
  const labels = [...RIBBON, ...SIMPLE_TABS]
    .flatMap((tab) => tab.groups)
    .filter((group) => group.large)
    .map((group) => group.label);
  assert.deepEqual([...new Set(labels)], ["Openings"]);
});

test("every ladder width table matches its ladder length", () => {
  for (const kind of Object.keys(LADDERS)) {
    assert.equal(WIDTHS[kind].length, LADDERS[kind].length, kind);
    assert.equal(maxStep(kind), LADDERS[kind].length - 1);
  }
});

test("a wide window keeps every group at its best look", () => {
  const steps = planSteps(GROUPS, fitsIn(GROUPS, 5000));
  assert.deepEqual(steps, GROUPS.map(() => 0));
});

test("the plan fits whenever anything can fit", () => {
  for (let limit = 500; limit <= 1400; limit += 10) {
    const steps = planSteps(GROUPS, fitsIn(GROUPS, limit));
    assert.ok(total(GROUPS, steps) <= limit, `limit ${limit}`);
  }
});

test("no dead space: no group could take one step back and still fit", () => {
  for (let limit = 500; limit <= 1400; limit += 10) {
    const steps = planSteps(GROUPS, fitsIn(GROUPS, limit));
    steps.forEach((s, i) => {
      if (s === 0) return;
      const back = [...steps];
      back[i] -= 1;
      assert.ok(total(GROUPS, back) > limit, `limit ${limit}, group ${i} could grow`);
    });
  }
});

test("Finishes, floors, ceilings and openings step before Add drawing stacks its anchors", () => {
  const first = GROUPS.map(() => 0);
  // Narrow just enough that one step is needed.
  const limit = total(GROUPS, first) - 10;
  const steps = planSteps(GROUPS, fitsIn(GROUPS, limit));
  assert.equal(steps[0], 0, "Add drawing stays side by side");
  assert.equal(steps[6], 1, "Openings, the rightmost priority-3 group, steps first");
  assert.deepEqual(steps.slice(1, 6), [0, 0, 0, 0, 0]);
  assert.equal(steps[7], 0);
});

test("priority 3 gives up its first step no later than Add drawing gives up side-by-side anchors", () => {
  assert.ok(shrinkKey("stack", 3, 0) <= shrinkKey("mixed", 2, 0));
  assert.ok(shrinkKey("large", 3, 0) <= shrinkKey("mixed", 2, 0));
  assert.ok(shrinkKey("stack", 3, 0) < shrinkKey("stack", 1, 0));
});

test("protected groups hold their size longer than low-priority ones", () => {
  const steps = planSteps(GROUPS, fitsIn(GROUPS, 900));
  const walls = steps[2];
  const levels = steps[1];
  assert.ok(walls <= levels, `walls ${walls} vs levels ${levels}`);
});

test("dropdowns are the last resort", () => {
  // Narrower than the best look (1990 in this model) but still wide enough
  // that a dropdown is not required. Priority-3 stacks reach their dropdown
  // only once the row is tighter than this.
  const steps = planSteps(GROUPS, fitsIn(GROUPS, 1300));
  steps.forEach((s, i) => assert.ok(s < maxStep(GROUPS[i].kind) || GROUPS[i].kind === "large", `group ${i}`));
});

test("it stops when nothing is left to shrink", () => {
  const steps = planSteps(GROUPS, () => false);
  steps.forEach((s, i) => assert.equal(s, maxStep(GROUPS[i].kind)));
});

test("mixed groups lose side-by-side anchors before anything else; anchor comfort goes late", () => {
  assert.ok(shrinkKey("mixed", 0, 0) < shrinkKey("stack", 1, 0));
  assert.ok(shrinkKey("mixed", 0, 5) > shrinkKey("large", 0, 1));
});
