# Excel source map

File: `TSP_TEAM TIME Tdummy.xlsm`

Do not "fix" the workbook. Use it as a requirements dump.

## Sheets

| Sheet | Role |
|-------|------|
| LOGIN PAGE | User manual (travel/print rules documented here; not all implemented) |
| PROJECT INFORMATION | Register: A code, B description, C client, D email, E cell, F address, G property, H type (free text), I budget estimate, J time spent (almost unused) |
| CECILE, JEANDRE, LIANA, JESSICA, DAWIE, LOUW, FLORIS | Timesheets; most `veryHidden`. LIANA is the populated example. |
| USER INVOICE, USER INVOICE (2)/(3), Sheet1, Sheet2 | Certificate / invoice layouts. Sheet2 = three side-by-side monthly certificates for P074 |
| STRATAREPORT | Shape A cost structure |
| CONSENT USE | Shape B + PCT 1–4 |
| REZONING | Shape B + PCT 1–7 |
| REMOVAL OF RESTRICTIONS | Shape B + PCT 1–7 + other charges |
| TOWNSHIP establishment | Shape C stages + sundries (D063) |
| ADMINISTRATION | Simple unit × rate admin items |
| BOQ, CONSTRUCTION COST JBCC, CONSOLIDATION, SUBDVISION | Empty placeholders |
| REZONING / others | Some sheets are invoice clones, not types |

## Timesheet columns (staff sheets)

| Col | Meaning |
|-----|---------|
| C | Project code |
| D | Client (looked up from PROJECT INFORMATION) |
| E | Date |
| F–G | Start / end |
| H | Duration formula `G-F` |
| I | Activity type (dropdown) |
| J | Description on invoice (preferred over I) |
| K | Manual override (Excel write-down-in-place — **do not copy this mechanism**) |
| L | A4 prints |
| M | Travel km |
| N | Linear estimate minutes × 32 |
| O | 15-minute tier estimate |

VBA `ProcessSheet` reads K or O; **never L or M**. Invoice max 16 lines (rows 24–39).

Staff list in invoice dropdown: FLORIS, CECILE, JESSICA, JEANDRE, RAYNHARD, LOUW, DAWIE, ALL SHEETS. Passwords are plaintext in `Module1` (`UnlockSheet`) — ignore; real auth is out of this slice.

## VBA to reimplement in spirit, not in kind

- `PopulateProjectInfo` — lookup register by code onto certificate header
- `Tier1920` — 15-minute ladder
- `ProcessSheet` — filter by code + date range, emit certificate lines
- `HandleClientLookup` — code → client name

Do not port sheet hide/lock, ForceLogout, or AutoSave hacks.

## Linked examples (already extracted)

See `web/v2/project-master-data.json`:

- D063 ↔ `TOWNSHIP establishment` + LIANA/FLORIS/JEANDRE rows
- P074 ↔ Sheet2 May/Jun/Jul certificates + FLORIS/LIANA rows
- W076 ↔ `REZONING` (no time in this dummy file)
- J065 ↔ `CONSENT USE` (one FLORIS hour)
- P077 ↔ `REMOVAL OF RESTRICTIONS` (two FLORIS entries)
- G025 ↔ one FLORIS strata row, no template link
