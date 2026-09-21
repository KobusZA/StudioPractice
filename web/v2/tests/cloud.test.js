import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CloudError, RECOVERED_NAME, createCloud, importLocalDocument,
} from "../cloud.js";
import { AuthRequiredError, DocSync, httpTransport } from "../sync.js";
import { DOC_STORE_KEY, emptyDoc, nid, rectShape } from "../model.js";

/**
 * A fetch that answers from a script and records what it was asked. No network
 * and no server process: what is under test here is the client's reading of a
 * status code, and server/tests/ already proves the server produces them.
 */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers || {},
      keepalive: Boolean(init.keepalive),
      credentials: init.credentials,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return handler(calls[calls.length - 1], calls.length);
  };
  fn.calls = calls;
  return fn;
}

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return payload; },
    async text() { return payload === undefined ? "" : JSON.stringify(payload); },
  };
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
  };
}

function docWithRoom() {
  const doc = emptyDoc();
  doc.rooms.push({ id: nid("r"), name: "Kitchen", shape: rectShape(0, 0, 4, 3) });
  return doc;
}

// --- the transport ---------------------------------------------------------

test("a save sends the document with an If-Match revision", async () => {
  const fetch = fakeFetch(() => response(200, { drawing: { revision: "8" } }));
  const transport = httpTransport({ drawingId: "doc1", fetch });
  const doc = emptyDoc();

  const result = await transport.put({ doc, revision: "7" });
  assert.deepEqual(result, { ok: true, revision: "8" });

  const [call] = fetch.calls;
  assert.equal(call.method, "PUT");
  assert.equal(call.url, "/api/drawings/doc1");
  assert.equal(call.headers["If-Match"], "7");
  // The session is an httpOnly cookie, so it has to be asked for by name.
  assert.equal(call.credentials, "include");
  assert.deepEqual(call.body.doc, doc);
});

test("a 409 is reported as a conflict carrying their revision and document", async () => {
  const theirs = { ...emptyDoc(), name: "Theirs" };
  const fetch = fakeFetch(() => response(409, {
    revision: "12", drawing: { revision: "12", doc: theirs },
  }));
  const transport = httpTransport({ drawingId: "doc1", fetch });

  const result = await transport.put({ doc: emptyDoc(), revision: "7" });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.revision, "12");
  // The user is about to choose between two documents; theirs comes with the
  // refusal so the choice is not blind.
  assert.deepEqual(result.doc, theirs);
});

test("a 500 and a dropped connection both throw, so the write is queued", async () => {
  const failing = httpTransport({
    drawingId: "doc1", fetch: fakeFetch(() => response(500, { error: "boom" })),
  });
  await assert.rejects(() => failing.put({ doc: emptyDoc(), revision: "1" }), /500/);

  const dropped = httpTransport({
    drawingId: "doc1",
    fetch: fakeFetch(() => { throw new TypeError("Failed to fetch"); }),
  });
  await assert.rejects(() => dropped.put({ doc: emptyDoc(), revision: "1" }));
});

test("a 428 throws rather than reporting saved", async () => {
  const transport = httpTransport({
    drawingId: "doc1", fetch: fakeFetch(() => response(428, { error: "If-Match required" })),
  });
  // A missing If-Match is this side's bug, but the honest report is still that
  // the document did not land.
  await assert.rejects(() => transport.put({ doc: emptyDoc(), revision: "1" }), /428/);
});

test("a 401 asks for a sign-in instead of pretending to be offline", async () => {
  let asked = 0;
  const transport = httpTransport({
    drawingId: "doc1",
    fetch: fakeFetch(() => response(401, { error: "Sign in to continue" })),
    onAuthRequired: () => { asked += 1; },
  });
  await assert.rejects(() => transport.put({ doc: emptyDoc(), revision: "1" }), AuthRequiredError);
  assert.equal(asked, 1);
});

test("the flush path sets keepalive so a closing page still saves", async () => {
  const fetch = fakeFetch(() => response(200, { drawing: { revision: "2" } }));
  const transport = httpTransport({ drawingId: "doc1", fetch });
  await transport.put({ doc: emptyDoc(), revision: "1", keepalive: true });
  assert.equal(fetch.calls[0].keepalive, true);
});

test("read returns the stored drawing, and null when there is none", async () => {
  const drawing = { id: "doc1", revision: "3", doc: emptyDoc() };
  const found = httpTransport({
    drawingId: "doc1", fetch: fakeFetch(() => response(200, { drawing })),
  });
  assert.deepEqual(await found.read(), drawing);

  const missing = httpTransport({
    drawingId: "doc1", fetch: fakeFetch(() => response(404, { error: "No such drawing" })),
  });
  assert.equal(await missing.read(), null);
});

test("the transport refuses to exist without a drawing to write to", () => {
  assert.throws(() => httpTransport({ fetch: fakeFetch(() => response(200, {})) }), /drawingId/);
});

// --- the transport under the scheduler -------------------------------------

test("the scheduler adopts the server's revision and reports Saved", async () => {
  let revision = 1;
  const fetch = fakeFetch(() => {
    revision += 1;
    return response(200, { drawing: { revision: String(revision) } });
  });
  const sync = new DocSync({
    transport: httpTransport({ drawingId: "doc-fixed", fetch }),
    revision: "1",
    setTimer: () => 1,
    clearTimer: () => {},
  });

  const doc = { ...emptyDoc(), id: "doc-fixed", name: "A" };
  sync.save(doc);
  const state = await sync.flush();
  assert.equal(state.kind, "saved");
  assert.equal(state.revision, "2");
  assert.equal(sync.isDirty(), false);
  assert.equal(fetch.calls[0].headers["If-Match"], "1");
});

test("a 409 through the scheduler stops writing and offers their document", async () => {
  const theirs = { ...emptyDoc(), id: "doc-fixed", name: "Theirs" };
  const fetch = fakeFetch(() => response(409, {
    revision: "9", drawing: { revision: "9", doc: theirs },
  }));
  const sync = new DocSync({
    transport: httpTransport({ drawingId: "doc-fixed", fetch }),
    revision: "1",
    setTimer: () => 1,
    clearTimer: () => {},
  });

  sync.save({ ...emptyDoc(), id: "doc-fixed", name: "Mine" });
  const state = await sync.flush();
  assert.equal(state.kind, "conflict");
  assert.deepEqual(state.conflict.doc, theirs);

  // Writing has stopped. A further edit must not go on shipping over them.
  sync.save({ ...emptyDoc(), id: "doc-fixed", name: "Mine again" });
  await sync.flush();
  assert.equal(fetch.calls.length, 1);
});

// --- the library client ----------------------------------------------------

test("a failed request becomes a CloudError with the server's own message", async () => {
  const cloud = createCloud({
    fetch: fakeFetch(() => response(404, { error: "No such job" })),
  });
  await assert.rejects(() => cloud.openProject("prj1"), (error) => {
    assert.ok(error instanceof CloudError);
    assert.equal(error.status, 404);
    assert.equal(error.message, "No such job");
    return true;
  });
});

test("no network is status 0, not a guess at what the server might have said", async () => {
  const cloud = createCloud({
    fetch: fakeFetch(() => { throw new TypeError("Failed to fetch"); }),
  });
  await assert.rejects(() => cloud.listProjects(), (error) => {
    assert.equal(error.status, 0);
    return true;
  });
});

test("a 401 anywhere in the library is flagged as needing a sign-in", async () => {
  const cloud = createCloud({
    fetch: fakeFetch(() => response(401, { error: "Sign in to continue" })),
  });
  await assert.rejects(() => cloud.listProjects(), (error) => {
    assert.equal(error.authRequired, true);
    return true;
  });
});

test("session() is null when signed out rather than a half-filled account", async () => {
  const out = createCloud({ fetch: fakeFetch(() => response(200, { signedIn: false })) });
  assert.equal(await out.session(), null);

  const inn = createCloud({
    fetch: fakeFetch(() => response(200, { signedIn: true, orgId: "org1", email: "a@b.c" })),
  });
  assert.equal((await inn.session()).orgId, "org1");
});

// --- the one-time import ---------------------------------------------------

test("work in the old key is uploaded as a recovered job and the key is cleared", async () => {
  const doc = docWithRoom();
  const storage = fakeStorage({ [DOC_STORE_KEY]: JSON.stringify(doc) });
  const uploads = [];
  const cloud = { createProject: async (args) => { uploads.push(args); return { id: "prj1" }; } };

  const result = await importLocalDocument({ storage, cloud });
  assert.equal(result.reason, "recovered");
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].name, RECOVERED_NAME);
  // What goes up is normalizeDoc()'s output, so the room arrives with the
  // defaults a loaded document always gets rather than byte-identical.
  assert.deepEqual(uploads[0].doc.rooms.map((r) => r.name), ["Kitchen"]);
  assert.equal(uploads[0].doc.rooms[0].id, doc.rooms[0].id);
  // Cleared only after the upload was confirmed.
  assert.equal(storage.getItem(DOC_STORE_KEY), null);
});

test("a named document keeps its own name rather than being called recovered", async () => {
  const doc = docWithRoom();
  doc.name = "Erf 1180";
  const storage = fakeStorage({ [DOC_STORE_KEY]: JSON.stringify(doc) });
  const uploads = [];
  const cloud = { createProject: async (args) => { uploads.push(args); return { id: "prj1" }; } };

  await importLocalDocument({ storage, cloud });
  assert.equal(uploads[0].name, "Erf 1180");
});

test("a pre-identity document is imported with the id normalizeDoc gives it", async () => {
  const legacy = { schema: "sp.doc/2", rooms: [{ id: "r1", name: "Kitchen" }] };
  const storage = fakeStorage({ [DOC_STORE_KEY]: JSON.stringify(legacy) });
  const uploads = [];
  const cloud = { createProject: async (args) => { uploads.push(args); return { id: "prj1" }; } };

  await importLocalDocument({ storage, cloud });
  assert.ok(uploads[0].doc.id);
  assert.equal(uploads[0].name, RECOVERED_NAME);
});

test("an empty document is not uploaded, but the key still stops being checked", async () => {
  const storage = fakeStorage({ [DOC_STORE_KEY]: JSON.stringify(emptyDoc()) });
  let created = 0;
  const cloud = { createProject: async () => { created += 1; return { id: "prj1" }; } };

  const result = await importLocalDocument({ storage, cloud });
  assert.equal(result.reason, "empty");
  assert.equal(created, 0);
  assert.equal(storage.getItem(DOC_STORE_KEY), null);
});

test("a site-only document counts as work worth recovering", async () => {
  const doc = emptyDoc();
  doc.site = { erfNumber: "1180" };
  const storage = fakeStorage({ [DOC_STORE_KEY]: JSON.stringify(doc) });
  let created = 0;
  const cloud = { createProject: async () => { created += 1; return { id: "prj1" }; } };

  await importLocalDocument({ storage, cloud });
  // hasJobContent(), not hasContent(): a job that is so far only a boundary is
  // a real job, and treating it as empty is how it gets thrown away.
  assert.equal(created, 1);
});

test("a failed upload leaves the work exactly where it was", async () => {
  const raw = JSON.stringify(docWithRoom());
  const storage = fakeStorage({ [DOC_STORE_KEY]: raw });
  const cloud = { createProject: async () => { throw new CloudError(0, "No connection"); } };

  await assert.rejects(() => importLocalDocument({ storage, cloud }));
  // The next sign-in tries again. Clearing first would have lost it.
  assert.equal(storage.getItem(DOC_STORE_KEY), raw);
});

test("a document that will not parse is left untouched rather than cleared", async () => {
  const storage = fakeStorage({ [DOC_STORE_KEY]: "{not json" });
  let created = 0;
  const cloud = { createProject: async () => { created += 1; return { id: "prj1" }; } };

  const result = await importLocalDocument({ storage, cloud });
  assert.equal(result.reason, "unreadable");
  assert.equal(created, 0);
  // Somebody's only copy of something. A clear here is the one action that
  // cannot be undone.
  assert.equal(storage.getItem(DOC_STORE_KEY), "{not json");
});

test("the import runs once: a second sign-in finds nothing to do", async () => {
  const storage = fakeStorage({ [DOC_STORE_KEY]: JSON.stringify(docWithRoom()) });
  let created = 0;
  const cloud = { createProject: async () => { created += 1; return { id: "prj1" }; } };

  await importLocalDocument({ storage, cloud });
  const second = await importLocalDocument({ storage, cloud });
  assert.equal(created, 1);
  assert.equal(second, null);
});

// --- the library's request surface -----------------------------------------

test("the deleted jobs a restore needs are asked for explicitly", async () => {
  const fetch = fakeFetch(() => response(200, { projects: [] }));
  const cloud = createCloud({ fetch });
  await cloud.listProjects();
  await cloud.listProjects({ includeDeleted: true });
  assert.deepEqual(fetch.calls.map((c) => c.url), ["/api/projects", "/api/projects?deleted=1"]);
});

test("visualize posts the massing snapshot and returns the rendered image", async () => {
  const fetch = fakeFetch(() => response(200, { image: "data:image/png;base64,abc" }));
  const cloud = createCloud({ fetch });
  const image = await cloud.visualize({ image: "data:image/png;base64,src" });
  assert.equal(image, "data:image/png;base64,abc");
  assert.equal(fetch.calls[0].method, "POST");
  assert.equal(fetch.calls[0].url, "/api/visualize");
  assert.deepEqual(fetch.calls[0].body, { image: "data:image/png;base64,src" });
});
