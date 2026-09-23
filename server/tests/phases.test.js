// Where the job has got to in its own process.
//
// The rule these exist to hold is that the phase is *stated*, never inferred.
// A phase whose tasks are all ticked does not advance the job, because "the
// tasks are done" and "we have moved on" are different claims - and where the
// two disagree, the disagreement is the thing worth reporting.

import test from "node:test";
import assert from "node:assert/strict";
import { firmWithRegisterProject, logHour, signedUpAgent, testServer } from "./helpers.js";

test("a templated job knows its phases and is in none of them", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "R081", typeCode: "REZONING", budgetEstimate: null,
  });

  const res = await client.get(`/api/projects/${project.id}/phases`);
  assert.equal(res.status, 200);

  // Five phases, cloned from the workbook's own REZONING sheet, in its order.
  assert.equal(res.body.phases.length, 5);
  assert.deepEqual(res.body.phases.map((p) => p.seq), [1, 2, 3, 4, 5]);
  assert.ok(res.body.phases.every((p) => p.tasksTotal > 0));

  // Null, not phase one. Nobody has said where this job is, and a register
  // that answered "inception" would be making it up.
  assert.equal(res.body.current, null);
  assert.equal(res.body.currentSince, null);
  assert.deepEqual(res.body.history, []);
  assert.ok(res.body.phases.every((p) => p.position === null),
    "no phase has a position until the job has one");
});

test("entering a phase positions every other phase around it", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "R082", typeCode: "REZONING", budgetEstimate: null,
  });
  const { body: before } = await client.get(`/api/projects/${project.id}/phases`);
  const third = before.phases[2].ref;

  const entered = await client.post(`/api/projects/${project.id}/phase`, { phaseRef: third });
  assert.equal(entered.status, 201);
  assert.equal(entered.body.current, third);
  assert.equal(entered.body.currentListed, true);
  assert.ok(entered.body.currentSince);

  assert.deepEqual(
    entered.body.phases.map((p) => p.position),
    ["behind", "behind", "current", "ahead", "ahead"],
  );
});

test("going back to an earlier phase is another event, not a correction", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "R083", typeCode: "REZONING", budgetEstimate: null,
  });
  const { body: listed } = await client.get(`/api/projects/${project.id}/phases`);
  const [first, , third] = listed.phases;

  await client.post(`/api/projects/${project.id}/phase`, { phaseRef: first.ref });
  await client.post(`/api/projects/${project.id}/phase`, { phaseRef: third.ref });
  const back = await client.post(`/api/projects/${project.id}/phase`, {
    phaseRef: first.ref, note: "Council sent the application back",
  });

  assert.equal(back.body.current, first.ref);
  assert.equal(back.body.currentNote, "Council sent the application back");

  // All three survive, newest first. "We went back to public participation in
  // August" is the fact a fee query turns on; overwriting a column would lose
  // it and leave the job looking as though it had never advanced.
  assert.equal(back.body.history.length, 3);
  assert.deepEqual(back.body.history.map((h) => h.phaseRef),
    [first.ref, third.ref, first.ref]);
});

test("ticking every task in a phase does not advance the job", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "R084", typeCode: "REZONING", budgetEstimate: null,
  });
  const { body: listed } = await client.get(`/api/projects/${project.id}/phases`);
  const firstPhase = listed.phases[0].ref;

  const { body: taskList } = await client.get(`/api/projects/${project.id}/tasks`);
  const inPhase = taskList.tasks.filter((t) => t.phaseLabel === firstPhase);
  assert.ok(inPhase.length > 0);
  for (const task of inPhase) {
    await client.patch(`/api/tasks/${task.id}`, { status: "done" });
  }

  const { body: after } = await client.get(`/api/projects/${project.id}/phases`);
  assert.equal(after.phases[0].tasksDone, inPhase.length);
  assert.equal(after.current, null, "a full checklist is not a statement about where we are");
});

test("the register carries each job's phase, so twelve jobs cost one query", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "R085", typeCode: "REZONING", budgetEstimate: null,
  });
  const { body: listed } = await client.get(`/api/projects/${project.id}/phases`);
  await client.post(`/api/projects/${project.id}/phase`, { phaseRef: listed.phases[1].ref });

  const { body: register } = await client.get("/api/register");
  const row = register.projects.find((p) => p.id === project.id);
  assert.equal(row.currentPhase, listed.phases[1].ref);
  assert.ok(row.phaseSince);

  const { body: one } = await client.get(`/api/register/${project.id}`);
  assert.equal(one.project.currentPhase, listed.phases[1].ref);
});

test("a phase somebody typed that is not on the list is still the answer", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "W076", typeCode: null, budgetEstimate: null,
  });

  // A placeholder type and no fee schedule: no phase list at all, which is a
  // finished state for the four sheets that arrived empty.
  const { body: empty } = await client.get(`/api/projects/${project.id}/phases`);
  assert.deepEqual(empty.phases, []);

  const entered = await client.post(`/api/projects/${project.id}/phase`, {
    phaseRef: "Waiting on the neighbour's consent",
  });
  assert.equal(entered.body.current, "Waiting on the neighbour's consent");
  // Flagged as unlisted rather than dropped: freehand is still an answer, and
  // silently discarding it would be worse than showing it as off-template.
  assert.equal(entered.body.currentListed, false);
});

test("phase evidence separates what was quoted from what was tagged to it", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    code: "R086", typeCode: "REZONING", budgetEstimate: null,
  });
  const { body: listed } = await client.get(`/api/projects/${project.id}/phases`);
  const target = listed.phases[0];
  assert.ok(target.quoted > 0, "a rezoning phase carries a fee from the template");

  await logHour(client, project.id, { phaseRef: target.ref });
  await logHour(client, project.id);

  const { body: after } = await client.get(`/api/projects/${project.id}/phases`);
  assert.equal(after.phases[0].captured, 1920);
  // The hour nobody tagged is reported, not spread across the phases. Phase
  // is optional on a time entry, so per-phase captured is always partial and
  // the page has to be able to say by how much.
  assert.equal(after.capturedUntagged, 1920);
});

test("a phase is required, and another firm's job is not found", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, { code: "R087" });

  const blank = await client.post(`/api/projects/${project.id}/phase`, { phaseRef: "  " });
  assert.equal(blank.status, 400);
  assert.match(blank.body.error, /phase is required/);

  const { client: stranger } = await signedUpAgent(baseUrl, { orgName: "Other Firm" });
  assert.equal((await stranger.get(`/api/projects/${project.id}/phases`)).status, 404);
  assert.equal(
    (await stranger.post(`/api/projects/${project.id}/phase`, { phaseRef: "Inception" })).status,
    404,
  );
});
