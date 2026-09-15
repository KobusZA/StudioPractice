# Migration plan: level-relative elevation → attach-to-element

Status: **proposed, not started**. This document describes the change; no code
has been touched yet. Nothing here is binding until it's reviewed — same
convention as `UNITS-MIGRATION-PLAN.md`: scope, breaking points and rollout
order are agreed before any schema or extractor code moves.

## Decision

Add an optional **attach relationship** to level-bound drawn objects (drawn
walls and beams today; shaped objects if the open decision below extends it),
so an object's base elevation can be resolved from another object's top
surface instead of always being its level's flat datum elevation.

This is Revit's **Attach Top/Base** concept, scoped down to what this app
actually needs: a wall that sits on a foundation (or a beam that sits on
another beam) should keep its correct base elevation if the thing under it
changes height, without the firm re-entering a number. It is **not** a
proposal to model true per-object 3D solids, join geometry booleans, or a
general constraint solver — see "why not further" below.

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

### 2. `web/v2/compile.js` — elevation resolution

- `levelElevation(pack, levelId)` (`web/v2/compile.js:69-72`) stays as the
  fallback. The wall/beam elevation call sites (`:314`, `:349`, `:418`) need a
  new function, e.g. `resolvedElevation(doc, pack, obj)`, that:
  - returns `levelElevation(pack, obj.level) + target's own resolved
    elevation + target's height` when `obj.baseAttach` resolves to a live
    object,
  - falls back to `levelElevation(pack, obj.level)` when `baseAttach` is
    `null`,
  - returns the level elevation **and a warning** (not a guess) when
    `baseAttach` points at an object that no longer exists — same pattern as
    every other "unknown is null, never a plausible default" gap this schema
    already tracks (`SCHEMA.md` §2).
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
  over `(doc, refs)`, returns `{ ok, message }`, no DOM. Restricted to exactly
  one selected object plus one target, `ENDPOINTED` kinds only (same
  restriction `joinSelection` already applies at `web/v2/modify.js:325`).
- Needs a "detach" counterpart (set `baseAttach` back to `null`) — Revit's
  equivalent is `Attach Top/Base` → "Detach" — so a bad attach isn't a
  one-way trip requiring undo.

### 5. `web/v2/ribbon.js` / `web/v2/ui.js` — one new tool, one new picker

- A ribbon command (mirroring `align`/`join`'s existing entries) that arms a
  "pick the target" click, restricted to the level `lookDownLevelId` returns
  (`web/v2/level-view.js:11`) plus the active level itself — you attach to
  what's under you or beside you, not to a level above.
- The Check/BOM panels that already print elevation-derived numbers should
  show *why* an elevation is what it is once this lands (e.g. "attached to
  Foundation F1" vs "Level 01 GFL + 0") — same spirit as `titleBlockFields()`
  printing an em-dash instead of a guessed value (`SCHEMA.md` Week 3 section).

### 6. `web/v2/tests/*`

- `modify.test.js`: new tests for `attachSelection`/detach, mirroring the
  existing `join`/`align` coverage style.
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

## Rollout order (once approved)

1. `web/v2/model.js`: add `baseAttach` to the doc schema (additive), update
   `normalizeDoc()`.
2. `web/v2/compile.js`: `resolvedElevation()` with the fallback/warning
   behaviour described above; wire into the wall/beam payload rows.
3. `web/v2/modify.js`: `attachSelection` + detach.
4. `web/v2/ribbon.js` / `web/v2/ui.js`: the tool and the level-scoped target
   picker (reusing `lookDownLevelId`).
5. `web/v2/tests/*`: coverage for 1–3 before 4 lands, so the resolution logic
   is pinned before the UI exists to drive it.
6. Decide and close (or explicitly bound) the `floorToCeiling`-null gap noted
   in §2, since attach chains make an unbounded version of that gap worse.

## Open decisions to confirm before implementation starts

- **Scope of attachable kinds.** This plan only covers `segment`/`beam`
  (drawn linear objects). Should `slab`/`roof` (`SHAPED` kinds) also get a
  `baseAttach`, e.g. a floor slab attached to a foundation's top? Revit
  allows attach on more than walls; this plan defers that until the
  wall/beam case is proven.
- **Chain depth.** One level of attach (wall → foundation) is the stated
  scope. Do beams need to attach to walls, making a two-deep chain, or should
  a beam only ever attach to another beam/level datum? Deeper chains need the
  cycle-guard behaviour decided up front, not discovered via a bug.
- **What "broken attach" shows the user.** A warning in the Check panel, a
  visible marker on the canvas (dangling reference), or both? `SCHEMA.md`'s
  "unknown is null, never a plausible default" principle says this must be
  visible somewhere, not silently absorbed into a fallback number.
- **Whether room-derived shared walls (`deriveRoomWalls`) ever need attach.**
  Current position: no — attach is for objects a person explicitly draws and
  positions, not walls the app derives from room polygons. Worth confirming
  this doesn't box in a real customer need (e.g. attaching an upper floor's
  derived wall to the floor slab below it).

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
