# Plan: cloud documents — the job is a row, not a file

Status: **steps 1 to 5 of the implementation order are built. A firm has a
library of jobs, and opening one cannot touch another.** Document identity,
`hasJobContent()`, the title block reading `doc.name`, and `web/v2/sync.js` are
from steps 1–2. `server/` is step 3: Node and Postgres, accounts resolved through
`membership`, `project` and `drawing` rows, `GET`/`PUT /api/drawings/:id` with
`If-Match`, and an org-scoped data access layer no handler can bypass. Step 4
points the planner at it — a sign-in veil, `httpTransport`, a conflict bar with
the two choices, and the one-time import of the old `localStorage` key. Step 5 is
the library: New, Open, Rename, Duplicate, Delete and Restore, with Demo house
and the old Clear rewired as navigations.

A drawing survives having its browser wiped: sign in, draw, clear all local
storage, reload, and the job comes back from the server. Save, Save As, Clear and
the file picker are gone, because nothing is replaced in place any more. Steps
6–8 (underlay assets, offline, notes) are unbuilt, and the library says so where
it would otherwise have to pretend: the per-row *On site* control is disabled
with the reason, rather than claiming a job is cached when nothing caches it yet.

Not deployed, and deliberately. The image, a two-container compose stack, the
`.env` contract and a runbook with a smoke checklist are written
(`server/README.md`), and **nothing is hosted**: that needs a hosting target and
secrets, and guessing either would put a half-configured server in front of real
work.

This supersedes the earlier file-based Save/Open spec. That spec's goal is kept
verbatim — *a builder can have more than one job and not lose work when he hits
New, Open, Clear or Demo house* — but its three mechanisms (download a
`.sp.json`, autosave to `localStorage`, open via `<input type="file">`) are all
replaced, because all three make the job a document the user holds.

## Decision

The **server is the system of record.** A job is a row and its drawing is a row
beneath it, saved continuously; the browser holds at most an opaque cache of
jobs the user asked to take on site. There is **no native file format** — the
only ways data leaves are the existing one-way DXF/IFC exports.

**A job is not a drawing.** The drawing is the first artefact a job owns, and
later work — quotes, legal documents, supplier correspondence, a timeline — adds
siblings beside it rather than keys inside `doc`. §14 records what that costs
today, which is one extra table and nothing else.

Three goals were tangled together in the original "no data on the user's PC"
rule, and they are separated here because only the third cares where bytes sit:

| Goal | Enforced by |
|---|---|
| The user cannot operate without the system | An account and a **time-boxed offline lease**, plus not shipping a portable round-trip document |
| Work is never lost | The server row being authoritative, plus a pending-write queue for the open job |
| Usable on site with no signal | An explicit per-project offline cache |

**Round-trip versus one-way** is the line that matters, not open versus closed.
A DXF or IFC is a deliverable — nobody re-opens it here as the same editable
job — and `PHILOSOPHY.md` puts a permit set and a Revit handoff in the purpose
statement, so those stay exactly as they are, wording included. A `.sp.json`
would be a second editor's input and the thing a customer takes with them; that
is what gets dropped.

**Two honest limits, recorded so nobody designs against them later.**

1. A browser cannot prevent local copies. Everything rendered arrived over the
   wire; DevTools and a screenshot are always available. An opaque cache tied to
   a session stops the casual "email the job to my draughtsman", and that is all
   it is claimed to do.
2. Offline access without an expiry is a permanent free licence. The lease in §6
   is not a convenience feature; it is the licence check.

## What survives from the file-based spec

Document identity (§1 there, §2 here), the serialisation body — `normalizeDoc()`
output is still exactly the payload, now a request body and a `jsonb` column —
the dirty signature, the insistence that logic live in `model.js` so tests need
no DOM, and Export CAD/IFC untouched.

What disappears entirely: `fileName`, `suggestedFileName()`, the file picker,
Save As, and the three-button *Save · Don't save · Cancel* prompt. The prompt
goes because **nothing is replaced in place any more.** New, Open and Demo house
each navigate to a different project row; the open job is already saved. There
is no moment at which unsaved work is about to be overwritten, which is the
failure mode that dialog existed to catch.

## 1. Scope

In: accounts, one org per account, a project library, continuous autosave,
conflict detection, server-stored underlay, explicit offline caching with
view-plus-notes editing, and a one-time import of whatever is in the existing
`localStorage` key.

Out of this slice, and each is a **scheduling** block in the sense of
`PHILOSOPHY.md`'s table, not an integrity one:

- Sharing, multi-user orgs, live collaboration cursors.
- Version history as a browsable UI. Revisions are stored (§4) but only the
  latest is readable.
- **Offline geometry editing** and therefore any merge engine — see §6.
- Per-tenant type packs. The pack is still a static fetch; §11.
- Client, job number, and the rest of Project information. This adds only
  `doc.name` so the title block and the library have something real.
- Everything a job will own besides its drawing: quotes, legal documents,
  supplier correspondence, timelines, project management. Not described here —
  only left room for; §14.

## 2. Document identity

Schema stays `"sp.doc/2"`. Both keys are optional and `normalizeDoc()` fills
them, so every existing autosave still loads.

| Field | Default | Role |
|---|---|---|
| `id` | new id on `emptyDoc()` | Stable drawing id, and the primary key of the `drawing` row. Client-generated; the server scopes it to the org and rejects a collision |
| `name` | `null` | Typed job name. Never invent "Untitled Project" — the sheet still prints `—` when blank |

No `fileName`, and no filesystem path — there is no file.

`titleBlockFields()` currently prints `projectName: pack?.name || "—"`
(`web/v2/sheets.js`). It reads `doc.name` instead. The pack name stays the
firm/template line wherever it is already printed.

## 3. Storage

Node + Postgres. Tables, minimally:

- `org` — the firm.
- `app_user` — email, password hash.
- `membership` — `user_id`, `org_id`, `role`. One row per user today, and every
  user has exactly one. It exists now because it is free now: suppliers,
  draughtsmen and clients will need narrower access, and retrofitting a join
  table means finding every place that assumed `user.org_id`.
- `session` — token, `user_id`, `expires_at`, `offline_until` (§6).
- `project` — the **job**: `id`, `org_id`, `name`, `created_at`, `updated_at`,
  `opened_at`, `deleted_at`, `offline_pinned_at`. Client, job number, quotes,
  documents and timeline all hang here later.
- `drawing` — `id` (the doc id), `project_id`, `pack_id`, `revision bigint`,
  `doc jsonb`, timestamps. One row per job for now; the schema does not forbid
  two.
- `drawing_revision` — `drawing_id`, `revision`, `doc jsonb`, `created_at`.
  Written on a coalescing schedule, not every keystroke; recovery only.
- `project_note` — `id`, `project_id`, `author_id`, `created_at`, `level`,
  `x`, `y`, `body`. **Deliberately not inside `doc`** — see §6.
- `asset` — `id`, `org_id`, `project_id`, `kind`, `mime`, `bytes`. `underlay` is
  the first `kind`, not the only one it is built for: quote PDFs, signed
  drawings and supplier attachments are the same row with a different `kind`.

Two rules for every table, present and future:

- **Nothing is hard-deleted.** `deleted_at` only, so a mis-click is recoverable
  without a version UI, and so a record that mattered legally cannot vanish.
- **Every row carries `created_by` and `created_at`.** Free now, impossible
  later: a quote or a legal document is worth nothing without knowing who issued
  it and when, and authorship cannot be reconstructed for rows written without
  it.

## 4. Sync

The cheap part of this migration: **every mutation already calls
`store.persist()`.** So `PlanStore` keeps its call sites and its `storage`
option is replaced with a sink that a new `web/v2/sync.js` provides.

- Debounce roughly 1.5s after the last mutation, then
  `PUT /api/drawings/:id` with `If-Match: <revision>`.
- Flush on `visibilitychange` and `beforeunload` with `fetch(..., {keepalive:true})`.
- `200` returns the new revision; the client adopts it and reports **Saved**.
- `409` means the row moved under us — another tab or the site tablet. Stop
  writing, tell the user plainly, and offer *reload theirs* or *overwrite with
  mine*. Never merge silently.
- Network failure queues the write (§6) and reports **Offline — N changes
  queued**, never "Saved".

That last point is `PHILOSOPHY.md`'s third principle applied to a save
indicator: an unconfirmed write is unknown, and unknown is not allowed to
render as a plausible default. Today `persist()` swallows its errors and
editing continues in memory; on a network that is no longer acceptable.

Keep the dirty signature — `JSON.stringify` of the doc after each confirmed
save — as the thing that decides whether a write is even needed, and as the
`beforeunload` guard when a flush is still in flight.

**`sync.js` is for the drawing, and must not become the app's data layer.**
Coalescing autosave with last-write-wins-on-`If-Match` is right for a canvas
someone is dragging walls around in. It is wrong for a quote or a legal
document, which are records: issued once, immutable afterwards, and worth
nothing unless you can say exactly what was sent to a client and when. Those get
ordinary CRUD plus an audit trail when they arrive. Reusing this scheduler for
one would silently trade that audit property for convenience.

`hasContent()` currently tests only rooms, segments, slabs and roofs. The
library needs a broader `hasJobContent()` covering openings, items, beams,
stairs, sheets, site, underlay placement, `doc.levels` and `floorsRevealed`, so
a site-only or openings-only job is not shown as empty.

## 5. Library, and the commands that replace Save/Open

| Command | Behaviour |
|---|---|
| `file-new` | `POST /api/projects` creates the job and its first drawing from `emptyDoc()` + `packId` → navigate. Requires a connection |
| `file-open` | The project library: name, erf, last opened. No file input, and **no thumbnail** — see the note below |
| `file-rename` | Inline in the library and in the chrome. Sets `doc.name` and `project.name` together |
| `file-duplicate` | Server-side copy with a **new id** and " (copy)" appended. This is what the old Save As was; against a row, keeping the same id would just overwrite it |
| `file-delete` | Soft delete, undoable from the library |

Save and Save As do not exist. The chrome shows the job name, the sync state,
and the offline lease when one is active.

Demo house stops replacing the open plan: it creates a real project named
"Demo house" from the existing demo geometry and navigates to it. Clear
disappears — its handler became `file-new`. Both of those buttons used to mutate
`store.doc` in place, which is exactly the data loss the original spec was
written to stop.

After any navigation: `syncPackLevels()`, level switcher, `render()`, undo stack
reset, `clearUnderlay(store.doc)` before the incoming job's underlay loads.

**No thumbnail, and no fake one.** A picture of the job would have to come from
the geometry; a placeholder image is the plausible default `PHILOSOPHY.md`'s third
principle refuses, and it would be believed. Name, erf and dates are facts the
server already sends, and they are enough to pick a job out of a list. Rendering
a real one from `compile()` output is a later, additive change.

**Two rules the UI must hold, both about refusing rather than guessing.** Every
switch of job flushes first and does not navigate while anything is unconfirmed —
`DocSync.attach()` throws, and the caller turns that into a sentence, never a
dropped queue. And New, Duplicate, Delete, Rename and the library itself need the
server, so while the save path reports `offline` those commands are disabled with
that as the reason, instead of failing after the click.

## 6. Offline

**Explicit, not silent.** A project is cached only when the user marks it
*available on site*, because he needs to know before he drives out to the plot.
An automatic last-N cache silently misses the one job he needed.

Cached per pinned project, in IndexedDB: the doc, the underlay asset, the
resolved pack, and the notes. Purged when unpinned, on sign-out, and when the
lease expires.

The open job additionally keeps a **pending-write buffer** — one job only,
replaced on each confirmed save, cleared on sign-out and on navigating away —
so a dropped connection or a crash mid-session loses nothing.

**What works offline, and why the line is here.** The expensive part of offline
is not reading, it is merging: two devices editing the same geometry buys
conflict resolution, which is weeks of work and the one thing here that is
genuinely hard to retrofit. So the line is *additive versus conflicting*, which
lands close to "existing projects yes, new things no" but is sharper:

- **Allowed:** open a pinned job, pan, switch levels, measure, read the BOM, and
  add **site notes** — timestamped, append-only, positioned. Two devices' notes
  both arrive; they cannot conflict. This is why notes are their own rows and
  not a key inside `doc`.
- **Requires a connection:** any geometry edit, New, Duplicate, Delete, rename,
  compile, export, and the library beyond the pinned list.

The UI must say which mode it is in before a gesture fails, not after — a
disabled Draw group with "needs a connection" beats a wall that will not appear.

**The lease.** `session.offline_until`, suggested 14 days, refreshed on every
successful online use. Past expiry a pinned job still lists but will not open
until the app reaches the server. This is the mechanism behind "the user cannot
operate without the system"; storage location never was.

## 7. Underlay

The old spec's apology — *pixels are session-only, load the PDF again* —
existed only because `localStorage` cannot hold a scan. It is dropped: the
PDF/image becomes an `asset` row, `doc.underlay` keeps placement plus
`assetId`, and a job opens on a second device with its scan and its scale
intact. Size caps and per-org quota are worth deciding before this ships.

## 8. Auth

Email and password, server-side sessions in an httpOnly cookie. Every query is
scoped by `org_id` at the data-access layer rather than per handler, so a missing
check cannot leak another firm's job. Rate-limit sign-in. No third-party identity
provider in this slice.

One user, one org, one role — but resolved through `membership` (§3), never from
a column on the user. Roles and invitations are not built here; the join table
just means they will not be a migration.

## 9. Migrating what already exists

Whatever sits in `localStorage["sp-planner-document-v2"]` right now is real
work — in your browser and in any tester's. On first successful sign-in, if the
key parses and `hasJobContent()` is true, upload it as a project named
"Recovered drawing", then remove the key. Deleting the key without this throws
the work away.

## 10. The Revit connector — withdrawn

The first architecture was a Revit add-in that extracted a model and a local
HTTP host (`LocalConnectorHost` on `127.0.0.1:17300`) that the web page pulled
from. That path is **not valid**. The planner compiles its own document in
the browser (`compile()`), and the server is the system of record. Do not
plan a pairing-code invert, a hosted origin calling localhost, or a live
extract from Revit. The C# project remains in the tree as leftover from that
attempt; it is not part of the product surface. One-way DXF/IFC exports stay
as in `PHILOSOPHY.md`.

## 11. The pack

`ui.js` still does `fetch("../samples/tsp-pack.json")`. By the same argument
used for jobs, a firm's template content is that firm's data and belongs in the
database per tenant — but not in this slice. The only requirement now is that
the offline cache stores the pack keyed by `pack.id`, so a pinned job renders
against the pack it was drawn with.

## 12. Tests

Server tests over a real Postgres, and DOM-free client tests in
`web/v2/tests/` as everywhere else. `sync.js` takes an injected clock and
transport so its scheduler is testable without a network.

- `emptyDoc()` has an `id`; two calls differ.
- `normalizeDoc()` on a pre-identity document fills `id`, leaves `name` null.
- `titleBlockFields().projectName` is `doc.name` when set, `—` when null, and
  never the pack name.
- `hasJobContent()` true for site-only and for openings-only, false for empty
  plus `packId`.
- Sync: debounce coalesces a burst into one PUT; `409` stops writing and does
  not merge; a failed PUT queues and the state is never "Saved"; the queue
  flushes in order on reconnect.
- Offline: a geometry mutation is refused while offline; a site note is
  accepted and queued; an expired lease refuses to open a pinned job.
- Server: a project is unreachable from another `org_id`, resolved through
  `membership`; `If-Match` mismatch returns 409; soft delete hides from the
  library and is restorable; no code path issues a `DELETE FROM`.
- The `localStorage` import runs once, creates one project, and clears the key.
- Library: a queue that survived the flush blocks the navigation and is still
  queued afterwards; an unanswered conflict blocks it too; a blocked open asks
  the server for nothing at all. `file-new` refuses a document carrying the open
  drawing's id. Duplicate returns a different drawing id and leaves the open
  job's transport and queue untouched. Renaming the open job hands back a
  revision to adopt; renaming another job adopts nothing. A row with no name
  shows `—`, and a job never opened shows no date rather than today's.
- Cookies: `Secure` follows `COOKIE_SECURE`, falls back to `NODE_ENV` when it is
  unset, and falls back rather than reading a non-boolean value as truthy.

## 13. Docs to update

`web/v2/SCHEMA.md`: there is no job file; the drawing is a row under a job;
identity keys; underlay is now stored; notes are rows, not a doc key.
`PHILOSOPHY.md`: one sentence, if any — a job library is a behaviour, not a new
engine — plus the round-trip-versus-one-way distinction, which is the reasoning
future features will need to reuse. Both are already there: "a library of jobs to
open one from" sits in the behaviours list, and §"What leaves the app" carries the
round-trip line.

Ribbon hints: File items are commands, not todos — and in the built UI there are
no File items on the ribbon at all. `ribbon.js` transcribes the customer's four
toolbars plus Check, none of which is a File tab, so New, Open and Demo house are
buttons in the chrome and Rename, Duplicate, Delete and Restore are per-row
actions in the library. Adding a fifth-and-a-half tab would have changed what
`ribbon.js` claims to be a transcription of, for no gain.

## 14. Room left for what comes after

Quotes, legal documents, supplier correspondence, timelines and project
management are all future work, and this plan deliberately does not describe
them. It only avoids the three decisions that would be expensive to reverse once
they arrive:

- **The job is separate from its drawing** (§3). Everything later hangs off
  `project`, so those foreign keys have one unambiguous target. Doing this now
  costs one table; doing it later is a migration with real jobs behind it.
- **`sync.js` stays drawing-only** (§4), so records that need an audit trail do
  not inherit a scheduler built for a canvas.
- **No hard deletes, and `created_by` on everything** (§3), because a quote or a
  document without an author and a date is not a record.

`membership` (§3) is the same kind of insurance for the moment a supplier or a
client needs narrow access.

**One open question, not settled here.** `PHILOSOPHY.md`'s purpose test is a
plan, a price, a picture and a permit. Quotes are the price and legal documents
serve the permit, so both are clearly in scope. Timelines and project management
are none of the four, which by that document's own rules means they need either
a justification against one of them or an explicit amendment to the purpose
statement — resolved before that work is scheduled, not while it is being built.

## Implementation order

1. **Done.** Doc identity, `normalizeDoc()`, `hasJobContent()`,
   `titleBlockFields()` reads `doc.name`, and their tests. No server needed;
   useful either way.
2. **Done.** `sync.js` as a local sink first — same interface, still
   `localStorage` — plus the dirty signature and the sync-state chrome. Proves
   the seam. `PlanStore`'s `storage` option became `sink`; conflict handling is
   written and tested against a fake transport even though nothing local can
   produce a conflict, because step 4 needs it and a scheduler is cheaper to get
   right before a network is involved. What is *not* here: the chrome shows the
   job name and the save state, but New/Open/Rename/Duplicate/Delete are still
   step 5, so there is still one job in one slot and Clear still replaces it.
3. **Done, except deployment.** `server/`: auth and `membership`, `project` +
   `drawing`, `PUT`/`GET` with `If-Match`, and the org scope living in
   `src/store.js` rather than in each handler — `openStore()` demands an org and
   a user, so a handler cannot ask for "project X", only for "project X in my
   org". One dependency (`pg`); passwords are `node:crypto` scrypt and the
   HTTP layer is `node:http`. Tables for `project_note` and `asset` exist with
   no routes, because they are free now and a migration later. Tested against a
   real Postgres, including that no source file contains a `DELETE FROM`.

   **Deployment: the artefacts are done, the hosting is not, and the second half
   is waiting on a decision rather than on work.** What exists: `server/Dockerfile`
   (built from the repository root, because the image serves `web/` from the same
   origin as the API), a compose stack with *both* services — Postgres and the
   app, the app reaching the db by service name inside the network while 5440
   stays published for `npm test` and a host-side `npm start` — the `.env`
   contract, and `server/README.md` as the runbook plus a smoke checklist.

   One thing changed in the server for this rather than being left as a trap:
   the session cookie's `Secure` flag is now `COOKIE_SECURE`, defaulting to
   `NODE_ENV`. `Secure` is a property of the connection and not of the build, and
   a production image reached over plain HTTP sets a cookie the browser silently
   drops — sign-in then appears to succeed and not have happened, with nothing in
   any log. It is tested, including that an unreadable value falls back instead of
   reading as truthy.

   What is **not** done, and what it is waiting for: a named host. The deploy
   shape — managed Postgres versus a container, where TLS terminates, how secrets
   are stored — follows from that choice and cannot be written first. Guessing a
   URL, a provider or a secret would be worse than being undeployed.
4. **Done.** `sync.js` gained `httpTransport`; `web/v2/cloud.js` is the
   accounts-and-library client, kept out of `sync.js` on purpose so a record
   never inherits the drawing's scheduler. `DocSync.attach()` is the navigation
   primitive step 5 needs, and it refuses while a write is unconfirmed rather
   than dropping the queue. Conflict resolution is a bar with two buttons and no
   default. The `localStorage` import runs once on sign-in, clears the key only
   after the upload is confirmed, and leaves an unparseable document alone.
   One design decision not in the plan: **`project.name` follows `doc.name` on
   every accepted save**, so the library and the printed title block cannot
   disagree within a keystroke of each other.
5. **Done.** The library: New, Open, Rename, Duplicate, Delete and Restore, with
   Demo house and Clear rewired as navigations. The endpoints already existed, so
   this was the client half — `web/v2/library.js` for the behaviour (DOM-free and
   tested against a real `DocSync` with a scripted transport) and an overlay in
   `ui.js` for the rows.

   Four decisions worth recording, because each one is a refusal:

   - **A blocked navigation is a sentence, not a discard.** `flushForNavigation()`
     writes what is pending and then checks; a queue that survived means the write
     did not land, so the job stays open and says why. An unanswered `409` blocks
     the same way, with its own wording.
   - **`file-new` refuses a document wearing the open drawing's id** before it is
     sent. Clear used to keep that id deliberately, because it was replacing that
     row's contents; a *new row* carrying it would collide with the job it was
     meant to leave alone.
   - **Duplicate does not navigate.** It is something done to a row in the list,
     and the open job has no reason to close. The copy is checked for having come
     back with a different drawing id.
   - **Delete is disabled on the open job** rather than deleting the row the
     editor is attached to and then writing into it.

   Renaming the open job adopts the revision the server's rewrite produced —
   without that, the next autosave arrives with a stale `If-Match` and the job
   conflicts with its own rename. `openMostRecentProject()` is gone: boot reopens
   the last-opened job, and a firm with no jobs lands in the library with New,
   which is the case that used to silently create a row.
6. Underlay assets.
7. Offline: pinning, the IndexedDB cache, the pending queue, the lease, and the
   disabled-tool states.
8. Site notes.

Steps 1–5 are the slice that stops data loss, and they are built. 6–8 are what
make it usable on a site with no signal, and are worth their own review before
starting.

## Done when

- Two jobs live as two rows, and opening one cannot touch the other.
- A quote, a legal document or a timeline could be added later as a table
  referencing `project`, without touching the drawing or its sync.
- A refresh restores the open job from the server, not from the browser.
- New, Open and Demo house cannot lose work, because nothing is replaced in
  place and the last write is confirmed before navigation.
- The save indicator never says "Saved" for a write the server did not confirm.
- A pinned job opens on site with its underlay and scale, accepts notes, refuses
  geometry edits, and stops opening once the lease expires.
- There is no way to download a re-openable job, and Export CAD/IFC wording is
  unchanged.
- Documents without `id` or `name` still open.
