# Brief: history panel

A session history for the open drawing, in the spirit of Paint.NET's History window, cut down to what we actually need.

Undo and redo move **one step**. The list shows those steps. It does not jump, and it does not delete a step out of the middle.

## Goal

After a few edits, the user can see what they did, undo one step, see that step marked as removed from the plan, and redo it. A new edit while steps are undone drops those later steps and says so.

## Do not change

- The document saved to the server. History stays in memory on `PlanStore`. It is not a field on the doc, and it is not written by `persist()`.
- One undo step per gesture. Drags already push on pointer-down and drop the entry when the pointer never moves. Keep that. Do not record a step per pointer-move.
- Cherry-picking. No control that removes an earlier step while keeping later ones.
- Clicking a row does nothing to the document. Rows are not buttons and are not a slider.
- `server/ui_served.js`. The live UI is `web/v2`.

## Model

`web/v2/model.js`. An entry is `{ label, doc, selected, primary }`. `doc`, `selected`, and `primary` are clones taken **before** the edit. `label` is the name of the edit that followed.

Two stacks:

- `undoStack` — steps that are on the plan now. Oldest at the front. Same limit as today (`undoLimit`, default 60). Pushing past the limit drops the oldest entry.
- `redoStack` — steps that were undone. These are the grey rows. Empty until the user undoes.

`pushUndo(label = "Edit")`

- If `redoStack` is not empty, clear it and remember how many entries were dropped (see Notices).
- Push `{ label, doc: clone(doc), selected: clone(selected), primary: clone(primary) }`.
- If the oldest entry is dropped, remember that too.

`undo()`

- Pop one undo entry. If there is none, return `false`.
- Push the live state onto `redoStack` with the **popped entry's label** (that label names the edit being removed).
- Restore `doc`, `selected`, and `primary` from the popped entry. Use `setSelection`, so a missing object is dropped the same way a normal selection change drops it.
- `persist()`. Return `true`.

`redo()`

- Pop one redo entry. If there is none, return `false`.
- Push the live state onto `undoStack` with the **redo entry's label**.
- Restore `doc`, `selected`, and `primary`. `persist()`. Return `true`.
- Redo does not clear the other redo entries. One step only.

`dropUndo({ restore = false } = {})`

- Pop one undo entry and discard it. Do not push a redo entry. This is the speculative no-op path (pointer-down that never moved, a refused edit).
- When `restore` is true, put that entry's `doc` and selection back. Callers that today do `const prev = undoStack.pop(); if (prev) store.doc = prev` use this.
- Return `false` when the stack is empty.

`clearHistory()`

- Empty both stacks and any pending notice. Replace the three `store.undoStack = []` sites in `ui.js` (open a job, sign out, take the other side of a conflict).

Stop reading `undoStack` entries as bare documents. `ui.js` and `sheet-ui.js` call `pushUndo`, `dropUndo`, `undo`, and `redo` only.

`undoStack.length` stays the number of undoable steps. The service-route cancel path compares that length and may keep doing so.

## Labels

Every `pushUndo` in `ui.js`, `sheet-ui.js`, and `model.js` passes a label. Wording is past tense, two to four words, the same idea as the status line next to that edit: "Drew wall", "Moved opening", "Corner added", "Grouped". No sentences and no millimetre dumps.

Where many pointer-downs share one `pushUndo`, map the drag kind once:

| Drag | Label |
|---|---|
| move | Moved |
| opening | Moved opening |
| segment-end | Moved wall end |
| shape-vertex, shape-edge | Edited outline |
| region-vertex, region-edge, region-move | Edited floor finish |
| property-vertex, property-move | Edited property line |
| underlay-move, underlay-scale, underlay-rotate | Adjusted sheet |

`groupSelection` / `ungroupSelection` label themselves "Grouped" and "Ungrouped". Sheet edits in `sheet-ui.js` pass their own short labels through `ctx.pushUndo(label)`.

A bare `pushUndo()` may still record "Edit" so old tests keep working. After this change, production call sites do not use the bare form.

## Notices

`pushUndo` records at most one notice for that call:

- Redo tail cleared: `Removed N later steps.` (N is 1: `Removed 1 later step.`)
- Oldest entry dropped, and the redo tail was already empty: `Earlier steps dropped.`

The UI reads it once, with `takeHistoryNotice()`, and shows it on the status line. A notice never stacks up across edits.

## Commands

One function runs both steps, used by the ribbon, the plan toolbar, the history panel, and the keyboard. Today Ctrl+Z calls `store.undo()` and `render()`, while the toolbar calls `runCommand("undo")` and does not render. Both go through this function:

1. `store.undo()` or `store.redo()`.
2. `syncPackLevels()`, `drawLevelSwitcher()`, `render()`.
3. Refresh the history list.
4. If there is a notice, `setStatusMessage` it.

Keyboard, and do not change the rest of that handler:

- Ctrl+Z or Cmd+Z: one undo. Shift is not held.
- Ctrl+Y, Cmd+Y, Ctrl+Shift+Z, or Cmd+Shift+Z: one redo.

Holding the key may repeat, one step per keydown. That is still one at a time.

Ribbon: in the Arrange group, add Redo immediately after Undo (`command: "redo"`). Plan toolbar: a Redo button beside `#v2-undo`. Disable Undo when `undoStack` is empty and Redo when `redoStack` is empty, on the toolbar, the ribbon, and the panel.

`cancelDrawing` for a revertible drag can stay a one-step undo. Restoring the selection from the snapshot replaces the hand-saved selection around that `undo()`, once a check shows the drag has not changed the selection it should come back to.

## Panel

Bottom of the inspector column (`#v2-dock-context`), under the fields, so the elevation card stays above the fold. Visible while a drawing is open, including when nothing is selected.

- Title: **History**.
- Undo and Redo in the header. Same commands as the toolbar.
- A scrolling list, about eight rows tall. Oldest at the top.
- Applied steps (the undo labels, oldest first) in normal ink. The last of them is the current step: copper mark, `aria-current="step"`.
- Undone steps under that, grey, struck through. Each has a visually hidden "Removed" so the state is not only colour.
- When every step has been undone, a pinned first row **As opened** is the current step. It is not an undo entry and it cannot be redone past.
- The list does not accept clicks, keyboard focus, or drag. No jump, no compare toggle, no delete.

Styles go in `v2.css` with the existing paper / ink / copper tokens.

Keep the list markup in a small `history-panel.js` that takes the two stacks and returns HTML (or fills a node from plain data). `ui.js` calls it after undo, redo, `pushUndo`, and `dropUndo`. Do not rebuild the inspector to refresh the list.

## Tests

`web/v2/tests/core.test.js`, on `PlanStore`:

- Undo restores the document and the selection, one step.
- Redo puts that document and selection back, one step.
- A `pushUndo` after an undo clears the redo stack and the notice is `Removed 1 later step.`
- The 61st push drops the oldest and the notice is `Earlier steps dropped.`
- `dropUndo({ restore: true })` puts the document back and leaves redo empty.
- `undo()` and `redo()` on an empty stack return `false`.
- Neither stack is stored on `doc`.

`history-panel.js`: a list with two applied steps and one redo step marks the second applied step current and the last row removed. No control in that HTML navigates.

## Acceptance

1. Draw or edit a few things. History lists them by name, oldest at the top, and the last one is marked current.
2. Undo once. The plan goes back one step, the selection comes back with it, and that step is grey and struck through. Redo once puts it back. Undo and Redo do nothing when their stack is empty.
3. Undo twice, then make a new edit. The two grey steps disappear and the status line says `Removed 2 later steps.`
4. Clicking a row does not change the plan.
5. Opening another job, signing out, or taking the other document in a conflict clears both stacks.
6. Ctrl+Z, the toolbar, the ribbon, and the panel undo agree. Ctrl+Y and Ctrl+Shift+Z redo one step.
7. A drag that does not move still leaves no history row.
8. `node --test web/v2/tests/core.test.js` passes, plus the history-panel test.
