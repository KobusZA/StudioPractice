// The permission level picked on the Team page: chosen when a teammate is
// added, changeable later by an owner, never by the teammate, never on self.

import test from "node:test";
import assert from "node:assert/strict";
import { agent, firmWithRegisterProject, testServer } from "./helpers.js";

const PASSWORD = "correct horse battery";
const uniqueEmail = (tag) => `${tag}-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function signIn(baseUrl, email) {
  const client = agent(baseUrl);
  const res = await client.post("/api/auth/sign-in", { email, password: PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { client, account: res.body };
}

test("a new teammate defaults to employee when no role is given", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const email = uniqueEmail("default");

  const res = await owner.post("/api/team", { email, password: PASSWORD });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.member.role, "employee");
});

test("an owner can add a teammate as an owner, who then has full capabilities", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const email = uniqueEmail("coowner");

  const res = await owner.post("/api/team", { email, password: PASSWORD, role: "owner" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.member.role, "owner");

  const { account } = await signIn(baseUrl, email);
  assert.equal(account.role, "owner");
  assert.equal(account.capabilities.canViewBilled, true);
});

test("an unknown role is rejected when adding a teammate", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);

  const res = await owner.post("/api/team", {
    email: uniqueEmail("bogus"), password: PASSWORD, role: "superuser",
  });
  assert.equal(res.status, 400);
});

test("an owner can change a teammate's role, and the change takes effect", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const email = uniqueEmail("promote");
  const invited = await owner.post("/api/team", { email, password: PASSWORD });
  const { userId } = invited.body.member;
  const { client: teammate } = await signIn(baseUrl, email);

  assert.equal((await teammate.get("/api/team/roster")).status, 403);

  const promoted = await owner.patch(`/api/team/${userId}`, { role: "owner" });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal(promoted.body.members.find((m) => m.userId === userId).role, "owner");
  assert.equal((await teammate.get("/api/team/roster")).status, 200);

  const demoted = await owner.patch(`/api/team/${userId}`, { role: "employee" });
  assert.equal(demoted.status, 200);
  assert.equal(demoted.body.members.find((m) => m.userId === userId).role, "employee");
  assert.equal((await teammate.get("/api/team/roster")).status, 403);
});

test("an unknown role is rejected when editing a teammate", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const invited = await owner.post("/api/team", { email: uniqueEmail("edit"), password: PASSWORD });

  const res = await owner.patch(`/api/team/${invited.body.member.userId}`, { role: "superuser" });
  assert.equal(res.status, 400);
});

test("nobody can change their own role, so a firm always keeps an owner", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const me = (await owner.get("/api/team/roster")).body.members.find((m) => m.isYou);

  const res = await owner.patch(`/api/team/${me.userId}`, { role: "employee" });
  assert.equal(res.status, 400);
});

test("an employee cannot change anyone's role, including their own", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const email = uniqueEmail("sneaky");
  const invited = await owner.post("/api/team", { email, password: PASSWORD });
  const { client: employee } = await signIn(baseUrl, email);

  const res = await employee.patch(`/api/team/${invited.body.member.userId}`, { role: "owner" });
  assert.equal(res.status, 403);

  const roster = (await owner.get("/api/team/roster")).body.members;
  assert.equal(roster.find((m) => m.userId === invited.body.member.userId).role, "employee");
});
