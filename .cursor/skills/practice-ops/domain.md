# Domain model

## Entities

```
RateBand            code, label, hourly_rate, effective_from
ProjectType         code, name, billing_basis_default, template_version
  Phase             seq, name, default_pct_split[1..n]
    TaskTemplate    seq, description, hours_by_rate_band, default_fee, kind
AssumptionTemplate  text, rule (hours_cap | allowance | exclusion | claim_separately)

Project             code, client, property, type, budget_estimate, basis, status
  ProjectTask       cloned from template; status; assignee; annotations; may add/strike
  ProjectAssumption cloned; state derived: holding | at_risk | breached
TimeEntry           project, user, date, start, end, activity_type, description,
                    phase_or_task?, prints?, km?, captured_amount (immutable)
Disbursement        project, kind, quoted, incurred, recovered_on_certificate?
PaymentCertificate  project, seq, period, status (draft|issued)
  CertificateLine   from schedule | time | disbursement
  WriteDown         amount, pct?, reason_code, note, optional phase_id
```

**Quoted** = template professional fee (+ disbursement allowances).
**Captured** = sum of time-entry `captured_amount` (full tariff, never edited).
**Billed** = certified professional after write-downs + recovered disbursements.
**Realisation** = billed ÷ captured.
**Burn** = captured ÷ quoted (fixed-fee).

Shape A (`STRATAREPORT`): one unnamed phase, fee-only lines.
Shape B (`CONSENT USE`, `REZONING`, `REMOVAL OF RESTRICTIONS`): numbered tasks in phases, four tariff bands, phase fee split across PCT columns.
Shape C (`TOWNSHIP establishment`): stages + sundries, fixed costs allocated across Pct columns.

A and C are degenerate B. One schema.

## Rate bands (from fee templates)

| Code | Label | Typical hourly (workbook) |
|------|--------|---------------------------|
| A1 | Principal | R 3 600 |
| A2 | Professional staff | R 3 100 |
| B | Salaried technical | R 2 300 |
| C | Other staff | R 1 900 |

Timesheet parallel (LIANA formulas): linear R32/min (column N); 15-minute ladder R480 / R960 / R1 440 / R1 920 then whole hours at R1 920 plus remainder (column O). Invoice VBA uses column K if non-zero else O, then units = `Ceiling(base/480)*0.25`.

Store which rule applied with `effective_from`. Do not collapse these into one "correct" rate.

## Write-down

New records: required `reason_code` from `scope_creep | under_quoted | our_error | client_relationship | goodwill`. Optional note.

Imported Excel discounts may have empty reason; flag as a warning.

## Project types in the workbook

**Templates with content**

- STRATAREPORT (Shape A)
- CONSENT USE (Shape B) — linked example J065
- REZONING (Shape B) — W076
- REMOVAL OF RESTRICTIONS (Shape B) — P077
- TOWNSHIP establishment (Shape C) — D063

**Empty placeholder sheets** (register the type, empty task list)

- BOQ
- CONSTRUCTION COST JBCC
- CONSOLIDATION
- SUBDVISION (keep the misspelling as an alias; display name Subdivision)

**Also seen as free text in PROJECT INFORMATION column H** (do not treat as canonical until user confirms): DISPUTE, ARCHITECTURE, BUILDING PLAN, RENOVATION, LAND USE RIGHTS, SCANNING, CONTRACT OPINION, etc. `DISPUTE` is T&M in practice (P074).

## Activity types (canonicalize to one list)

Phone call, Report, File work, Meeting, Site visit, Admin, Networking, Town planning, Architectural work, Training, Marketing, Travel, Print, Daily huddle, Friday club, Excel work, Other.

Drawing/Revit work maps to Architectural work (and township lines such as "Scale out in REVIT").

## Status vocabulary

Project: `open | on_hold | halted | complete`.
Phase/task: `not_started | in_progress | done | not_required`.
Certificate: `scheduled | draft | issued`.
Assumption: `holding | at_risk | breached`.
