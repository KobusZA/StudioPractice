import test from "node:test";
import assert from "node:assert/strict";

import { LADDERS, maxStep, planSteps, shrinkKey } from "../ribbon-fit.js";
import { readFileSync } from "node:fs";
import { CONTEXT_TABS, GROUP_PRIORITY, RIBBON, placingTab, ribbonItems, selectionTab, sheetTab, tabWithStatus } from "../ribbon.js";

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

test("Add drawing on Build is the two ways in, plus a Sheet button only once a sheet is loaded", () => {
  const add = RIBBON.find((t) => t.id === "build").groups.find((g) => g.label === "Add drawing");
  assert.equal(add.menu, undefined);
  const onRow = add.items.filter((item) => !item.contextOnly);
  assert.deepEqual(onRow.map((item) => item.id), ["underlay", "satellite", "underlay-adjust"]);
  assert.deepEqual(onRow.filter((item) => item.needsUnderlay).map((item) => item.id), ["underlay-adjust"]);
  assert.deepEqual(onRow.filter((item) => item.anchor).map((item) => item.id), ["underlay", "satellite", "underlay-adjust"]);
  assert.equal(onRow.find((item) => item.id === "underlay-adjust").label, "Edit sheet");
  assert.equal(onRow.find((item) => item.id === "underlay-adjust").splitBefore, true);
});

test("Modify | Sheet holds the sheet's commands, defined once in RIBBON", () => {
  const tab = sheetTab();
  assert.equal(tab.key, "sheet");
  assert.equal(tab.label, "Sheet");
  const ids = tab.groups.flatMap((g) => g.items.map((item) => item.id));
  assert.deepEqual(ids, ["calibrate", "underlay-off", "sheet-list", "align-floors", "reference"]);
  // Hide and Model / Sheet are view toggles on the plan strip, not here.
  assert.equal(ids.includes("underlay-toggle"), false);
  assert.equal(ids.includes("trace-view"), false);
  // And no sheet command is left on Build.
  const build = RIBBON.find((t) => t.id === "build").groups.flatMap((g) => g.items).filter((item) => !item.contextOnly);
  for (const id of ids) assert.equal(build.some((item) => item.id === id), false, id);
});

test("DWG and CAD sit on Output with the export commands", () => {
  const exchange = RIBBON.find((t) => t.id === "output").groups.find((g) => g.label === "Exchange");
  assert.deepEqual(exchange.items.map((item) => item.id), ["export-dxf", "export-ifc", "dwg", "cad"]);
  assert.equal(exchange.items.find((item) => item.id === "dwg").todo.length > 20, true);
});

test("route edits live on the Services tab and place-component is not a second place tool", () => {
  const services = RIBBON.find((t) => t.id === "build").groups.find((g) => g.label === "Services");
  const ids = services.items.map((item) => item.id);
  assert.equal(ids.includes("service-place"), false);
  assert.deepEqual(services.items.filter((item) => !item.contextOnly).map((item) => item.id), [
    "electrical", "plumbing", "waterheater", "drainage", "service-route",
  ]);
  const route = CONTEXT_TABS.service.groups.find((g) => g.label === "Route");
  assert.deepEqual(route.items, ["service-node", "service-rise", "service-connect", "service-type", "service-slope"]);
  for (const id of route.items) assert.equal(services.items.find((item) => item.id === id).needs, undefined, id);
});

test("every id on a contextual tab is a RIBBON item, so a command is defined once", () => {
  const items = ribbonItems();
  for (const [key, tab] of Object.entries(CONTEXT_TABS)) {
    for (const group of tab.groups) for (const id of group.items) assert.ok(items.has(id), `${key}: ${id}`);
  }
});

test("the Walls tab lists the agreed actions, and its Edit group is the last to shrink", () => {
  const wall = selectionTab(new Set(["wall"]));
  assert.equal(wall.label, "Walls");
  assert.deepEqual(wall.groups.map((g) => g.label), ["Edit", "Wall", "Trim and extend", "View", "Finishes", "Height", "Arrange"]);
  assert.deepEqual(wall.groups[0].items.map((i) => i.id), ["move", "copy", "rotate", "mirror", "align", "delete"]);
  assert.deepEqual(wall.groups[1].items.map((i) => i.id), ["split-wall", "snap", "join", "select-similar"]);
  assert.deepEqual(wall.groups[2].items.map((i) => i.id), ["trim-corner", "trim-single", "trim-circle"]);
  assert.deepEqual(wall.groups[3].items.map((i) => i.id), ["edit-face", "flip-face", "second-screen"]);
  assert.deepEqual(wall.groups[4].items.map((i) => i.id), ["wall-finishes"]);
  assert.deepEqual(wall.groups[5].items.map((i) => i.id), ["attach", "detach"]);
  assert.equal(ribbonItems().get("edit-face").label, "Show face");
  assert.equal(ribbonItems().get("split-wall").label, "Split here");
  assert.deepEqual(selectionTab(new Set(["door"])).groups[0].items.map((i) => i.id), ["move", "copy", "align", "delete", "select-similar"]);
  assert.deepEqual(selectionTab(new Set(["door"])).groups[1].items.map((i) => i.id), ["flip-hinge", "flip-swing"]);
  assert.equal(GROUP_PRIORITY.Edit, -1);
  assert.equal(GROUP_PRIORITY.Walls, -1);
});

test("a room and a site boundary get no tab, and nothing selected gets none", () => {
  assert.equal(selectionTab(new Set(["room"])), null);
  assert.equal(selectionTab(new Set()), null);
});

test("a selectable kind with no tab of its own gets Modify | Selection", () => {
  const sel = selectionTab(new Set(["other"]));
  assert.equal(sel.label, "Selection");
  assert.equal(sel.key, "selection");
  assert.deepEqual(sel.groups.map((g) => g.label), ["Edit"]);
  assert.deepEqual(sel.groups[0].items.map((i) => i.id), ["move", "copy", "rotate", "mirror", "align", "delete"]);
  const withWall = selectionTab(new Set(["wall", "other"]));
  assert.equal(withWall.label, "Multi-Select");
  assert.deepEqual(withWall.groups[0].items.map((i) => i.id), ["move", "copy", "rotate", "mirror", "align", "delete"]);
});

test("a selection of more than one thing gains Existing and Proposed", () => {
  const walls = tabWithStatus(selectionTab(new Set(["wall"])));
  const status = walls.groups.find((group) => group.label === "Status");
  assert.deepEqual(status.items.map((item) => item.id), ["mark-existing", "mark-proposed"]);
  assert.equal(status.items[0].label, "Existing");
  assert.equal(status.items[1].label, "Proposed");
  const mixed = tabWithStatus(selectionTab(new Set(["wall", "door"])));
  assert.equal(mixed.label, "Multi-Select");
  assert.deepEqual(mixed.groups.at(-1).items.map((item) => item.id), ["mark-existing", "mark-proposed"]);
  assert.deepEqual(mixed.groups[0].items.map((item) => item.id), ["move", "copy", "align", "delete"]);
  const placing = tabWithStatus(placingTab("walls"));
  assert.equal(placing.label, "Place Wall");
  assert.deepEqual(placing.groups.at(-1).items.map((item) => item.id), ["mark-existing", "mark-proposed"]);
  const source = readFileSync(new URL("../ribbon-fit.js", import.meta.url), "utf8");
  assert.ok(source.includes('"mark-existing": \''));
  assert.ok(source.includes('"mark-proposed": \''));
});

test("Multi-Select is the intersection of the kinds' Edit groups", () => {
  const mixed = selectionTab(new Set(["wall", "door"]));
  assert.equal(mixed.label, "Multi-Select");
  // A door's Edit group has no Rotate or Mirror, so a wall and a door share neither.
  assert.deepEqual(mixed.groups[0].items.map((i) => i.id), ["move", "copy", "align", "delete"]);
  const withRoute = selectionTab(new Set(["wall", "service"]));
  assert.deepEqual(withRoute.groups[0].items.map((i) => i.id), ["move", "delete"]);
  const withRoom = selectionTab(new Set(["wall", "room"]));
  assert.deepEqual(withRoom.groups[0].items.map((i) => i.id), ["delete"]);
});

test("a placing tab is derived from the item's tool, not written out", () => {
  const walls = placingTab("walls");
  assert.equal(walls.label, "Place Wall");
  assert.deepEqual(walls.groups[0].items.map((i) => i.id), ["walls", "boundary", "foundations"]);
  assert.equal(placingTab("doors").label, "Place Door");
  assert.equal(placingTab("windows").label, "Place Window");
  assert.equal(placingTab("floors").label, "Place Floor");
  assert.equal(placingTab("stairs").label, "Place Stair");
  assert.equal(placingTab("waterheater").label, "Place Water heater");
  for (const [id, item] of ribbonItems()) {
    if (item.tool && item.tabId === "build" && id !== "roof-cut") assert.ok(placingTab(id), id);
    else assert.equal(placingTab(id), null, id);
  }
  // Trims arm a tool but do not place anything. Cut roof edits a roof.
  assert.equal(placingTab("trim-corner"), null);
  assert.equal(placingTab("roof-cut"), null);
});

test("only the agreed commands wait for a selection", () => {
  const waits = [...ribbonItems().values()].filter((i) => i.needsSelection).map((i) => i.id).sort();
  assert.deepEqual(waits, [
    "attach", "copy", "delete", "detach", "group", "mirror", "move", "rotate", "select-similar", "snap", "ungroup",
  ]);
  for (const id of ["align", "join", "split", "split-wall", "trim-corner", "trim-single", "trim-circle"]) {
    assert.equal(ribbonItems().get(id).needsSelection, undefined, id);
  }
});

test("every id on a contextual tab has its own icon", () => {
  const source = readFileSync(new URL("../ribbon-fit.js", import.meta.url), "utf8");
  for (const tab of Object.values(CONTEXT_TABS)) {
    for (const group of tab.groups) {
      for (const id of group.items) {
        assert.ok(source.includes(`${/^[a-z]+$/i.test(id) ? id : `"${id}"`}: '`), `no glyph for ${id}`);
      }
    }
  }
});

test("only Openings opts into large buttons", () => {
  const labels = RIBBON
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
