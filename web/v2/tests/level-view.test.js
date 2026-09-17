import { test } from "node:test";
import assert from "node:assert/strict";

import {
  lookDownLevelId,
  lookUpLevelId,
  ghostContext,
  MAX_FLOORS_TO_ADD,
  floorsAvailableToAdd,
  canAddFloor,
  visibleLevels,
  mergedLevels,
  validateLevelInsert,
  insertLevel,
  buildHouseStations,
  inspectorStations,
  selectedInspectorStationId,
} from "../level-view.js";
import { ribbonItems } from "../ribbon.js";
import { normalizeDoc, emptyDoc } from "../model.js";

const levels = [
  { id: "00 FOUNDATION", elevation: -0.6 },
  { id: "01 GFL", elevation: 0 },
  { id: "02 L1", elevation: 3 },
  { id: "03 L2", elevation: 6 },
];

test("look-down is the storey immediately below, not every level under the cut", () => {
  assert.equal(lookDownLevelId(levels, "02 L1"), "01 GFL");
  assert.equal(lookDownLevelId(levels, "01 GFL"), "00 FOUNDATION");
  assert.equal(lookDownLevelId(levels, "00 FOUNDATION"), null);
});

test("look-up is the storey immediately above", () => {
  assert.equal(lookUpLevelId(levels, "01 GFL"), "02 L1");
  assert.equal(lookUpLevelId(levels, "03 L2"), null);
});

test("a foundation cut ghosts the ground floor above, not an empty look-down", () => {
  assert.deepEqual(ghostContext(levels, "00 FOUNDATION"), { levelId: "01 GFL", look: "up" });
});

test("an occupied floor still ghosts the storey below, not the one above", () => {
  assert.deepEqual(ghostContext(levels, "01 GFL"), { levelId: "00 FOUNDATION", look: "down" });
  assert.deepEqual(ghostContext(levels, "02 L1"), { levelId: "01 GFL", look: "down" });
});

test("the top storey has nothing above and still ghosts the floor below", () => {
  assert.deepEqual(ghostContext(levels, "03 L2"), { levelId: "02 L1", look: "down" });
});

test("unordered pack levels still sort by elevation", () => {
  const shuffled = [levels[2], levels[0], levels[3], levels[1]];
  assert.equal(lookDownLevelId(shuffled, "02 L1"), "01 GFL");
});

test("an unknown or empty stack has nothing to ghost", () => {
  assert.equal(lookDownLevelId(levels, "missing"), null);
  assert.equal(lookDownLevelId([], "01 GFL"), null);
});

test("this-level-only is a ribbon command, not a drawing tool", () => {
  const item = ribbonItems().get("level-isolate");
  assert.equal(item?.command, "level-isolate");
  assert.equal(item?.label, "This level only");
  assert.equal(item?.tool, undefined);
});

// A new document (or one that has never touched "+ Add floor") shows only
// the ground floor and its foundation - "waiting, like a new Revit project"
// - even against a four-level TSP pack that also defines 02 L1 and 03 L2.
test("a fresh document shows only the ground floor and its foundation, not every template storey", () => {
  const shown = visibleLevels(levels, 0);
  assert.deepEqual(shown.map((l) => l.id), ["00 FOUNDATION", "01 GFL"]);
});

test("+ Add floor reveals one more storey at a time, in order", () => {
  assert.deepEqual(visibleLevels(levels, 1).map((l) => l.id), ["00 FOUNDATION", "01 GFL", "02 L1"]);
  assert.deepEqual(visibleLevels(levels, 2).map((l) => l.id), ["00 FOUNDATION", "01 GFL", "02 L1", "03 L2"]);
});

test("+ Add floor caps at MAX_FLOORS_TO_ADD even if more storeys exist", () => {
  const fiveLevels = [
    ...levels,
    { id: "04 L3", elevation: 9 },
  ];
  assert.equal(MAX_FLOORS_TO_ADD, 2);
  assert.deepEqual(
    visibleLevels(fiveLevels, 99).map((l) => l.id),
    ["00 FOUNDATION", "01 GFL", "02 L1", "03 L2"],
    "revealing past the cap never surfaces a third added storey"
  );
});

test("canAddFloor and floorsAvailableToAdd agree on when the button should disable", () => {
  assert.equal(floorsAvailableToAdd(levels), 2);
  assert.equal(canAddFloor(levels, 0), true);
  assert.equal(canAddFloor(levels, 1), true);
  assert.equal(canAddFloor(levels, 2), false, "already at the cap");

  const singleStorey = [{ id: "01 GFL", elevation: 0 }];
  assert.equal(floorsAvailableToAdd(singleStorey), 0);
  assert.equal(canAddFloor(singleStorey, 0), false, "the template has nothing left to reveal");
});

test("a pack with no storeys at all (elevation never >= 0) is returned as-is", () => {
  const onlyFoundations = [{ id: "B2", elevation: -6 }, { id: "B1", elevation: -3 }];
  assert.deepEqual(visibleLevels(onlyFoundations, 0).map((l) => l.id), ["B2", "B1"]);
});

// --- Insert level: the template is the default stack, not the limit -------

test("insert level is a live command, not a todo", () => {
  const item = ribbonItems().get("levels");
  assert.equal(item?.command, "insert-level");
  assert.equal(item?.todo, undefined, "'levels come from the template' was never an integrity block");
});

test("an inserted level joins the template stack in elevation order", () => {
  const own = insertLevel([], { name: "04 L3", elevation: 9 });
  const merged = mergedLevels(levels, own);
  assert.deepEqual(merged.map((l) => l.id), ["00 FOUNDATION", "01 GFL", "02 L1", "03 L2", "04 L3"]);
  assert.equal(merged.at(-1).userSupplied, true);
});

test("an inserted level states no floor-to-ceiling rather than borrowing a neighbour's", () => {
  const [level] = insertLevel([], { name: "01A MEZZ", elevation: 1.4 });
  assert.equal(level.floorToCeiling, null);
  assert.equal(level.floorToFloor, null);
  assert.equal(level.elevation, 1.4, "the elevation is a supplied fact, so it is a real number");
});

test("an inserted level is always visible, without consuming an + Add floor reveal", () => {
  const own = insertLevel([], { name: "04 L3", elevation: 9 });
  const merged = mergedLevels(levels, own);
  assert.deepEqual(
    visibleLevels(merged, 0).map((l) => l.id),
    ["00 FOUNDATION", "01 GFL", "04 L3"],
    "the user asked for this storey, so it is not something to reveal later"
  );
  assert.equal(floorsAvailableToAdd(merged), 2, "the template still has two storeys left to reveal");
  assert.equal(canAddFloor(merged, 2), false, "and an inserted level does not raise the cap");
});

test("insert level refuses each bad spec for its own distinct reason", () => {
  assert.match(validateLevelInsert(levels, { name: "  ", elevation: 9 }).message, /^Name the level/);
  assert.match(validateLevelInsert(levels, { name: "04 L3", elevation: "" }).message, /elevation in metres/);
  assert.match(validateLevelInsert(levels, { name: "02 l1", elevation: 9 }).message, /already exists/);
  assert.match(validateLevelInsert(levels, { name: "04 L3", elevation: 3 }).message, /cannot share an elevation/);
  assert.equal(validateLevelInsert(levels, { name: "04 L3", elevation: 9 }).ok, true);
});

test("there is no cap on how many levels a document may insert", () => {
  let own = [];
  for (let i = 0; i < 6; i += 1) {
    const spec = { name: `EXTRA ${i}`, elevation: 9 + i * 3 };
    assert.equal(validateLevelInsert(mergedLevels(levels, own), spec).ok, true, `level ${i} refused`);
    own = insertLevel(own, spec);
  }
  assert.equal(mergedLevels(levels, own).length, 10);
});

test("a document's own levels survive a round trip and are never mistaken for the template's", () => {
  const doc = emptyDoc();
  assert.deepEqual(doc.levels, [], "a fresh document has inserted nothing");
  doc.levels = insertLevel(doc.levels, { name: "04 L3", elevation: 9 });
  const round = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(round.levels, [
    { id: "04 L3", name: "04 L3", elevation: 9, floorToFloor: null, floorToCeiling: null, userSupplied: true },
  ]);
});

test("a pre-insert-level document normalises to an empty own-level stack", () => {
  const round = normalizeDoc({ schema: "sp.doc/2", rooms: [], segments: [] });
  assert.deepEqual(round.levels, []);
});

const namedLevels = [
  { id: "00 FOUNDATION", name: "00 FOUNDATION", elevation: -0.6, floorToFloor: 0.6, floorToCeiling: 2.902 },
  { id: "01 GFL", name: "01 GFL", elevation: 0, floorToFloor: 3, floorToCeiling: 2.902 },
  { id: "02 L1", name: "02 L1", elevation: 3, floorToFloor: 3, floorToCeiling: 2.902 },
  { id: "03 L2", name: "03 L2", elevation: 6, floorToFloor: 2.8, floorToCeiling: 2.902 },
];

test("a fresh document's cuts are foundation, ground floor, its ceiling and the roof — not every template storey", () => {
  const stations = buildHouseStations(visibleLevels(namedLevels, 0));
  assert.deepEqual(stations.map((s) => s.label), [
    "00 FOUNDATION",
    "01 GFL · floor",
    "01 GFL · ceiling",
    "Roof · eaves",
  ]);
  assert.equal(stations.find((s) => s.kind === "roof").levelId, "01 GFL");
});

test("the inspector lists those cuts, not the four template storey names", () => {
  const stations = inspectorStations(buildHouseStations(visibleLevels(namedLevels, 0)), namedLevels, "01 GFL");
  assert.deepEqual(stations.map((s) => s.label), [
    "00 FOUNDATION",
    "01 GFL · floor",
    "01 GFL · ceiling",
    "Roof · eaves",
  ]);
});

test("an object on a storey that is not yet revealed still has a matching inspector row", () => {
  const stations = inspectorStations(buildHouseStations(visibleLevels(namedLevels, 0)), namedLevels, "02 L1");
  assert.ok(stations.some((s) => s.levelId === "02 L1" && s.kind === "floor"));
  assert.ok(stations.some((s) => s.label === "02 L1 · ceiling"));
  assert.equal(stations.filter((s) => s.kind === "roof").length, 1, "do not add a second roof for the hidden storey");
});

test("the inspector stays on the active cut when that cut belongs to the object's storey", () => {
  const stations = buildHouseStations(visibleLevels(namedLevels, 0));
  assert.equal(selectedInspectorStationId(stations, "01 GFL", "01 GFL::ceiling"), "01 GFL::ceiling");
  assert.equal(selectedInspectorStationId(stations, "01 GFL", "roof"), "roof");
  assert.equal(selectedInspectorStationId(stations, "00 FOUNDATION", "01 GFL::floor"), "00 FOUNDATION::floor");
});
