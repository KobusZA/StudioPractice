// The fee schedule: the agreed breakdown of the quote, which until now had no
// stored form at all.
//
// The rule these tests exist to hold is that there is exactly one quoted
// figure. The register's budget estimate and a phase-by-phase schedule are two
// answers to the same question, and a screen that showed both would let them
// drift until nobody could say which one the client had agreed to. So the
// schedule wins when it exists, the estimate answers when it does not, and
// `financials.quotedSource` says out loud which of the two was used.

import test from "node:test";
import assert from "node:assert/strict";
import { firmWithRegisterProject, logHour, testServer } from "./helpers.js";

/** The real REZONING split from the workbook's W076 sheet: R74 500 over five phases. */
const REZONING = [
  { label: "1 - Inception", quoted: 15000 },
  { label: "2 - Submission to authorities", quoted: 30000 },
  { label: "3 - Public participation", quoted: 14000 },
  { label: "4 - Procuring decision", quoted: 7000 },
  { label: "5 - Promulgation", quoted: 8500 },
];

const put = (client, projectId, lines) => (
  client.put(`/api/projects/${projectId}/fee-schedule`, { lines })
);

/**
 * A job with no fee template behind it, so the schedule under test is the only
 * one that has ever existed on it. Registering a templated type clones a
 * schedule at creation - that path is `fee-templates.test.js`, and mixing the
 * two here would test the seed rather than the schedule.
 */
const firmWithFreehandProject = (baseUrl, fields = {}) => (
  firmWithRegisterProject(baseUrl, { typeCode: null, ...fields })
);

const financials = async (client, projectId) => (
  (await client.get(`/api/projects/${projectId}/financials`)).body.financials
);

test("a schedule is stored as a whole document and read back in order", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithFreehandProject(baseUrl);

  const saved = await put(client, project.id, REZONING);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.feeSchedule.lines.map((l) => l.seq), [1, 2, 3, 4, 5]);
  assert.deepEqual(saved.body.feeSchedule.lines.map((l) => l.label), REZONING.map((l) => l.label));
  assert.equal(saved.body.feeSchedule.quoted, 74500);

  const read = await client.get(`/api/projects/${project.id}/fee-schedule`);
  assert.deepEqual(read.body.feeSchedule.lines.map((l) => l.quoted),
    [15000, 30000, 14000, 7000, 8500]);
});

test("saving a schedule replaces the prior one rather than appending to it", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithFreehandProject(baseUrl);
  await put(client, project.id, REZONING);

  // A fee proposal is reissued whole. Five phases revised down to two is two
  // phases, not seven - and the old rows are soft-deleted, not overwritten.
  const revised = await put(client, project.id, [
    { label: "1 - Inception", quoted: 18000 },
    { label: "2 - Submission to authorities", quoted: 30000 },
  ]);
  assert.equal(revised.body.feeSchedule.lines.length, 2);
  assert.equal(revised.body.feeSchedule.quoted, 48000);
  assert.deepEqual(revised.body.feeSchedule.lines.map((l) => l.seq), [1, 2]);

  const { rows } = await (await testServer()).pool.query(
    `select count(*) filter (where deleted_at is null)     as live,
            count(*) filter (where deleted_at is not null) as superseded
       from fee_schedule_line where project_id = $1`,
    [project.id],
  );
  assert.equal(Number(rows[0].live), 2);
  assert.equal(Number(rows[0].superseded), 5);
});

test("the schedule sum outranks the register's budget estimate", async () => {
  const { baseUrl } = await testServer();
  // D063's real numbers: the register says R120 000 and the template says
  // R54 445.80. Somebody quoted one of them, and burn has to pick.
  const { client, project } = await firmWithFreehandProject(baseUrl, { budgetEstimate: 120000 });

  const before = await financials(client, project.id);
  assert.equal(before.quoted, 120000);
  assert.equal(before.quotedSource, "budget_estimate");
  assert.equal(before.scheduleLines, 0);

  await put(client, project.id, [
    { label: "Stage 1 - Inception & preparation", quoted: 23415.2 },
    { label: "Stage 2 - Site measurement & scaling", quoted: 8350 },
    { label: "Stage 3 - Engineering & SANS forms", quoted: 4350 },
    { label: "Stage 4 - Runner / council submission", quoted: 4000 },
    { label: "Stage 5 - Comments & handover", quoted: 900 },
    { label: "Sundries", quoted: 13430.6 },
  ]);

  const after = await financials(client, project.id);
  assert.equal(after.quoted, 54445.8);
  assert.equal(after.quotedSource, "fee_schedule");
  assert.equal(after.scheduleLines, 6);
  // The estimate is still reported, because the disagreement between the two
  // is itself a warning the master view raises. It is simply not the fee.
  assert.equal(after.budgetEstimate, 120000);
});

test("an emptied schedule falls back to the budget estimate rather than to zero", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithFreehandProject(baseUrl, { budgetEstimate: 120000 });
  await put(client, project.id, REZONING);
  await put(client, project.id, []);

  const after = await financials(client, project.id);
  // Zero would read as a job quoted at nothing, which prints 100%+ burn on
  // the first hour logged. A missing schedule is not a fee of R0.
  assert.equal(after.quoted, 120000);
  assert.equal(after.quotedSource, "budget_estimate");
});

test("burn is measured against the schedule once one exists", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithFreehandProject(baseUrl, { budgetEstimate: 120000 });
  for (let i = 0; i < 4; i += 1) await logHour(client, project.id);

  assert.equal((await financials(client, project.id)).burn, 7680 / 120000);
  await put(client, project.id, [{ label: "Only phase", quoted: 7000 }]);
  const after = await financials(client, project.id);
  assert.equal(after.captured, 7680);
  assert.ok(after.burn > 1, `expected the job to read as over its fee, got ${after.burn}`);
});

test("a phase shows what was certified under it, and by how much it overran", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithFreehandProject(baseUrl);
  await put(client, project.id, REZONING);

  const draft = (await client.post(`/api/projects/${project.id}/certificates`, {}))
    .body.certificate;
  // Matched on the label, trimmed and case-folded: the phase is typed on the
  // certificate on a different day by a different person.
  await client.post(`/api/certificates/${draft.id}/lines`, {
    description: "Inception, in full", amount: 15000, phaseRef: "1 - inception",
  });
  await client.post(`/api/certificates/${draft.id}/lines`, {
    description: "Submission, overrun", amount: 34000, phaseRef: "2 - SUBMISSION TO AUTHORITIES ",
  });
  await client.post(`/api/certificates/${draft.id}/issue`, {});

  const { lines, unallocated } = (await client.get(`/api/projects/${project.id}/fee-schedule`))
    .body.feeSchedule;
  assert.equal(lines[0].certified, 15000);
  assert.equal(lines[0].variance, 0);
  assert.equal(lines[1].certified, 34000);
  assert.equal(lines[1].variance, -4000);
  assert.equal(lines[2].certified, 0);
  assert.equal(lines[2].variance, 14000);
  assert.equal(unallocated.certified, 0);
});

test("money certified against no phase is reported rather than absorbed", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithFreehandProject(baseUrl);
  await put(client, project.id, REZONING);
  await logHour(client, project.id);

  const draft = (await client.post(`/api/projects/${project.id}/certificates`, {}))
    .body.certificate;
  // A time line carries no phase unless somebody typed one, and a hand-typed
  // line can name a phase the schedule has never heard of.
  await client.post(`/api/certificates/${draft.id}/lines-from-time`, {});
  await client.post(`/api/certificates/${draft.id}/lines`, {
    description: "Extra meeting", amount: 2500, phaseRef: "Phase 9 - who knows",
  });

  const { lines, unallocated } = (await client.get(`/api/projects/${project.id}/fee-schedule`))
    .body.feeSchedule;
  // Still a draft, so none of it is certified - but it is not invisible.
  assert.equal(unallocated.certified, 0);
  assert.equal(unallocated.draft, 1920 + 2500);
  assert.deepEqual(lines.map((l) => l.draft), [0, 0, 0, 0, 0]);
});

test("a schedule line needs a label and a number", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithFreehandProject(baseUrl);

  const noLabel = await put(client, project.id, [{ label: "  ", quoted: 100 }]);
  assert.equal(noLabel.status, 400);
  const noAmount = await put(client, project.id, [{ label: "Phase 1", quoted: "R15 000" }]);
  assert.equal(noAmount.status, 400);

  // And neither attempt left half a schedule behind.
  const read = await client.get(`/api/projects/${project.id}/fee-schedule`);
  assert.deepEqual(read.body.feeSchedule.lines, []);
});
