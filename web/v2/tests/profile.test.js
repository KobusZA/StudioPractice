import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accountCard,
  displayNameFromEmail,
  formatDuration,
  initialsFromName,
  practiceAddress,
  simulatedLicense,
} from "../profile.js";

test("a dotted local-part becomes a two-word name and two initials", () => {
  assert.equal(displayNameFromEmail("jane.builder@acme.co.za"), "Jane Builder");
  assert.equal(initialsFromName("Jane Builder"), "JB");
});

test("the same firm always gets the same practice address", () => {
  const a = practiceAddress("org_abc", "Acme Builders");
  const b = practiceAddress("org_abc", "Acme Builders");
  assert.deepEqual(a, b);
  assert.match(a.lines.join("\n"), /South Africa/);
});

test("licence remaining is the time until the next membership anniversary", () => {
  const memberSince = "2025-03-18T00:00:00.000Z";
  const now = Date.parse("2026-09-18T00:00:00.000Z");
  const license = simulatedLicense({ memberSince, role: "owner" }, now);
  assert.equal(license.level, "Studio");
  assert.equal(license.seatsIncluded, 5);
  assert.ok(license.remainingMs > 0);
  assert.ok(Date.parse(license.renewsAt) > now);
});

test("durations read as days, then months, then years", () => {
  assert.equal(formatDuration(0), "today");
  assert.equal(formatDuration(3 * 24 * 60 * 60 * 1000), "3 days");
  assert.equal(formatDuration(90 * 24 * 60 * 60 * 1000), "3 months");
});

test("the account card carries the live job count, not a placeholder", () => {
  const card = accountCard(
    {
      email: "lee.naude@studio.test",
      orgName: "Naude & Co",
      orgId: "org1",
      role: "owner",
      memberSince: "2026-01-01T00:00:00.000Z",
    },
    { jobCount: 4, now: Date.parse("2026-09-18T00:00:00.000Z") },
  );
  assert.equal(card.name, "Lee Naude");
  assert.equal(card.jobCount, 4);
  assert.equal(card.orgName, "Naude & Co");
  assert.equal(card.license.level, "Studio");
});
