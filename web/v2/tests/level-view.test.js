import { test } from "node:test";
import assert from "node:assert/strict";

import { lookDownLevelId, lookUpLevelId } from "../level-view.js";
import { ribbonItems } from "../ribbon.js";

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

test("unordered pack levels still sort by elevation", () => {
  const shuffled = [levels[2], levels[0], levels[3], levels[1]];
  assert.equal(lookDownLevelId(shuffled, "02 L1"), "01 GFL");
});

test("an unknown or empty stack has nothing to ghost", () => {
  assert.equal(lookDownLevelId(levels, "missing"), null);
  assert.equal(lookDownLevelId([], "01 GFL"), null);
});

test("this-storey-only is a ribbon command, not a drawing tool", () => {
  const item = ribbonItems().get("level-isolate");
  assert.equal(item?.command, "level-isolate");
  assert.equal(item?.tool, undefined);
});
