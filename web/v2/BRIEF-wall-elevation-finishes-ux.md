# Brief: wall inspection, wall elevation &amp; finishes — first-time-user UX

**Mock to build from:** `web/v2/wall-finish-ux-mock.html` (open it directly in a
browser — static, not wired). The five numbered callouts in its "What changed"
panel are the five changes below, in the same order. Match its layout and
wording unless this brief says otherwise; the mock is illustrative for colour
and spacing, this brief is authoritative for behaviour and which real files
own it.

**Why:** a new user who selects a wall has no reason to know that (a) scrolling
the Inspector reveals a picture of the wall and an "Open elevation" button,
(b) that picture is a drawing of a *different* feature than ribbon → Document →
Views → Elevation, (c) wall finishes (paint, tile, plaster...) live under
ribbon → Document → Project, next to "Project information", and (d) in the
**Simple** ribbon density, there is currently no path to wall or floor
finishes at all — the two items aren't in `SIMPLE_TABS`. None of this is a
bug; it's unreachable/undiscoverable, which is worse. Fix discoverability
without touching the underlying finish/elevation data model
(`finish-model.js`, `wall-elevation.js`) — it's correct and well-tested.

Do the five changes as five separate commits/PRs in the order below. Each is
independently shippable and testable.

---

## 1. Move "Wall finishes" / "Floor finishes" onto the main ribbon

**File:** `web/v2/ribbon.js`

- In the **Full** ribbon (`export const RIBBON`), the `id: "build"` tab
  currently has a `"Walls"` group (`walls`, `boundary`, `foundations`) and a
  `"Floors & roofs"` group. Add a new group immediately after `"Walls"`:
  ```js
  {
    label: "Finishes",
    items: [
      { id: "wall-finishes", label: "Wall finishes", command: "wall-finishes" },
      { id: "finishes", label: "Floor finishes", command: "finishes" },
    ],
  },
  ```
  Remove these two item objects from the `"Project"` group under the
  `id: "document"` tab (leave `project-info` there on its own).
- In **Simple** (`const SIMPLE_TABS`), the `id: "draw"` tab has no finishes
  entry at all today — add one, right after the `"Walls"` group:
  ```js
  { label: "Finishes", items: ["wall-finishes", "finishes"] },
  ```
  (Simple tabs reference ids only; label/command/tool come from `RIBBON`, so
  no duplication.)
- Don't touch `HINTS`, the `command` dispatch in `ui.js` (`case "finishes":
  openFloorFinishes(); return;` / `case "wall-finishes": openWallFinishes();
  return;` — still correct), or `GROUP_PRIORITY` (an unlisted group defaults
  to priority 0, which is fine here).

**Check:** `web/v2/tests/ribbon-fit.test.js` still passes. Open both ribbon
densities in the app and confirm "Wall finishes" / "Floor finishes" render
under the new "Finishes" group, and the old "Project" group still has
"Project information" alone.

---

## 2. Reorder the Inspector: the wall's picture before its millimetre fields

**File:** `web/v2/index.html`, inside `#v2-inspect-fields` (currently ~line
396–497).

The DOM order of fields determines their visual order; visibility per
selected object kind is still controlled entirely by `ui.js` (`setHidden`
calls) and is **not changing**. This is a pure reorder plus one new wrapper:

1. Keep this order unchanged at the top: Name, Use, Fill, Type, Status.
2. Move the block `#v2-ctx-elev-wrap` + `#v2-ctx-finish` (the elevation
   preview and the finishes panel) to **immediately after Status**, before
   Form/Pitch/Ridge/Top/Wall height/Sill/Width/Height/Offset/Base/etc.
3. Wrap `#v2-ctx-top-wrap`, `#v2-ctx-wallh-wrap` and `#v2-ctx-attach-wrap`
   (the "Base: not attached" read-field) in one new
   `<details class="more-settings"><summary>More wall settings</summary>…</details>`.
   These three are confirmed in `ui.js` to be independently shown/hidden via
   `setHidden(el.ctxTopWrap, …)` (line ~13053), `setHidden(el.ctxWallHWrap, …)`
   (line ~13070, used for **both** a drawn wall and a room's wall height —
   leave that logic alone) and `setHidden(el.ctxAttachWrap, …)` (line
   ~15382). Wrapping them in `<details>` does not change that logic; it only
   changes whether the row is visually collapsed. Default the `<details>`
   **open**, so nothing that works today stops being reachable in one click —
   this change is about ordering, not hiding.
4. **Do not** move or wrap `#v2-ctx-sill-wrap`, `#v2-ctx-owidth-wrap`,
   `#v2-ctx-oheight-wrap`, `#v2-ctx-ooffset-wrap`. Those are opening
   (door/window) fields, confirmed opening-only in `ui.js`'s
   `syncHeightFields()` (~line 13062) — they are the *primary* fields when a
   window/door is selected, not secondary, and must stay exactly where they
   are, visible and un-collapsed.
5. Form/Pitch/Ridge/Ridge (roof fields) stay where they are; this brief only
   reorders the wall-facing part of the shared field list.

**Check:** select a room, a roof, a door and a window in turn and confirm
nothing that was visible before is now hidden or in the wrong tab order for
those kinds — only a *wall* selection's field order should visibly change.

---

## 3. Make the elevation preview read as clickable

**Files:** `web/v2/v2.css` (new/extended rules around `.elev-preview-wrap` /
`.elev-preview`, ~line 2525), `web/v2/index.html` (`#v2-ctx-elev-wrap` markup),
`web/v2/ui.js` (wherever `#v2-ctx-elev-open` is wired — search
`el.ctxElevOpen`).

- Make `#v2-ctx-elev-wrap` itself the click target (currently only the small
  text button below it is), with `cursor: pointer`, a hover/focus border in
  copper, and a hover overlay reading "Open elevation ↗" drawn over the SVG
  (see `.elev-card` / `.open-overlay` in the mock for the exact look). Keep
  the existing `#v2-ctx-elev-open` button too (for keyboard/no-hover users;
  it can become a small persistent label in the corner rather than a full
  button) — don't remove the existing click handler, add the wrapper as an
  additional trigger for the same handler.
- Label the card "Wall elevation" with the face ("south face" /
  "west face", from `elevationModel(...).side` — check how
  `wall-elevation-render.js` already derives a side label, if it does; if not,
  a minimal "this face" / "the other face" is fine, matching what `Flip face`
  already implies) so it reads as a feature, not a diagram.

**Check:** `web/v2/tests/wall-elevation.test.js` is a model/logic test, not a
DOM test — it should be unaffected. Verify manually that clicking anywhere on
the preview card opens the elevation strip exactly as clicking "Open
elevation" does today.

---

## 4. Group the "Add a finish" dropdown by base coat vs applied finish; separate height from span

**Files:** `web/v2/finish-panel.js`, `web/v2/v2.css`.

- `finish-data.js`'s `FINISH_CATEGORIES` already encodes the distinction you
  need: `layer: "coat"` (`plaster`, `render`, `facebrick`) is what the wall is
  *made of*; everything else real (`rhinolite`, `wallTile`, `paint`,
  `waterproofing`, `skirting`) sits *on top of* a coat; `none` is virtual
  ("take the default off"). Don't change `finish-data.js`.
- In `finish-panel.js`'s `surfaceTypeOptions()` (~line 63), when building the
  wall `<select>` (used in `faceFinishHtml`'s add-sheet and `bandCardHtml`'s
  per-row select), emit two `<optgroup>`s instead of a flat list:
  `"Base coat"` for ids with `layer === "coat"`, `"Applied finish"` for the
  rest that are not virtual, and (only where `{ none: true }` is passed, i.e.
  the add-sheet and the per-band select, not the room-rule select which never
  offers `none`) a trailing ungrouped `"No finish"` option exactly as today.
  Floor finishes (`surfaceTypeOptions("floor", …)`) have no coats — leave
  floor's call sites emitting a flat list (check the `surface` argument before
  grouping, or simply: only group when `surface === "wall"`).
- The custom-height block (`data-fin-custom`, `run-bottom`/`run-top`) and the
  span block (`data-fin-span`, `run-from`/`run-to`) in `faceFinishHtml()`
  (~lines 810–819) already exist as two separate blocks — they just look
  identical today. Give each its own bordered box with a label and a small
  icon: "Up the wall" (vertical icon) for bottom/top, "Along the wall"
  (horizontal icon) for from/to — see `.dim-group`, `.v-group`, `.h-group` in
  the mock for the exact treatment. This is CSS plus two short label/icon
  additions in the template string; no field names or `data-fin` attributes
  change, so `ui.js`'s existing event handlers (`run-add`, `applyHeightPreset`,
  etc.) need no changes.

**Check:** `web/v2/tests/finishes.test.js` — confirm it asserts on
`FINISH_CATEGORIES`/model behaviour, not on the literal `<select>` markup
(grep the test file for `surfaceTypeOptions` or `<optgroup` before changing
anything, to be sure). Manually add a Paint run and a Plaster run on the same
face and confirm both still save correctly and the existing overlap-warning
behaviour (`overlapNotesHtml` in `finish-panel.js`) is untouched.

---

## 5. Live preview in the "Add a finish" sheet

**File:** `web/v2/ui.js` (the finish-panel event-delegation block, ~line
14020 onward — look at `syncFinishPanel`, `finishField`, and the
`applyHeightPreset` pattern that already listens to the height-preset select).

Today nothing shows where a new finish will land until after you click
"Whole face" / "Draw area" and scroll back up to the saved card. Add a small
preview, reusing the existing `bandMiniHtml(band, model)` renderer from
`finish-panel.js` (already used for saved cards):

- Add a `<div class="live-preview">` placeholder inside the add-sheet markup
  in `faceFinishHtml()`, right above the action buttons.
- In `ui.js`, add an `input`/`change` listener (delegated on `el.ctxFinish`,
  same pattern as the existing finish-panel listeners) on the add-sheet's
  category select, height-preset select, and the four custom/span number
  inputs. On change, build a synthetic band object from the current form
  values (`category`, `from`/`to` defaulting to 0/`model.length` when the span
  box is hidden, `bottom`/`top` from the height fields) and the current
  `finishFaceModel()`, call `bandMiniHtml(syntheticBand, model)`, and write
  the result into the placeholder. This is read-only scratch state — it must
  not touch `doc`, `store.pushUndo()`, or persist anything; it only re-renders
  on each keystroke/change the same as the existing preset-fill logic already
  does for the height fields.
- Debounce isn't necessary (the existing render loop is cheap), but don't
  trigger a full `render()` — update just that one element's `innerHTML`,
  the same way `syncElevationPreview()` already avoids a full re-render via
  its `elevPreviewKey` cache.

**Check:** type values in, confirm the mini preview updates without the whole
Inspector re-rendering or losing focus on the field being typed in (the
existing finish panel already guards against losing focus while
typing — see the `typing` check in `syncFinishPanel`, ~line 14056 — follow
the same guard).

---

## Explicitly out of scope for this brief

- The elevation strip's visible-by-default info bar and the first-run
  coach-mark on the wall-height drag handle (callouts ③ and ④ in the mock).
  These need a persistence decision (localStorage key naming, whether it's
  per-browser or per-account) that should be a separate, short discussion
  before building — flag it back rather than guessing.
- Any change to `wall-elevation.js`, `wall-elevation-render.js`,
  `finish-model.js`, or `finish-data.js`'s actual categories, units, or
  compliance/overlap logic. This brief is UI surfacing only.
- Renaming the ribbon's building-wide "Elevation" command (Document → Views)
  to disambiguate it from the per-wall elevation. Worth doing, but it's a
  naming/content decision for the firm, not a layout fix — raise it
  separately.

## Definition of done

- `cd web/v2 && npm test` passes unchanged.
- Both ribbon densities (Simple and Full) can reach wall finishes and floor
  finishes in two clicks or fewer from a fresh selection.
- Selecting a wall shows its elevation picture and finishes section without
  scrolling on a standard laptop-height Inspector panel.
- A door, window, room and roof selection are visually unchanged apart from
  the elevation/finishes block moving for walls specifically.
- Adding a Paint run and a Plaster run on the same face still produces the
  correct "Paint on the plaster" quiet note and no new false-positive overlap
  warning.
