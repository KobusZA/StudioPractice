// Projected cost: what the firm expects a job to cost it, typed in per job.
// Profit and margin are derived against the quote, so these prove the
// arithmetic, the "no figure is not zero" rule, and the billed-tier gate.

import test from "node:test";
import assert from "node:assert/strict";
import { agent, firmWithRegisterProject, testServer } from "./helpers.js";

/** The owner invites a colleague and signs them in as their own session. */
async function inviteEmployee(baseUrl, owner) {
  const email = `employee-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const invited = await owner.post("/api/team", { email, password: "correct horse battery" });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const client = agent(baseUrl);
  const signedIn = await client.post("/api/auth/sign-in", { email, password: "correct horse battery" });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
  return { client };
}

// A freehand job: no template, so the quote is the budget estimate and the
// numbers in the tests are the ones written in them.
const freehand = { typeCode: null, budgetEstimate: 15000, billingBasis: "fixed_fee" };

test("profit and margin are worked out from the quote and the projected cost", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    ...freehand, projectedCost: 10000,
  });

  const { body } = await client.get(`/api/register/${project.id}`);
  assert.equal(body.project.projectedCost, 10000);
  assert.equal(body.project.financials.projectedCost, 10000);
  assert.equal(body.project.financials.projectedProfit, 5000);
  assert.equal(body.project.financials.projectedMargin, 0.3333);
});

test("a job with no projected cost has no profit, not a profit of the whole fee", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, freehand);

  const { body } = await client.get(`/api/register/${project.id}`);
  assert.equal(body.project.projectedCost, null);
  assert.equal(body.project.financials.projectedProfit, null);
  assert.equal(body.project.financials.projectedMargin, null);
});

test("a cost with no quote reports no profit either", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    ...freehand, budgetEstimate: null, projectedCost: 10000,
  });

  const { financials } = (await client.get(`/api/register/${project.id}`)).body.project;
  assert.equal(financials.projectedCost, 10000);
  assert.equal(financials.projectedProfit, null);
  assert.equal(financials.projectedMargin, null);
});

test("revising the quote moves the profit without retyping the cost", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    ...freehand, projectedCost: 10000,
  });

  const patched = await client.patch(`/api/register/${project.id}`, { budgetEstimate: 18000 });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.project.financials.projectedProfit, 8000);
});

test("a cost can be set, changed and cleared, and a loss is a negative profit", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, freehand);

  const set = await client.patch(`/api/register/${project.id}`, { projectedCost: 16000 });
  assert.equal(set.body.project.projectedCost, 16000);
  assert.equal(set.body.project.financials.projectedProfit, -1000);

  // Blank is an explicit "no cost", the same answer budgetEstimate gives.
  const cleared = await client.patch(`/api/register/${project.id}`, { projectedCost: "" });
  assert.equal(cleared.body.project.projectedCost, null);
  assert.equal(cleared.body.project.financials.projectedProfit, null);

  const bad = await client.patch(`/api/register/${project.id}`, { projectedCost: "lots" });
  assert.equal(bad.status, 400);
});

test("an unrelated edit leaves the projected cost alone", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    ...freehand, projectedCost: 10000,
  });

  const patched = await client.patch(`/api/register/${project.id}`, { status: "on_hold" });
  assert.equal(patched.body.project.projectedCost, 10000);
});

test("an employee does not see the projected cost, profit or margin", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await firmWithRegisterProject(baseUrl, {
    ...freehand, projectedCost: 10000,
  });
  const { client: employee } = await inviteEmployee(baseUrl, owner);

  const { financials, projectedCost } = (await employee.get(`/api/register/${project.id}`)).body.project;
  assert.equal(projectedCost, null);
  assert.equal(financials.projectedCost, null);
  assert.equal(financials.projectedProfit, null);
  assert.equal(financials.projectedMargin, null);
});

const TYPE = encodeURIComponent("TOWNSHIP establishment");
const SMALL_TEMPLATE = {
  phases: [
    { name: "Stage A", fee: 6000, tasks: [{ description: "Survey" }] },
    { name: "Stage B", fee: 4000, tasks: [{ description: "Report" }] },
  ],
};

test("a template can carry a cost share, and a type without one has none", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);

  const before = await client.get(`/api/fee-templates/${TYPE}`);
  assert.equal(before.body.template.costPct, null, "nothing is seeded from the workbook");

  const put = await client.put(`/api/fee-templates/${TYPE}`, { ...SMALL_TEMPLATE, costPct: 0.65 });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.template.costPct, 0.65);

  // A save that does not mention the share leaves it alone.
  const resaved = await client.put(`/api/fee-templates/${TYPE}`, SMALL_TEMPLATE);
  assert.equal(resaved.body.template.costPct, 0.65);

  const cleared = await client.put(`/api/fee-templates/${TYPE}`, { ...SMALL_TEMPLATE, costPct: null });
  assert.equal(cleared.body.template.costPct, null);
});

test("a cost share outside zero to one is refused and nothing is half-saved", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);
  const original = (await client.get(`/api/fee-templates/${TYPE}`)).body.template;

  for (const costPct of [65, -0.1, "lots"]) {
    const put = await client.put(`/api/fee-templates/${TYPE}`, { ...SMALL_TEMPLATE, costPct });
    assert.equal(put.status, 400, String(costPct));
  }
  const after = (await client.get(`/api/fee-templates/${TYPE}`)).body.template;
  assert.equal(after.phases.length, original.phases.length, "the template is untouched");
});

test("a new job starts with the template's cost and remembers the template's fee", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);
  await client.put(`/api/fee-templates/${TYPE}`, { ...SMALL_TEMPLATE, costPct: 0.65 });

  const created = await client.post("/api/register", {
    code: "T100", name: "From template", typeCode: "TOWNSHIP establishment",
    billingBasis: "fixed_fee",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { financials } = created.body.project;
  assert.equal(financials.quoted, 10000);
  assert.equal(financials.templateQuote, 10000);
  assert.equal(financials.vsTemplate, 0);
  assert.equal(financials.projectedCost, 6500);
  assert.equal(financials.projectedProfit, 3500);
});

test("a cost typed at registration beats the template's default", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);
  await client.put(`/api/fee-templates/${TYPE}`, { ...SMALL_TEMPLATE, costPct: 0.65 });

  const created = await client.post("/api/register", {
    code: "T101", name: "Typed", typeCode: "TOWNSHIP establishment",
    billingBasis: "fixed_fee", projectedCost: 9000,
  });
  assert.equal(created.body.project.financials.projectedCost, 9000);
});

test("a type with no cost share leaves the job's cost empty", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);
  await client.put(`/api/fee-templates/${TYPE}`, SMALL_TEMPLATE);

  const created = await client.post("/api/register", {
    code: "T102", name: "No share", typeCode: "TOWNSHIP establishment",
    billingBasis: "fixed_fee",
  });
  assert.equal(created.body.project.financials.projectedCost, null);
  assert.equal(created.body.project.financials.projectedProfit, null);
});

test("revising the job's schedule shows how far it drifted from the template", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);
  await client.put(`/api/fee-templates/${TYPE}`, { ...SMALL_TEMPLATE, costPct: 0.65 });
  const created = await client.post("/api/register", {
    code: "T103", name: "Bigger", typeCode: "TOWNSHIP establishment",
    billingBasis: "fixed_fee",
  });
  const id = created.body.project.id;

  const revised = await client.put(`/api/projects/${id}/fee-schedule`, {
    lines: [{ label: "Stage A", quoted: 9000 }, { label: "Stage B", quoted: 6000 }],
  });
  assert.equal(revised.status, 200, JSON.stringify(revised.body));

  const { financials } = (await client.get(`/api/register/${id}`)).body.project;
  assert.equal(financials.quoted, 15000);
  assert.equal(financials.templateQuote, 10000, "the template's price is not rewritten");
  assert.equal(financials.vsTemplate, 5000);
  assert.equal(financials.projectedCost, 6500, "the cost does not chase the new quote");
  assert.equal(financials.projectedProfit, 8500);
});

test("a job with no template has no template quote to drift from", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, freehand);
  const { financials } = (await client.get(`/api/register/${project.id}`)).body.project;
  assert.equal(financials.templateQuote, null);
  assert.equal(financials.vsTemplate, null);
});

test("an employee does not see the template quote or the cost share", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  await owner.put(`/api/fee-templates/${TYPE}`, { ...SMALL_TEMPLATE, costPct: 0.65 });
  const created = await owner.post("/api/register", {
    code: "T104", name: "Hidden", typeCode: "TOWNSHIP establishment", billingBasis: "fixed_fee",
  });
  const { client: employee } = await inviteEmployee(baseUrl, owner);

  const { financials } = (await employee.get(`/api/register/${created.body.project.id}`)).body.project;
  assert.equal(financials.templateQuote, null);
  assert.equal(financials.vsTemplate, null);
  const template = (await employee.get(`/api/fee-templates/${TYPE}`)).body.template;
  assert.equal(template.costPct, null);
});

test("a duplicated job keeps the projected cost", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    ...freehand, projectedCost: 10000,
  });

  const copy = await client.post(`/api/projects/${project.id}/duplicate`, {});
  assert.equal(copy.status, 201, JSON.stringify(copy.body));

  const { body } = await client.get("/api/register");
  const duplicate = body.projects.find((job) => /\(copy\)$/.test(job.name));
  assert.ok(duplicate, "the copy appears on the register");
  assert.equal(duplicate.projectedCost, 10000);
});
