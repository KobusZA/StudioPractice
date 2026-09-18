// One firm must not be able to see or touch another firm's job, and the check
// that guarantees it lives in the data access layer rather than in each
// handler. These tests go through the HTTP surface with a second signed-in
// firm, which is the only way to prove the claim end to end.

import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
import { firmWithProject, signedUpAgent, testDoc, testServer } from "./helpers.js";

test("a job is unreachable from another org, on every route that names it", async () => {
  const { baseUrl } = await testServer();
  const { project } = await firmWithProject(baseUrl, { name: "Erf 412" });
  const { client: stranger } = await signedUpAgent(baseUrl, { orgName: "Other Firm" });

  const attempts = [
    ["GET", `/api/projects/${project.id}`],
    ["PATCH", `/api/projects/${project.id}`],
    ["DELETE", `/api/projects/${project.id}`],
    ["POST", `/api/projects/${project.id}/duplicate`],
    ["POST", `/api/projects/${project.id}/restore`],
    ["GET", `/api/drawings/${project.drawing.id}`],
  ];
  for (const [method, path] of attempts) {
    const res = await stranger.request(method, path, { body: { name: "mine now" } });
    assert.equal(res.status, 404, `${method} ${path}`);
    // 404 rather than 403: a firm should not be able to confirm that another
    // firm's job id exists.
    assert.equal(JSON.stringify(res.body).includes("Erf 412"), false);
  }
});

test("a stranger's save is refused and changes nothing", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);
  const { client: stranger } = await signedUpAgent(baseUrl, { orgName: "Other Firm" });

  const attempt = await stranger.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: testDoc({ id: project.drawing.id, name: "overwritten" }) },
    { headers: { "If-Match": String(project.drawing.revision) } },
  );
  assert.equal(attempt.status, 404);

  const mine = await client.get(`/api/drawings/${project.drawing.id}`);
  assert.equal(mine.body.drawing.revision, project.drawing.revision);
  assert.notEqual(mine.body.drawing.doc.name, "overwritten");
});

test("the library lists only the signing firm's jobs", async () => {
  const { baseUrl } = await testServer();
  const { client: first } = await firmWithProject(baseUrl, { name: "Theirs" });
  const { client: second } = await signedUpAgent(baseUrl, { orgName: "Second Firm" });
  await second.post("/api/projects", { name: "Mine", doc: testDoc() });

  const listed = await second.get("/api/projects");
  assert.deepEqual(listed.body.projects.map((p) => p.name), ["Mine"]);

  const theirs = await first.get("/api/projects");
  assert.deepEqual(theirs.body.projects.map((p) => p.name), ["Theirs"]);
});

test("the store cannot be opened without a scope", async () => {
  const { pool } = await testServer();
  // The structural half of the claim: a handler that forgot to authenticate
  // cannot get a store at all, so there is no unscoped query to leak through.
  assert.throws(() => openStore(pool, {}), /orgId/);
  assert.throws(() => openStore(pool, { orgId: "org_x" }), /userId/);
});

test("the org comes from membership, not from a column on the user", async () => {
  const { pool, baseUrl } = await testServer();
  const { account } = await signedUpAgent(baseUrl);

  const columns = await pool.query(
    `select column_name from information_schema.columns where table_name = 'app_user'`,
  );
  const names = columns.rows.map((r) => r.column_name);
  // If this column ever appears, resolveSession() has a shortcut available to
  // it and the membership join stops being load-bearing.
  assert.equal(names.includes("org_id"), false);

  const membership = await pool.query(
    `select org_id, role from membership where user_id = $1 and deleted_at is null`,
    [account.userId],
  );
  assert.equal(membership.rows.length, 1);
  assert.equal(membership.rows[0].org_id, account.orgId);
});
