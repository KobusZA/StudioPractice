# What this application is, and what may stop a feature

Status: **the governing document.** `web/v2/SCHEMA.md`, `LEVEL-ATTACH-PLAN.md`
and `UNITS-MIGRATION-PLAN.md` all derive their reasoning from this file rather
than re-arguing it; where one of them says "out of scope," it must name which
of the three blocks below it means.

## The purpose

The app helps a builder get to four things: **a plan, a price, a picture, and a
permit.** Draw the job, price it, show the client what it will look like, and
produce the compliance documentation the municipality asks for.

That sentence is the scope test. If a feature moves a builder closer to one of
those four, it is in scope, and the only remaining question is *when* it is
built - not *whether*.

## The three principles

### 1. We copy Revit's behaviours. We do not rebuild Revit's engines.

The customer's own complaint about Revit was that it is too complex and carries
functions its users never need. The fix is not to discard what Revit got right;
it is to keep the *behaviours* and drop the *engines*.

A **behaviour** is something a Revit-trained person already knows: levels and a
storey cut, look-down underlay, attach base/top, snapping, groups, mirror and
align, sheets with a title block, one storey at a time, a library of jobs to
open one from. These are cheap to build, they are the accumulated result of
other people thinking hard about the problem, and copying one costs a user
nothing to learn. Copy them freely.

An **engine** is family authoring, MEP routing, a general constraint solver,
solid geometry booleans, structural analysis, photoreal rendering, and true
per-object 3D solids. Each costs quarters, serves almost nobody in this
audience, and is where Revit's complexity actually comes from. These stay out,
and "Revit has it" is never on its own an argument for building one.

"We are not rewriting Revit" means the second paragraph, never the first. It is
not a reason to refuse an interaction a builder expects.

### 2. The template defines the defaults, not the limits.

The firm's Revit template is the source of truth for *what this firm builds
with*: its wall types, doors, windows, fittings, levels, sheets and title
blocks. The app ships that template's content, not a generic CAD palette, and
over time it should consume more of the template rather than reinventing
equivalents beside it. If the template already states a fact, read it - do not
re-derive it, and do not build a parallel version of it.

But a template is a starting point, which is what it is for a Revit user too.
Where the template's content runs out, the user may supply more: a third storey,
a level at an elevation the template never named. What the template does not
state and the user has not supplied, we **ask for** - a family the firm has to
add, a fact the firm has to confirm - and we never invent it.

The standing list of those asks lives in [TEMPLATE-ASKS.md](TEMPLATE-ASKS.md).

### 3. Unknown is `null`, never a plausible default.

A blank gets queried; a wrong number gets built. So a SKU carries physical
facts and never a compliance verdict, the rule engine is the only thing allowed
to say "pass," the pack and the job carry facts while the rule engine owns
every judgement, and every gap surfaces in a report instead of defaulting to
something believable. This is the rule the whole product's credibility rests
on, and it is not negotiable under schedule pressure.

The product is the planner in `web/v2` and the Node/Postgres system of record
in `server/`. A builder draws and prices the job in the browser; the server
holds the row. That is not a viewer of a Revit model. The C# add-in and
`LocalConnectorHost` on `127.0.0.1:17300` were the first attempt at getting
facts onto a page; they are not how the product works, and they are not a
path to restore. `build-pack.js` still turns a firm's catalog dump into a
SKU pack so judgements stay testable without Autodesk software. DXF and IFC
remain one-way deliverables a registered professional can open in Revit
without this add-in.

## What leaves the app: round-trip versus one-way

The line that decides whether a format may be written is **round-trip versus
one-way**, not open versus closed.

A DXF or an IFC is a **deliverable**: nobody re-opens one here as the same
editable job, and the purpose statement above names a permit set and a Revit
handoff, so both stay exactly as they are. A re-openable job document is a
different thing - it is a second editor's input and the copy a customer takes
with them - and it is not written. The job lives on the server as a row, and the
only ways data leaves are the existing one-way exports. See
[CLOUD-DOCUMENTS-PLAN.md](CLOUD-DOCUMENTS-PLAN.md).

Two limits are recorded there rather than designed against: a browser cannot
prevent local copies, and offline access without an expiry is a permanent free
licence.

## Which blocks are allowed to refuse a feature

Every "no" in this codebase must be one of three kinds, and must say which:

| Kind | May refuse? | What it sounds like | How it clears |
|---|---|---|---|
| **Integrity** | **Yes, outright** | "This would have to guess a fact nobody supplied." | The fact arrives, or the feature reports "unknown" instead of a number |
| **Template** | No - it is a question | "No ramp type exists in the template; the firm must supply one." | The firm adds the family, or confirms the fact |
| **Scheduling** | No - it needs a date | "Not this week; it lands with the sheet system." | It gets built |

Only an integrity block is a refusal. A template block is an ask addressed to
the firm, and belongs in `TEMPLATE-ASKS.md` with the rest. A scheduling block is
a roadmap item, and must be phrased as one - a greyed button with an honest
"lands with X" tooltip, never "out of scope," because the two read completely
differently to the person who wanted it.

The failure mode this table exists to prevent: a scheduling decision wearing an
integrity decision's clothes. "We are not rebuilding Revit" is not an integrity
block, and using it as one has already cost this app features a builder needs -
`Insert level` being the clearest case, where "levels are template-owned" was
read as "the user may never add a storey," even though a level's elevation typed
by a user is a supplied fact and not a guess at all.

## What is genuinely out

Not deferred - out, unless the purpose test above changes:

- Family authoring, and any parametric modelling of a family's internals.
- MEP routing. The firm counts service points and prices them as PC sums; we
  place and count symbols, and never route a pipe, duct or cable.
- Structural analysis, and any calculation a registered engineer signs.
- Photoreal rendering. Client-facing visuals are schematic or AI-assisted, and
  an AI-assisted image is watermarked as one.
- Automated municipal approval, and any claim of submission autonomy for work
  that requires SACAP registration. The app can produce a submission-ready set
  for a registered professional to check and sign, and can submit directly only
  for the work types that do not require registration (pools, boundary and
  garden walls, carports, outbuildings, internal alterations).
