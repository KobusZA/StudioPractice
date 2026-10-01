// The firm's letterhead: owner-only, empty until typed, and never guessed at.

import test from "node:test";
import assert from "node:assert/strict";
import { agent, firmWithRegisterProject, testServer } from "./helpers.js";

async function employeeOf(baseUrl, owner) {
  const email = `employee-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await owner.post("/api/team", { email, password: "correct horse battery" });
  const client = agent(baseUrl);
  await client.post("/api/auth/sign-in", { email, password: "correct horse battery" });
  return client;
}

test("a new firm has a blank letterhead: nothing is seeded", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const { status, body } = await owner.get("/api/org/settings");
  assert.equal(status, 200);
  assert.equal(body.settings.vatNumber, null);
  assert.equal(body.settings.bankAccountNo, null);
  assert.equal(body.settings.tradingName, null);
  assert.ok(body.settings.orgName, "the sign-up name is offered as the fallback");
});

test("an owner saves the letterhead; a blank clears a field; absent keys stay", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const saved = await owner.put("/api/org/settings", {
    tradingName: "  Example Practice Pty Ltd ",
    addressLines: "1 Test Road\nTest Park\nPretoria",
    vatNumber: "4000000000", bankName: "Test Bank", bankAccountNo: "123 456",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.settings.tradingName, "Example Practice Pty Ltd");
  assert.equal(saved.body.settings.addressLines, "1 Test Road\nTest Park\nPretoria");

  const cleared = await owner.put("/api/org/settings", { vatNumber: "" });
  assert.equal(cleared.body.settings.vatNumber, null);
  assert.equal(cleared.body.settings.bankName, "Test Bank");
});

test("an unknown setting is refused, not silently ignored", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const res = await owner.put("/api/org/settings", { favouriteColour: "copper" });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test("an employee can neither read nor write the letterhead", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  await owner.put("/api/org/settings", { bankAccountNo: "999" });
  const employee = await employeeOf(baseUrl, owner);
  assert.equal((await employee.get("/api/org/settings")).status, 403);
  assert.equal((await employee.put("/api/org/settings", { bankAccountNo: "1" })).status, 403);
  assert.equal((await owner.get("/api/org/settings")).body.settings.bankAccountNo, "999");
});
