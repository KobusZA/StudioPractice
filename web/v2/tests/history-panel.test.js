import { test } from "node:test";
import assert from "node:assert/strict";
import { historyAction, historyIconKind, historyListHtml, historyView } from "../history-panel.js";

test("the current step is the last applied one and undone steps are removed", () => {
  const undoStack = [{ label: "Drew wall" }, { label: "Moved opening" }];
  const redoStack = [{ label: "Added paint" }];
  const view = historyView(undoStack, redoStack);
  assert.deepEqual(view.rows.map((row) => row.label), ["Drew wall", "Moved opening", "Added paint"]);
  assert.equal(view.current, 1);
  assert.equal(view.rows[2].removed, true);
  assert.equal(view.rows[1].removed, false);

  const html = historyListHtml(undoStack, redoStack);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /is-current/);
  assert.match(html, /is-removed/);
  assert.match(html, /Removed/);
  assert.equal(html.includes("<button"), false);
  assert.equal(html.includes("href="), false);
});

test("a history name lists what the step did", () => {
  assert.equal(historyAction("Deleted", ["room Bedroom"]), "Deleted room Bedroom");
  assert.equal(historyAction("Deleted", ["room Bedroom", "door"]), "Deleted room Bedroom and door");
  assert.equal(historyAction("Moved", ["wall", "door", "window", "beam"]), "Moved wall, door, and 2 more");
  assert.equal(historyAction("Edited", []), "Edited");
});

test("each kind of step has its own icon, and a press is not listed", () => {
  assert.equal(historyIconKind("Deleted room Bedroom"), "delete");
  assert.equal(historyIconKind("Moved wall 230 mm brick"), "move");
  assert.equal(historyIconKind("Drew wall 230 mm brick"), "add");
  assert.notEqual(historyIconKind("Deleted room Bedroom"), historyIconKind("Moved wall 230 mm brick"));
  const html = historyListHtml(
    [{ label: "Deleted room Bedroom" }, { label: "Moved wall", pending: true }],
    [{ label: "Rotated the sheet 90° clockwise" }],
  );
  assert.equal(html.includes("Moved wall"), false);
  assert.match(html, /data-icon="delete"/);
  assert.match(html, /data-icon="rotate"/);
  assert.equal(html.includes('data-icon="move"'), false);
});

test("undoing every step leaves As opened current", () => {
  const view = historyView([], [{ label: "Drew wall" }]);
  assert.equal(view.rows[0].label, "As opened");
  assert.equal(view.current, 0);
  assert.equal(view.rows[1].removed, true);
});
