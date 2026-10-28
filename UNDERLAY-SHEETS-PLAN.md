# Plan: sheets you can move, see together, and load more than one of

Status: **not started.** This follows the multi-page underlay (import, scale,
align, snap) and the server-side plan file (`asset` rows, `sheetSet.assetId`).
Those stay. This plan is what is still awkward once a PDF is on the job.

## Decision

A placed page belongs to a **floor**, and the floor is a field the user can
change. It is not a guess locked in at import, and it is not the bookmark
kind (`ground`, `first`, `site`).

The **Sheets list is the only navigator.** The level switcher, the Adjust
dropdown, the Align switcher and the reference tabs all show a slice of that
same list. They do not invent a second way to decide what a page is.

A drawing may hold **more than one plan file**, and more than one page of a
floor may be **visible at once**. Import adds a file. Replacing one is a
choice, named after the file it replaces.

The sheet's place on the canvas does not change when its floor changes. Floors
in this app are which storey you are looking at, not a second coordinate
system. A page moved from Ground floor to First floor is the same rectangle,
on the other storey.

## What is wrong today

- One PDF per drawing. A second file replaces the first. That question is
  asked only when the current underlay is a single image. A plan set is
  replaced with no question, and the scale checks, alignment marks and ceiling
  heights go with it.
- After import, a page's floor cannot be changed. The Sheets list says where
  it went and refuses to edit it. The fix is to import again, which throws
  the setup away.
- Only `site`, `ground` and `first` can be placed. A second floor or a
  basement parses as Other and is left unused. Align only offers `ground`
  and `first`.
- Five controls change which page you are on (level switcher, Sheets list,
  Adjust's Sheet dropdown, Align's switcher, reference tabs). Clicking a plan
  row also changes the active floor, and nothing says so.
- One page is drawn per floor. The others appear only as a faint overlay
  inside Align.
- Import waits for the whole upload before the plan redraws. A refresh while
  the file is downloading shows the walls and no sheet, and no "loading".
- Saving a new PDF deletes the previous file on the next save. A recovery
  snapshot in `drawing_revision` still names that id, so restoring it finds
  nothing. Removing a sheet without importing another never releases the file,
  so it keeps counting toward the 4 GB quota.

## Out of scope

Named so they are not quietly dropped, and not part of the phases below:

- Cropping a sheet, halftone or greyscale, a measure tool on the plan sheet
  itself, search across sheet names, printing with the underlay off.
- Align that also rotates (two points per sheet). Align stays a translation.
- A red/blue revision compare. It wants phases 3 and 4 first.
- pdf.js loading a page range from a URL, and caching the file in the browser
  for site use. Both are the offline step of `CLOUD-DOCUMENTS-PLAN.md`, not
  this plan. This plan still downloads the whole file on open.

---

## Phase 1 — don't lose a set, and don't freeze on upload

No model change.

**Replacing a plan set asks first.** Today `sheet-ui.js` asks only when
`doc.underlay` is set and `doc.sheetSet` is not. Ask whenever a sheet set, an
image or a satellite view is already there. The message names what goes:
placed sheets, scale checks, alignment marks, ceiling heights. Choices are
**Keep current** and **Replace**. Default is Keep current. (Phase 4 turns
Replace into "replace this file" and makes the ordinary path Add.)

**The sheet is on screen before the upload finishes.** `adoptSheetSet` (and
the image equivalent) runs, the view fits, and the status says the pages are
placed. `rememberPdf` / `rememberImageFile` then runs. While it runs, the
status chip reads **Saving plan file…** and, once the browser reports it,
a percentage. Closing the tab during that upload warns that the file is not
on the job yet. Failure keeps the sheet on screen and offers **Retry** in the
status line, with the sentence already used: the file is on screen, but a
refresh will ask for it again.

**Opening a job says the file is loading.** `restoreStoredUnderlay` already
holds the "Choose PDF…" bar down via `pdfRestorePending`. That wait shows a
chip, **Loading {pdfName}…**, in the same place as Sharpening. The bar appears
only when the fetch failed or the drawing has no `assetId`.

**A drawing saved before files were stored says so.** When `sheetSet` exists,
`assetId` does not, and no PDF is open: "{name} was saved before plan files
were stored. Choose it once and it will be kept." The button stays
**Choose PDF…**.

## Phase 2 — the Sheets list, and moving a sheet to another floor

This is the phase that makes a wrong floor cheap to fix.

### Model

`levelId` is the floor. `kind` stays as the bookmark classification from
import (`cover`, `site`, `ground`, `first`, `elevations`, `sections`,
`other`) and is not shown as the floor and not consulted by Align.

A page gains `role`:

| role | meaning |
| --- | --- |
| `plan` | has a placement, drawn on `levelId` |
| `elevation` | reference panel only |
| `section` | reference panel only |
| `unused` | kept in the list, not drawn, not in the reference panel |

`normalizeSheetSet` fills `role` when it is absent: a placement means `plan`,
kind `elevations` / `sections` means those roles, anything else is `unused`.
Old documents open unchanged.

`movePageToLevel(set, pageIndex, levelId)`:

- The page's role must be `plan`, and `levelId` must be a real level. The
  same floor is a no-op.
- `levelId` changes. The placement does not: `x`, `y`, `metresPerPixel`,
  `rotation`, `opacity`, `pinned`, `calibrated`, and the page's `anchor` and
  `verified` all stay.
- If the old floor's `activeByLevel` pointed at this page, it moves to the
  next remaining plan page on that floor, or the key is dropped.
- The call says whether the view follows. Following sets
  `activeByLevel[newLevel]` to this page. Not following leaves the new
  floor's active page alone, so the moved sheet waits there behind whatever
  is already showing.

`placePage(set, pageIndex, levelId)` turns an `unused`, `elevation` or
`section` page into a `plan` on that floor and seeds a placement with
`seedPlacement` when it has none. `unplacePage` is the reverse: role
`unused`, placement and anchor dropped, the page kept. Both are ordinary
undoable edits (`pushUndo` then `persist`).

`movePlansOnLevel(set, fromLevelId, toLevelId)` is `movePageToLevel` for
every plan page on `fromLevelId`, view following only the page that was
showing.

Align's page list stops using `ALIGN_KINDS`. Every `plan` page is offered,
on any floor. The datum rule (lowest floor, then earliest page) is unchanged.

### Import dialog

One control per page, **Use as**, replacing Kind, Trace over and Level:

- **Plan on** [level ▾], listing the drawing's real floors, so a second floor
  or a basement is just a level.
- **Elevation**
- **Section**
- **Don't use**

The bookmark parse still pre-fills this, including the printed scale. The
help line under the title stays one sentence. A ticked plan whose floor does
not exist yet still offers **+ Add floor**.

### Sheets list

The list is grouped, in this order: one heading per floor that has a plan
page or is a real level, then **Elevations & sections**, then **Not on a
floor**. A floor heading with no pages is still shown when the drawing has
that level, so there is somewhere to drop a row.

Each plan row: a mark for the page on screen, the sheet name (editable, which
writes `label`), the printed scale, and ✓ or ? for the scale check. The floor
is the group, not a second column.

**Moving one sheet.** The row has a floor control, a native select of the
drawing's levels, labelled **Floor**. Changing it calls `movePageToLevel`.
Dragging the row onto another floor heading does the same call. Both are
required: the select works without a pointer, the drag is the fast path.
Keyboard: focus a row, press `m`, the floor select opens.

If the moved sheet was the one on screen, the view follows and the status
line says "{label} is now on {floor}." The level switcher updates in the same
turn. If it was not on screen, the view stays and the row changes group.

**Moving a whole floor's sheets.** The floor heading has **Move all to**
[level ▾]. More than one sheet asks first: "Move {n} sheets from {floor} to
{floor}? Their place on the plan stays the same." One sheet does not ask; it
is the same as moving that row.

**A page that is not placed.** An unused row has **Place on** [level ▾],
which calls `placePage`. An elevation or section row opens the reference
panel on click, and the same **Place on** control is there for the case where
the import guess was wrong. Placing one seeds the scale as unverified and
does not discard the other pages.

**Taking one sheet off the plan.** The row has **Don't trace**. If the page
has a verified scale or an alignment mark, ask first and name those. The page
lands under **Not on a floor**. This is not **Remove…**, which still deletes
the whole underlay and still asks with Hide as the default.

**Zoom to this sheet.** Double-click a plan row, or a small button on it,
calls the existing fit (`fitUnderlayView`) after showing that page. A single
click still shows the page without changing the zoom. Clicking a plan row
that lives on another floor still changes the active floor, and the status
line says "Now on {floor}."

**On the sheet itself.** While a plan page is showing, the canvas corner
carries "{label} · {floor} · 1:{scale} · scale checked" or "scale not
checked". It is drawn with the sheet, so it moves and hides with it.

**Page Up / Page Down** step through the plan pages of the current floor.
They do not leave the floor. They do nothing while typing in a field.

The Adjust bar's Sheet dropdown and Align's switcher stay, as filtered views
of this list. They are not where a floor is edited. The ribbon command
**Reference** is renamed **Elevations & sections**. Its panel is unchanged.

### Simple mode

**PDF / image** and **Satellite** stay in the Sheet group after a sheet is
loaded. Today `collapseAfterLoad` hides them, so a Simple user cannot add a
file once one is there.

## Phase 3 — more than one sheet visible on a floor

Still one file. A plan page gains `shown` (default true for the active page
of its floor, false for the others). `doc.underlay` remains the **current**
page: Set scale, Adjust, Pin, snap and tracing all act on it, exactly as now.
`shown` only controls drawing.

The Sheets list eye toggles `shown`. The current page cannot be hidden; hide
it by switching the current page first, or by the existing Hide, which still
hides every sheet at once (`underlay.hidden` on the placement currently
mirrored — phase 3 moves that flag to the sheet set, one hide for the whole
underlay, so a single page's eye is not confused with it).

Drawing reuses the align ghost path: extra `shown` pages of the current floor
are painted under the current page, paper knocked out, at their own opacity.
They are not hit-tested. Clicking one in the list makes it current, without
fitting. Align mode is unchanged and still draws the sheets being aligned.

Opacity per page already exists on the placement. The row's opacity slider
writes it. Draw order within a floor is page order; a drag handle on the row
reorders pages inside the floor only, and does not change the floor.

## Phase 4 — more than one PDF

*Implemented: PDF sources, Add, Replace this file, Load new revision, hash
dedupe, and the release rule. Not implemented: image and satellite underlays as
sources. They stay a single `doc.underlay` that a PDF import replaces (after
the existing question), so a PDF set and an image cannot yet sit together.*

### Model

`sheetSet` gains `sources`. A source is `{ id, name, assetId, mime }` with
`mime` one of the types the server already accepts, or `satellite` with no
`assetId` (those pixels stay fetched the way they are now). Each page gains
`sourceId`.

`normalizeSheetSet` wraps an old sheet set: one source, `id` stable for that
document, `name` from `pdfName`, `assetId` from `sheetSet.assetId`, every
page pointing at it. `pdfName` and `sheetSet.assetId` are still written for
one revision as copies of the single source, then dropped once nothing reads
them. `underlayAssetIds` collects every source `assetId` plus an image
source. A satellite source contributes none.

An image underlay and a satellite underlay become sources too, each with one
synthetic page. `doc.underlay` is still the mirrored current placement, so
the rest of `ui.js` keeps reading it.

### Import

**PDF / image adds a source.** It does not clear the others. The import
dialog is the phase 2 dialog, and its title says **Add**.

**Replace this file** is a separate command on a source heading in the Sheets
list. It opens the same dialog, and on Import it swaps that source's pages
only. Other sources, their placements and their files stay. The confirmation
names the file being replaced.

**Load new revision** is the same command when the user wants placements kept.
The new PDF is matched to the old pages by cleaned bookmark title, then by
page index. A match whose page size is within the existing 2% is kept
automatically (placement, scale check, alignment mark, floor, role). Anything
else is a row in the dialog: old page, proposed new page, and a choice of
which new page, or **Drop**. Unmatched new pages arrive as `unused`. The old
source's `assetId` is replaced by the new upload. The old file is released
only under the rule below, so a snapshot can still open it.

A second copy of the same bytes is not uploaded again. The source stores the
SHA-256 of the file next to `assetId`. `rememberPdf` sends the hash first;
the server returns the existing asset when the hash, the project and the mime
match a live row. The drawing then points at that id.

### Server

The release query in `saveDrawing` changes. A live `underlay` asset on the
project is kept when any of these name it:

- the drawing just saved
- any `drawing_revision.doc` for that drawing
- an asset uploaded after the drawing's previous `updated_at` (the guard that
  is already there, so an autosave cannot delete a file the next save is
  about to point at)

An asset no rule names is released on that save, including one orphaned by
removing the last source and saving. That is what stops a removed file
counting toward the 4 GB quota forever. Bytes named by a snapshot are not
released, and they do count toward the quota: a revision you can restore is
storage you are using. The quota error stays the one already thrown.

`SCHEMA.md` is updated in the same change, in the paragraph that today says a
sheet set keeps a single `sheetSet.assetId`.

## Tests

Phase 2, in `web/v2/tests/sheet-set.test.js`, pure functions only:

- `movePageToLevel` changes `levelId`, leaves the placement numbers and the
  anchor, retargets `activeByLevel` on the old floor, and follows only when
  asked.
- `placePage` on an unused page seeds a placement and role `plan`.
  `unplacePage` drops the placement and keeps the page.
- `normalizeSheetSet` derives `role` for a document that has none, and round
  trips a document that has one.
- Align's page filter is covered where it lives (the helper that today reads
  `ALIGN_KINDS`): a plan page whose kind is `other` on a second-floor level
  is included.

Phase 4, server, in `server/tests/assets.test.js`:

- Saving a drawing that no longer names an asset releases it.
- The same save does not release an asset still named by a
  `drawing_revision` row.
- A second upload of the same hash returns the existing asset id.

No new browser-only test. The floor control, the drag and the upload chip are
checked by hand on the Riverglen PDF: move the ground floor sheet to the
first floor and back, place the cover page onto the ground floor, and reload
mid-session to see the loading chip rather than an empty plan.

## Order

Phase 1, then phase 2. Phase 2 is the user's floor move and is useful on a
single PDF with no further work. Phase 3 before phase 4, because several
visible sheets do not need several files, and phase 4's list is the phase 2
list with a source heading added above the floors.
