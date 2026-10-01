// PERMISSIONS-PROPOSAL.md's two roles, proved the same way isolation.test.js
// proves org-scoping: through the HTTP surface, against a second real
// account, not by trusting the code that computes the gate.

import test from "node:test";
import assert from "node:assert/strict";
import {
  agent, firmWithRegisterProject, logHour, testServer,
} from "./helpers.js";

/** The owner invites a colleague and signs them in as their own session. */
async function inviteEmployee(baseUrl, owner) {
  const email = `employee-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const invited = await owner.post("/api/team", { email, password: "correct horse battery" });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const client = agent(baseUrl);
  const signedIn = await client.post("/api/auth/sign-in", { email, password: "correct horse battery" });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
  return { client, email, account: signedIn.body };
}

test("only an owner can add a team member", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const { client: employee } = await inviteEmployee(baseUrl, owner);

  const rejected = await employee.post("/api/team", {
    email: "second@example.com", password: "correct horse battery",
  });
  assert.equal(rejected.status, 403);

  const accepted = await owner.post("/api/team", {
    email: `third-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: "correct horse battery",
  });
  assert.equal(accepted.status, 201);
});

test("sign-in reports the role and the capabilities it implies", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const { account: employeeAccount } = await inviteEmployee(baseUrl, owner);

  assert.equal(employeeAccount.role, "employee");
  assert.deepEqual(employeeAccount.capabilities, {
    canEditWork: true,
    canViewHours: true,
    canViewBilled: false,
    canViewCost: false,
  });

  const ownerSession = await owner.get("/api/auth/session");
  assert.equal(ownerSession.body.role, "owner");
  assert.deepEqual(ownerSession.body.capabilities, {
    canEditWork: true,
    canViewHours: true,
    canViewBilled: true,
    canViewCost: true,
  });
});

test("an employee can add a task, log time, and edit a drawing", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await firmWithRegisterProject(baseUrl);
  const { client: employee } = await inviteEmployee(baseUrl, owner);

  const tasks = await employee.post(`/api/projects/${project.id}/tasks`, {
    description: "Site visit before submission",
  });
  assert.equal(tasks.status, 201, JSON.stringify(tasks.body));

  const entry = await employee.post("/api/time-entries", {
    projectId: project.id,
    date: "2026-03-02",
    start: "09:00",
    end: "10:00",
    minutes: 60,
    activityType: "Site visit",
    description: "Walked the boundary",
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));

  const phase = await employee.post(`/api/projects/${project.id}/phase`, {
    phaseRef: "Township establishment",
  });
  assert.equal(phase.status, 201, JSON.stringify(phase.body));
});

test("an employee sees hours and burn but not the fee, budget, or a certificate amount", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await firmWithRegisterProject(baseUrl, {
    budgetEstimate: 120000,
  });
  await logHour(owner, project.id);
  const certificate = (await owner.post(`/api/projects/${project.id}/certificates`, {})).body.certificate;
  await owner.post(`/api/certificates/${certificate.id}/lines`, {
    description: "First claim", amount: 5000,
  });

  const { client: employee } = await inviteEmployee(baseUrl, owner);

  const register = await employee.get(`/api/register/${project.id}`);
  assert.equal(register.status, 200);
  assert.equal(register.body.project.budgetEstimate, null);
  assert.equal(register.body.project.financials.quoted, null);
  assert.equal(register.body.project.financials.captured, null);
  // Burn is hours-tier, not billed-tier, and stays visible - matching the
  // proposal's "can_view_hours ... burn %" and the Mosaic Work Planner
  // precedent it cites.
  assert.notEqual(register.body.project.financials.burn, undefined);

  const financials = await employee.get(`/api/projects/${project.id}/financials`);
  assert.equal(financials.body.financials.billed, null);
  assert.equal(financials.body.financials.realisation, null);

  // Their own hour, because the owner's is not theirs to read at all - see "an
  // employee reads only their own time log". The gate is on the role, so the
  // money is hidden even on the row they typed themselves.
  await logHour(employee, project.id);
  const entries = await employee.get(`/api/time-entries?project=${project.id}`);
  assert.equal(entries.body.entries[0].capturedAmount, null);
  assert.equal(entries.body.entries[0].minutes, 60);

  const rateBands = (await employee.get("/api/practice/reference")).body.rateBands;
  assert.ok(rateBands.length > 0);
  assert.ok(rateBands.every((band) => band.hourlyRate === null));

  const certificates = await employee.get(`/api/projects/${project.id}/certificates`);
  assert.equal(certificates.body.certificates[0].subtotal, null);

  const fullCertificate = await employee.get(`/api/certificates/${certificate.id}`);
  assert.equal(fullCertificate.body.certificate.lines[0].amount, null);
  assert.equal(fullCertificate.body.certificate.total, null);
  // The line still exists and reads, just with no money on it - "hide, don't
  // disable" (PERMISSIONS-PROPOSAL.md §"web/practice/").
  assert.equal(fullCertificate.body.certificate.lines[0].description, "First claim");
});

test("an employee's task list carries no fee, and cannot put one on a task", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await firmWithRegisterProject(baseUrl);
  await owner.post(`/api/projects/${project.id}/tasks`, {
    description: "Compile the layout plan", defaultFee: 8000,
  });
  const { client: employee } = await inviteEmployee(baseUrl, owner);

  const tasks = await employee.get(`/api/projects/${project.id}/tasks`);
  assert.equal(tasks.status, 200, JSON.stringify(tasks.body));
  assert.ok(tasks.body.tasks.length > 0);
  assert.ok(tasks.body.tasks.every((task) => task.defaultFee === null));
  // The task itself still reads - only the money is gone.
  assert.ok(tasks.body.tasks.some((task) => task.description === "Compile the layout plan"));

  // A task fee feeds addScheduleLinesFromTasks, so accepting one here would let
  // a role that cannot see money decide some.
  const priced = await employee.post(`/api/projects/${project.id}/tasks`, {
    description: "Respond to the objection", defaultFee: 5000,
  });
  assert.equal(priced.status, 403, JSON.stringify(priced.body));

  const unpriced = await employee.post(`/api/projects/${project.id}/tasks`, {
    description: "Respond to the objection",
  });
  assert.equal(unpriced.status, 201, JSON.stringify(unpriced.body));
});

test("an employee reads only their own time log, whoever they ask for", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, account: ownerAccount, project } = await firmWithRegisterProject(baseUrl);
  await logHour(owner, project.id, { description: "The owner's own hour" });
  const { client: employee, account: employeeAccount } = await inviteEmployee(baseUrl, owner);
  await logHour(employee, project.id, { description: "The employee's own hour" });

  const ownEntries = await employee.get(`/api/time-entries?project=${project.id}`);
  assert.equal(ownEntries.status, 200);
  assert.deepEqual(
    ownEntries.body.entries.map((entry) => entry.description),
    ["The employee's own hour"],
  );

  // Naming the owner does not widen it. The money on a colleague's row is
  // already nulled; who spent how long on what is the timesheet itself.
  const asked = await employee.get(
    `/api/time-entries?project=${project.id}&person=${ownerAccount.userId}`,
  );
  assert.deepEqual(
    asked.body.entries.map((entry) => entry.description),
    ["The employee's own hour"],
  );

  // The owner still sees both, and can still filter by person for real.
  const all = await owner.get(`/api/time-entries?project=${project.id}`);
  assert.equal(all.body.entries.length, 2);
  const filtered = await owner.get(
    `/api/time-entries?project=${project.id}&person=${employeeAccount.userId}`,
  );
  assert.deepEqual(
    filtered.body.entries.map((entry) => entry.description),
    ["The employee's own hour"],
  );
});

test("only an owner logs time under somebody else's name, and only inside the firm", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, account: ownerAccount, project } = await firmWithRegisterProject(baseUrl);
  const { client: employee, account: employeeAccount } = await inviteEmployee(baseUrl, owner);

  // An immutable row under a name that never agreed to it.
  const spoofed = await employee.post("/api/time-entries", {
    projectId: project.id,
    userId: ownerAccount.userId,
    date: "2026-03-03",
    minutes: 60,
    activityType: "File work",
    description: "Logged as the owner",
  });
  assert.equal(spoofed.status, 403, JSON.stringify(spoofed.body));

  // The owner types up a handwritten day for somebody else - the flow the gate
  // exists to allow.
  const onBehalf = await owner.post("/api/time-entries", {
    projectId: project.id,
    userId: employeeAccount.userId,
    date: "2026-03-03",
    minutes: 60,
    activityType: "File work",
    description: "Read off the desk",
  });
  assert.equal(onBehalf.status, 201, JSON.stringify(onBehalf.body));
  assert.equal(onBehalf.body.entry.userEmail, employeeAccount.email);

  // A user in another firm is not a member here, so there is nobody of that id
  // to attribute an hour to.
  const { account: strangerAccount } = await firmWithRegisterProject(baseUrl, { code: "X001" });
  const crossOrg = await owner.post("/api/time-entries", {
    projectId: project.id,
    userId: strangerAccount.userId,
    date: "2026-03-03",
    minutes: 60,
    activityType: "File work",
    description: "Somebody else's staff",
  });
  assert.equal(crossOrg.status, 400, JSON.stringify(crossOrg.body));
});

test("an employee cannot create, bill, or issue a certificate, or record a write-down", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await firmWithRegisterProject(baseUrl);
  const certificate = (await owner.post(`/api/projects/${project.id}/certificates`, {})).body.certificate;
  const { client: employee } = await inviteEmployee(baseUrl, owner);

  const attempts = [
    ["POST", `/api/projects/${project.id}/certificates`, {}],
    ["POST", `/api/certificates/${certificate.id}/lines`, { description: "x", amount: 1 }],
    ["POST", `/api/certificates/${certificate.id}/write-downs`, { amount: 1, reasonCode: "goodwill" }],
    ["POST", `/api/certificates/${certificate.id}/issue`, {}],
    ["PUT", `/api/projects/${project.id}/fee-schedule`, { lines: [{ label: "x", quoted: 1 }] }],
  ];
  for (const [method, path, body] of attempts) {
    const res = await employee.request(method, path, { body });
    assert.equal(res.status, 403, `${method} ${path}: ${JSON.stringify(res.body)}`);
  }

  // The owner can still do every one of them - the gate is on the role, not
  // on the record.
  const issued = await owner.post(`/api/certificates/${certificate.id}/lines`, {
    description: "Owner's own claim", amount: 100,
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
});

test("a job an employee registers is built from the real template fees", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const { client: employee } = await inviteEmployee(baseUrl, owner);

  // Redaction is for what the employee reads, not for what the server copies:
  // a null-fee task list and a R0 quote would be stored, then invisible to the
  // one person who could notice.
  const created = await employee.post("/api/register", {
    code: "E001", name: "Employee-registered", clientName: "A client",
    typeCode: "TOWNSHIP establishment", billingBasis: "fixed_fee",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const asOwnerSchedule = await owner.get(`/api/projects/${created.body.project.id}/fee-schedule`);
  assert.equal(asOwnerSchedule.status, 200, JSON.stringify(asOwnerSchedule.body));
  assert.ok(asOwnerSchedule.body.feeSchedule.quoted > 0, "quote must not be R0");
  const asOwnerTasks = await owner.get(`/api/projects/${created.body.project.id}/tasks`);
  assert.ok(asOwnerTasks.body.tasks.some((task) => task.defaultFee > 0));
});
