// What a minute is worth. Ported from the workbook's formulas and its invoice
// macro, in spirit rather than in kind - see .cursor/skills/practice-ops/source-map.md.
//
// The workbook prices the same minute three ways and does not reconcile them:
// a linear column, a quarter-hour ladder, and four hourly bands in the fee
// templates. That is not a bug to fix. Which rule applied is a fact about the
// entry, so it is stored on the row with the rate it used, and this module
// only ever computes - it never decides which rule the firm should have used.
//
// Pure, and deliberately free of any database import, so the arithmetic can be
// tested without Postgres running.

/** Cents, not floats-that-look-like-money. */
export function toCents(amount) {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

export const PRICING_RULES = ["linear_32", "tier_1920", "band_hourly"];

/** The workbook's linear column: minutes times R32. R1 920 an hour. */
export function linearAmount(minutes) {
  return toCents(requireMinutes(minutes) * 32);
}

/**
 * The workbook's quarter-hour ladder: R480, R960, R1 440, R1 920, and past an
 * hour, whole hours at R1 920 plus the same ladder on the remainder.
 *
 * Written closed-form because it is one: R480 per started quarter-hour is the
 * ladder, and `hours * 1920` is four of those. The two columns therefore price
 * the same hourly rate and differ only in rounding up to the next quarter,
 * which is worth knowing before anyone tries to "reconcile" them.
 */
export function tier1920(minutes) {
  return toCents(Math.ceil(requireMinutes(minutes) / 15) * 480);
}

/** A fee-template band (A1 principal, A2 professional, B technical, C other). */
export function bandAmount(minutes, hourlyRate) {
  const rate = Number(hourlyRate);
  if (!Number.isFinite(rate) || rate < 0) throw new RangeError("hourlyRate must be a number >= 0");
  return toCents((requireMinutes(minutes) / 60) * rate);
}

/**
 * Money back into billable hours for a certificate line, as the invoice macro
 * did it: round up to the next R480 and call that a quarter of an hour. A line
 * therefore never shows less time than was charged for.
 */
export function certificateUnits(amount) {
  const base = Number(amount);
  if (!Number.isFinite(base) || base < 0) throw new RangeError("amount must be a number >= 0");
  return Math.ceil(base / 480) * 0.25;
}

/**
 * The one entry point the store uses. Returns the captured amount and the rate
 * that produced it, so both can be written onto the row and neither has to be
 * recomputed later against a table that has since moved on.
 */
export function priceEntry({ minutes, rule = "tier_1920", hourlyRate = null }) {
  switch (rule) {
    case "linear_32":
      return { capturedAmount: linearAmount(minutes), rateApplied: 1920 };
    case "tier_1920":
      return { capturedAmount: tier1920(minutes), rateApplied: 1920 };
    case "band_hourly":
      if (hourlyRate === null) throw new RangeError("band_hourly needs an hourlyRate");
      return { capturedAmount: bandAmount(minutes, hourlyRate), rateApplied: toCents(hourlyRate) };
    default:
      throw new RangeError(`unknown pricing rule: ${rule}`);
  }
}

/**
 * Minutes between two `HH:MM` times on one day. Returns null when either is
 * missing or the pair is impossible, because an entry with no end time is a
 * real thing in the source data and guessing a duration for it would invent
 * captured value. The caller decides what to do about it.
 */
export function minutesBetween(start, end) {
  const from = parseClock(start);
  const to = parseClock(end);
  if (from === null || to === null || to < from) return null;
  return to - from;
}

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

function requireMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("minutes must be a whole number >= 0");
  }
  return value;
}
