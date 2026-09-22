// The register: the type-agnostic spine the rest of practice ops hangs off.
// These go through HTTP because the two rules worth proving here - that a job
// need not have a drawing, and that a project code cannot be issued twice -
// are enforced in the route and the index respectively, not in a helper.

import test from "node:test";
import assert from "node:assert/strict";
import { firmWithRegisterProject, signedUpAgent, testDoc, testServer } from "./helpers.js";

test("a job can exist with no drawing", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);

  assert.equal(project.code, "D063");
  assert.equal(project.drawingId, null);

  // The planner's own open route, which used to 404 here. A strata report or
  // a dispute never produces geometry, and a register job the rest of the
  // application cannot open is a job that does not exist to it.
  const opened = await client.get(`/api/projects/${project.id}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.drawing, null);
  assert.equal(opened.body.project.id, project.id);
});

test("a drawing attaches to a register job when the work needs one", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);

  // A client-minted id, as everywhere else: the document has an identity
  // before it is written. testDoc() mints a fresh one per call, because these
  // ids are global and the suite does not truncate between runs.
  const doc = testDoc({ name: "Layout" });
  const attached = await client.post(`/api/projects/${project.id}/drawing`, { doc });
  assert.equal(attached.status, 201);
  assert.equal(attached.body.drawing.id, doc.id);

  const opened = await client.get(`/api/projects/${project.id}`);
  assert.equal(opened.body.drawing.id, doc.id);
});

test("a project code cannot be issued twice, however it is typed", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl, { code: "P078" });

  // The workbook carried P078 twice and `C036 ` beside `CO36.9`. Trailing
  // space and case are the two ways the duplicate actually arrives, so the
  // index folds both and the write is refused rather than the collision being
  // discovered months later against real money.
  for (const code of ["P078", "p078", " P078 "]) {
    const again = await client.post("/api/register", { code, name: "Something else" });
    assert.equal(again.status, 409, code);
    assert.match(again.body.error, /already in use/);
  }

  const distinct = await client.post("/api/register", { code: "P079", name: "Next one" });
  assert.equal(distinct.status, 201);
});

test("two firms may each use the same code", async () => {
  const { baseUrl } = await testServer();
  await firmWithRegisterProject(baseUrl, { code: "P001" });
  const { client: other } = await signedUpAgent(baseUrl, { orgName: "Other Firm" });
  const mine = await other.post("/api/register", { code: "P001", name: "Mine" });
  assert.equal(mine.status, 201);
});

test("a job with no code is refused", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const res = await client.post("/api/register", { name: "Nameless" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /project code is required/);
});

test("a new firm starts with the type list and the tariff bands", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const { body } = await client.get("/api/practice/reference");

  assert.equal(body.projectTypes.length, 9);
  assert.equal(body.projectTypes.filter((t) => t.isPlaceholder).length, 4);
  // The workbook's sheet is misspelled. The code keeps it so an import
  // matches; the display name does not inherit the typo.
  const subdivision = body.projectTypes.find((t) => t.code === "SUBDVISION");
  assert.equal(subdivision.name, "Subdivision");
  assert.equal(subdivision.isPlaceholder, true);

  assert.deepEqual(body.rateBands.map((b) => b.code), ["A1", "A2", "B", "C"]);
  assert.equal(body.rateBands.find((b) => b.code === "A1").hourlyRate, 3600);
  assert.ok(body.activityTypes.includes("Site visit"));
  assert.equal(body.writeDownReasons.includes("legacy_unspecified"), false);
});

test("a placeholder type is a usable type", async () => {
  const { baseUrl } = await testServer();
  // Four of the twelve disciplines arrived as empty sheets. Registering one
  // has to work now - no pre-built tasks, everything downstream fine - because
  // the alternative is inventing a task list nobody has described.
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "B001", typeCode: "BOQ", name: "Schedule of quantities",
  });
  assert.equal(project.typeCode, "BOQ");

  const logged = await client.post("/api/time-entries", {
    projectId: project.id, date: "2026-03-02", minutes: 30,
    activityType: "File work", description: "Measuring off",
  });
  assert.equal(logged.status, 201);
});

test("a partial update moves only what it names", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    clientEmail: "trust@example.com", clientCell: "082 000 0000",
  });

  const patched = await client.patch(`/api/register/${project.id}`, { status: "halted" });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.project.status, "halted");
  // A form that posts what it renders must not blank what it does not.
  assert.equal(patched.body.project.clientEmail, "trust@example.com");
  assert.equal(patched.body.project.clientCell, "082 000 0000");
  assert.equal(patched.body.project.budgetEstimate, 120000);
});

test("the register carries each job's money, and says nothing where there is none", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);
  const { body } = await client.get("/api/register");

  const [job] = body.projects;
  assert.equal(job.financials.captured, 0);
  assert.equal(job.financials.billed, 0);
  assert.equal(job.financials.quoted, 120000);
  // Null, not zero. "Nobody has billed this yet" and "this realised nothing"
  // are different sentences, and a rail that prints 0% for the first is
  // lying about a job that is simply new.
  assert.equal(job.financials.realisation, null);
  assert.equal(job.financials.burn, 0);
});

test("a job with no budget reports no burn rather than a fabricated one", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "P074", name: "Pretorius dispute",
    billingBasis: "time_and_materials", budgetEstimate: null,
  });
  await client.post("/api/time-entries", {
    projectId: project.id, date: "2026-03-02", minutes: 60,
    activityType: "Meeting", description: "Consultation",
  });

  const { body } = await client.get(`/api/register/${project.id}`);
  assert.equal(body.project.financials.quoted, null);
  assert.equal(body.project.financials.captured, 1920);
  assert.equal(body.project.financials.burn, null);
});
