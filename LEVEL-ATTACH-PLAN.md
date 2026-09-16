# Migration plan: level-relative elevation → attach-to-element

Status: **Phase 1 implemented.** Rollout steps 1–6 below are done; Phase 2 is
untouched and still unscheduled. The gate this plan set for itself was met
before any code moved — `UNITS-MIGRATION-PLAN.md`'s steps 1–6 have landed
(`sp.pack/3`, mm on the C# side, `normalizePackUnits()` at the JSON boundary),
so all the attach arithmetic below is written in metres against the same
internal units every other consumer already uses.

Three things came out differently from the plan as written, recorded here
rather than left as a silent divergence:

- **`height` is now a readable per-object override on segments/beams**, not
  only `baseAttach` and `baseOffset`. §4's detach ("write the object's currently
  resolved elevation *and height* into `obj.baseOffset` and `obj.height`")
  cannot work without readers honouring it, so `walls.js` and
  `compile.js`'s `drawnObjectHeight()` prefer it over the SKU's height.
  `null` means "use the SKU's", which is every object that has never been
  attached.
- **A target whose type states no height is a fourth warning case**
  (`target-height-unknown`), alongside the three §2 lists. The firm's own
  template states `thickness`/`width`/`depth` but no `height` for its
  foundation types, so without this the most common real attach would have
  silently resolved against `system.wallHeight` — a guessed elevation
  underneath a real wall, which is what "unknown is null, never a plausible
  default" exists to prevent. The attaching object's *own* missing height still
  falls back the way `walls.js` always has; only the target's top is strict.
- **The batch pre-commit summary confirms in the attach panel, not a modal.**
  §4 allowed either ("or a confirm step in the UI layer"); this file's own
  convention is a panel — see `promptCalibrationDistance`'s "instead of
  blocking on `window.prompt`".

An opening now also reads its host wall's resolved base rather than the level
datum, so a door in an attached wall is not left sitting below it. The plan
didn't mention openings; leaving them on the datum would have been a new
inconsistency introduced by this change rather than a pre-existing one.

## Decision

Add an optional **attach relationship** to level-bound drawn objects (drawn
walls and beams today; shaped objects only if Phase 2 item 2e below happens),
so an object's base elevation can be resolved from another object's top
surface instead of always being its level's flat datum elevation.

This is Revit's **Attach Top/Base** concept, scoped down to what this app
actually needs: a wall that sits on a foundation (or a beam that sits on
another beam) should keep its correct base elevation if the thing under it
changes height, without the firm re-entering a number. It is **not** a
proposal to model true per-object 3D solids, join geometry booleans, or a
general constraint solver — see "why not further" below.

**Naming caveat (from review):** despite invoking "Attach Top/Base," this
plan's schema field is `baseAttach` only — there is no `topAttach`. Revit
users reach for Top attach at least as often as Base (a wall's top following
a sloped roof/beam above it), and that case has no equivalent here at all.
Either this plan should stop citing "Top/Base" as its model and call this
what it is — a **base**-only attach — or Top attach needs to ship. Resolved:
it doesn't ship in Phase 1 (see "Phase 1 decisions" below); Top attach is
Phase 2 item 2a.

**This document is now split into two phases.** Everything under
"Breaking-change scope" below is **Phase 1**: base attach for `segment`/`beam`
only, with a narrow picker and single decided answer to every question raised
in review. Phase 2 — Top attach, a wider picker, deeper chains, `slab`/`roof`
attach, and the canvas dangling-reference marker — is written up on its own
further down, after "Rollout order," and is **not** approved or scheduled by
this document; it exists so Phase 1 doesn't quietly foreclose it by accident.

## Why now, and why not further

- Every level-bound object today resolves its elevation from `pack.levels`
  alone: `compile.js`'s `levelElevation(pack, levelId)` (`web/v2/compile.js:69`)
  looks up the level's flat `elevation` number, and every emitted payload row
  (`SketchForm`/`TakeoffInstance`-shaped rows for walls, items, beams, roofs)
  calls it directly off `wall.level` / `effectiveLevel(obj, pack)`
  (`web/v2/compile.js:314,349,388,418`). There is no per-object offset from
  that datum anywhere in the document model (`web/v2/model.js`) — a wall's
  base is always exactly its level's elevation, full stop.
- The one place this already almost exists is `ceilingHeightFor` /
  the ceiling-vs-floor elevation split (`web/v2/compile.js:217-230`): a
  ceiling on a level is deliberately placed at `levelElevation + floorToCeiling`
  rather than flush with the floor, because two elements on the same level
  cannot share one elevation. That's the same shape of problem an attach
  relationship solves generally: "this object's elevation is a function of
  another object, not a flat constant."
- Scope is deliberately narrow: an **attach reference** (`{ kind, id }` on the
  attaching object, resolved to the target's top elevation at compile/derive
  time), not a live geometric solid boolean. Revit's "Attach" and "Join
  Geometry" are two separate commands for a reason — attach is a numeric
  relationship, join is a rendering/solid cleanup. Only the numeric
  relationship is in scope here; nothing in this plan changes how
  `MeshExtractor` or the plan canvas draws solids.
- Cross-level picking (a foundation on the level below a wall) already has a
  building block: `lookDownLevelId(levels, activeId)` in
  `web/v2/level-view.js:11-16` answers "what level sits under the active one."
  This plan reuses that, not a new level-adjacency concept.

## Breaking-change scope

### 1. `web/v2/model.js` — document schema, additive only

- Add optional `baseAttach: { kind, id } | null` to the segment and beam shape
  (`ENDPOINTED` kinds today: `web/v2/modify.js:25`). Absent/`null` means
  "current behaviour" — elevation comes from the level datum, exactly as
  today. This is additive (new optional key), so it does **not** need a
  `DOC_SCHEMA` bump (`web/v2/model.js:23`, currently `sp.doc/2`), by the same
  "additive is fine, renaming/removing is not" rule `SCHEMA.md` already
  states for the pack schema.
- `normalizeDoc()` (`web/v2/model.js:515`) needs `baseAttach: seg.baseAttach ??
  null` added to the segment/beam mapping so a migrated v1/pre-attach document
  gets the explicit `null` rather than an absent key — same "unknown is never
  a plausible default, make the gap explicit" rule the pack schema already
  follows for compliance facts.
- A resolution helper belongs here (or in `compile.js`, see below):
  `resolveBaseAttach(doc, ref)` walking `baseAttach` to the target object,
  with a cycle guard (A attached to B attached to A) that returns "unknown"
  rather than looping.
- **Added for usability (from Revit-complaints review): `baseOffset: number`,
  default `0`.** Also additive, also on segment/beam. This exists so
  **detach doesn't visibly relocate the object.** Revit's own Detach leaves
  the wall exactly where it currently sits — it just stops the live link;
  the wall doesn't jump back to some other datum. Without an explicit offset
  field, this plan's detach (§4) has nowhere to "freeze" the object's
  current position and would have to snap it back to the flat level
  elevation instead, which is exactly the kind of surprising jump Revit
  users notice and complain about. `baseOffset` is read whenever
  `baseAttach` is `null` (`levelElevation(pack, obj.level) + (obj.baseOffset
  || 0)`) and is what detach writes into.

### 2. `web/v2/compile.js` — elevation resolution

- `levelElevation(pack, levelId)` (`web/v2/compile.js:69-72`) stays as the
  fallback. The wall/beam elevation call sites (`:314`, `:349`, `:418`) need a
  new function, e.g. `resolvedElevation(doc, pack, obj)`, that:
  - returns `levelElevation(pack, obj.level) + target's own resolved
    elevation + target's height` when `obj.baseAttach` resolves to a live
    object,
  - falls back to `levelElevation(pack, obj.level) + (obj.baseOffset || 0)`
    when `baseAttach` is `null` — see the `baseOffset` addition in §1; for
    every object that has never been attached, `baseOffset` is `0` and this
    is identical to today's behaviour,
  - returns the level elevation **and a warning** (not a guess) when
    `baseAttach` points at an object that no longer exists — same pattern as
    every other "unknown is null, never a plausible default" gap this schema
    already tracks (`SCHEMA.md` §2),
  - returns the level elevation **and a warning** (same "never a guess"
    treatment) when the resolved chain is geometrically invalid — e.g. the
    attaching object's own top would end up below its resolved base. The
    plan as written only names "target no longer exists" as a warning case;
    a degenerate chain is just as much an "unknown," not a number to compute
    and display anyway.
- **Decided: attach adjusts `height`, not just elevation, so the takeoff stays
  accurate.** `resolvedElevation` alone only changes where an object's base
  *sits* (its Z position); left at that, `wall.height` — set once from the
  SKU/system default and the input to `area`/`volume`
  (`web/v2/compile.js:294-302`, `web/v2/walls.js:132,163`) — would be
  unchanged, so the wall's *top* would rise by the same amount its base does,
  silently, with no corresponding change to its schedule row. Decision: keep
  the object's **pre-attach top elevation fixed** and let attach eat into its
  height from the bottom, i.e. add a companion
  `resolvedHeight(doc, pack, obj) = (levelElevation(pack, obj.level) +
  obj.height) - resolvedElevation(doc, pack, obj)` and feed that into the
  `area`/`volume` calculation alongside `resolvedElevation` at every call
  site that currently reads `obj.height` directly for a wall/beam with a
  live `baseAttach`. This is the smallest change that keeps the Check/BOM
  numbers honest, and it's cheap to build now versus retrofitting once a
  firm is already trusting the schedule.
  - If `resolvedHeight` comes back `<= 0` (the target's top is already above
    where this object's top used to be), that's the "geometrically invalid
    attach" case below — warn, don't silently emit a negative/zero row.
- This directly interacts with the open decision already on record in
  `SCHEMA.md` §"Open decisions carried into week 2" item 1: `floorToCeiling`
  is null on both levels today, so `compile()` "falls back to
  `system.wallHeight`, which is floor-to-floor and therefore optimistic."
  Attach resolution walking up a chain of heights makes that same optimism
  compound (a wall attached to a foundation attached to nothing gets one
  wrong number; a beam attached to that wall gets two). That existing gap
  should be closed, or at least explicitly bounded, before attach chains are
  allowed to be more than one level deep.

### 3. `web/v2/walls.js` — no structural change, one new read

- `deriveDrawnWalls` (`web/v2/walls.js:145-172`) already carries `level` per
  wall; it would additionally pass `baseAttach` through untouched so
  `compile.js` can resolve it. `deriveRoomWalls` produces walls from room
  polygons, which have no `baseAttach` of their own in this pass — attach is
  scoped to drawn linear objects (walls/beams a person places directly), not
  room-derived shared walls. Room-derived walls stay level-datum-only.

### 4. `web/v2/modify.js` — new Toolbar 3 operation

- Add `attachSelection(doc, refs, targetRef)` alongside `rotateSelection`,
  `mirrorSelection`, `alignSelection`, `joinSelection`
  (`web/v2/modify.js:64,118,190,323`), following the same shape: pure function
  over `(doc, refs)`, returns `{ ok, message }`, no DOM. `ENDPOINTED` kinds
  only (same restriction `joinSelection` already applies at
  `web/v2/modify.js:325`); `targetRef` itself must not appear in `refs`.
- **Decided: batch, not single-object.** `alignSelection` already establishes
  the exact shape needed — one anchor/target plus N other refs, same
  relationship applied to all of them (`web/v2/modify.js:191-215`). Build
  `attachSelection` the same way from the start: every ref in `refs` gets
  `baseAttach = targetRef`, `targetRef` is excluded from the loop, one call
  handles a whole run of walls onto one foundation. There's no "ship narrow
  first" justification here the way there is elsewhere in this plan — the
  multi-ref pattern is precedent-following, not new scope, and it's far
  cheaper to build this way now than to widen the signature once the UI and
  tests already assume one-at-a-time.
- Needs a "detach" counterpart — Revit's equivalent is `Attach Top/Base` →
  "Detach" — so a bad attach isn't a one-way trip requiring undo. Detach is
  batch too, for the same reason.
  - **Detach freezes position, it does not reset it (from usability
    review).** Before clearing `baseAttach` to `null`, write the object's
    *currently resolved* elevation and height into `obj.baseOffset` and
    `obj.height` respectively (`baseOffset = resolvedElevation(...) -
    levelElevation(pack, obj.level)`), so the object stays exactly where it
    visually was the instant before detach. Setting `baseAttach = null`
    without this would make the object jump straight to the flat level
    datum on detach — the single most jarring thing Revit's own Detach
    deliberately avoids.
- **Failure messages must be specific per cause, matching this file's own
  convention (from usability review).** Every existing operation in this
  file already does this — `fail("Select two or more objects to align.")`,
  `fail("These do not meet end to end.")`, `fail("These are not
  collinear.")` (`web/v2/modify.js:194,342,348`) — never one generic
  message. `attachSelection` should follow the identical convention: e.g.
  `"Select at least one object and exactly one target."`, `"Target has no
  resolvable elevation."`, `"That would create an attach cycle."`, `"Target
  is more than one level below."` This directly answers Revit's
  best-known Attach complaint — "Cannot attach highlighted walls" with no
  further explanation — by doing the opposite of it, and it's free: this
  codebase already writes this way everywhere else.
- **Batch attach needs a pre-commit summary, not silent partial success
  (from usability review).** If 3 of 4 selected walls can attach to the
  target and 1 would be invalid, say so *before* applying — e.g. `"3 walls
  will attach to Foundation F1; Wall W7 would become invalid and will be
  skipped."` — rather than applying silently and letting the user discover
  the skipped one later in the Check panel. `alignSelection`'s per-row loop
  (`web/v2/modify.js:200-214`) already computes a per-object outcome before
  mutating anything; `attachSelection` should do the validity pass first,
  return the summary, and only mutate on a second confirmed call (or a
  confirm step in the UI layer) — same shape, just report before committing.

### 5. `web/v2/ribbon.js` / `web/v2/ui.js` — one new tool, one new picker

- A ribbon command (mirroring `align`/`join`'s existing entries) that arms a
  "pick the target" click, restricted to the level `lookDownLevelId` returns
  (`web/v2/level-view.js:11`) plus the active level itself — you attach to
  what's under you or beside you, not to a level above.
- **Decided: keep the narrow picker for Phase 1.** Revit lets you pick any
  host element visible in the current view as an attach target regardless of
  level — e.g. a wall spanning a double-height void attaching two levels
  down, or attaching *up* to a roof/floor. This plan's level-scoped picker
  forecloses both, deliberately: it's consistent with deferring Top attach
  (there's no "attach up" case until Top exists), and "attach across a
  double-height void" is rare enough to hit the wall and revisit rather than
  build general host-picking now. Widening the picker is Phase 2 scope — see
  below.
- The Check/BOM panels that already print elevation-derived numbers should
  show *why* an elevation is what it is once this lands (e.g. "attached to
  Foundation F1" vs "Level 01 GFL + 0") — same spirit as `titleBlockFields()`
  printing an em-dash instead of a guessed value (`SCHEMA.md` Week 3 section).
- **Attach state must also be visible on the object itself, not only in the
  Check panel (from usability review).** Revit's best-known Attach
  complaint besides the vague failure message is that attach state is
  otherwise invisible — you have to open Properties or turn on "Reveal
  Constraints" to find out a wall is attached at all. Whatever inspector
  already shows a selected wall/beam's properties should print "Attached to:
  Foundation F1" (or "Not attached") the instant that object is selected, so
  the state is visible without running a separate Check pass.
- **Reuse the existing armed-tool hint, don't build new UI chrome, for the
  pick step (from usability review).** `el.ribbonHint` /
  `HINTS[activeFunction]` already show a next-step hint while a tool is
  armed, with a warning override (`foundationLevelMismatch`,
  `web/v2/ui.js:2079-2101`). The Attach tool should use exactly this: the
  hint text names what's pickable ("Click a wall or beam on the level
  below, or the target to attach to"), and — while hovering a valid
  candidate, before the click commits — the hint should preview the result
  ("Base rises 0.30 m; height reduces to 2.10 m") or the failure ("Target's
  top is already above this wall's top — pick a different target"). Showing
  the consequence *before* the click, not after, is the direct fix for
  Revit's "why did my wall change / why did attach fail" complaint.
- **Dim or exclude invalid pick candidates rather than letting the user click
  them and fail (from usability review).** The picker is already scoped to
  `lookDownLevelId` + the active level; extend that same scoping to the
  canvas rendering while the tool is armed — grey out everything outside the
  allowed levels/kinds so it's visually obvious what can be picked, instead
  of relying on a `fail()` message after a bad click. Converts "clicked the
  wrong thing, got an error" into "the wrong thing was never clickable,"
  which is the most direct answer to "make the snapping easier."
- **Offer a named-list alternative to the canvas click (from usability
  review).** Precision-clicking a thin foundation strip or a beam edge at
  low zoom is exactly the kind of fiddly snapping Revit users complain
  about. Next to "pick the target on canvas," add a small dropdown/list
  populated with the same candidate set the picker already allows (named by
  SKU/label, e.g. "Foundation F1 — west run"), so a target can be chosen by
  name instead of by pixel-perfect click. This sidesteps snap-precision
  entirely rather than trying to engineer better snapping.

### 6. `web/v2/tests/*`

- `modify.test.js`: new tests for `attachSelection`/detach, mirroring the
  existing `join`/`align` coverage style — including that detach freezes
  `baseOffset` rather than resetting the object's visible position, and that
  each failure path produces a distinct, specific message.
- `core.test.js` or a new `compile.test.js`-adjacent fixture: attach chain
  resolves correctly one level deep, resolves to a warning (not a guessed
  number) when the target is missing, and refuses/ignores a cycle.
- `underlay.test.js`/`schema-forward.test.js` are unaffected — this is a doc
  schema change, not a pack schema change.

### 7. C# connector — explicitly deferred, not in scope for this pass

- `TypeCatalogExtractor.cs` reads `Level` per instance (`:242-252`) but has no
  concept of Revit's own Attach Top/Base relationship on the source model.
  Reading that off a real Revit wall (`WallUtils`/`HostObjectUtils` attach
  APIs) so an imported catalog arrives with attach info pre-populated is a
  reasonable follow-up, but this plan only covers the **web planner's own**
  attach relationship between objects the user draws in-app. Flagged here so
  it isn't silently assumed later; not scheduled.

## Rollout order (all six done)

This is the Phase 1 rollout only — Phase 2 (below) is not scheduled.

1. `web/v2/model.js`: add `baseAttach` **and `baseOffset`** to the doc schema
   (both additive), update `normalizeDoc()`.
2. `web/v2/compile.js`: `resolvedElevation()` and `resolvedHeight()` with the
   fallback/warning behaviour described above (missing target, invalid
   chain, one-hop depth cap, `baseOffset` fallback); wire both into the
   wall/beam payload rows.
3. `web/v2/modify.js`: `attachSelection` (batch, anchor+refs shape, per-cause
   fail messages, pre-commit validity summary) + detach (freezes
   `baseOffset`, does not reset position).
4. `web/v2/ribbon.js` / `web/v2/ui.js`: the tool and the level-scoped target
   picker (reusing `lookDownLevelId`, dimming invalid candidates, a
   named-list alternative to the canvas click); the `ribbonHint` preview
   while hovering a candidate; "Attached to: X" on the selection inspector;
   Check-panel warning text for a broken attach.
5. `web/v2/tests/*`: coverage for 1–3 before 4 lands, so the resolution logic
   is pinned before the UI exists to drive it.
6. Decide and close (or explicitly bound) the `floorToCeiling`-null gap noted
   in §2, since attach chains make an unbounded version of that gap worse.
   **Bounded, not closed** — recorded under `SCHEMA.md`'s open decision 1: one
   hop means the optimistic `wallHeight` fallback is absorbed at most once, as
   it was before attach existed, and a target with no stated height is warned
   about rather than absorbing it at all. Closing it needs real
   floor-to-ceiling values from the template, and 2c (deeper chains) stays
   blocked until then.

## Phase 1 decisions (resolved)

Everything below was an open question during review; each now has a decision
recorded so Phase 1 can be implemented without re-opening scoping mid-build.

| # | Question | Decision | Where |
|---|---|---|---|
| 1 | Does attach change takeoff quantities? | **Yes** — `resolvedHeight` shrinks from the bottom, pre-attach top elevation stays fixed | §2 |
| 2 | Single-object or batch attach? | **Batch** — same anchor+refs shape as `alignSelection` | §4 |
| 3 | Picker scope? | **Narrow** — `lookDownLevelId` + active level only, for Phase 1 | §5 |
| 4 | Geometrically invalid attach result? | Same warning path as a missing target (§2) | §2 |
| 5 | Chain depth? | **One level only for Phase 1** — reject/warn on a second hop rather than relying on the cycle guard to catch it incidentally | §2 |
| 6 | What shows the user a broken attach? | **Check-panel warning text is required** for Phase 1 (near-free, `resolvedElevation` already computes the state); a canvas dangling-reference marker is **Phase 2** | §2, §5 |
| 7 | Room-derived shared walls (`deriveRoomWalls`)? | **No, for now** — recorded as a live backlog item (see Phase 2), not a permanent no | §3 |
| 8 | Top attach? | **Deferred to Phase 2** — see below | Phase 2 |
| 9 | Wider picker (any host, any level, attach up)? | **Deferred to Phase 2** — depends on Top attach | Phase 2 |
| 10 | `slab`/`roof` attachable? | **Deferred to Phase 2** | Phase 2 |
| 11 | Does detach reset position or freeze it? | **Freeze** — new `baseOffset` field captures the currently-resolved value so nothing visibly jumps | §1, §4 |
| 12 | How specific should attach failure messages be? | **One distinct message per cause**, matching this file's existing convention | §4 |
| 13 | Does batch attach report problems before or after committing? | **Before** — validity pass first, summary shown, then commit | §4 |
| 14 | How is attach state surfaced to the user? | **Both**: immediately on the object's own selection inspector, and in the Check panel | §5 |
| 15 | How does the picker communicate what's pickable / what a pick will do? | **Reuse `ribbonHint`** for instructions and a live pre-commit preview; dim invalid candidates on canvas; offer a named-list alternative to clicking | §5 |

## Phase 2 (deferred scope — not approved, not scheduled)

Phase 2 is everything Phase 1 deliberately narrowed away. It is written up
here so the narrowing is visible and revisitable, not so it's committed to.
Do not start any of this until the "Before starting Phase 2" checklist below
is satisfied.

### 2a. Top attach

- Add `topAttach: { kind, id } | null` alongside `baseAttach` on the segment
  and beam shape (`web/v2/model.js`), same additive/`normalizeDoc()`
  treatment as Phase 1's `baseAttach`.
- Resolution direction is the mirror of Phase 1's: a `topAttach`'d object's
  *top* is pinned to the target's **bottom**, and (following the Phase-1
  decision in §2) its `height` grows/shrinks from the top instead of the
  bottom to keep the object's *base* elevation fixed. `resolvedElevation`
  and `resolvedHeight` need a `direction` argument rather than being
  duplicated wholesale.
- UI needs a second ribbon command ("Attach Top" next to "Attach Base",
  matching Revit's own two-button layout) and the detach counterpart for
  each.
- This is the header item on Phase 2 because it's the single most common
  non-base Revit attach case (a wall's top following a sloped roof/beam) and
  the plan's own naming ("Attach Top/Base") already sets the expectation
  that it exists.

### 2b. Wider attach-target picker

- Once Top attach exists, "attach up" is a real case the Phase-1 picker
  (`lookDownLevelId` + active level, §5) cannot serve. Widen the picker to
  also offer `lookUpLevelId` when the active tool is Attach Top.
- Separately (independent of Top attach): consider whether picking should
  ever cross more than one level — e.g. a wall spanning a double-height
  void attaching to something two levels down. Only take this on if a real
  layout hits the current one-level limit; don't build it speculatively.

### 2c. Chain depth beyond one level

- Phase 1 caps resolution at one hop and rejects/warns on a second. If beams
  attaching to walls (which then attach to foundations) turns out to be a
  real workflow, this needs: a decided max depth (or none, with the cycle
  guard as the only backstop), and — per §2's note — the `floorToCeiling`
  optimism gap closed first, since a multi-hop chain compounds that gap once
  per hop instead of absorbing it once.

### 2d. Canvas dangling-reference marker

- Phase 1 ships the Check-panel warning text only. A visible marker on the
  canvas at a dangling `baseAttach`/`topAttach` reference is new
  canvas-rendering work this plan doesn't otherwise touch (nothing in Phase
  1 changes how the canvas draws objects). Scope this against whatever the
  canvas layer's current annotation/marker mechanism is (if any) before
  estimating it.

### 2e. `slab`/`roof` (`SHAPED` kinds) attach

- E.g. a floor slab attached to a foundation's top, or a roof attached to a
  wall's top. Needs its own resolution path since `SHAPED` objects don't
  have the `ENDPOINTED` `x1/y1/x2/y2` shape Phase 1's `resolvedElevation`
  assumes — likely a shape-level Z-offset rather than a per-segment one.
  Defer until Phase 1's wall/beam case has real usage behind it.

### 2f. Room-derived shared walls (`deriveRoomWalls`)

- Current position (Phase 1): no attach on derived walls at all. The
  concrete case worth tracking: an upper floor's room-derived wall attached
  to the floor slab below it, so redrawing that slab doesn't require
  re-touching every room on the floor above. Revisit once Phase 1 usage
  shows whether this is a real customer pain point or a theoretical one.

## Before starting Phase 2

Checks to run — and questions to have real answers to, not guesses — before
any Phase 2 item above is scheduled:

- **Has Phase 1 actually shipped and been used on a real job?** Phase 2 exists
  to answer needs Phase 1 deliberately didn't guess at (batch size beyond
  what `alignSelection`-style batching covers, whether anyone hits the
  one-level chain cap, whether the Check-panel warning text is enough or
  people ask for the canvas marker). Don't schedule Phase 2 items off this
  plan's own speculation — schedule them off what Phase 1 usage actually
  surfaces.
- **Is the `floorToCeiling`-null gap (§2, and `SCHEMA.md`'s week-2 open
  decisions) closed or explicitly bounded?** Required before 2c (deeper
  chains) specifically — a multi-hop chain on top of an already-optimistic
  fallback compounds a known-bad number.
- **Has `UNITS-MIGRATION-PLAN.md` fully landed (see below)?** If it hasn't,
  neither should Phase 2 — same file-overlap argument that applies to Phase
  1 applies again here, and Phase 2's `resolvedHeight`/direction changes
  touch the same lines a second time.
- **Does the canvas layer have any existing annotation/marker mechanism**
  (for 2d), or does this plan need to scope building one from scratch? Check
  before estimating, not after starting.
- **Is there a real Top-attach use case on record from an actual user/job**
  (for 2a), or is "Revit has it" the only justification so far? The naming
  caveat earlier in this document is a documentation problem, not by itself
  proof that Top attach needs to ship.

## When to implement this relative to `UNITS-MIGRATION-PLAN.md`

**After the units migration, not concurrently, and not before it.**

- Every number this plan's resolution logic touches — `levelElevation`,
  `floorToCeiling`, `wallHeight`, and the new attach-chain arithmetic that
  adds heights together — is exactly the category of "linear dimension" the
  units plan is about to move from metres to millimetres. Writing
  `resolvedElevation()` now means writing it in metres and then touching it
  again the moment the units plan's step 7 ("revisit whether internal
  geometry math also moves to mm") happens — pure rework for no benefit.
- The two plans' breaking-change scopes overlap almost exactly on the file
  list (`model.js`, `walls.js`, `compile.js`, `modify.js`, the schema files,
  the test suite). Landing them concurrently means two structural diffs
  fighting over the same lines, which is the failure mode both plans exist to
  avoid in the first place.
- The units plan is smaller, already fully scoped, and — per its own
  rollout order — has an independently shippable first step (the C# side)
  that carries no web-side risk. It should go first end to end, including
  deciding its own open questions (sketch/mesh coordinate units, rounding
  precision), before this plan's code starts.
- Concretely: **do not start rollout step 1 of this plan until
  `UNITS-MIGRATION-PLAN.md`'s rollout steps 1–6 are landed** (step 7, the
  "revisit internal geometry math" follow-up, can happen either before or
  after this plan — it's independent of attach). Use the gap between the two
  plans landing to settle this plan's open decisions above, so implementation
  can start immediately once the units migration is done rather than opening
  a second round of scoping then.
