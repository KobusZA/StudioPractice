# Brief: implement the wall-elevation / finishes UX

Implement the first-user GUI changes shown in [`wall-finish-ux-mock.html`](wall-finish-ux-mock.html). This is a **layout, copy, and discoverability** job. The finish model, elevation maths, compile, and BoQ already work — do not reopen them.

## Goal

A new user who selects a wall should immediately see (1) a picture of that wall face, (2) that the picture opens a real elevation they can drag, and (3) a clear way to add paint / tile / plaster without scrolling past eight millimetre fields or guessing what "Elevation" on the ribbon means.

Walk the mock once before coding. Copper badges ①–⑤ in the mock are the five changes below.

## Do not change

- Data: `finish-data.js`, `finish-model.js`, `wall-elevation.js`, `compile.js` finish rows, room rules vs face runs, coat-vs-applied layering, quantities.
- Building-wide compass elevations: `elevation.js` and ribbon **Document → Views → Elevation**. That is a different feature. Do not rename or merge it.
- The services route-profile dock that the wall-elevation strip already shares. Keep `syncElevationDock()` owning that strip.
- Look-and-feel tokens (paper / copper / Fraunces). Match existing `v2.css`, do not invent a second visual language.
- Do not add a first-run tour framework, a plan-view paint-roller badge, or onboarding plumbing beyond the two one-time dismissals specified below.

## 1. Move finishes onto the Build ribbon

**Today.** Full ribbon: `Document → Project` holds `project-info`, `finishes` ("Floor finishes"), `wall-finishes`. Simple ribbon (`SIMPLE_TABS`) does not show either finishes command.

**Do this.**

- In `ribbon.js` `RIBBON`, take `finishes` and `wall-finishes` out of Document / Project. Leave `project-info` there.
- Add a **Finishes** group on the **Build** tab, immediately after **Walls**, with those two items (Wall finishes first).
- In `SIMPLE_TABS` Draw tab, add the same group after Walls: `{ label: "Finishes", items: ["wall-finishes", "finishes"] }`.
- Commands stay `openWallFinishes` / `openFloorFinishes` in `ui.js`. Do not change their behaviour except the status line may mention the new inspector order ("the picture of the wall, then Add a finish").
- Update any ribbon test that asserts Project still contains those ids (`tests/` — search `wall-finishes` / `"finishes"`).

## 2. Inspector: picture first, millimetres collapsed

**Today.** `index.html` inspector stack is Name → Use → … → Top → Wall height → Sill → Width → Height → Offset → elevation preview → finish panel. A selected wall must scroll past the millimetre fields to find the drawing.

**Do this.**

- Reorder `#v2-inspect-fields` so that, for a **wall**, the order is: identity (name/type/status as they already apply) → `#v2-ctx-elev-wrap` → `#v2-ctx-finish` → a collapsed `<details>` titled **Wall height and other settings** that holds Top, Wall height, and Base (`#v2-ctx-top-wrap`, `#v2-ctx-wallh-wrap`, `#v2-ctx-attach-wrap`).
- Opening fields (Sill, Width, Height, Offset from left) stay **visible when an opening is selected**. They are the primary facts then. Do not bury them in the details. The `← Wall` back button stays.
- Room / slab finish panels stay where they are relative to room/slab fields; this reorder is for the wall/opening path.
- `syncPlanContext()` already shows/hides each wrap. After the DOM move, keep those `setHidden` calls; just make sure a wall's elevation + finishes are above the fold without scrolling the millimetre block.
- Convert `#v2-ctx-elev-wrap` into a clickable card:
  - Hover / focus: copper border + overlay **"Open elevation"** (or **"Close elevation"** when `elevationOpen`).
  - Click on the wrap (not on a finish band or opening, which still open the existing callout) toggles the strip — same as `#v2-ctx-elev-open` today. You may keep that button for accessibility or fold it into the overlay; do not lose a keyboard-reachable control.
  - A short header on the card: "Wall elevation" + which face (south/room side is enough if you already have it; otherwise "this face" / Flip is on the strip).
- CSS lives in `v2.css` next to `.elev-preview-wrap`. Do not put a second copy of the mock's `<style>` block into `index.html`.

## 3. Elevation help is visible the first time

**Today.** `#v2-elev-info` is a hidden-until-docked circled "i". The note `#v2-elev-info-note` only opens on click, then closes on outside pointerdown. The text is already right: *"Drag the top of the wall to set its height. The line above is the next floor, or the roof on the top storey. Scroll to zoom; middle-drag or Alt-drag to move around. Fit shows the whole wall."*

**Do this.**

- When the wall-elevation strip first opens in a browser that has not dismissed it, show that note as a bar **inside the dock** (under the title row, above the SVG), not a popup on the "i". Include a **Don't show again** control.
- Persist dismissal in `localStorage` (key e.g. `v2-elev-info-dismissed`). After dismiss: hide the bar, keep the existing "i" so the user can reopen the note.
- `syncElevationDock()` already reveals `#v2-elev-info` when the strip shows. Wire the first-run bar there; do not show it on the services route profile.

## 4. One first-run coach-mark on the height handle

**Today.** Nothing tells a new user the wall top is draggable. The handle is only drawn on the **open** strip (`interactive: true` in `elevationSvg`), not the inspector preview.

**Do this.**

- The first time the wall-elevation strip opens (separate `localStorage` key, e.g. `v2-elev-coach-dismissed`), show a short coach-mark pointing at the top handle: **"Drag the top of the wall to set its height."** One button: **Got it**. Then never again.
- Dismiss on Got it, Exit, or closing the strip. Do not block dragging while it is visible.
- Keep it small (existing paper/ink chip). No spotlight overlay, no multi-step tour.

## 5. Add-a-finish sheet: groups, labelled dimensions, live preview

All markup is `finish-panel.js` `faceFinishHtml` / `surfaceTypeOptions`. Events stay delegated in `ui.js`.

**Dropdown groups.** `surfaceTypeOptions("wall", …)` currently dumps every wall category in `categoriesForSurface` order. Split into two `<optgroup>`s using the existing `FINISH_CATEGORIES[id].layer` flag:

- **Base coat — what the wall is made of:** `layer === "coat"` (plaster, render, facebrick, and virtual `none` when `none: true`).
- **Applied finish — goes on top of a coat:** `layer !== "coat"` (rhinolite, wall tile, paint, waterproofing, skirting).

Do not change category ids, labels, or default (`wallTile` is fine). Room-rule type selects can use the same helper so the wording stays one place.

**Dimension boxes.** Today's custom height row is "Up / to" (`data-fin-custom`) and the span row is "Along the wall From / to" (`data-fin-span`), revealed by **Part of this face**. Keep the data attributes and `applyHeightPreset` / `band-part` / `run-add` behaviour. Restyle into two labelled boxes sitting side by side when both are visible:

- **Up the wall** — bottom / top mm (already `run-bottom`, `run-top`).
- **Along the wall** — from / to mm (already `run-from`, `run-to`). Hidden until Part of this face is on, as now.

Copy in the mock: the two pairs must never read as the same "from / to".

**Live preview.** `bandMiniHtml` already draws a face + band + openings. Add a small live preview inside the add-face sheet that updates as category / height preset / custom mm / span change (listen on `ctxFinish` input/change; do not rebuild the whole inspector on every keystroke — patch the preview node). Empty / invalid mm → no band, just the face.

**Buttons.** Keep **Whole face**, **Draw area**, **Part of this face**. Draw area already sets `elevationOpen = true`; leave that.

`tests/finishes.test.js` asserts `data-fin="band-height"` and "Skirting" in `faceFinishHtml`. Keep those attributes. Add a test that the wall type `<select>` contains the two optgroup labels. Update any snapshot-like `includes(...)` that assumed a flat option list.

## Files you will touch

| File | Why |
|------|-----|
| `web/v2/ribbon.js` | Move items; add Finishes to Full + Simple |
| `web/v2/index.html` | Inspector field order; elevation card; optional first-run info bar markup |
| `web/v2/ui.js` | Click-the-preview; first-run info + coach persist; live preview patch; `openWallFinishes` copy |
| `web/v2/finish-panel.js` | Optgroups, dimension copy, live-preview slot |
| `web/v2/v2.css` | Card hover, info bar, coach-mark, dim boxes |
| `web/v2/tests/finishes.test.js` | Optgroups + existing HTML contracts |
| ribbon tests if they pin Project contents | Search `wall-finishes` |

You should **not** need `wall-elevation.js`, `wall-elevation-render.js`, `finish-model.js`, or `elevation.js`.

## Acceptance

1. Full ribbon Build tab shows a Finishes group (Wall finishes, Floor finishes) after Walls. Document → Project has only Project information (plus whatever else already lived there besides the two finish commands). Simple Draw tab shows the same Finishes group.
2. Select a drawn wall: Inspector shows Name/Type/Status, then the elevation card, then Wall finishes, without scrolling. Top / Wall height / Base are behind one collapsed details.
3. Hover/focus the elevation card: overlay says Open elevation. Click (not on a band) opens the strip under the plan. Click a painted band still opens the existing finish callout.
4. First open of the strip in a clean profile: info bar visible with Don't show again; coach-mark on the height handle with Got it. Reload: both stay gone. The "i" still reopens the note.
5. Add a finish: type list is two optgroups. Custom height + Part of this face show **Up the wall** vs **Along the wall**. The mini preview moves when those numbers change. Whole face / Draw area / typed Add still create the same `finishRuns` as today.
6. Select a window: Sill / Width / Height / Offset remain visible; `← Wall` still returns to the host wall.
7. `node --test web/v2/tests/finishes.test.js` (and any ribbon test you touched) pass. Existing elevation / finish edit tests still pass.

## Verify in the browser

The user rule requires it. With a job that has at least one wall and one window:

- Select the wall. Confirm the picture is above the fold and opens the strip.
- Drag the wall top; add Paint as Whole face; add a second finish as Part of this face with custom mm and watch the live preview; Draw area on the strip.
- Select the window, then `← Wall`.
- Confirm Document → Views → Elevation still opens the compass-side building elevation, unchanged.

If you cannot run the app, say so and list what you could not click.
