import test from "node:test";
import assert from "node:assert/strict";
import { firmWithProject, testDoc, testServer } from "./helpers.js";

test("a created job round-trips its document and starts at revision 1", async () => {
  const { baseUrl } = await testServer();
  const doc = testDoc({ name: "Erf 1180", rooms: [{ id: "r1", name: "Kitchen" }] });
  const { client, project } = await firmWithProject(baseUrl, { name: "Erf 1180", doc });

  assert.equal(project.drawing.revision, "1");
  const fetched = await client.get(`/api/drawings/${project.drawing.id}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.body.drawing.doc, doc);
  // The revision is also an ETag, so a cache and the If-Match header agree.
  assert.equal(fetched.headers.get("etag"), `"1"`);
});

test("the drawing id is the document's own id", async () => {
  const { baseUrl } = await testServer();
  const doc = testDoc();
  const { project } = await firmWithProject(baseUrl, { doc });
  // §2: the client mints the identity, and the server keys the row by it.
  assert.equal(project.drawing.id, doc.id);
});

test("a save against the current revision is accepted and bumps it", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);

  const saved = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, name: "Erf 9" } },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.drawing.revision, "2");
  assert.equal(saved.body.drawing.doc.name, "Erf 9");
});

test("a save against a stale revision is a 409 carrying their document", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);
  const stale = project.drawing.revision;

  // A second tab, or the site tablet, got there first.
  await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, name: "Theirs" } },
    { headers: { "If-Match": stale } },
  );

  const mine = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, name: "Mine" } },
    { headers: { "If-Match": stale } },
  );
  assert.equal(mine.status, 409);
  assert.equal(mine.body.revision, "2");
  // The user is about to choose between two documents, so theirs comes with the
  // refusal. Nothing is merged: the stored name is one of the two, not a blend.
  assert.equal(mine.body.drawing.doc.name, "Theirs");

  const stored = await client.get(`/api/drawings/${project.drawing.id}`);
  assert.equal(stored.body.drawing.doc.name, "Theirs");
  assert.equal(stored.body.drawing.revision, "2");
});

test("overwrite-with-mine succeeds once the client adopts their revision", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);

  await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, name: "Theirs" } },
    { headers: { "If-Match": project.drawing.revision } },
  );
  const conflict = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, name: "Mine" } },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(conflict.status, 409);

  const resolved = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, name: "Mine" } },
    { headers: { "If-Match": conflict.body.revision } },
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.drawing.doc.name, "Mine");
});

test("a save with no If-Match is refused as a precondition, not accepted", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);

  const res = await client.put(`/api/drawings/${project.drawing.id}`, { doc });
  // A write with no stated expectation would silently overwrite a colleague.
  assert.equal(res.status, 428);

  // `*` means "any existing version", which is that same blind overwrite.
  const wildcard = await client.put(
    `/api/drawings/${project.drawing.id}`, { doc }, { headers: { "If-Match": "*" } },
  );
  assert.equal(wildcard.status, 428);
});

test("a document whose id is not this drawing's is refused", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);

  const res = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: testDoc({ id: "docsomeoneelse" }) },
    { headers: { "If-Match": project.drawing.revision } },
  );
  // Otherwise one job is written over another, and both ids say it was fine.
  assert.equal(res.status, 400);
});

test("a body that is not a document object is refused", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);
  for (const doc of [null, "a string", 12, []]) {
    const res = await client.put(
      `/api/drawings/${project.drawing.id}`, { doc },
      { headers: { "If-Match": project.drawing.revision } },
    );
    assert.equal(res.status, 400, JSON.stringify(doc));
  }
});

test("a missing drawing is a 404, not a conflict", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithProject(baseUrl);
  const res = await client.put(
    "/api/drawings/docnotreal", { doc: testDoc({ id: "docnotreal" }) },
    { headers: { "If-Match": "1" } },
  );
  assert.equal(res.status, 404);
});

test("a recovery snapshot is written, and not once per keystroke", async () => {
  const { baseUrl, pool } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);

  let revision = project.drawing.revision;
  for (let i = 0; i < 5; i += 1) {
    const res = await client.put(
      `/api/drawings/${project.drawing.id}`,
      { doc: { ...doc, name: `Pass ${i}` } },
      { headers: { "If-Match": revision } },
    );
    revision = res.body.drawing.revision;
  }

  const { rows } = await pool.query(
    `select revision from drawing_revision where drawing_id = $1 order by revision`,
    [project.drawing.id],
  );
  // Six accepted writes, one snapshot: the schedule coalesces, so the table is
  // a history worth reading rather than a log of mouse movements.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revision, "1");
});
