// Captured value, and the claim that it is immutable.
//
// This is the decision the spreadsheet got wrong and the one the customer
// actually asked for: there, an hour that could not be billed was handled by
// typing a smaller number over the original, which destroys the only evidence
// that the work took longer than it was worth. Here the row stands.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { firmWithRegisterProject, logHour, signedUpAgent, testServer } from "./helpers.js";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("an entry is priced once, by the rule named on the row", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);

  const { entry } = await logHour(client, project.id, { minutes: 47 });
  // 47 minutes is four started quarter-hours: R1 920, not R1 504.
  assert.equal(entry.capturedAmount, 1920);
  assert.equal(entry.pricingRule, "tier_1920");
  assert.equal(entry.rateApplied, 1920);

  const listed = await client.get(`/api/time-entries?project=${project.id}`);
  assert.equal(listed.body.entries[0].capturedAmount, 1920);
});

test("the linear rule is available and recorded as the one that applied", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const { entry } = await logHour(client, project.id, {
    minutes: 47, pricingRule: "linear_32",
  });
  // The same 47 minutes, the firm's other formula, a different number. Both
  // are theirs; which one applied is a fact about the entry.
  assert.equal(entry.capturedAmount, 1504);
  assert.equal(entry.pricingRule, "linear_32");
});

test("a band rate is read from the firm's own table", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const { entry } = await logHour(client, project.id, {
    minutes: 60, pricingRule: "band_hourly", rateBandCode: "A1",
  });
  assert.equal(entry.capturedAmount, 3600);
  assert.equal(entry.rateBandCode, "A1");
  assert.equal(entry.rateApplied, 3600);
});

test("no statement in src/ updates a captured amount", async () => {
  // The structural half of the claim, asserted the way the no-DELETE-FROM rule
  // is: there is no store method that edits captured value, and this is what
  // stops one being added by accident.
  const files = await readdir(SRC_DIR);
  for (const file of files.filter((f) => f.endsWith(".js"))) {
    const source = await readFile(join(SRC_DIR, file), "utf8");
    const updates = source.match(/update\s+time_entry[\s\S]*?(?=\n\s*`|\n\s*\)|;)/gi) || [];
    for (const statement of updates) {
      assert.equal(
        /captured_amount\s*=|minutes\s*=|rate_applied\s*=|pricing_rule\s*=/i.test(statement),
        false,
        `${file} re-prices a time entry:\n${statement}`,
      );
    }
  }
});

test("a wrong entry is withdrawn, not edited, and the sum drops it", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const { entry: keep } = await logHour(client, project.id);
  const { entry: mistake } = await logHour(client, project.id, {
    minutes: 480, description: "Typed 8 hours by mistake",
  });

  let financials = (await client.get(`/api/projects/${project.id}/financials`)).body.financials;
  assert.equal(financials.captured, 1920 + 15360);

  assert.equal((await client.del(`/api/time-entries/${mistake.id}`)).status, 200);
  financials = (await client.get(`/api/projects/${project.id}/financials`)).body.financials;
  assert.equal(financials.captured, 1920);

  const listed = await client.get(`/api/time-entries?project=${project.id}`);
  assert.deepEqual(listed.body.entries.map((e) => e.id), [keep.id]);
  // Withdrawing twice is a 404, not a second timestamp.
  assert.equal((await client.del(`/api/time-entries/${mistake.id}`)).status, 404);
});

test("logging time answers with the burn it just caused", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, {
    budgetEstimate: 5000,
  });

  // The warning that matters is the one at the keyboard, while the row is
  // being typed - not the one on a page somebody opens at month end.
  const first = await logHour(client, project.id);
  assert.equal(first.financials.captured, 1920);
  assert.equal(first.financials.burn, 0.384);

  const second = await logHour(client, project.id, { minutes: 120 });
  assert.equal(second.financials.captured, 1920 + 3840);
  assert.equal(second.financials.burn, 1.152);
  // Over the quote, and the number says so rather than clamping at 100%.
  assert.ok(second.financials.burn > 1);
});

test("rows the workbook would have hidden are counted instead", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  await logHour(client, project.id);
  await logHour(client, project.id, {
    start: "14:00", end: null, minutes: 0, description: "Never clocked off",
  });

  const { financials } = (await client.get(`/api/projects/${project.id}/financials`)).body;
  assert.equal(financials.brokenRows, 1);
  assert.equal(financials.captured, 1920);
});

test("a duration typed without clock times is not a broken row", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  // Most of a day gets recorded after the fact, with no start and no end.
  // Flagging that would put a warning on the normal case, and a warning on
  // the normal case teaches everybody to ignore the warnings.
  await logHour(client, project.id, { start: null, end: null, minutes: 90 });

  const { financials } = (await client.get(`/api/projects/${project.id}/financials`)).body;
  assert.equal(financials.brokenRows, 0);
  assert.equal(financials.captured, 2880);
});

test("time captured but never certified is reported as such", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  await logHour(client, project.id);
  await logHour(client, project.id, { minutes: 30 });

  const { financials } = (await client.get(`/api/projects/${project.id}/financials`)).body;
  // Hours nobody ever put on a document. In the workbook this was invisible,
  // because the invoice was hand-compiled from whichever rows were noticed.
  assert.equal(financials.uncertifiedCaptured, 1920 + 960);
  assert.equal(financials.certifiedGross, 0);
});

test("an entry that is not a record is refused", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const attempts = [
    [{ description: "" }, /description is required/],
    [{ activityType: "" }, /activity type is required/],
    [{ minutes: -5 }, /minutes/],
    [{ minutes: 12.5 }, /minutes/],
    [{ pricingRule: "band_hourly", rateBandCode: "Z9" }, /rate band/],
  ];
  for (const [override, expected] of attempts) {
    const res = await client.post("/api/time-entries", {
      projectId: project.id, date: "2026-03-02", minutes: 60,
      activityType: "File work", description: "Work", ...override,
    });
    assert.equal(res.status, 400, JSON.stringify(override));
    assert.match(res.body.error, expected);
  }
});

test("the timesheet is one log for the practice, filtered", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const other = await client.post("/api/register", { code: "J065", name: "Consent use" });
  await logHour(client, project.id, { date: "2026-03-02" });
  await logHour(client, other.body.project.id, { date: "2026-04-10" });

  // The workbook kept seven sheets, most of them veryHidden, which is why
  // nobody could answer "what did this job cost" without opening all of them.
  assert.equal((await client.get("/api/time-entries")).body.entries.length, 2);
  assert.equal(
    (await client.get(`/api/time-entries?project=${project.id}`)).body.entries.length, 1,
  );
  assert.equal(
    (await client.get("/api/time-entries?from=2026-04-01&to=2026-04-30")).body.entries.length, 1,
  );
  // A calendar date stays a calendar date, with no zone attached on the way out.
  assert.equal((await client.get("/api/time-entries")).body.entries[0].date, "2026-04-10");
});

test("another firm cannot log time against a job it cannot see", async () => {
  const { baseUrl } = await testServer();
  const { project } = await firmWithRegisterProject(baseUrl);
  const { client: stranger } = await signedUpAgent(baseUrl, { orgName: "Other Firm" });
  const res = await stranger.post("/api/time-entries", {
    projectId: project.id, date: "2026-03-02", minutes: 60,
    activityType: "File work", description: "Not mine",
  });
  assert.equal(res.status, 404);
});
