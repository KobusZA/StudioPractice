import test from "node:test";
import assert from "node:assert/strict";

import { LADDERS, maxStep, planSteps, shrinkKey } from "../ribbon-fit.js";
import { readFileSync } from "node:fs";
import { CONTEXT_TABS, GROUP_PRIORITY, RIBBON, floorFinishTab, isAnnotatingTab, placingTab, ribbonItems, selectionTab, sheetTab, tabWithStatus, wallFinishTab } from "../ribbon.js";

// A toy width model: each group's width depends on its kind and step, so the
// planner can be exercised without a browser. Wider = nicer.
const WIDTHS = {
  large: [130, 110, 90, 40],
  stack: [260, 240, 220, 190, 90, 40],
  mixed: [300, 260, 200, 100, 40],
  wide: [340, 300, 270, 160, 40],
  settings: [240, 180, 110],
};
const widthOf = (g, step) => WIDTHS[g.kind][step];
const total = (groups, steps) => groups.reduce((sum, g, i) => sum + widthOf(g, steps[i]), 0);
const fitsIn = (groups, limit) => (steps) => total(groups, steps) <= limit;

// Build's row, in order, with its real kinds and priorities.
const BUILD_KINDS = ["mixed", "stack", "wide", "mixed", "wide", "mixed", "stack", "wide"];
const GROUPS = RIBBON.find((t) => t.id === "build").groups
  .map((g, i) => ({ kind: BUILD_KINDS[i], prio: GROUP_PRIORITY[g.label] ?? 0, label: g.label }));

test("Build is regrouped in drawing order, each modelling group led by one tool", () => {
  const build = RIBBON.find((t) => t.id === "build");
  assert.deepEqual(build.groups.map((g) => g.label), [
    "Underlay", "Levels", "Walls & openings", "Rooms", "Floors & roofs", "Structure", "Services", "Interiors",
  ]);
  const onRow = (label) => build.groups.find((g) => g.label === label).items.filter((item) => !item.contextOnly);
  const lead = (label) => onRow(label).filter((item) => item.anchor).map((item) => item.id);
  assert.deepEqual(lead("Underlay"), ["underlay"]);
  assert.deepEqual(lead("Walls & openings"), ["walls"]);
  assert.deepEqual(lead("Rooms"), ["rooms"]);
  assert.deepEqual(lead("Floors & roofs"), ["floors"]);
  assert.deepEqual(lead("Structure"), ["columns"]);
  assert.deepEqual(lead("Interiors"), ["furniture"]);
  assert.deepEqual(lead("Levels"), []);
  assert.deepEqual(lead("Services"), []);
  assert.deepEqual(onRow("Walls & openings").map((i) => i.id), ["walls", "doors", "windows", "boundary", "foundations"]);
  assert.deepEqual(onRow("Floors & roofs").map((i) => i.id), ["floors", "ceilings", "roofs", "roof-cut"]);
  assert.deepEqual(onRow("Interiors").map((i) => i.id), ["furniture", "casework", "scale-person", "scale-car", "wall-finishes", "finishes"]);
  assert.deepEqual(onRow("Levels").map((i) => i.label), ["Add level", "Remove level", "Insert level"]);
  assert.equal(ribbonItems().get("room-sep").label, "Room separator");
  assert.equal(build.groups.find((g) => g.label === "Walls & openings").short, "Walls");
  assert.equal(build.groups.find((g) => g.label === "Floors & roofs").short, "Floors");
  // Ramps and railings have no template types yet, so they are off the row.
  assert.equal(ribbonItems().has("ramp"), false);
  assert.equal(ribbonItems().has("railings"), false);
});

test("Underlay on Build is the two ways in, plus Edit sheet only once a sheet is loaded", () => {
  const add = RIBBON.find((t) => t.id === "build").groups.find((g) => g.label === "Underlay");
  assert.equal(add.menu, undefined);
  const onRow = add.items.filter((item) => !item.contextOnly);
  assert.deepEqual(onRow.map((item) => item.id), ["underlay", "satellite", "underlay-adjust"]);
  assert.deepEqual(onRow.filter((item) => item.needsUnderlay).map((item) => item.id), ["underlay-adjust"]);
  assert.equal(onRow.find((item) => item.id === "underlay-adjust").label, "Edit sheet");
});

test("the Walls, Room and Furniture icons are the chosen ones", () => {
  const source = readFileSync(new URL("../ribbon-fit.js", import.meta.url), "utf8");
  // Stepped bricks, a plain outline, and a sofa.
  assert.ok(source.includes('walls: \'<path d="M3 19V5h12v4.67h3v4.66h3V19z"/>'));
  assert.ok(source.includes('rooms: \'<path d="M4 4h16v16H4z"/>\''));
  assert.ok(source.includes('furniture: \'<path d="M5.5 11V7A1.5'));
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
    "electrical", "plumbing", "drainage", "service-route",
  ]);
  // Water heaters are placed from Plumbing.
  assert.deepEqual(ribbonItems().get("plumbing").categories, ["sanitary", "waterheater"]);
  assert.equal(ribbonItems().get("service-route").label, "Route");
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
  assert.deepEqual(wall.groups.map((g) => g.label), ["Edit", "Wall", "Trim and extend", "View", "Finishes", "Height", "Foundation", "Arrange"]);
  assert.deepEqual(wall.groups[0].items.map((i) => i.id), ["move", "copy", "rotate", "mirror", "align", "delete"]);
  assert.deepEqual(wall.groups[1].items.map((i) => i.id), ["split-wall", "snap", "join", "select-similar"]);
  assert.deepEqual(wall.groups[2].items.map((i) => i.id), ["trim-corner", "trim-single", "trim-circle"]);
  assert.deepEqual(wall.groups[3].items.map((i) => i.id), ["edit-face", "flip-face", "second-screen"]);
  assert.deepEqual(wall.groups[4].items.map((i) => i.id), ["wall-finishes"]);
  assert.deepEqual(wall.groups[5].items.map((i) => i.id), ["attach", "detach"]);
  assert.deepEqual(wall.groups[6].items.map((i) => i.id), ["add-foundation"]);
  assert.equal(ribbonItems().get("edit-face").label, "Show face");
  assert.equal(ribbonItems().get("split-wall").label, "Split here");
  assert.deepEqual(selectionTab(new Set(["door"])).groups[0].items.map((i) => i.id), ["move", "copy", "align", "delete", "select-similar"]);
  assert.deepEqual(selectionTab(new Set(["door"])).groups[1].items.map((i) => i.id), ["flip-hinge", "flip-swing"]);
  assert.equal(GROUP_PRIORITY.Edit, -1);
  assert.equal(GROUP_PRIORITY["Walls & openings"], -1);
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

test("a placing tab lists only the tools that place, from the item's group", () => {
  const walls = placingTab("walls");
  assert.equal(walls.label, "Place Wall");
  assert.deepEqual(walls.groups[0].items.map((i) => i.id), ["walls", "doors", "windows", "boundary", "foundations"]);
  assert.equal(walls.groups[0].short, "Walls");
  assert.equal(placingTab("doors").label, "Place Door");
  assert.equal(placingTab("windows").label, "Place Window");
  assert.equal(placingTab("floors").label, "Place Floor");
  assert.equal(placingTab("stairs").label, "Place Stair");
  assert.equal(placingTab("plumbing").label, "Place Plumbing");
  const placingCommands = new Set(["room-sep", "service-route", "text", "dimensions", "lines", "region", "revision"]);
  for (const [id, item] of ribbonItems()) {
    const expect = (item.tool && item.tabId === "build" && id !== "roof-cut") || placingCommands.has(id);
    if (expect) assert.ok(placingTab(id), id);
    else assert.equal(placingTab(id), null, id);
  }
  // Trims arm a tool but do not place anything. Cut roof edits a roof.
  // Finishes open a picture of something already drawn.
  assert.equal(placingTab("trim-corner"), null);
  assert.equal(placingTab("roof-cut"), null);
  assert.equal(placingTab("finishes"), null);
  assert.equal(placingTab("wall-finishes"), null);
  assert.deepEqual(placingTab("casework").groups[0].items.map((i) => i.id), ["furniture", "casework", "scale-person", "scale-car"]);
  assert.deepEqual(placingTab("floors").groups[0].items.map((i) => i.id), ["floors", "ceilings", "roofs"]);
  assert.deepEqual(placingTab("rooms").groups[0].items.map((i) => i.id), ["rooms", "room-sep"]);
  assert.equal(placingTab("room-sep").label, "Place Room separator");
  // Annotate: each tool opens its own tab, with the others one click away.
  assert.equal(placingTab("text").label, "Place Text");
  assert.equal(placingTab("lines").label, "Place Line");
  assert.equal(placingTab("region").label, "Place Fill");
  assert.equal(placingTab("dimensions").label, "Place Dimension");
  assert.deepEqual(placingTab("text").groups[0].items.map((i) => i.id), ["text", "dimensions", "lines", "region", "revision"]);
  assert.equal(isAnnotatingTab(placingTab("text")), true);
  assert.equal(isAnnotatingTab(placingTab("lines")), false, "a line can be existing or proposed");
  assert.equal(isAnnotatingTab(placingTab("walls")), false);
  // Annotate: each tool opens its own tab, with the rest of Annotate one click away.
  assert.equal(placingTab("text").label, "Place Text");
  assert.equal(placingTab("dimensions").label, "Place Dimension");
  assert.equal(placingTab("lines").label, "Place Line");
  assert.equal(placingTab("region").label, "Place Fill");
  assert.deepEqual(placingTab("text").groups[0].items.map((i) => i.id), ["text", "dimensions", "lines", "region", "revision"]);
  assert.equal(isAnnotatingTab(placingTab("text")), true);
  assert.equal(isAnnotatingTab(placingTab("lines")), false, "a line can be existing or proposed");
  assert.equal(isAnnotatingTab(placingTab("walls")), false);
  assert.deepEqual(placingTab("electrical").groups[0].items.map((i) => i.id), ["electrical", "plumbing", "drainage", "service-route"]);
  assert.equal(placingTab("service-route").label, "Place Route");
});

test("an open finish picture has its own short tab, and can name what it shows", () => {
  const wall = wallFinishTab();
  assert.equal(wall.key, "wall-finish");
  assert.equal(wall.label, "Wall finish");
  assert.deepEqual(wall.groups[0].items.map((i) => i.id), ["add-finish", "flip-face", "second-screen", "finish-done"]);
  assert.equal(wallFinishTab("230 Brick, Kitchen side").label, "Wall finish · 230 Brick, Kitchen side");
  const floor = floorFinishTab();
  assert.equal(floor.key, "floor-finish");
  assert.equal(floor.label, "Floor finish");
  assert.deepEqual(floor.groups[0].items.map((i) => i.id), ["add-finish", "second-screen", "finish-done"]);
  assert.equal(floorFinishTab("Kitchen").label, "Floor finish · Kitchen");
  assert.equal(ribbonItems().get("add-finish").label, "Add a finish");
  assert.equal(ribbonItems().get("finish-done").label, "Done");
});

test("the permanent Modify tab keeps only the commands with no other home", () => {
  const tab = RIBBON.find((t) => t.id === "modify");
  assert.equal(tab.label, "Modify");
  assert.deepEqual(tab.groups.map((g) => g.label), ["Modify", "Arrange"]);
  const visible = tab.groups.flatMap((g) => g.items.filter((item) => !item.contextOnly).map((item) => item.id));
  assert.deepEqual(visible, [
    "trim-corner", "trim-single", "trim-circle", "join", "cut", "merge", "split", "align", "group", "ungroup",
  ]);
  assert.equal(ribbonItems().has("undo"), false);
  assert.equal(ribbonItems().has("redo"), false);
  assert.equal(ribbonItems().has("contour"), false);
});

test("Call out sits with Section, and site tools share one Site group", () => {
  const document = RIBBON.find((t) => t.id === "document");
  const views = document.groups.find((g) => g.label === "Views");
  assert.deepEqual(views.items.map((item) => item.id), ["section", "elevation", "callout", "grids"]);
  const site = document.groups.find((g) => g.label === "Site");
  assert.deepEqual(site.items.map((item) => item.id), ["property-line", "sg-coords", "building-line", "contours", "platform"]);
  const output = RIBBON.find((t) => t.id === "output");
  assert.deepEqual(output.groups.find((g) => g.label === "3D").items.map((item) => item.id), ["view-3d", "view-camera"]);
  const check = RIBBON.find((t) => t.id === "check").groups.find((g) => g.label === "Compliance");
  assert.deepEqual(check.items.map((item) => item.id), ["check"]);
  assert.equal(check.items[0].label, "Run checks");
});

test("a floor or a roof can be split or merged from its own tab", () => {
  const floor = selectionTab(new Set(["floor"]));
  assert.deepEqual(floor.groups.find((g) => g.label === "Floor").items.map((i) => i.id), [
    "edit-poly", "follow-walls", "finishes", "split", "merge",
  ]);
  const roof = selectionTab(new Set(["roof"]));
  assert.deepEqual(roof.groups.find((g) => g.label === "Roof").items.map((i) => i.id), [
    "roof-cut-here", "edit-poly", "split", "merge",
  ]);
});

test("only the agreed commands wait for a selection", () => {
  const waits = [...ribbonItems().values()].filter((i) => i.needsSelection).map((i) => i.id).sort();
  assert.deepEqual(waits, [
    "add-foundation", "attach", "copy", "delete", "detach", "group", "mirror", "move", "rotate", "select-similar", "snap", "ungroup",
  ]);
  for (const id of ["align", "join", "split", "split-wall", "trim-corner", "trim-single", "trim-circle"]) {
    assert.equal(ribbonItems().get(id).needsSelection, undefined, id);
  }
});

test("every id on a contextual tab has its own icon", () => {
  const source = readFileSync(new URL("../ribbon-fit.js", import.meta.url), "utf8");
  const tabs = [...Object.values(CONTEXT_TABS), wallFinishTab(), floorFinishTab()];
  for (const tab of tabs) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        const id = item.id || item;
        assert.ok(source.includes(`${/^[a-z]+$/i.test(id) ? id : `"${id}"`}: '`), `no glyph for ${id}`);
      }
    }
  }
});

test("no group opts into all-large buttons: size comes from one lead tool", () => {
  const labels = RIBBON
    .flatMap((tab) => tab.groups)
    .filter((group) => group.large)
    .map((group) => group.label);
  assert.deepEqual(labels, []);
  for (const group of RIBBON.flatMap((tab) => tab.groups)) {
    assert.ok(group.items.filter((item) => item.anchor).length <= 1, group.label);
  }
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

test("Interiors gives up the first step, and only Interiors, when the row is just too wide", () => {
  const first = GROUPS.map(() => 0);
  const limit = total(GROUPS, first) - 10;
  const steps = planSteps(GROUPS, fitsIn(GROUPS, limit));
  assert.deepEqual(steps, GROUPS.map((g) => (g.label === "Interiors" ? 1 : 0)));
});

test("Build's groups take each step in the agreed order, Walls & openings last", () => {
  for (const step of [0, 1, 2]) {
    const order = [...GROUPS]
      .sort((a, b) => shrinkKey(a.kind, a.prio, step) - shrinkKey(b.kind, b.prio, step))
      .map((g) => g.label);
    assert.deepEqual(order, [
      "Interiors", "Services", "Underlay", "Structure", "Levels", "Floors & roofs", "Rooms", "Walls & openings",
    ], `step ${step}`);
  }
  // Walls & openings is a whole step behind: its first step comes after every
  // other group's second.
  const walls = GROUPS.find((g) => g.label === "Walls & openings");
  for (const g of GROUPS) {
    if (g === walls) continue;
    assert.ok(shrinkKey(g.kind, g.prio, 1) < shrinkKey(walls.kind, walls.prio, 0), g.label);
  }
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

test("wall settings tighten before other groups shrink, and fold only once those groups are spent", () => {
  assert.ok(shrinkKey("settings", 0, 0) < shrinkKey("mixed", 2, 0));
  assert.ok(shrinkKey("settings", 0, 1) > shrinkKey("stack", -1, maxStep("stack")));
  const row = [...GROUPS, { kind: "settings", prio: 0 }];
  const wide = total(row, row.map(() => 0));
  const steps = planSteps(row, fitsIn(row, wide - 10));
  assert.deepEqual(steps.slice(0, -1), GROUPS.map(() => 0));
  assert.equal(steps.at(-1), 1);
});

test("names stay as long as they can: tile first, then the lead folds in, then icons", () => {
  for (const kind of ["stack", "mixed", "wide"]) {
    const ladder = LADDERS[kind];
    const tile = ladder.findIndex((s) => s.lone === "tile");
    const icons = ladder.findIndex((s) => s.icons);
    assert.equal(tile, 1, kind);
    assert.ok(icons > tile, kind);
    assert.ok(ladder.at(-1).collapsed, kind);
  }
  const inline = LADDERS.mixed.findIndex((s) => s.anchors === "inline");
  assert.ok(inline > 1 && inline < LADDERS.mixed.findIndex((s) => s.icons));
  // A wide group keeps its lead large, captioned, until it folds away.
  assert.ok(LADDERS.wide.every((s) => s.collapsed || (!s.anchors && s.icons !== "all")));
});
