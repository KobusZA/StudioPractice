// A fee that is a ceiling: hours past it stay captured, are proposed as a
// write-down at certificate time, and cannot be issued to the client.

import test from "node:test";
import assert from "node:assert/strict";
import { agent, firmWithRegisterProject, logHour, testServer } from "./helpers.js";

/** A R1 000 capped job with one R1 920 hour logged on it. */
async function cappedJob(baseUrl, fields = {}) {
  const firm = await firmWithRegisterProject(baseUrl, {
    typeCode: null, budgetEstimate: 1000, billingBasis: "fixed_fee", feeCeiling: true, ...fields,
  });
  await logHour(firm.client, firm.project.id);
  return firm;
}

async function draftWithTime(owner, projectId) {
  const created = await owner.post(`/api/projects/${projectId}/certificates`, {});
  const id = created.body.certificate.id;
  const filled = await owner.post(`/api/certificates/${id}/lines-from-time`, {});
  assert.equal(filled.status, 200, JSON.stringify(filled.body));
  return filled.body.certificate;
}

test("the ceiling flag round-trips on the register", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await cappedJob(baseUrl);
  assert.equal(project.feeCeiling, true);
  const off = await client.patch(`/api/register/${project.id}`, { feeCeiling: false });
  assert.equal(off.body.project.feeCeiling, false);
  // A patch that does not mention the flag leaves it alone.
  const on = await client.patch(`/api/register/${project.id}`, { feeCeiling: true });
  const renamed = await client.patch(`/api/register/${project.id}`, { name: "Renamed" });
  assert.equal(on.body.project.feeCeiling, true);
  assert.equal(renamed.body.project.feeCeiling, true);
});

test("a certificate past the ceiling proposes the write-down that brings it to the cap", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await cappedJob(baseUrl);
  const certificate = await draftWithTime(owner, project.id);

  assert.equal(certificate.subtotal, 1920);
  assert.deepEqual(
    { ...certificate.ceiling },
    { quoted: 1000, priorNet: 0, room: 1000, net: 1920, excess: 920, proposedWriteDown: 920 },
  );
});

test("a certificate past the ceiling will not issue until the excess is written down", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await cappedJob(baseUrl);
  const certificate = await draftWithTime(owner, project.id);

  const refused = await owner.post(`/api/certificates/${certificate.id}/issue`, {});
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.match(refused.body.error ?? refused.body.message ?? "", /ceiling/i);

  const written = await owner.post(`/api/certificates/${certificate.id}/write-downs`, {
    amount: certificate.ceiling.proposedWriteDown, reasonCode: "fee_ceiling",
    note: "Fee ceiling reached",
  });
  assert.equal(written.status, 200, JSON.stringify(written.body));
  assert.equal(written.body.certificate.net, 1000);
  assert.equal(written.body.certificate.ceiling.excess, 0);

  const issued = await owner.post(`/api/certificates/${certificate.id}/issue`, {});
  assert.equal(issued.status, 200, JSON.stringify(issued.body));

  // The hour is untouched, and the loss is on the record under its own reason.
  const financials = (await owner.get(`/api/projects/${project.id}/financials`)).body.financials;
  assert.equal(financials.captured, 1920);
  assert.equal(financials.billed, 1000);
  assert.equal(financials.ceilingRoom, 0);
  assert.deepEqual(financials.writtenDownByReason, [{ reasonCode: "fee_ceiling", amount: 920 }]);
});

test("a second certificate on a spent ceiling proposes writing down all of it", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await cappedJob(baseUrl);
  const first = await draftWithTime(owner, project.id);
  await owner.post(`/api/certificates/${first.id}/write-downs`, {
    amount: 920, reasonCode: "fee_ceiling",
  });
  await owner.post(`/api/certificates/${first.id}/issue`, {});

  await logHour(owner, project.id, { date: "2026-03-03" });
  const second = await draftWithTime(owner, project.id);
  assert.equal(second.ceiling.room, 0);
  assert.equal(second.ceiling.proposedWriteDown, second.subtotal);
});

test("a job that is not capped is unaffected", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await cappedJob(baseUrl, { feeCeiling: false });
  const certificate = await draftWithTime(owner, project.id);
  assert.equal(certificate.ceiling, null);
  const issued = await owner.post(`/api/certificates/${certificate.id}/issue`, {});
  assert.equal(issued.status, 200);
});

test("a capped job with no fee to cap it at has no ceiling to enforce", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await cappedJob(baseUrl, { budgetEstimate: null });
  const certificate = await draftWithTime(owner, project.id);
  assert.equal(certificate.ceiling, null);
});

test("fee_ceiling is offered as a write-down reason", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl);
  const reference = (await client.get("/api/practice/reference")).body;
  assert.ok(reference.writeDownReasons.includes("fee_ceiling"));
});
