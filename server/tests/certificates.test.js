// Certificates, and the write-down.
//
// The customer's ask, in their words, was not to stop overriding values - they
// cannot recoup time the client will not pay for - but to be told it is
// happening. So the tests that matter here are that the reason is compulsory,
// that the two numbers stay separate, and that nothing goes missing between
// the timesheet and the document.

import test from "node:test";
import assert from "node:assert/strict";
import { firmWithRegisterProject, logHour, signedUpAgent, testServer } from "./helpers.js";

async function draftFor(client, projectId, period = {}) {
  const res = await client.post(`/api/projects/${projectId}/certificates`, period);
  assert.equal(res.status, 201);
  return res.body.certificate;
}

test("every captured hour reaches the document, past sixteen lines", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  for (let i = 0; i < 20; i += 1) {
    await logHour(client, project.id, { description: `Attendance ${i + 1}` });
  }

  const draft = await draftFor(client, project.id);
  const filled = await client.post(`/api/certificates/${draft.id}/lines-from-time`, {});
  // The invoice macro stopped at sixteen rows, and the seventeenth hour simply
  // never reached the client. There is no cap here, silent or otherwise.
  assert.equal(filled.body.certificate.lines.length, 20);
  assert.equal(filled.body.certificate.subtotal, 20 * 1920);
  assert.deepEqual(filled.body.certificate.lines.map((l) => l.seq),
    Array.from({ length: 20 }, (_, i) => i + 1));
});

test("blank dates mean the whole job, not a broken statement", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  await logHour(client, project.id);

  // An empty date input posts "". Reaching Postgres as ''::date it fails the
  // whole statement, and the visible symptom is a button that does nothing.
  const draft = await draftFor(client, project.id, { periodStart: "", periodEnd: "" });
  const { status, body } = await client.post(`/api/certificates/${draft.id}/lines-from-time`, {
    from: "", to: "",
  });
  assert.equal(status, 200);
  assert.equal(body.certificate.lines.length, 1);
  assert.equal(body.certificate.periodStart, null);
});

test("a line carries the hours it charged for", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  await logHour(client, project.id, { minutes: 47 });

  const draft = await draftFor(client, project.id);
  const { body } = await client.post(`/api/certificates/${draft.id}/lines-from-time`, {});
  const [line] = body.certificate.lines;
  assert.equal(line.source, "time");
  assert.equal(line.amount, 1920);
  assert.equal(line.units, 1);
  assert.equal(line.description, "Drafting the layout plan");
});

test("an hour is billed once, however the ranges overlap", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  await logHour(client, project.id, { date: "2026-03-02" });
  await logHour(client, project.id, { date: "2026-03-20" });

  const draft = await draftFor(client, project.id);
  let body = (await client.post(`/api/certificates/${draft.id}/lines-from-time`, {
    from: "2026-03-01", to: "2026-03-15",
  })).body;
  assert.equal(body.certificate.lines.length, 1);

  // A range that covers what was already pulled. Re-running it must be a
  // no-op, not a second charge nobody can see inside a total.
  body = (await client.post(`/api/certificates/${draft.id}/lines-from-time`, {
    from: "2026-03-01", to: "2026-03-31",
  })).body;
  assert.equal(body.certificate.lines.length, 2);
  assert.equal(body.certificate.subtotal, 3840);
});

test("a write-down needs a reason", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  await logHour(client, project.id);
  const draft = await draftFor(client, project.id);
  await client.post(`/api/certificates/${draft.id}/lines-from-time`, {});

  const bare = await client.post(`/api/certificates/${draft.id}/write-downs`, { amount: 500 });
  assert.equal(bare.status, 400);
  assert.match(bare.body.error, /reason is required/);

  // And not any string: the list is closed, so the reporting the customer
  // asked for can group by it.
  const invented = await client.post(`/api/certificates/${draft.id}/write-downs`, {
    amount: 500, reasonCode: "felt_like_it",
  });
  assert.equal(invented.status, 500);
});

test("a percentage off the bottom of the page, as the firm already writes it", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  await logHour(client, project.id);
  await logHour(client, project.id);
  const draft = await draftFor(client, project.id);
  await client.post(`/api/certificates/${draft.id}/lines-from-time`, {});

  // P074's July certificate: subtotal, less 20%, subtotal.
  const { body } = await client.post(`/api/certificates/${draft.id}/write-downs`, {
    pct: 0.2, reasonCode: "under_quoted", note: "Quoted before the scope was clear",
  });
  const certificate = body.certificate;
  assert.equal(certificate.subtotal, 3840);
  assert.equal(certificate.writtenDown, 768);
  assert.equal(certificate.net, 3072);
  assert.equal(certificate.vat, 460.8);
  assert.equal(certificate.total, 3532.8);
  assert.equal(certificate.writeDowns[0].reasonCode, "under_quoted");
});

test("realisation is what the firm kept of what the work cost it", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  await logHour(client, project.id);
  await logHour(client, project.id);
  const draft = await draftFor(client, project.id);
  await client.post(`/api/certificates/${draft.id}/lines-from-time`, {});
  await client.post(`/api/certificates/${draft.id}/write-downs`, {
    pct: 0.2, reasonCode: "goodwill",
  });

  // Nothing counts until it goes out. A draft sitting at R3 840 is reported
  // as a draft, and realisation is honestly 0 - the firm has spent R3 840 and
  // billed nobody - with `draftGross` there so a screen can say which of the
  // two situations it is looking at rather than flashing red at a new job.
  let financials = (await client.get(`/api/projects/${project.id}/financials`)).body.financials;
  assert.equal(financials.certifiedGross, 0);
  assert.equal(financials.draftGross, 3840);
  assert.equal(financials.realisation, 0);

  assert.equal((await client.post(`/api/certificates/${draft.id}/issue`)).status, 200);
  financials = (await client.get(`/api/projects/${project.id}/financials`)).body.financials;
  assert.equal(financials.captured, 3840);
  assert.equal(financials.certifiedGross, 3840);
  assert.equal(financials.writtenDown, 768);
  assert.equal(financials.billed, 3072);
  assert.equal(financials.realisation, 0.8);
  // Captured value is untouched by the write-down. That is the whole point:
  // the firm can still see what the work actually cost.
  assert.equal(financials.uncertifiedCaptured, 0);
});

test("an issued certificate is a statement, not a draft", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const { entry } = await logHour(client, project.id);
  const draft = await draftFor(client, project.id);
  await client.post(`/api/certificates/${draft.id}/lines-from-time`, {});
  await client.post(`/api/certificates/${draft.id}/issue`);

  for (const [path, body] of [
    [`/api/certificates/${draft.id}/lines`, { description: "Extra", amount: 100 }],
    [`/api/certificates/${draft.id}/lines-from-time`, {}],
    [`/api/certificates/${draft.id}/write-downs`, { amount: 10, reasonCode: "goodwill" }],
    [`/api/certificates/${draft.id}/issue`, {}],
  ]) {
    const res = await client.post(path, body);
    assert.equal(res.status, 409, path);
    assert.match(res.body.error, /issued/);
  }

  // And the hour underneath it cannot be withdrawn either. Unpicking a
  // document the client is holding is a credit, not a delete.
  const withdrawn = await client.del(`/api/time-entries/${entry.id}`);
  assert.equal(withdrawn.status, 409);
});

test("a fixed-fee schedule line is typed, and numbered in order", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const draft = await draftFor(client, project.id, {
    periodStart: "2026-03-01", periodEnd: "2026-03-31",
  });

  await client.post(`/api/certificates/${draft.id}/lines`, {
    description: "Phase 1: application lodged", amount: 18000, pct: 0.33, phaseRef: "1",
  });
  const { body } = await client.post(`/api/certificates/${draft.id}/lines`, {
    description: "Phase 2: advertising", amount: 9000, pct: 0.17, phaseRef: "2",
  });
  assert.deepEqual(body.certificate.lines.map((l) => l.seq), [1, 2]);
  assert.equal(body.certificate.lines[0].source, "schedule");
  assert.equal(body.certificate.subtotal, 27000);
  assert.equal(body.certificate.periodStart, "2026-03-01");
});

test("certificates are numbered per job, from one", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const other = await client.post("/api/register", { code: "P077", name: "Removal" });

  assert.equal((await draftFor(client, project.id)).seq, 1);
  assert.equal((await draftFor(client, project.id)).seq, 2);
  assert.equal((await draftFor(client, other.body.project.id)).seq, 1);

  const listed = await client.get(`/api/projects/${project.id}/certificates`);
  assert.deepEqual(listed.body.certificates.map((c) => c.seq), [1, 2]);
});

test("another firm cannot read or change a certificate", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const draft = await draftFor(client, project.id);
  const { client: stranger } = await signedUpAgent(baseUrl, { orgName: "Other Firm" });

  assert.equal((await stranger.get(`/api/certificates/${draft.id}`)).status, 404);
  assert.equal((await stranger.post(`/api/certificates/${draft.id}/issue`)).status, 404);
  assert.equal((await stranger.post(`/api/certificates/${draft.id}/write-downs`, {
    amount: 100, reasonCode: "goodwill",
  })).status, 404);
});
