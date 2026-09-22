// Fee templates, and what registering a job of a templated type produces.
//
// The figures asserted here are the workbook's own, not round numbers chosen
// to make a test read nicely. That is the point of the slice: a firm's first
// REZONING job should arrive priced the way this firm already prices one, and
// a test that accepted R100 phases would pass while the seed drifted.
//
// The other half is the placeholder case. Four of the nine types arrived as
// empty sheets, and a job of one of those must register and work exactly as
// well with no task list at all - that is a settled decision, not a gap to be
// filled in later with invented content.

import test from "node:test";
import assert from "node:assert/strict";
import { FEE_TEMPLATES, templateTotal } from "../src/fee-templates.js";
import { firmWithRegisterProject, signedUpAgent, testServer } from "./helpers.js";

const REZONING_PHASES = [
  "1 - Inception",
  "2 - Submission to authorities",
  "3 - Public participation",
  "4 - Procuring decision",
  "5 - Promulgation",
];

test("the seeded templates still add up to the workbook's own totals", () => {
  // Sheet 'REZONING' J40, 'CONSENT USE' H44, 'REMOVAL OF RESTRICTIONS' J47,
  // 'TOWNSHIP establishment' C69. If an edit below moves one of these, it is
  // a change to what the firm charges and wants saying out loud.
  assert.equal(templateTotal(FEE_TEMPLATES.REZONING), 74500);
  assert.equal(templateTotal(FEE_TEMPLATES["CONSENT USE"]), 39000);
  assert.equal(templateTotal(FEE_TEMPLATES["REMOVAL OF RESTRICTIONS"]), 30000);
  assert.equal(templateTotal(FEE_TEMPLATES["TOWNSHIP establishment"]), 54445.8);

  // Shape C prices each task and the stage is their sum, so the two have to
  // agree - this is the assertion the seed file's comment promises.
  for (const phase of FEE_TEMPLATES["TOWNSHIP establishment"].phases) {
    const fromTasks = Math.round(phase.tasks.reduce((sum, t) => sum + t.fee, 0) * 100) / 100;
    assert.equal(fromTasks, phase.fee, phase.name);
  }
  // And STRATAREPORT's phase is the sum of its three items, R1 950 - not the
  // sheet's own R1 100, which comes from a SUM() that stops one row short.
  assert.equal(templateTotal(FEE_TEMPLATES.STRATAREPORT), 1950);
});

test("signing up seeds the five templates and leaves the placeholders empty", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);

  const rezoning = (await client.get("/api/fee-templates/REZONING")).body.template;
  assert.deepEqual(rezoning.phases.map((p) => p.name), REZONING_PHASES);
  assert.deepEqual(rezoning.phases.map((p) => p.defaultFee), [15000, 30000, 14000, 7000, 8500]);
  assert.equal(rezoning.quoted, 74500);
  // Task text comes across with the phases, so the job gets a checklist and
  // not just five numbers.
  assert.equal(rezoning.phases[0].tasks[0].description,
    "Briefing session with client: taking instructions");
  assert.deepEqual(rezoning.phases.map((p) => p.tasks.length), [3, 7, 3, 5, 3]);
  // The split is a fraction of the template total: 15 000 of 74 500.
  assert.equal(rezoning.phases[0].defaultPctSplit, 0.2013);

  const boq = (await client.get("/api/fee-templates/BOQ")).body.template;
  assert.deepEqual(boq.phases, []);
  assert.equal(boq.quoted, 0);
});

test("registering a templated job produces the tasks and the fee schedule together", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "W076", name: "Noltrix zoning application", typeCode: "REZONING",
    budgetEstimate: null,
  });

  const { tasks } = (await client.get(`/api/projects/${project.id}/tasks`)).body;
  assert.equal(tasks.length, 21);
  assert.deepEqual([...new Set(tasks.map((t) => t.phaseLabel))], REZONING_PHASES);
  assert.deepEqual(tasks.map((t) => t.seq), Array.from({ length: 21 }, (_, i) => i + 1));
  assert.equal(tasks.every((t) => t.status === "not_started"), true);
  assert.equal(tasks.every((t) => t.templateTaskId !== null), true);

  const { feeSchedule } = (await client.get(`/api/projects/${project.id}/fee-schedule`)).body;
  assert.deepEqual(feeSchedule.lines.map((l) => l.label), REZONING_PHASES);
  assert.equal(feeSchedule.quoted, 74500);

  // And the quote the rest of the application measures burn against is that
  // same number, from that same clone - not a second figure typed in later.
  const { financials } = (await client.get(`/api/projects/${project.id}/financials`)).body;
  assert.equal(financials.quoted, 74500);
  assert.equal(financials.quotedSource, "fee_schedule");
});

test("a placeholder type registers with neither tasks nor a schedule", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "B001", name: "Bill of quantities", typeCode: "BOQ", budgetEstimate: 40000,
  });

  assert.deepEqual((await client.get(`/api/projects/${project.id}/tasks`)).body.tasks, []);
  assert.deepEqual(
    (await client.get(`/api/projects/${project.id}/fee-schedule`)).body.feeSchedule.lines, [],
  );
  // Fully usable: the register's own estimate answers for the fee, and a
  // freehand schedule can be typed the moment somebody wants one.
  const { financials } = (await client.get(`/api/projects/${project.id}/financials`)).body;
  assert.equal(financials.quoted, 40000);
  assert.equal(financials.quotedSource, "budget_estimate");
});

test("the township template clones its stages, including sundries", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);

  const { feeSchedule } = (await client.get(`/api/projects/${project.id}/fee-schedule`)).body;
  assert.equal(feeSchedule.quoted, 54445.8);
  assert.equal(feeSchedule.lines.at(-1).label, "Sundries");
  assert.equal(feeSchedule.lines.at(-1).quoted, 13430.6);

  const { tasks } = (await client.get(`/api/projects/${project.id}/tasks`)).body;
  const surveyor = tasks.find((t) => t.description.startsWith("Land surveyor cost"));
  // Shape C prices the task, so the clone carries a fee the job can bill.
  assert.equal(surveyor.defaultFee, 12000);
  assert.equal(surveyor.phaseLabel, "Stage 1 - Inception & preparation");
});

test("a struck task stays on the list rather than disappearing from it", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const { tasks } = (await client.get(`/api/projects/${project.id}/tasks`)).body;
  const target = tasks.find((t) => t.description === "Confirmation of existing building plans");

  const struck = await client.patch(`/api/tasks/${target.id}`, {
    status: "not_required", note: "Vacant property",
  });
  assert.equal(struck.status, 200);
  const after = struck.body.tasks.find((t) => t.id === target.id);
  // Still there, and still counted - the record of a decision, not a deletion.
  assert.equal(struck.body.tasks.length, tasks.length);
  assert.equal(after.status, "not_required");
  assert.equal(after.note, "Vacant property");

  const nonsense = await client.patch(`/api/tasks/${target.id}`, { status: "cancelled" });
  assert.equal(nonsense.status, 400);
});

test("a freehand task sits beside the cloned ones and is marked as its own", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);

  const added = await client.post(`/api/projects/${project.id}/tasks`, {
    description: "Respond to the environmental department complaint",
    phaseLabel: "Stage 3 - Engineering & SANS forms",
    defaultFee: 2400,
  });
  assert.equal(added.status, 201);
  const task = added.body.tasks.at(-1);
  // Null template id is what distinguishes work somebody added from work the
  // firm's template said this discipline involves.
  assert.equal(task.templateTaskId, null);
  assert.equal(task.defaultFee, 2400);
});

test("a certificate line billed from a task carries the phase it was quoted under", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const { tasks } = (await client.get(`/api/projects/${project.id}/tasks`)).body;
  const runner = tasks.find((t) => t.description.startsWith("Appoint runner"));

  const draft = (await client.post(`/api/projects/${project.id}/certificates`, {}))
    .body.certificate;
  const billed = await client.post(`/api/certificates/${draft.id}/lines-from-tasks`, {
    tasks: [{ taskId: runner.id }],
  });
  assert.equal(billed.status, 200);
  const [line] = billed.body.certificate.lines;
  assert.equal(line.source, "phase");
  assert.equal(line.amount, 4000);
  assert.equal(line.phaseRef, "Stage 4 - Runner / council submission");
  assert.equal(line.projectTaskId, runner.id);

  // Which is what makes the phase reconcile on the fee schedule, in full.
  await client.post(`/api/certificates/${draft.id}/issue`, {});
  const { feeSchedule } = (await client.get(`/api/projects/${project.id}/fee-schedule`)).body;
  const stage4 = feeSchedule.lines.find((l) => l.label === "Stage 4 - Runner / council submission");
  assert.equal(stage4.certified, 4000);
  assert.equal(stage4.variance, 0);
  assert.equal(feeSchedule.unallocated.certified, 0);
});

test("a task is billed once, and a part-billed phase says what fraction", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const { tasks } = (await client.get(`/api/projects/${project.id}/tasks`)).body;
  const surveyor = tasks.find((t) => t.description.startsWith("Land surveyor cost"));

  const draft = (await client.post(`/api/projects/${project.id}/certificates`, {}))
    .body.certificate;
  const half = await client.post(`/api/certificates/${draft.id}/lines-from-tasks`, {
    tasks: [{ taskId: surveyor.id, pct: 0.5 }],
  });
  assert.equal(half.body.certificate.lines[0].amount, 6000);
  assert.equal(half.body.certificate.lines[0].pct, 0.5);

  const again = await client.post(`/api/certificates/${draft.id}/lines-from-tasks`, {
    tasks: [{ taskId: surveyor.id }],
  });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already billed/);
  assert.equal((await client.get(`/api/certificates/${draft.id}`)).body.certificate.lines.length, 1);
});

test("a phase-priced task with no fee of its own asks for an amount by name", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "J065", typeCode: "CONSENT USE", budgetEstimate: null,
  });
  const { tasks } = (await client.get(`/api/projects/${project.id}/tasks`)).body;
  const first = tasks[0];
  assert.equal(first.defaultFee, null);

  const draft = (await client.post(`/api/projects/${project.id}/certificates`, {}))
    .body.certificate;
  const refused = await client.post(`/api/certificates/${draft.id}/lines-from-tasks`, {
    tasks: [{ taskId: first.id }],
  });
  assert.equal(refused.status, 400);
  // Named, because "no fee" on a template that prices the phase is the normal
  // case and the user needs to know which line to type a number against.
  assert.match(refused.body.error, /Briefing session with client/);

  const priced = await client.post(`/api/certificates/${draft.id}/lines-from-tasks`, {
    tasks: [{ taskId: first.id, amount: 7500 }],
  });
  assert.equal(priced.body.certificate.lines[0].amount, 7500);
  assert.equal(priced.body.certificate.lines[0].phaseRef, "Phase 1 - Inception");
});

test("re-registering does not duplicate a job's task list", async () => {
  const { baseUrl, pool } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);

  // The township template's own 44 tasks, cloned once at registration.
  const before = (await client.get(`/api/projects/${project.id}/tasks`)).body.tasks;
  assert.equal(before.length, 44);

  // Changing the type on a job that already has a list must not clone a second
  // one over the first: the quoted fee would double and the phases of two
  // different disciplines would interleave. The list a job is running against
  // is the one it was opened with, and re-pointing it is a decision somebody
  // makes task by task.
  await client.patch(`/api/register/${project.id}`, { typeCode: "REZONING" });
  const { rows } = await pool.query(
    `select count(*) as n from project_task where project_id = $1 and deleted_at is null`,
    [project.id],
  );
  assert.equal(Number(rows[0].n), 44);
  const after = (await client.get(`/api/projects/${project.id}/tasks`)).body.tasks;
  assert.deepEqual(after.map((t) => t.id), before.map((t) => t.id));
});
