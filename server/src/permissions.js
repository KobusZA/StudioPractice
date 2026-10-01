// The capability lookup PERMISSIONS-PROPOSAL.md describes. One pure function,
// no store method reads a gated field without going through it first - the
// same "no code path updates captured_amount" discipline SKILL.md decision 8
// already applies to writes, applied here to reads.
//
// `membership.role` (server/db/schema.sql) is already free text, seeded to
// 'owner' at sign-up. This file is the only place that says what a role value
// means; a third role is a new entry here, not a migration.

/**
 * Four independent gates, matching the money ladder PERMISSIONS-PROPOSAL.md's
 * research found repeated across the category (BQE, Scoro, Mosaic,
 * Productive): operational editing, hours/progress (no currency), billed
 * money (quote, budget, captured $, certificate amounts), and cost money
 * (tariff rates, write-down amount/reason - the most restricted tier
 * everywhere it was checked).
 */
const OWNER = Object.freeze({
  canEditWork: true,
  canViewHours: true,
  canViewBilled: true,
  canViewCost: true,
});

/**
 * Can do everything an owner can operationally - add/strike tasks, log time,
 * pick an activity type, attach/edit a drawing, change status - but sees
 * hours and burn/phase progress only. No fee, no budget, no certificate or
 * write-down amount, no tariff. This is the two-tier shape the proposal ships
 * first; a middle tier (billed visible, cost still hidden) is open decision 2
 * there and does not exist yet.
 */
const EMPLOYEE = Object.freeze({
  canEditWork: true,
  canViewHours: true,
  canViewBilled: false,
  canViewCost: false,
});

export const ROLES = Object.freeze(["owner", "employee"]);

/**
 * An unrecognised role gets the narrowest set, not the widest. A role value
 * this file does not yet know about is a gap, and "unknown is never a
 * plausible default" (SKILL.md decision 6) means the gap costs the least
 * access, not the most.
 */
export function capabilitiesFor(role) {
  if (role === "owner") return OWNER;
  if (role === "employee") return EMPLOYEE;
  return EMPLOYEE;
}

/** `value` when the gate is open, `null` otherwise - never `0`, never omitted. */
export function gate(value, allowed) {
  return allowed ? value : null;
}
