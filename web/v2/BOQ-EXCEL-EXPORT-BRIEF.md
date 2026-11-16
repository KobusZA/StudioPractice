# Brief: export the BOQ (and BOM) to Excel

Today the BOQ only exists on screen. Output > Schedules > BOQ opens the schedule overlay, and the only other copy of the figures is `window.__boq` in the browser console. A QS cannot take the quantities away, price the blank lines, or send them to anyone. Print BOQ on the ribbon is still a `todo`.

The firm already prices jobs in Excel. `calculators/QS MASTERY VBA CALCULATOR FINAL Rev01 22 Aug 2026 A.xlsm` has a **Raw Import** sheet that a macro (`ImportCSV`) fills from a Revit schedule CSV. It looks for the header row containing `Model`, then reads `Length`, `Area`, `Volume`, `Count` (and `Height`, `Perimeter`, `Width` where present). The **BoQ Codes** sheet maps each `TSP_` code to a bill sheet and row, and **Final BoQ** is the priced bill. compile.js already treats Model, Family, Type, Length, Area, Volume and Count as its contract with that workbook. So there are two different things a user might mean by "extract to Excel":

1. **A readable, priced BOQ workbook** that a person opens, reads, prices and sends on.
2. **A feed for the QS workbook**: the same rows the Revit schedules give it today, so the existing macro and bill layout keep working.

This brief builds the first one now and defines the second so it can follow straight after (see Phase 2).

## Goal

A **Download Excel** button on the schedule overlay saves an `.xlsx` of whatever schedule is open (BOQ or BOM). The file holds the same lines, quantities, rates and warnings as the screen. Excel, LibreOffice and Google Sheets open it with no repair prompt. A QS can type a rate into a blank line and see the amount and total update.

## Decisions

These are decided. Do not reopen them while building.

1. **A real `.xlsx`, not a CSV.** A CSV cannot carry number formats, formulas, a header block or a second sheet. Excel also mangles one: it reads a code like `1-2` as a date, opens UTF-8 (`m²`, `—`) as junk without a byte-order mark, and on a machine set to a comma decimal it splits on the wrong character. The QS-workbook CSV in Phase 2 is a separate, deliberately narrow format.
2. **No new dependency.** v2 has no npm dependencies and vendors only pdf.js. A new module, `xlsx.js`, writes the workbook itself: a ZIP in "stored" mode (no compression, so no deflate code, only CRC-32) holding about eight small XML parts. SheetJS (~1 MB) or ExcelJS would be the only reason to add a build step. The sheets here are plain tables, so that is not worth it. If formatting needs grow past what is below, revisit this.
3. **Blank means "no rate on file", never 0.** An unpriced line exports with an empty Rate cell and an empty Amount, the same as "—" on screen (schedule.js, PHILOSOPHY.md). It does not export as 0, or as the text "—" that a formula would trip over.
4. **Amounts are formulas, with the values cached.** Amount is `=IF(G{r}="","",F{r}*G{r})` and every total is `=SUM(...)`, so typing a rate in Excel prices the line. Each formula cell also carries its computed value (`<v>`), so a viewer that does not recalculate (Outlook preview, a phone) still shows the right numbers.
5. **Quantities are exported unrounded.** The cell holds the full number and the number format shows it to 2 decimals (`ea` lines show 0 decimals). This way Excel's arithmetic matches the app's: the app multiplies unrounded quantities, and so does the formula.
6. **The export reads the drawing at the moment of the click.** It calls the same `boqRows(compile(store.doc, pack), rateBook)` as `runBoq()`, then repaints the open overlay from those rows before saving. The drawing can change while the overlay is docked (Side view), and the file and the screen must never disagree.
7. **One button, both schedules.** The button sits in the overlay header and exports whichever schedule is open. A BOM export is the same workbook without the Rate and Amount columns or the total. No separate ribbon command: the export belongs next to the figures it exports.
8. **Units are written as they are on screen** (`m`, `m2`, `m3`, `ea`), so a line can be matched by eye across the app, the file and the rate book.

## Later (not in this pass)

- **Phase 2, QS workbook feed** (below). Specified here, built as its own change once the customer answers the open question.
- **Print BOQ / Print BOM** stay `todo` on the ribbon. A PDF is the vector PDF export's job (Week 3).
- **Reading an edited workbook back in** (rates typed in Excel flowing into the rate book). Rates live in the Practice rate book (`web/practice/rates.js`). A round trip needs its own rules about which side wins.
- **Grouping by bill sheet** (Concrete, Earthworks, Alterations ...) the way Final BoQ does. That needs the BoQ Codes mapping in the app. Lines are grouped by category in this pass, the same as on screen.

## Do not change

- `schedule.js`. `boqRows`, `bomRows`, `findRate`, `qtyForUnit` and `scheduleTotal` stay as they are. The export reads their output and never computes a quantity or a price of its own.
- The overlay's on-screen table, side view, row picking and model pane.
- compile.js's payload. The export adds no field to it.

## Workbook layout

File name: `{job code} {job name} BOQ {YYYY-MM-DD}.xlsx` (BOM: `... BOM ...`). Characters Windows rejects are stripped, empty parts and their spaces are dropped, and the fallback is `BOQ {date}.xlsx`. The job code comes from the open project (`openProject.code`) and the job name from `store.doc.name`.

### Sheet 1 — `BOQ` (or `BOM`)

Header block, one label/value pair per row in columns A–B, bold labels:

| Row | Label | Value |
|---|---|---|
| 1 | *(title, bold, larger)* | `Bill of quantities` / `Bill of materials` |
| 2 | Job | code and name |
| 3 | Rate book | name and "from {effectiveFrom}" (BOQ only; "None loaded" when there is no rate book) |
| 4 | Exported | date and time, local |
| 5 | Drawing revision | the doc revision the sync layer last confirmed, where known |
| 6 | Lines | `{n} lines, {unpriced} with no rate on file` (BOQ) / `{n} lines` (BOM) |

Then one blank row, then the table. The header row is bold, has a bottom border and is frozen (`<pane ySplit>`) so it stays visible while scrolling. An autofilter covers the table.

| Col | Header | Source | Format |
|---|---|---|---|
| A | Item | running number, 1… per line | `0` |
| B | Category | `row.category` | text |
| C | Code | `row.model` (the SKU, e.g. `TSP_MAS008`) | text, always a string cell |
| D | Description | `row.description` | text, wrapped, ~60 chars wide |
| E | Unit | `row.unit` | text |
| F | Qty | `row.qty` | `#,##0.00` (`ea`: `#,##0`) |
| G | Rate | `row.rate`, blank when `!row.priced` | `"R" #,##0.00` (symbol from `rateBook.symbol`) |
| H | Amount | formula, decision 4 | same as Rate |
| I | Order qty | `row.orderQty` or `row.orderQuantity` where stated, else blank | as Qty |
| J | Boxes | `row.boxes` where stated, else blank | `0` |
| K | Note | `Derived from route bends` when `row.derived`; `PC allowance` when `row.pcAllowance`; `No rate on file` when unpriced; joined with `; ` | text |

The BOM sheet drops G and H. Columns I–K keep their headers and move left.

Rows are grouped by category, in the order `boqRows` already sorts them. Each category starts with a heading row (category name, bold, light fill) and ends with a subtotal row (`Subtotal {category}`, `=SUM` over that category's Amount cells). After the last category comes a blank row and then `Total (priced lines only)` in bold, summing the subtotal cells. Unpriced lines add nothing, as on screen. BOM has no subtotals or total.

### Sheet 2 — `Elements`

One row per drawn element behind each line (`row.elements`), so a QS can audit where "42 m of 110 wall" comes from.

| Col | Header | Source |
|---|---|---|
| A | Item | the Item number of the line on sheet 1 |
| B | Code | line `model` |
| C | Description | line `description` |
| D | Element id | `element.id` |
| E | Level | level name (same lookup as `levelName()` in ui.js) |
| F | Status | `existing` / `proposed` (`planned` reads as `proposed`, as on screen) / `demolished` |
| G | Length (m) | `element.length` (blank when 0) |
| H | Area (m²) | `element.area` (blank when 0) |
| I | Volume (m³) | `element.volume` (blank when 0) |
| J | Count | `element.count` (blank when 0) |
| K | Angle (°) | `element.angle` where stated |
| L | Gradient | `element.gradient` where stated |
| M | In drawing | `Yes` when `element.kind` is set; `No (derived)` for a room-derived wall or a recipe-implied quantity |

The header row is frozen and has an autofilter.

### Sheet 3 — `Notes`

The same warnings `runBoq()` puts above the table (derived fitting lines, no rate book, unpriced count), one per row. After them, a fixed line: "Quantities are measured from the drawing. Rate and Amount are blank where no rate is on file; type a rate to price the line." When there are no warnings the sheet holds only that line.

## Code

### `xlsx.js` (new)

Pure, with no DOM, so it runs under `node --test`.

```js
/** @returns {Uint8Array} the bytes of an .xlsx */
export function writeWorkbook({ sheets, creator })
// sheets: [{ name, columns: [{ width, style }], rows: [[cell, ...]], freezeRow, autoFilter }]
// cell:   null | string | number | { v, f, style }   (f = formula without "=")
```

- Parts: `[Content_Types].xml`, `_rels/.rels`, `docProps/core.xml`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml`, `xl/worksheets/sheet{n}.xml`. Strings are written as inline strings (`t="inlineStr"`), so there is no shared-string table to keep in sync.
- `styles.xml` holds a small fixed palette: plain, bold, bold+border (header), category heading fill, quantity `#,##0.00`, integer `#,##0`, money (built from the rate book symbol), wrapped text. A cell's `style` names one of these.
- Escape `& < > " '` and strip XML-illegal control characters from every string. A description can contain anything a user typed.
- Sheet names: at most 31 characters, none of `[]:*?/\`.
- ZIP: local file headers, central directory, end record, CRC-32 from a 256-entry table, stored method, fixed DOS timestamp. About 60 lines.

### `schedule-export.js` (new)

Also pure. It turns schedule rows into the `sheets` argument above.

```js
export function scheduleWorkbook(rows, { priced, title, job, rateBook, revision, exportedAt, warnings, levelName })
export function scheduleFileName({ code, name, priced, date })
```

All the layout above (category headings, subtotal formulas, cached values, column sets for BOQ and BOM, the Elements and Notes sheets) lives here, not in ui.js.

### `ui.js`

- Factor the warnings out of `runBoq()` into `boqWarnings(rows)`, so the screen and the Notes sheet use the same text.
- `exportSchedule()`: recompile per decision 6 (`boqRows` or `bomRows` depending on `schedulePriced`), set `scheduleRowsCache`, `paintSchedule()`, build the workbook, then `downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName)`. Status message: `Saved {fileName}.`
- `index.html`: `<button type="button" id="v2-schedule-export">Download Excel</button>` in the overlay header, before Side view. Wire it in the same block as `v2-schedule-peek`.

## Tests

`tests/xlsx.test.js`
- A one-cell workbook unzips (a tiny reader in the test: walk the central directory, check every CRC) to the expected part names.
- Strings with `&`, `<`, `"`, a control character and `m²` come back escaped and intact.
- A sheet name longer than 31 characters, or containing `/`, is cleaned.

`tests/schedule-export.test.js`, using the same fixtures as `schedule.test.js`
- An unpriced line has an empty Rate cell and an empty cached Amount, never `0` and never `"—"`.
- A priced line's Amount formula is `IF(G{r}="","",F{r}*G{r})` and its cached value equals `row.amount`.
- The total's cached value equals `scheduleTotal(rows)`.
- Qty cells hold the unrounded `row.qty`.
- A code such as `1-2` or `00123` is a string cell.
- A BOM workbook has no Rate or Amount column and no total row.
- The Elements sheet has one row per element, and an element with `kind: null` reads `No (derived)`.
- `scheduleFileName` strips `\ / : * ? " < > |` and falls back to `BOQ {date}.xlsx`.

## Acceptance

On a real job with walls, openings, finishes and a service route with bends:

1. Open the BOQ, click **Download Excel**, and open the file in desktop Excel, LibreOffice and Google Sheets. None of them shows a repair prompt.
2. Every line, quantity, rate and the total match the screen. The screen rounds amounts to whole rand and the file shows cents; the values are equal.
3. Type a rate into a blank Rate cell. Its Amount, its category subtotal and the total update.
4. Dock the overlay (Side view), draw another wall, and export again. The new wall is in the file and on the repainted screen.
5. Do the same with the BOM. There are no money columns.

## Phase 2 — QS workbook feed (specified, not built in this pass)

A second button, **Download for QS workbook**, writes a CSV that the macro on Raw Import accepts as if Revit had exported it. The shape follows `calculators/TSP WALL SCHEDULE(1).csv`:

```
"TSP SCHEDULE","","","","","",""
"Model","Family","Type","Length","Area","Volume","Count"
"","","","","","",""
"TSP_CON052","Basic Wall","Masonary wall 220mm Foundation Perimeter (plaster)","5915","4","0.77","1"
```

- One row per **compile() instance**, not per rolled-up line, so the workbook does its own summing, as it does for Revit.
- **Length in millimetres** (compile.js holds metres), area in m², volume in m³, count as an integer. Plain numbers, no unit suffix (the Floor schedule's `173 m²` style is not reproduced).
- UTF-8 with a byte-order mark, comma separated, every field quoted.
- Rows with no `model` are left out and listed on the export panel, because the workbook sets a code it cannot find to 0.

Before building it, run the real macro on a file this writes and confirm three things. Does it need one CSV per category (walls, floors, roofs), as the Revit schedules are split today? Does it care about the title row text? Does it need `Perimeter`, `Height` or `Width` columns present even when empty? The VBA reads columns by header name (`GetHeaderColumn`), which suggests extra or missing columns are tolerated, but that has not been tested.

## Open questions for the customer

1. "When you say extract to Excel, do you want a priced BOQ to read and send, or to drop the quantities into your QS MASTERY workbook as you do with the Revit schedules today, or both?" This decides whether Phase 2 follows straight after.
2. "Should the exported BOQ be grouped by your bill sheets (Concrete, Earthworks, Alterations ...) like Final BoQ, rather than by category?" If yes, the BoQ Codes mapping has to come into the app or the rate book.
3. "Do you need VAT and a grand total on the export, or is that done in your workbook?" Nothing in the app models VAT today, so the export leaves it out.
