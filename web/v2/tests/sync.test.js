import { test } from "node:test";
import assert from "node:assert/strict";

import { DocSync, docSignature, localTransport, syncStateLabel } from "../sync.js";
import { DOC_STORE_KEY, PlanStore, emptyDoc, nid } from "../model.js";

/** A timer the test drives by hand, so no test waits out a debounce. */
function fakeTimer() {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn) => {
      const handle = next++;
      pending.set(handle, fn);
      return handle;
    },
    clearTimer: (handle) => pending.delete(handle),
    get count() { return pending.size; },
    /** Fire every scheduled callback, in the order they were scheduled. */
    async run() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) await fn();
    },
  };
}

/**
 * Records what it was asked to write. `mode` is flipped mid-test to make the
 * network fail or the row move without a network being involved at all.
 */
function fakeTransport({ revision = 0 } = {}) {
  const t = {
    writes: [],
    mode: "ok",
    theirRevision: 99,
    theirDoc: { schema: "sp.doc/2", id: "theirs" },
    revision,
    async put({ doc, revision: ifMatch }) {
      t.writes.push({ doc, ifMatch });
      if (t.mode === "down") throw new Error("network down");
      if (t.mode === "conflict") {
        return { ok: false, conflict: true, revision: t.theirRevision, doc: t.theirDoc };
      }
      t.revision += 1;
      return { ok: true, revision: t.revision };
    },
  };
  return t;
}

function docWith(name) {
  return { ...emptyDoc(), id: "doc-fixed", name };
}

// --- the scheduler ---------------------------------------------------------

test("a burst of mutations coalesces into one write", async () => {
  const transport = fakeTransport();
  const timer = fakeTimer();
  const sync = new DocSync({ transport, ...timer });

  sync.save(docWith("a"));
  sync.save(docWith("b"));
  sync.save(docWith("c"));
  assert.equal(timer.count, 1, "one pending flush, not three");

  await timer.run();
  assert.equal(transport.writes.length, 1);
  assert.equal(transport.writes[0].doc.name, "c", "the last document wins");
  assert.equal(sync.state.kind, "saved");
});

test("an unchanged document is not written again", async () => {
  const transport = fakeTransport();
  const timer = fakeTimer();
  const sync = new DocSync({ transport, ...timer });
  const doc = docWith("a");

  sync.save(doc);
  await timer.run();
  sync.save(doc);
  await sync.flush();
  assert.equal(transport.writes.length, 1);
});

test("the state is never Saved while a write is unconfirmed", async () => {
  const transport = fakeTransport();
  const timer = fakeTimer();
  const seen = [];
  const sync = new DocSync({ transport, ...timer, onState: (s) => seen.push(s.kind) });

  sync.save(docWith("a"));
  assert.equal(sync.state.kind, "pending");
  assert.equal(syncStateLabel(sync.state), "Saving…");
  await timer.run();
  assert.deepEqual(seen, ["pending", "saving", "saved"]);
  assert.equal(syncStateLabel(sync.state), "Saved");
});

test("the confirmed revision is what the next write claims to have seen", async () => {
  const transport = fakeTransport();
  const sync = new DocSync({ transport, ...fakeTimer() });

  sync.save(docWith("a"));
  await sync.flush();
  sync.save(docWith("b"));
  await sync.flush();
  assert.deepEqual(transport.writes.map((w) => w.ifMatch), [0, 1]);
  assert.equal(sync.state.revision, 2);
});

// --- failure ---------------------------------------------------------------

test("a failed write queues, reports how many, and never says Saved", async () => {
  const transport = fakeTransport();
  const sync = new DocSync({ transport, ...fakeTimer() });
  transport.mode = "down";

  sync.save(docWith("a"));
  await sync.flush();
  assert.equal(sync.state.kind, "offline");
  assert.equal(syncStateLabel(sync.state), "Offline — 1 change queued");
  assert.equal(sync.isDirty(), true);

  sync.save(docWith("b"));
  await sync.flush();
  assert.equal(syncStateLabel(sync.state), "Offline — 2 changes queued");
});

test("the queue flushes in order on reconnect, and only ever coalesces writes nobody has seen", async () => {
  const transport = fakeTransport();
  const sync = new DocSync({ transport, ...fakeTimer() });
  transport.mode = "down";

  // "a" was attempted, so it keeps its place: the transport may have taken it
  // and lost the reply. "b" and "c" were never sent, so "c" replaces "b".
  sync.save(docWith("a"));
  await sync.flush();
  sync.save(docWith("b"));
  sync.save(docWith("c"));
  await sync.flush();
  assert.equal(sync.state.queued, 2);

  transport.mode = "ok";
  transport.writes.length = 0;
  await sync.retry();

  assert.deepEqual(transport.writes.map((w) => w.doc.name), ["a", "c"]);
  assert.deepEqual(transport.writes.map((w) => w.ifMatch), [0, 1], "each write claims the revision the last one returned");
  assert.equal(sync.state.kind, "saved");
  assert.equal(sync.state.queued, 0);
  assert.equal(sync.isDirty(), false);
});

// --- conflict --------------------------------------------------------------

test("a conflict stops writing, keeps the local work, and merges nothing", async () => {
  const transport = fakeTransport();
  const timer = fakeTimer();
  const sync = new DocSync({ transport, ...timer });
  transport.mode = "conflict";

  sync.save(docWith("mine"));
  await sync.flush();
  assert.equal(sync.state.kind, "conflict");
  assert.equal(sync.state.conflict.revision, 99);
  assert.equal(sync.state.conflict.doc.id, "theirs");

  transport.writes.length = 0;
  sync.save(docWith("mine again"));
  await sync.flush();
  assert.equal(transport.writes.length, 0, "nothing is written until the user chooses");
  assert.equal(sync.state.kind, "conflict");
});

test("reload theirs drops the local queue; overwrite with mine sends it against their revision", async () => {
  const transport = fakeTransport();
  const sync = new DocSync({ transport, ...fakeTimer() });
  transport.mode = "conflict";
  sync.save(docWith("mine"));
  await sync.flush();

  const theirs = { ...emptyDoc(), id: "theirs", name: "theirs" };
  sync.resolveWithTheirs(theirs);
  assert.equal(sync.state.kind, "saved");
  assert.equal(sync.state.revision, 99);
  assert.equal(sync.isDirty(), false);

  transport.mode = "conflict";
  sync.save(docWith("mine"));
  await sync.flush();
  transport.mode = "ok";
  transport.writes.length = 0;
  await sync.resolveWithMine();
  assert.equal(transport.writes.length, 1);
  assert.equal(transport.writes[0].ifMatch, 99, "their revision, so the retry is accepted");
  assert.equal(transport.writes[0].doc.name, "mine");
  assert.equal(sync.state.kind, "saved");
});

// --- the local transport, and the PlanStore seam ---------------------------

function memoryStorage() {
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    raw: mem,
  };
}

test("the local transport keeps writing a bare document under the key it always used", async () => {
  const storage = memoryStorage();
  const sync = new DocSync({ transport: localTransport(storage), ...fakeTimer() });
  const doc = docWith("Smith Residence");

  sync.save(doc);
  await sync.flush();
  const stored = JSON.parse(storage.raw.get(DOC_STORE_KEY));
  assert.equal(stored.name, "Smith Residence");
  assert.equal(stored.id, "doc-fixed", "a bare document, so a later import can read it");
  assert.equal(sync.state.kind, "saved");
});

test("a store persists through the sink and reads back what the transport holds", async () => {
  const storage = memoryStorage();
  const timer = fakeTimer();
  const sync = new DocSync({ transport: localTransport(storage), ...timer });
  const store = new PlanStore(emptyDoc(), { sink: sync });

  store.doc.name = "Smith Residence";
  store.doc.items.push({ id: nid("i"), sku: "TSP_WC001", x: 1, y: 1 });
  store.persist();
  await timer.run();
  assert.equal(sync.state.kind, "saved");

  const reopened = new PlanStore(emptyDoc(), { sink: new DocSync({ transport: localTransport(storage) }) });
  assert.equal(reopened.load(), true);
  assert.equal(reopened.doc.name, "Smith Residence");
  assert.equal(reopened.doc.id, store.doc.id);
});

test("a quota failure is reported, not swallowed, and the edit is still queued", async () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  const sync = new DocSync({ transport: localTransport(storage), ...fakeTimer() });
  const store = new PlanStore(emptyDoc(), { sink: sync });

  store.doc.name = "Smith Residence";
  store.persist();
  await sync.flush();
  assert.equal(sync.state.kind, "offline");
  assert.equal(sync.isDirty(), true);
});

test("adopting the loaded document means the boot path does not write it straight back", async () => {
  const transport = fakeTransport();
  const sync = new DocSync({ transport, ...fakeTimer() });
  const doc = docWith("a");

  sync.adopt(doc, 7);
  assert.equal(sync.state.revision, 7);
  sync.save(doc);
  await sync.flush();
  assert.equal(transport.writes.length, 0);
  assert.equal(docSignature(doc), docSignature(doc));
});
