# Proposal: role-based permissions on a project

Status: **proposed, not started**. This document describes a possible change;
no code has been touched yet. `membership.role` already exists as a free-text
column seeded to `'owner'` at sign-up (`server/src/schema.sql:50-58`,
`server/src/auth.js:109-110`) specifically so a second role could be added
without a migration — this proposal is about *what that second role, and the
gate it drives, should be*, not about adding the column.

## Question this answers

Should two people on the same project see different things — e.g. an
employee can add a task, log time, pick activity types, and view/edit a
drawing, but not see the fee, the tariff, or what has been billed?

**Yes.** Every practice-management competitor checked treats *money
visibility* as a permission axis independent of *operational editing*. The
one exception (Monograph) is a deliberate, documented refusal — its own
support docs record customers asking for this exact separation and being
told no — and is recorded here as a counter-example, not a model to copy.

## Competitive research

| Tool | Style | Money gate, independent of task/work editing |
|---|---|---|
| BQE Core | Granular toggles on a security profile | `Allow read rate` / `Show bill rate` / `Show cost rate` are checkboxes separate from time-entry/task edit rights; "Manage Access" can hide $ per screen (Budget, Fee Schedule) while task access stays on. |
| Deltek Vantagepoint / Ajera | Role, per module | Labor cost access has 4 levels (Full / Subtotals only / Final totals only / None), independent of project/task edit rights. Full cost access is flagged as revealing salaries — grant carefully. |
| Total Synergy | Fixed tiers (6) + up to 6 custom | Assistant Project Manager creates projects/stages/tasks but never sees costs or financial reports; Project Manager adds invoicing, still no salary/cost data. Actuals/profitability gated to Director+. |
| Karbon | Toggle on top of role | `View dollar amounts` is one on/off switch, orthogonal to "who can create, edit, delete work." |
| Scoro | Modular permission sets | `View project income and cost` and `View labor cost of other users` are separate flags; hours/quantity progress is visible without $ or cost. |
| Mosaic | Fixed access levels | Base Member / Work Planner fully plan and edit work but see budgets only in hours/%, never dollars; Budget Manager tier adds $. |
| Harvest | Fixed roles + optional flag | Members never see rates; Managers get an *optional* "see/edit billable rates and amounts" permission layered on top of normal project/task management. |
| Productive.io | Fixed permission sets | Staff/Coordinator manage tasks with zero financial visibility; Manager sees budget usage but not cost/profit; Profitability Manager adds profit/revenue; only Admin sees cost rates. |
| Monograph | Fixed roles, deliberately coupled (exception) | States anyone with project edit access sees its rates and budget; has declined customer requests to separate the two. |
| Linear / Height | Coarse workspace roles | Admin/Member/Guest scoped by team/list membership; no $ concept at all — confirms pure work-tracking tools don't need this axis, not a counter-argument to adding it here. |

The recurring shape, distilled:

1. A base role governs **what you can do**: log time, add/strike tasks, pick
   activity types, attach/edit drawings, change status. This is essentially
   "assigned to the project or not."
2. An independent flag/tier governs **what money you can see**, and several
   tools split *that* into its own ladder rather than one on/off switch:
   **hours/quantity always visible → billable $ visible with a flag → cost /
   margin visible only to the top tier.** Cost/pay rate is consistently the
   most restricted field of all — more locked down than quoted or billed $.
3. Write-down amount/reason and certificate totals travel with the billed-$
   gate, not the task-edit gate.

## Decision

Add a **capability set on `membership.role`**, not a second permission
system: `role` stays the one column that already exists
(`server/src/schema.sql:54`), and its value is looked up against a small,
server-side table of capabilities rather than gaining new columns per
capability. Four capabilities, matching the three-tier money ladder above
plus the operational baseline:

```
can_edit_work    - create/strike tasks, log time, pick activity type,
                    attach/edit drawings, change project status
can_view_hours   - budgeted/logged hours, burn %, phase progress -
                    no currency anywhere
can_view_billed  - budget_estimate, quoted fee, captured_amount totals,
                    realisation ratio, PaymentCertificate amounts
can_view_cost    - RateBand.hourly_rate values, WriteDown.amount/reason,
                    anything implying staff pay or firm margin
```

Two named roles ship first (`owner` already exists; add `employee`):

| Role | edit_work | view_hours | view_billed | view_cost |
|---|---|---|---|---|
| `owner` (existing default) | yes | yes | yes | yes |
| `employee` (new) | yes | yes | no | no |

This is deliberately the minimum needed to answer the question as asked — an
employee who can add a task, log time, pick an activity type, and edit a
drawing, but cannot see the fee or what was billed. It does not yet build
Harvest/BQE's finer "billed yes, cost no" middle tier (a project-manager role
that sees quoted/billed but not staff pay rates) — see "Open decisions"
below for why that's deferred rather than built now.

## Why now, and why not further

- `membership.role` was already reserved for exactly this by
  `server/src/auth.js:118-121`'s own comment ("the role travels with the
  account rather than being looked up again") and `schema.sql`'s comment on
  `membership` ("suppliers, draughtsmen and clients will need narrower
  access, and retrofitting a join table means finding every place that
  assumed `user.org_id`"). This proposal uses that reservation rather than
  adding a parallel table.
- Every entity the `view_billed`/`view_cost` gates would hide already exists
  in `domain.md`: `budget_estimate` on `Project`, `hourly_rate` on
  `RateBand`, `captured_amount` on `TimeEntry`, amounts on
  `PaymentCertificate`/`CertificateLine`/`WriteDown`. Nothing here invents a
  new field to hide — it's a read-side gate on fields the schema already
  has.
- Scope is deliberately two roles, not a general custom-permission builder
  (which is what BQE/Scoro/Total Synergy Enterprise eventually grow into).
  A firm this size has an owner and employees; a role editor is exactly the
  kind of thing worth deferring until a second real firm's onboarding asks
  for something the two fixed roles can't express.
- This does **not** touch `SKILL.md`'s settled decisions 1–8 (immutable
  captured value, write-down semantics, twelve project types, etc.) — it's a
  read-visibility layer on top of them, not a change to what's stored or how
  it's priced.

## Breaking-change scope

### 1. `server/src/auth.js` — one new role value, no schema change

- `role` is already a free-text column; add `'employee'` as a value
  `signUp`/an invite path can write. No `ALTER TABLE`.
- `resolveSession()` (`auth.js:209-244`) already returns `role` on every
  request; nothing here changes what it returns, only what callers do with
  it.

### 2. New: `server/src/permissions.js`

- One pure lookup: `capabilitiesFor(role) -> { canEditWork, canViewHours,
  canViewBilled, canViewCost }`, following the same "no store method that
  updates `captured_amount`" spirit `SKILL.md` decision 8 already uses for
  immutability — here, no code path reads a gated field without going
  through this function first.
- Two constants only (`owner`, `employee`) for now; a third row is adding a
  line to this table, not a migration.

### 3. `server/src/store.js` — read-side gating, not write-side

- Every store method that returns `budget_estimate`, `hourly_rate`,
  `captured_amount` totals, certificate amounts, or write-down
  amount/reason needs its result shaped by the caller's capabilities before
  it reaches JSON — not by refusing the query, by omitting/nulling the
  field, the same "gap is explicit, never invented" spirit `SKILL.md`
  decision 6 already uses (`null`, not `0`, not a guessed value).
- Write paths (`create task`, `log time entry`, `attach drawing`, `change
  status`) gate on `can_edit_work` only; they never touch money fields
  regardless of role, so they need no new gating logic beyond "is this role
  allowed to write at all."
- Certificate/write-down *creation* stays owner-only in this first pass (see
  open decision 3) — not because the model requires it, but because nothing
  in the current UI lets a non-owner reach that flow yet.

### 4. `web/practice/` — hide, don't disable

- Money fields render only when the signed-in user's capabilities include
  the relevant gate; when hidden, the surrounding layout collapses rather
  than showing a greyed-out placeholder — an employee looking at a task list
  should not see a redacted-looking budget column, they should see a task
  list. This matches Mosaic's "hours-only view" pattern more than BQE's
  "show empty/greyed field" pattern, on the theory that a spreadsheet-era
  user finding a blank $0 field will read it as data, not as "hidden."
- The master view's warnings list (`SKILL.md` §"Warnings") is written
  against `budget_estimate`/`captured_amount` comparisons; an employee
  without `can_view_billed` sees the operational warnings (broken time
  rows, missing end times) but not the money-shaped ones (captured >
  quoted, write-down with no reason).

### 5. `server/tests/*`

- New test alongside `isolation.test.js`'s existing shape: an `employee`
  role can create a task/time entry/drawing attachment and cannot read
  `budget_estimate`, `hourly_rate`, certificate amounts, or write-down
  amounts on the same project — mirroring how `isolation.test.js` already
  proves org-scoping structurally (`openStore(pool, {})` throws) rather
  than by convention.

## Open decisions

| # | Question | Leaning | Why not decided yet |
|---|---|---|---|
| 1 | Does an `employee` see *their own* logged time's captured amount, or only hours? | Hours only, matching the "employee never sees rates" baseline every competitor uses (Harvest Members, Mosaic Base Member) | Not yet asked of a real user; showing someone their own hour's price is a smaller leak than showing the firm's tariff table, and might be wanted. |
| 2 | Middle tier: a project-manager-shaped role that sees quoted/billed but not `RateBand.hourly_rate`/pay-implying cost — the Harvest-Manager / BQE-mid-profile shape? | Defer | The question as asked names exactly two tiers (add-task employee, full-visibility owner); build the third tier when a real firm has a person who needs it, not speculatively. |
| 3 | Can a non-owner create/issue a `PaymentCertificate` or record a `WriteDown`? | Owner-only for now | No UI reaches that flow for a non-owner today; deciding this now would be guessing ahead of a real workflow, the same reason `AssumptionTemplate`/forecast-at-completion are still unbuilt per `SKILL.md`. |
| 4 | Per-project override (an employee trusted with money on *one* job, not all) vs. org-wide only? | Org-wide only for now | Every competitor's simplest tier (Harvest, Mosaic, Height/Linear) is org-wide; per-project override is Total Synergy/BQE Enterprise territory and adds a second scope dimension before the first one has real usage behind it. |
| 5 | Who can invite/assign the `employee` role — is this the first "second member" the `membership` table has ever held? | Yes | No invite flow exists yet at all (`signUp` only ever creates the first `owner`). This proposal's role gate is a no-op until an invite path exists to assign anything but `owner` — see rollout order below. |

## Rollout order

Nothing below is scheduled; this is the order it would happen in once
approved.

1. Decide open questions 1–3 above (4–5 can stay deferred; they don't block
   a first ship).
2. `server/src/permissions.js` — the capability lookup, two roles, unit
   tested standalone.
3. An invite path that can create a `membership` row with `role = 'employee'`
   for a second `app_user` under the same org — this doesn't exist today
   (`signUp` only ever writes `'owner'`) and is a prerequisite, not part of
   this proposal's own scope, since inviting a second person into a firm is
   its own piece of work independent of what that person can then see.
4. `server/src/store.js` read-side gating on the fields listed in
   §"Breaking-change scope" item 3.
5. `web/practice/` hide-not-disable rendering, gated the same way.
6. `server/tests/*` coverage per item 5 above, written before step 5 lands
   UI so the gating is pinned by a test before it's pinned by a screenshot.

## Out of scope (this proposal)

- A general custom-role/permission-builder UI (BQE/Scoro/Total Synergy
  Enterprise-style). Two fixed roles only.
- Per-project role overrides (open decision 4).
- Certificate/write-down creation by non-owners (open decision 3).
- The invite flow itself, beyond noting it's a prerequisite (rollout step 3).
- Client-facing or contractor-facing roles (`SKILL.md`/`schema.sql` both
  gesture at "suppliers, draughtsmen and clients will need narrower access"
  as a future need, not this one).
