---
name: practice-ops
description: >-
  Builds StudioPractice practice operations: project register, project types,
  fee templates, timesheet, write-downs, payment certificates, and the project
  master view. Use when working on practice ops, project register, timesheet,
  time tracking, invoicing, payment certificates, fee schedules, project types,
  realisation, write-downs, or replacing TSP_TEAM TIME Tdummy.xlsm.
---

# Practice operations

This is the spine of the application. The drawing app in `web/v2/` is one activity that logs time against a project; it is not the product.

Read this skill before implementing register, timesheet, templates, certificates, or the master view. For schema and billing rules, read [domain.md](domain.md). For the Excel source map, read [source-map.md](source-map.md).

## Settled decisions

Do not reopen these unless the user explicitly does.

1. **Do not fix Excel rates.** Reproduce their pricing; do not "correct" R32/min vs R1 920/hr vs R2 340. Rates live in a versioned table.
2. **Captured value is immutable.** Time entries always price at full tariff and are never edited. Overspend that cannot be billed is a **write-down** (explicit amount + reason), not a mutated row (Excel column K).
3. **Write-down is for warning and reporting**, not a rich workflow. Attach to a **certificate**, with an optional **phase** reference. Require a short reason list (scope creep, under-quoted, our error, client relationship, goodwill) plus optional note.
4. **Twelve project types, work with what we have.** Seed real templates from the workbook; register empty placeholders for the rest. A stub type is usable: no pre-built tasks, freehand tasks, everything downstream still works. Templates are authorable in the app, not hardcoded.
5. **The drawing app is not the data model.** Do not bolt practice ops onto `web/v2` geometry code. New surfaces use the same look-and-feel tokens (see mocks below).
6. **Show gaps, do not invent numbers.** Missing templates, zero certificates, `#REF!` time rows, and register-vs-template mismatches are first-class warnings. A ratio with a zero denominator is `null`, never `0` — "nobody has billed this yet" and "this realised nothing" are different sentences.
7. **The register extends `project`.** Not a sidecar table: §14 of `CLOUD-DOCUMENTS-PLAN.md` reserved that row for exactly this. A job may have no drawing — `POST /api/register` creates one without, `POST /api/projects` (the planner's) still requires a document, and `POST /api/projects/:id/drawing` attaches one later.
8. **Immutability is structural, not a convention.** There is no store method that updates `captured_amount`, and `tests/timesheet.test.js` asserts no statement in `src/` does. A wrong row is soft-deleted and re-entered. An hour already on an issued certificate cannot be withdrawn at all.

## Sequence

Build in this order. Do not skip ahead to templates unless the user asks.

| Step | Deliverable | Why first |
|------|-------------|-----------|
| 1 | **Project register** — built | Type-agnostic spine. Codes, client, property, type, budget estimate. |
| 2 | **Timesheet** — built | Daily use. Immutable captured value, activity types, optional phase/task. |
| 3 | **Write-down + certificate generation** — built | Realisation (billed ÷ captured) and cash. |
| 4 | **Project master view** — built | Status, warnings, fee schedule. Assumptions and forecast deferred. |
| 5 | **Fee templates** — built | Seeded from the workbook's five sheets with content; the four empty ones stay placeholders. |

All five live in `server/src/store.js` (a `// --- the register ---` section onward),
`server/src/pricing.js`, `server/src/defaults.js`, `server/src/fee-templates.js` and
`web/practice/`. Read those before adding to them; the decisions below are already
expressed in code.

**Still to build**, and deliberately not guessed at: `AssumptionTemplate` /
`ProjectAssumption` (holding / at risk / breached) and the forecast at completion.
Both need real jobs to have run through the phases before their rules can be
written honestly.

Time entry should show **live burn** against the current phase fee while logging. That warning is worth more than the overview page.

## Source of truth (read, do not reverse-engineer from memory)

- Workbook: `TSP_TEAM TIME Tdummy.xlsm` (repo root). Dummy data; treat figures as real structure.
  The fee-template figures already ported out of it are in `server/src/fee-templates.js`,
  each with the sheet and cell it came from. Two of its own totals are wrong and are
  **not** corrected: `STRATAREPORT`'s `=SUM(J6:J7)` drops its third line item, and the
  `CONSENT USE` / `REMOVAL OF RESTRICTIONS` sheet totals fold disbursement allowances in
  with the professional fee. The seed carries professional fees only.
- Pricing rules, already ported: `server/src/pricing.js`. The linear column and the quarter-hour ladder are the same R1 920/hr and differ only in rounding up; do not "reconcile" them.
- Type list, tariff bands, activity types, write-down reasons: `server/src/defaults.js`, seeded per org at sign-up.
- Extracted sample: `web/v2/project-master-data.json`
- UX target: `web/v2/project-master-mock.html` (data-driven master view)
- Visual language: `web/v2/look-feel-mock.html` (Fraunces + Source Sans 3, copper `#b2451e`, cream `#efe8dc`)

Hero examples already in the mock:

- **D063 Bon Accord** — township template + 36 time rows, 142% of fee, never certified, halted by client instruction, register budget R120 000 vs template R54 445.80.
- **P074 Pretorius** — T&M dispute, 35 time rows, three real certificates, 20% July write-down with no reason, realisation ~49%.
- Thin types (W076, J065, P077, G025) show honest empty states.

## What to implement (by slice)

### Project register

Replace Excel `PROJECT INFORMATION`. Fields: project code (unique, trimmed), description, client, email, cell, address, property description, **project type** (controlled list, not free text), budget estimate, opened date, lead, billing basis (`fixed_fee` | `time_and_materials`).

Do not use Excel codes as primary keys without reconciliation: duplicates (`P078`), typos (`CO36.9`, `C036 `), collisions.

Creating a project: pick type → instantiate that type's task list (empty list if placeholder) → user may add/strike/annotate tasks.

### Timesheet

One log for the practice, filtered by person — not a hidden sheet per staff member. Columns: project, date, start, end, duration, activity type, invoice description, optional phase/task, prints qty, travel km, **captured amount** (computed, immutable), optional disbursement qty.

Do not implement Excel login passwords or sheet locking.

Activity types from the workbook dropdowns; keep a single canonical list (the sheet currently has two inconsistent lists by row range).

Travel/Print: documented in Excel but **not implemented** in VBA `ProcessSheet`. Treat as a scoped follow-on unless the user asks now. Quantity columns may exist unused.

### Certificates

Fixed-fee: certificate follows the template PCT split; overrun never reaches the client; it appears as variance on the fee schedule.

T&M: lines from time entries; write-down is explicit (P074 July: subtotal → less 20% → subtotal).

Never silently cap at 16 lines (Excel invoice limit).

VAT 15% as in source, configurable later.

### Master view

Match `project-master-mock.html`: rail of projects with realisation/burn badge; overview KPIs (quoted, captured, certified, forecast or realisation); warnings derived from rules; assumptions with Holding / At risk / Breached; fee schedule; time; certificates.

Forecast at completion is **indicative** (closed-phase efficiency applied to remaining fee), labelled as such — not a promise.

## Warnings (derived, not typed)

Implement as rules over stored numbers. Minimum set already proven on real data:

- Captured > quoted on a closed or overall fee (unrecoverable unless renegotiated).
- Captured > 0 and certified = 0.
- Broken time rows (missing end, `#REF!`, priced R0 despite hours).
- Register budget vs template total disagree.
- Write-down with no reason (legacy import only; new write-downs require reason).
- Uncertified tail after last certificate.
- Captured time never mapped onto any certificate line (hand-compiled drop).
- Assumption rule breached (e.g. council hours cap, advertising allowance, "claim travel separately" with qty logged and R0 claimed).
- Client halt / hold status from a project flag (D063).

## UI / verification

New practice-ops UI: same CSS tokens as the mocks. Do not restyle to a generic dashboard.

If you add or change UI, verify in the browser (user rule): exercise the flow, not a single screenshot. Empty register, project with no time, broken rows, T&M vs fixed-fee.

## Out of scope unless asked

- Migrating all 115 Excel projects (needs a dedicated import + code reconciliation).
- Implementing Travel/Print auto-billing.
- Authoring the four empty templates (`BOQ`, `CONSTRUCTION COST JBCC`, `CONSOLIDATION`, `SUBDVISION`) as content.
- Fixing historical spreadsheet formula errors.
- Excel VBA, sheet passwords, AutoSave rules.
