// Tier 5: pulling time onto a certificate can be narrowed to one person, and
// "Finances" is a canonical activity.

import test from "node:test";
import assert from "node:assert/strict";
import { agent, firmWithRegisterProject, testServer } from "./helpers.js";

test("lines-from-time can be limited to one member's hours", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project, account } = await firmWithRegisterProject(baseUrl);
  const email = `employee-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await owner.post("/api/team", { email, password: "correct horse battery" });
  const employee = agent(baseUrl);
  const signedIn = await employee.post("/api/auth/sign-in", { email, password: "correct horse battery" });
  const log = (client, description) => client.post("/api/time-entries", {
    projectId: project.id, date: "2026-03-03", minutes: 60,
    activityType: "File work", description,
  });
  assert.equal((await log(owner, "owner hour")).status, 201);
  assert.equal((await log(employee, "employee hour")).status, 201);

  const created = await owner.post(`/api/projects/${project.id}/certificates`, {});
  const id = created.body.certificate.id;
  const filled = await owner.post(`/api/certificates/${id}/lines-from-time`, {
    userId: signedIn.body.userId,
  });
  assert.equal(filled.status, 200, JSON.stringify(filled.body));
  assert.deepEqual(filled.body.certificate.lines.map((l) => l.description), ["employee hour"]);

  // The rest is still unbilled and comes in on an unfiltered pull.
  const rest = await owner.post(`/api/certificates/${id}/lines-from-time`, {});
  assert.deepEqual(rest.body.certificate.lines.map((l) => l.description).sort(),
    ["employee hour", "owner hour"]);
  assert.ok(account);
});

test("Finances is an offered activity", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);
  const ref = await client.get("/api/practice/reference");
  assert.ok(ref.body.activityTypes.includes("Finances"));
});
