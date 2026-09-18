// The library's commands: New, Open, Rename, Duplicate, and the rule in front of
// all of them - flush before you navigate, and refuse if the flush did not land.
//
// No DOM and no server. The cloud is a recorder, and the sync under test is the
// real DocSync against a scripted transport, because the thing most worth
// proving here is what happens to a *queue* when the user switches job.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NavigationBlocked, createJob, duplicateJob, flushForNavigation, jobRowFields,
  openJob, renameJob, shortDateTime, splitLibrary,
} from "../library.js";
import { DocSync } from "../sync.js";
import { emptyDoc } from "../model.js";

/** No debounce: every test here drives the scheduler by flushing it. */
function noTimer() {
  return { setTimer: () => 1, clearTimer: () => {} };
}

function docFor(id, name = null) {
  return { ...emptyDoc(), id, name };
}

/** A transport that accepts writes and counts them. */
function acceptingTransport() {
  let revision = 1;
  const puts = [];
  return {
    puts,
    async put({ doc }) {
      puts.push(doc);
      revision += 1;
      return { ok: true, revision: String(revision) };
    },
  };
}

/** A transport with no network behind it: every write throws, so it queues. */
function failingTransport() {
  return { put: async () => { throw new TypeError("Failed to fetch"); } };
}

function fakeCloud(overrides = {}) {
  const calls = [];
  const record = (name) => (...args) => { calls.push({ name, args }); };
  return {
    calls,
    async openProject(id) {
      record("openProject")(id);
      return { project: { id, name: "Theirs" }, drawing: { id: `dwg-${id}`, doc: docFor(`dwg-${id}`), revision: "4" } };
    },
    async createProject(args) {
      record("createProject")(args);
      return {
        id: "prj-new",
        name: args.name,
        drawing: { id: args.doc.id, doc: args.doc, revision: "1" },
      };
    },
    async duplicateProject(id) {
      record("duplicateProject")(id);
      return { id: "prj-copy", name: "Erf 1180 (copy)", drawing: { id: "dwg-copy" } };
    },
    async renameProject(id, name) {
      record("renameProject")(id, name);
      return { id, name, drawing: { id: "dwg-1", doc: docFor("dwg-1", name), revision: "9" } };
    },
    ...overrides,
  };
}

// --- the gate in front of every navigation ---------------------------------

test("a job with everything confirmed navigates", async () => {
  const sync = new DocSync({ transport: acceptingTransport(), revision: "1", ...noTimer() });
  sync.save(docFor("dwg-1", "A"));
  await assert.doesNotReject(() => flushForNavigation(sync));
  assert.equal(sync.isDirty(), false);
});

test("a queue that survives the flush blocks the navigation instead of being dropped", async () => {
  const sync = new DocSync({ transport: failingTransport(), revision: "1", ...noTimer() });
  sync.save(docFor("dwg-1", "Unsent"));
  await sync.flush();
  assert.equal(sync.state.kind, "offline");

  await assert.rejects(() => flushForNavigation(sync), NavigationBlocked);
  // The whole point: the unconfirmed document is still there, still belonging to
  // the job it was drawn in.
  assert.equal(sync.isDirty(), true);
  assert.equal(sync.queue.length, 1);
});

test("an unanswered conflict blocks navigation with its own reason", async () => {
  const theirs = docFor("dwg-1", "Theirs");
  const transport = {
    put: async () => ({ ok: false, conflict: true, revision: "12", doc: theirs }),
  };
  const sync = new DocSync({ transport, revision: "1", ...noTimer() });
  sync.save(docFor("dwg-1", "Mine"));
  await sync.flush();

  await assert.rejects(() => flushForNavigation(sync), (error) => {
    assert.ok(error instanceof NavigationBlocked);
    assert.match(error.message, /changed somewhere else/);
    return true;
  });
});

test("opening another job while a write is unconfirmed leaves the open job alone", async () => {
  const sync = new DocSync({ transport: failingTransport(), revision: "1", ...noTimer() });
  sync.save(docFor("dwg-1", "Unsent"));
  await sync.flush();

  const cloud = fakeCloud();
  let applied = null;
  await assert.rejects(
    () => openJob({ cloud, sync, projectId: "prj-2", apply: (o) => { applied = o; } }),
    NavigationBlocked,
  );
  assert.equal(applied, null);
  // Nothing was even asked of the server: the refusal happens before the GET,
  // so a blocked navigation cannot bump another job's opened_at either.
  assert.deepEqual(cloud.calls, []);
});

test("open flushes first, then hands the incoming job to the editor", async () => {
  const transport = acceptingTransport();
  const sync = new DocSync({ transport, revision: "1", ...noTimer() });
  sync.save(docFor("dwg-1", "Edited"));

  const cloud = fakeCloud();
  let applied = null;
  await openJob({ cloud, sync, projectId: "prj-2", apply: (o) => { applied = o; } });

  assert.equal(transport.puts.length, 1, "the job being left was written before the switch");
  assert.equal(applied.project.id, "prj-2");
  assert.equal(applied.drawing.id, "dwg-prj-2");
});

// --- new ------------------------------------------------------------------

test("a new job does not reuse the open drawing's id", async () => {
  const sync = new DocSync({ transport: acceptingTransport(), revision: "1", ...noTimer() });
  const cloud = fakeCloud();
  const doc = emptyDoc();

  const opened = await createJob({
    cloud, sync, doc, packId: "tsp-pack", openDrawingId: "dwg-open", apply: () => {},
  });
  assert.notEqual(opened.drawing.id, "dwg-open");
  assert.equal(opened.drawing.id, doc.id);
  assert.equal(cloud.calls[0].args[0].packId, "tsp-pack");
  assert.equal(cloud.calls[0].args[0].doc.packId, "tsp-pack");
});

// Clear used to keep the open drawing's id on purpose, because it was replacing
// that row's contents. A *new row* carrying it would collide with the job it was
// supposed to leave alone, so this is a refusal rather than a comment.
test("a document still wearing the open drawing's id is refused before it is sent", async () => {
  const cloud = fakeCloud();
  await assert.rejects(
    () => createJob({ cloud, sync: null, doc: docFor("dwg-open"), openDrawingId: "dwg-open" }),
    /cannot reuse the open drawing's id/,
  );
  assert.deepEqual(cloud.calls, []);
});

test("a new job needs a document that already has an identity", async () => {
  await assert.rejects(
    () => createJob({ cloud: fakeCloud(), sync: null, doc: { rooms: [] } }),
    /needs a document with an id/,
  );
});

test("a new job is refused while a write is unconfirmed, and nothing is created", async () => {
  const sync = new DocSync({ transport: failingTransport(), revision: "1", ...noTimer() });
  sync.save(docFor("dwg-1", "Unsent"));
  await sync.flush();

  const cloud = fakeCloud();
  await assert.rejects(
    () => createJob({ cloud, sync, doc: emptyDoc(), openDrawingId: "dwg-1" }),
    NavigationBlocked,
  );
  assert.deepEqual(cloud.calls, []);
});

// --- duplicate ------------------------------------------------------------

test("duplicate is a new id, and does not navigate away from the open job", async () => {
  const transport = acceptingTransport();
  const sync = new DocSync({ transport, revision: "1", ...noTimer() });
  sync.adopt(docFor("dwg-1"), "1");

  const cloud = fakeCloud();
  const copy = await duplicateJob({ cloud, projectId: "prj-1", sourceDrawingId: "dwg-1" });

  assert.equal(copy.id, "prj-copy");
  assert.notEqual(copy.drawing.id, "dwg-1");
  assert.match(copy.name, /\(copy\)$/);
  // The open job's save path is untouched: nothing was flushed, attached or
  // adopted, because duplicating is something done to a row in the list.
  assert.equal(sync.transport, transport);
  assert.equal(transport.puts.length, 0);
});

test("a copy wearing the original's drawing id is treated as a fault, not a copy", async () => {
  const cloud = fakeCloud({
    duplicateProject: async () => ({ id: "prj-copy", drawing: { id: "dwg-1" } }),
  });
  await assert.rejects(
    () => duplicateJob({ cloud, projectId: "prj-1", sourceDrawingId: "dwg-1" }),
    /original's drawing id/,
  );
});

// --- rename ---------------------------------------------------------------

test("renaming the open job adopts the revision the server's rewrite produced", async () => {
  const sync = new DocSync({ transport: acceptingTransport(), revision: "1", ...noTimer() });
  sync.adopt(docFor("dwg-1"), "1");

  const cloud = fakeCloud();
  let adopted = null;
  await renameJob({
    cloud, sync, projectId: "prj-1", name: "Erf 1180", open: true, adopt: (d) => { adopted = d; },
  });

  // The PATCH wrote doc.name and bumped the revision. Without adopting it the
  // next autosave arrives with a stale If-Match and conflicts with its own
  // rename.
  assert.equal(adopted.revision, "9");
  assert.equal(adopted.doc.name, "Erf 1180");
});

test("renaming a job that is not open adopts nothing", async () => {
  const sync = new DocSync({ transport: acceptingTransport(), revision: "1", ...noTimer() });
  sync.adopt(docFor("dwg-1"), "1");

  let adopted = null;
  await renameJob({
    cloud: fakeCloud(), sync, projectId: "prj-2", name: "Erf 9", adopt: (d) => { adopted = d; },
  });
  assert.equal(adopted, null);
  assert.equal(sync.revision, "1");
});

// --- what a row shows -----------------------------------------------------

test("a soft-deleted job still lists, in the section Restore works from", () => {
  const { jobs, deleted } = splitLibrary([
    { id: "a", deletedAt: null },
    { id: "b", deletedAt: "2026-09-18T08:00:00.000Z" },
  ]);
  assert.deepEqual(jobs.map((p) => p.id), ["a"]);
  assert.deepEqual(deleted.map((p) => p.id), ["b"]);
});

test("a row shows facts, and a blank name stays blank", () => {
  const row = jobRowFields({
    id: "prj-1", name: null, erf: "1180", openedAt: "2026-09-18T08:30:00.000Z",
  });
  assert.equal(row.name, null);
  // Never "Untitled Project": the title block prints an em-dash for a fact the
  // document does not have, and the library says the same thing.
  assert.equal(row.nameLabel, "—");
  assert.equal(row.erfLabel, "Erf 1180");
  assert.match(row.lastOpened, /2026/);
  assert.equal(row.deleted, false);
});

test("a job that has never been opened reports no date rather than today", () => {
  const row = jobRowFields({ id: "prj-1", name: "Erf 9" });
  assert.equal(row.lastOpened, null);
  assert.equal(shortDateTime(null), null);
  assert.equal(shortDateTime("not a date"), null);
});
