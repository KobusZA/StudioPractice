// The firm editing its own fee templates. Three things matter and each is
// asserted through the HTTP surface: only an owner can, a job registered
// before the edit keeps the fees it was built with, and a job registered after
// it is built from the new content.

import test from "node:test";
import assert from "node:assert/strict";
import { agent, firmWithRegisterProject, testServer } from "./helpers.js";

const TYPE = encodeURIComponent("TOWNSHIP establishment");

async function inviteEmployee(baseUrl, owner) {
  const email = `employee-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const invited = await owner.post("/api/team", { email, password: "correct horse battery" });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const client = agent(baseUrl);
  const signedIn = await client.post("/api/auth/sign-in", { email, password: "correct horse battery" });
  assert.equal(signedIn.status, 200);
  return client;
}

test("an owner can rewrite a template; a task-level fee sums into its phase", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);

  const put = await client.put(`/api/fee-templates/${TYPE}`, {
    phases: [
      { name: "Stage A", tasks: [{ description: "Obtain SG Diagram", fee: 200 }, { description: "Site visit", fee: 1800.5 }] },
      { name: "Stage B", fee: 5000, tasks: [{ description: "Report" }] },
    ],
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const { template } = put.body;
  assert.equal(template.phases.length, 2);
  assert.equal(template.phases[0].defaultFee, 2000.5);
  assert.equal(template.phases[1].defaultFee, 5000);
  assert.equal(template.quoted, 7000.5);
  assert.equal(template.phases[0].tasks[1].description, "Site visit");
});

test("an employee cannot edit or reset a template", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const employee = await inviteEmployee(baseUrl, owner);

  const put = await employee.put(`/api/fee-templates/${TYPE}`, { phases: [] });
  assert.equal(put.status, 403);
  const reset = await employee.post(`/api/fee-templates/${TYPE}/reset`, {});
  assert.equal(reset.status, 403);

  const still = await owner.get(`/api/fee-templates/${TYPE}`);
  assert.ok(still.body.template.phases.length > 1, "the seeded template is untouched");
});

test("editing a template leaves a registered job alone and shapes the next one", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const before = await client.get(`/api/projects/${project.id}/tasks`);
  const beforeCount = before.body.tasks.length;
  assert.ok(beforeCount > 3);

  const put = await client.put(`/api/fee-templates/${TYPE}`, {
    phases: [{ name: "Only stage", tasks: [{ description: "One task", fee: 100 }] }],
  });
  assert.equal(put.status, 200);

  const after = await client.get(`/api/projects/${project.id}/tasks`);
  assert.equal(after.body.tasks.length, beforeCount, "the existing job keeps its copy");

  const created = await client.post("/api/register", {
    code: "D900", name: "New job", clientName: "Client",
    typeCode: "TOWNSHIP establishment", billingBasis: "fixed_fee",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const fresh = await client.get(`/api/projects/${created.body.project.id}/tasks`);
  assert.deepEqual(fresh.body.tasks.map((task) => task.description), ["One task"]);
});

test("reset restores the workbook's content", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);
  await client.put(`/api/fee-templates/${TYPE}`, {
    phases: [{ name: "Only stage", tasks: [{ description: "One task", fee: 100 }] }],
  });
  const reset = await client.post(`/api/fee-templates/${TYPE}/reset`, {});
  assert.equal(reset.status, 200);
  assert.equal(reset.body.template.quoted, 54445.8);
});

test("a bad template is refused, and an unknown type is a 404", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);

  const blank = await client.put(`/api/fee-templates/${TYPE}`, {
    phases: [{ name: " ", tasks: [] }],
  });
  assert.equal(blank.status, 400, JSON.stringify(blank.body));
  const negative = await client.put(`/api/fee-templates/${TYPE}`, {
    phases: [{ name: "A", tasks: [{ description: "x", fee: -5 }] }],
  });
  assert.equal(negative.status, 400);
  const missing = await client.put("/api/fee-templates/NOPE", { phases: [] });
  assert.equal(missing.status, 404);
});
