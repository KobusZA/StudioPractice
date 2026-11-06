// The operator site. A firm owner already manages their own people; this is
// the view across firms, and the proof that a firm login cannot take it.

import test from "node:test";
import assert from "node:assert/strict";
import { agent, firmWithRegisterProject, signedUpAgent, testDoc, testServer } from "./helpers.js";

const PASSWORD = "correct horse battery";
// One server for the file. The set is the same object createApi closes over,
// so a test can add an email and the next sign-in promotes it. A fresh set
// per test would be ignored: testServer() only builds the API once.
const allow = new Set();
const { baseUrl } = await testServer({ platformAdminEmails: allow });

test("a firm owner cannot list companies", async () => {
  const { client } = await signedUpAgent(baseUrl);
  const res = await client.get("/api/admin/companies");
  assert.equal(res.status, 403);
});

test("a signed-out request cannot list companies", async () => {
  const res = await agent(baseUrl).get("/api/admin/companies");
  assert.equal(res.status, 401);
});

test("a platform administrator sees every company and its live job count", async () => {
  const first = await firmWithRegisterProject(baseUrl, { code: "D063" });
  const second = await signedUpAgent(baseUrl, { orgName: "Quiet Firm" });
  allow.add(first.account.email);

  const admin = agent(baseUrl);
  const signedIn = await admin.post("/api/auth/sign-in", {
    email: first.account.email,
    password: PASSWORD,
  });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.platformAdmin, true);

  const list = await admin.get("/api/admin/companies");
  assert.equal(list.status, 200);
  const byId = new Map(list.body.companies.map((company) => [company.id, company]));
  assert.equal(byId.get(first.account.orgId).jobCount, 1);
  assert.equal(byId.get(first.account.orgId).name, first.account.orgName);
  assert.equal(byId.get(second.account.orgId).jobCount, 0);
  assert.equal(byId.get(second.account.orgId).memberCount, 1);

  const detail = await admin.get(`/api/admin/companies/${first.account.orgId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.company.jobs.length, 1);
  assert.equal(detail.body.company.jobs[0].code, "D063");
  assert.equal(detail.body.company.jobs[0].clientName, "Bon Accord Trust");
  // The register job was created with a budget. That figure is the firm's.
  const dumped = JSON.stringify(detail.body);
  assert.equal(dumped.includes("budget"), false);
  assert.equal(dumped.includes("120000"), false);
});

test("a person can belong to more than one company and work in one at a time", async () => {
  const host = await signedUpAgent(baseUrl, { orgName: "Host Firm" });
  const other = await signedUpAgent(baseUrl, { orgName: "Other Firm" });
  allow.add(host.account.email);

  const admin = agent(baseUrl);
  await admin.post("/api/auth/sign-in", { email: host.account.email, password: PASSWORD });

  const email = `new.${Date.now()}@example.com`;
  const granted = await admin.post(`/api/admin/companies/${host.account.orgId}/members`, {
    email,
    password: "a fresh password",
    role: "employee",
  });
  assert.equal(granted.status, 201);
  assert.equal(granted.body.member.role, "employee");

  const newbie = agent(baseUrl);
  const session = await newbie.post("/api/auth/sign-in", {
    email,
    password: "a fresh password",
  });
  assert.equal(session.status, 200);
  assert.equal(session.body.orgId, host.account.orgId);
  assert.equal(session.body.role, "employee");
  assert.equal(session.body.platformAdmin, false);
  assert.equal(session.body.companies.length, 1);
  const companies = await newbie.get("/api/admin/companies");
  assert.equal(companies.status, 403);

  await host.client.post("/api/projects", { name: "Host job", doc: testDoc() });
  await other.client.post("/api/projects", { name: "Other job", doc: testDoc() });

  const also = await admin.post(`/api/admin/companies/${host.account.orgId}/members`, {
    email: other.email,
    role: "employee",
  });
  assert.equal(also.status, 201);

  const stillThere = await other.client.get("/api/auth/session");
  assert.equal(stillThere.body.orgId, other.account.orgId);
  assert.equal(stillThere.body.companies.length, 2);
  const listedBefore = await other.client.get("/api/projects");
  assert.deepEqual(listedBefore.body.projects.map((project) => project.name), ["Other job"]);

  const moved = await other.client.post("/api/auth/company", { orgId: host.account.orgId });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.orgId, host.account.orgId);
  assert.equal(moved.body.role, "employee");
  const listedAfter = await other.client.get("/api/projects");
  assert.deepEqual(listedAfter.body.projects.map((project) => project.name), ["Host job"]);

  const back = await other.client.post("/api/auth/company", { orgId: other.account.orgId });
  assert.equal(back.status, 200);
  assert.equal(back.body.role, "owner");
  const home = await other.client.get("/api/projects");
  assert.deepEqual(home.body.projects.map((project) => project.name), ["Other job"]);

  const refused = await other.client.post("/api/auth/company", { orgId: "org_nobody" });
  assert.equal(refused.status, 403);

  // An owner can attach someone who already belongs to another firm. No new password.
  const fromOwner = await other.client.post("/api/team", { email: host.account.email, role: "employee" });
  assert.equal(fromOwner.status, 201, JSON.stringify(fromOwner.body));
  const hostSession = await host.client.get("/api/auth/session");
  assert.equal(hostSession.body.companies.length, 2);
  assert.equal(hostSession.body.orgId, host.account.orgId);

  const again = await admin.post(`/api/admin/companies/${host.account.orgId}/members`, {
    email,
    password: "a fresh password",
    role: "employee",
  });
  assert.equal(again.status, 409);
});

test("the last owner of a company cannot be removed or demoted", async () => {
  const { account } = await signedUpAgent(baseUrl, { orgName: "Solo Firm" });
  allow.add(account.email);
  const admin = agent(baseUrl);
  const signedIn = await admin.post("/api/auth/sign-in", {
    email: account.email,
    password: PASSWORD,
  });

  const demote = await admin.patch(
    `/api/admin/companies/${account.orgId}/members/${signedIn.body.userId}`,
    { role: "employee" },
  );
  assert.equal(demote.status, 400);

  const removed = await admin.del(
    `/api/admin/companies/${account.orgId}/members/${signedIn.body.userId}`,
  );
  assert.equal(removed.status, 400);

  const detail = await admin.get(`/api/admin/companies/${account.orgId}`);
  assert.equal(detail.body.company.members.length, 1);
  assert.equal(detail.body.company.members[0].role, "owner");
});

test("revoking access signs that person out of the firm", async () => {
  const { account } = await signedUpAgent(baseUrl, { orgName: "Host Firm" });
  allow.add(account.email);
  const admin = agent(baseUrl);
  await admin.post("/api/auth/sign-in", { email: account.email, password: PASSWORD });

  const email = `leaving.${Date.now()}@example.com`;
  const granted = await admin.post(`/api/admin/companies/${account.orgId}/members`, {
    email,
    password: "a fresh password",
    role: "employee",
  });
  const member = agent(baseUrl);
  await member.post("/api/auth/sign-in", { email, password: "a fresh password" });

  const revoked = await admin.del(
    `/api/admin/companies/${account.orgId}/members/${granted.body.member.userId}`,
  );
  assert.equal(revoked.status, 200);

  const session = await member.get("/api/auth/session");
  assert.equal(session.body.signedIn, false);
  const register = await member.get("/api/register");
  assert.equal(register.status, 401);
});

test("a platform administrator can open a job in a company they do not belong to", async () => {
  const home = await signedUpAgent(baseUrl, { orgName: "Operator Firm" });
  const other = await firmWithRegisterProject(baseUrl, { code: "P074", name: "Pretorius" });
  allow.add(home.account.email);

  const admin = agent(baseUrl);
  await admin.post("/api/auth/sign-in", { email: home.account.email, password: PASSWORD });

  const refused = await other.client.post(
    `/api/admin/companies/${other.account.orgId}/jobs/${other.project.id}/open`,
  );
  assert.equal(refused.status, 403);

  const missing = await admin.post(
    `/api/admin/companies/${other.account.orgId}/jobs/prj_missing/open`,
  );
  assert.equal(missing.status, 404);
  const unmoved = await admin.get("/api/auth/session");
  assert.equal(unmoved.body.orgId, home.account.orgId);
  assert.equal(unmoved.body.visiting, false);

  const opened = await admin.post(
    `/api/admin/companies/${other.account.orgId}/jobs/${other.project.id}/open`,
  );
  assert.equal(opened.status, 200);
  assert.equal(opened.body.orgId, other.account.orgId);
  assert.equal(opened.body.orgName, other.account.orgName);
  assert.equal(opened.body.role, "owner");
  assert.equal(opened.body.visiting, true);
  assert.equal(opened.body.companies.some((company) => company.orgId === other.account.orgId), false);

  const register = await admin.get("/api/register");
  assert.equal(register.status, 200);
  assert.deepEqual(register.body.projects.map((project) => project.id), [other.project.id]);

  const detail = await admin.get(`/api/admin/companies/${other.account.orgId}`);
  assert.equal(detail.body.company.members.some((member) => member.email === home.account.email), false);

  const back = await admin.post("/api/auth/company", { orgId: home.account.orgId });
  assert.equal(back.status, 200);
  assert.equal(back.body.orgId, home.account.orgId);
  assert.equal(back.body.visiting, false);
  const homeRegister = await admin.get("/api/register");
  assert.deepEqual(homeRegister.body.projects.map((project) => project.id), []);
});
