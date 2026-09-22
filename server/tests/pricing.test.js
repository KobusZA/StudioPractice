// The arithmetic, with no Postgres in sight. Everything here is a claim about
// the workbook's own formulas, so the numbers in the assertions are the
// numbers in the spreadsheet rather than round ones chosen to make the test
// read nicely.

import test from "node:test";
import assert from "node:assert/strict";
import {
  bandAmount, certificateUnits, linearAmount, minutesBetween, priceEntry, tier1920,
} from "../src/pricing.js";

test("the linear column is minutes times R32", () => {
  assert.equal(linearAmount(0), 0);
  assert.equal(linearAmount(1), 32);
  assert.equal(linearAmount(7), 224);
  assert.equal(linearAmount(60), 1920);
  assert.equal(linearAmount(455), 14560);
});

test("the ladder charges a started quarter-hour in full", () => {
  assert.equal(tier1920(0), 0);
  assert.equal(tier1920(1), 480);
  assert.equal(tier1920(15), 480);
  assert.equal(tier1920(16), 960);
  assert.equal(tier1920(45), 1440);
  assert.equal(tier1920(60), 1920);
  // Past an hour: whole hours at R1 920 plus the ladder on the remainder.
  assert.equal(tier1920(61), 2400);
  assert.equal(tier1920(75), 2400);
  assert.equal(tier1920(135), 4320);
});

test("the two columns are the same rate and differ only in rounding", () => {
  // Worth asserting rather than assuming: the workbook looks like it prices
  // the same minute two different ways, and anybody reading it is one step
  // from "fixing" one of them. They agree exactly on the quarter hour.
  for (const minutes of [0, 15, 30, 45, 60, 120, 375]) {
    assert.equal(tier1920(minutes), linearAmount(minutes), `${minutes} minutes`);
  }
  // And off it, the ladder is never cheaper.
  for (const minutes of [1, 7, 16, 44, 61, 119]) {
    assert.ok(tier1920(minutes) > linearAmount(minutes), `${minutes} minutes`);
  }
});

test("a fee-template band prices by its hourly rate", () => {
  assert.equal(bandAmount(60, 3600), 3600);
  assert.equal(bandAmount(30, 3100), 1550);
  assert.equal(bandAmount(20, 1900), 633.33);
  assert.equal(bandAmount(0, 2300), 0);
});

test("certificate units round money up to the next quarter hour", () => {
  assert.equal(certificateUnits(0), 0);
  assert.equal(certificateUnits(1), 0.25);
  assert.equal(certificateUnits(480), 0.25);
  assert.equal(certificateUnits(481), 0.5);
  assert.equal(certificateUnits(1920), 1);
  assert.equal(certificateUnits(2400), 1.25);
});

test("a line never shows less time than it charged for", () => {
  for (const minutes of [1, 15, 16, 47, 60, 61, 190]) {
    const amount = tier1920(minutes);
    assert.ok(certificateUnits(amount) * 60 >= minutes, `${minutes} minutes`);
  }
});

test("priceEntry reports the rate it used, not just the total", () => {
  assert.deepEqual(priceEntry({ minutes: 60, rule: "tier_1920" }),
    { capturedAmount: 1920, rateApplied: 1920 });
  assert.deepEqual(priceEntry({ minutes: 7, rule: "linear_32" }),
    { capturedAmount: 224, rateApplied: 1920 });
  assert.deepEqual(priceEntry({ minutes: 60, rule: "band_hourly", hourlyRate: 3600 }),
    { capturedAmount: 3600, rateApplied: 3600 });
});

test("an unusable rule or duration is refused rather than priced at zero", () => {
  assert.throws(() => priceEntry({ minutes: 60, rule: "whatever" }), /unknown pricing rule/);
  assert.throws(() => priceEntry({ minutes: 60, rule: "band_hourly" }), /hourlyRate/);
  assert.throws(() => tier1920(-1), RangeError);
  assert.throws(() => tier1920(1.5), RangeError);
  assert.throws(() => linearAmount("an hour"), RangeError);
});

test("a duration with no end time is null, not a guess", () => {
  assert.equal(minutesBetween("09:00", "10:30"), 90);
  assert.equal(minutesBetween("9:00", "09:20"), 20);
  assert.equal(minutesBetween("08:15:00", "08:30:00"), 15);
  // The source workbook is full of rows where somebody never clocked off.
  // Inventing a duration for those invents captured value.
  assert.equal(minutesBetween("09:00", null), null);
  assert.equal(minutesBetween("09:00", ""), null);
  assert.equal(minutesBetween("10:00", "09:00"), null);
  assert.equal(minutesBetween("25:00", "26:00"), null);
});
