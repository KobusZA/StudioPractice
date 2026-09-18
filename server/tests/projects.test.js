import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { firmWithProject, signedUpAgent, testDoc, testServer } from "./helpers.js";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("a new job is created unnamed rather than 'Untitled'", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const res = await client.post("/api/projects", { doc: testDoc() });
  assert.equal(res.status, 201);
  // Same rule as the title block's em-dash: a blank gets typed over, a guess
  // gets printed on a drawing.
  assert.equal(res.body.project.name, null);
});

test("a blank name is null, not an empty string", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const res = await client.post("/api/projects", { name: "   ", doc: testDoc() });
  assert.equal(res.body.project.name, null);
});

test("the library reports the erf out of the document", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithProject(baseUrl, {
    name: "Erf job",
    doc: testDoc({ site: { erfNumber: "1180" } }),
  });
  const listed = await client.get("/api/projects");
  // Read out of jsonb server-side: a firm with forty jobs must not pull forty
  // documents to draw a list.
  assert.equal(listed.body.projects[0].erf, "1180");
});

test("rename sets the job name and the document's name together", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl, { name: "Old" });

  const res = await client.patch(`/api/projects/${project.id}`, { name: "  Erf 412  " });
  assert.equal(res.status, 200);
  assert.equal(res.body.project.name, "Erf 412");
  assert.equal(res.body.project.drawing.doc.name, "Erf 412");
  // The document moved, so the revision moved. The client adopts the one
  // returned here, or its next autosave collides with its own rename.
  assert.equal(res.body.project.drawing.revision, "2");

  const stored = await client.get(`/api/projects/${project.id}`);
  assert.equal(stored.body.drawing.doc.name, "Erf 412");
});

test("a rename to blank clears both, and leaves the document valid", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl, { name: "Named" });
  const res = await client.patch(`/api/projects/${project.id}`, { name: "" });
  assert.equal(res.body.project.name, null);
  // jsonb_set with a SQL NULL would have blanked the whole document.
  assert.equal(res.body.project.drawing.doc.name, null);
  assert.equal(res.body.project.drawing.doc.schema, "sp.doc/2");
});

test("naming the document names the job, so the library cannot disagree with the sheet", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl, { name: null });
  assert.equal(project.name, null);

  // What the chrome's name field does: an ordinary autosave carrying doc.name.
  await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, name: "Erf 1180" } },
    { headers: { "If-Match": project.drawing.revision } },
  );
  const listed = await client.get("/api/projects");
  assert.equal(listed.body.projects[0].name, "Erf 1180");
});

test("clearing the document's name clears the job's, rather than leaving a stale one", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl, { name: "Erf 1180" });
  const saved = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, name: null } },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(saved.status, 200);
  const listed = await client.get("/api/projects");
  assert.equal(listed.body.projects[0].name, null);
});

test("duplicate is a copy with new ids, not a second pointer at the same row", async () => {
  const { baseUrl } = await testServer();
  const doc = testDoc({ name: "Erf 412", rooms: [{ id: "r1", name: "Kitchen" }] });
  const { client, project } = await firmWithProject(baseUrl, { name: "Erf 412", doc });

  const copy = await client.post(`/api/projects/${project.id}/duplicate`);
  assert.equal(copy.status, 201);
  assert.equal(copy.body.project.name, "Erf 412 (copy)");
  assert.notEqual(copy.body.project.id, project.id);
  // This is what the old Save As was. Against a row, reusing the id would just
  // overwrite the original.
  assert.notEqual(copy.body.project.drawing.id, project.drawing.id);
  assert.equal(copy.body.project.drawing.doc.id, copy.body.project.drawing.id);
  assert.equal(copy.body.project.drawing.doc.name, "Erf 412 (copy)");
  assert.deepEqual(copy.body.project.drawing.doc.rooms, doc.rooms);

  const editedCopy = await client.put(
    `/api/drawings/${copy.body.project.drawing.id}`,
    { doc: { ...copy.body.project.drawing.doc, name: "Changed" } },
    { headers: { "If-Match": copy.body.project.drawing.revision } },
  );
  assert.equal(editedCopy.status, 200);
  const original = await client.get(`/api/drawings/${project.drawing.id}`);
  assert.equal(original.body.drawing.doc.name, "Erf 412");
});

test("delete hides a job from the library and is restorable", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl, { name: "Mis-click" });

  const deleted = await client.del(`/api/projects/${project.id}`);
  assert.equal(deleted.status, 200);
  assert.equal((await client.get("/api/projects")).body.projects.length, 0);
  assert.equal((await client.get(`/api/projects/${project.id}`)).status, 404);
  // The drawing goes with the job, so a deleted job's drawing is not still
  // reachable by its own id.
  assert.equal((await client.get(`/api/drawings/${project.drawing.id}`)).status, 404);

  const restored = await client.post(`/api/projects/${project.id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.project.name, "Mis-click");
  assert.equal((await client.get("/api/projects")).body.projects.length, 1);
  const drawing = await client.get(`/api/drawings/${project.drawing.id}`);
  assert.equal(drawing.status, 200);
});

test("a deleted job still exists, and is listable on request", async () => {
  const { baseUrl, pool } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);
  await client.del(`/api/projects/${project.id}`);

  const { rows } = await pool.query(
    `select deleted_at from project where id = $1`, [project.id],
  );
  assert.equal(rows.length, 1);
  assert.ok(rows[0].deleted_at);

  const listed = await client.get("/api/projects?deleted=1");
  assert.equal(listed.body.projects.some((p) => p.id === project.id), true);
});

test("deleting twice is a 404, not a second timestamp", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);
  assert.equal((await client.del(`/api/projects/${project.id}`)).status, 200);
  assert.equal((await client.del(`/api/projects/${project.id}`)).status, 404);
});

test("no code path issues a DELETE FROM", async () => {
  const files = await readdir(SRC_DIR);
  for (const file of files.filter((f) => f.endsWith(".js"))) {
    const source = await readFile(join(SRC_DIR, file), "utf8");
    // The plan's rule, asserted rather than trusted: a mis-click must be
    // recoverable without a version UI, and a record that mattered legally
    // cannot be allowed to vanish.
    assert.equal(/delete\s+from/i.test(source), false, `${file} contains a DELETE FROM`);
    assert.equal(/\btruncate\b/i.test(source), false, `${file} contains a TRUNCATE`);
  }
});

test("every table carries created_by and created_at", async () => {
  const { pool } = await testServer();
  const { rows } = await pool.query(
    `select table_name,
            count(*) filter (where column_name = 'created_by') as by,
            count(*) filter (where column_name = 'created_at') as at
       from information_schema.columns
      where table_schema = 'public'
      group by table_name`,
  );
  assert.ok(rows.length >= 9);
  for (const row of rows) {
    // Free now, impossible later: a quote or a legal document without an
    // author and a date is not a record.
    assert.equal(row.by, "1", `${row.table_name} has no created_by`);
    assert.equal(row.at, "1", `${row.table_name} has no created_at`);
  }
});

test("the library orders by most recently opened", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const first = await client.post("/api/projects", { name: "First", doc: testDoc() });
  const second = await client.post("/api/projects", { name: "Second", doc: testDoc() });

  assert.deepEqual((await client.get("/api/projects")).body.projects.map((p) => p.name),
    ["Second", "First"]);

  await client.get(`/api/projects/${first.body.project.id}`);
  assert.deepEqual((await client.get("/api/projects")).body.projects.map((p) => p.name),
    ["First", "Second"]);
  assert.ok(second.body.project.id);
});

test("an unknown endpoint is a 404 rather than a neighbouring handler", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  assert.equal((await client.get("/api/projects/abc/def")).status, 404);
  assert.equal((await client.get("/api/nope")).status, 404);
});
