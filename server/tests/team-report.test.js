// The team report: pure figures first, then the owner-only HTTP surface.

import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamReport, weekdaysBetween } from "../src/team-report.js";
import { agent, firmWithRegisterProject, logHour, testServer } from "./helpers.js";

const members = [
  { userId: "u1", email: "ann@example.com", role: "owner" },
  { userId: "u2", email: "bob@example.com", role: "employee" },
  { userId: "u3", email: "cy@example.com", role: "employee" },
];

const entry = (over = {}) => ({
  projectId: "p1", projectCode: "D063", projectName: "Bon Accord",
  userId: "u1", userEmail: "ann@example.com",
  date: "2026-03-02", minutes: 60, activityType: "File work",
  description: "Drafting the layout plan", capturedAmount: 1920,
  createdDate: "2026-03-02", onCertificate: false, billedOnIssued: false,
  ...over,
});

test("weekdays skip weekends", () => {
  assert.equal(weekdaysBetween("2026-03-02", "2026-03-08").length, 5);
  assert.equal(weekdaysBetween("2026-03-07", "2026-03-08").length, 0);
});

test("utilisation is hours over an 8-hour weekday, clamped to today", () => {
  const report = buildTeamReport({
    members, from: "2026-03-02", to: "2026-03-31", today: "2026-03-06",
    entries: [entry({ minutes: 20 * 60 })],
  });
  assert.equal(report.period.weekdays, 5);
  assert.equal(report.period.standardHours, 40);
  const ann = report.people.find((p) => p.userId === "u1");
  assert.equal(ann.utilisation, 0.5);
  assert.equal(ann.daysMissing, 4);
});

test("idle people are listed, and pull firm utilisation down", () => {
  const report = buildTeamReport({
    members, from: "2026-03-02", to: "2026-03-06", today: "2026-03-06",
    entries: [entry({ minutes: 40 * 60 })],
  });
  assert.equal(report.people.length, 3);
  const cy = report.people.find((p) => p.userId === "u3");
  assert.equal(cy.entries, 0);
  assert.equal(cy.utilisation, 0);
  assert.equal(report.firm.activePeople, 1);
  assert.equal(report.firm.utilisation, 0.333);
});

test("internal time is not billable share, and captured reconciles to the rows", () => {
  const report = buildTeamReport({
    members, from: "2026-03-02", to: "2026-03-06", today: "2026-03-06",
    entries: [
      entry({ minutes: 180, capturedAmount: 5760 }),
      entry({ minutes: 60, activityType: "Admin", capturedAmount: 1920, projectId: "p2", projectCode: "D064" }),
    ],
  });
  const ann = report.people[0];
  assert.equal(ann.billablePct, 0.75);
  assert.equal(ann.captured, 7680);
  assert.equal(ann.capturedPerHour, 1920);
  assert.equal(ann.projectCount, 2);
  assert.equal(ann.topProject.code, "D063");
  assert.equal(report.projects.reduce((s, j) => s + j.captured, 0), 7680);
});

test("billed, unbilled and stale unbilled are kept apart", () => {
  const report = buildTeamReport({
    members, from: "2026-01-01", to: "2026-03-06", today: "2026-03-06",
    entries: [
      entry({ date: "2026-03-02", capturedAmount: 100, onCertificate: true, billedOnIssued: true }),
      entry({ date: "2026-03-03", capturedAmount: 200, onCertificate: true }),
      entry({ date: "2026-03-04", capturedAmount: 400 }),
      entry({ date: "2026-01-05", capturedAmount: 800, createdDate: "2026-01-05" }),
    ],
  });
  const ann = report.people[0];
  assert.equal(ann.billed, 100);
  assert.equal(ann.unbilled, 1400);
  assert.equal(ann.staleUnbilled, 800);
  assert.equal(ann.billedPct, 0.067);
});

test("weekend, late and thin entries are flagged", () => {
  const report = buildTeamReport({
    members, from: "2026-03-02", to: "2026-03-09", today: "2026-03-09",
    entries: [
      entry({ date: "2026-03-07", minutes: 120, createdDate: "2026-03-07" }),
      entry({ description: "misc", createdDate: "2026-03-09" }),
    ],
  });
  const ann = report.people[0];
  assert.equal(ann.weekendHours, 2);
  assert.equal(ann.thinEntries, 1);
  assert.equal(ann.lateEntries, 1);
});

async function employeeOf(baseUrl, owner) {
  const email = `employee-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await owner.post("/api/team", { email, password: "correct horse battery" });
  const client = agent(baseUrl);
  await client.post("/api/auth/sign-in", { email, password: "correct horse battery" });
  return { client, email };
}

test("an owner reads the team report; it reconciles to the time logged", async () => {
  const { baseUrl } = await testServer();
  const { client: owner, project } = await firmWithRegisterProject(baseUrl);
  await logHour(owner, project.id);
  await logHour(owner, project.id, { activityType: "Admin", description: "Filing the month's invoices" });
  const { client: staff } = await employeeOf(baseUrl, owner);
  await logHour(staff, project.id, { description: "Setting out the erf boundaries" });

  const res = await owner.get("/api/team/report?from=2026-03-01&to=2026-03-31");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { report } = res.body;
  assert.equal(report.people.length, 2);
  assert.equal(report.firm.hours, 3);
  assert.equal(report.firm.captured, 5760);
  assert.equal(report.projects.length, 1);
  assert.equal(report.projects[0].people.length, 2);
});

test("an employee cannot read the team report", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  const { client: staff } = await employeeOf(baseUrl, owner);
  assert.equal((await staff.get("/api/team/report")).status, 403);
});

test("bad dates are refused", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await firmWithRegisterProject(baseUrl);
  assert.equal((await owner.get("/api/team/report?from=yesterday")).status, 400);
  assert.equal((await owner.get("/api/team/report?from=2026-04-01&to=2026-03-01")).status, 400);
});
