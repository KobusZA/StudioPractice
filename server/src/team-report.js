// The owner's view of the firm's people: who did what, on which jobs, and what
// it was worth. Pure - rows in, report out - so every figure can be tested
// without a database, and so the store method that feeds it stays a query.
//
// Value here is CAPTURED value (hours x rate at the moment of logging). It is
// not income: nothing on this screen says a client has paid, and a person is
// never credited with a share of a certificate. Where an entry has been pulled
// onto an issued certificate it is counted as `billed`, which answers "how much
// of what we captured actually went out the door" without pretending to
// attribute a fee.

import { INTERNAL_ACTIVITY_TYPES } from "./defaults.js";

/** 8 hours a weekday: the 40-hour week. */
export const STANDARD_DAY_MINUTES = 8 * 60;
/** Captured value still not on a certificate after this long is called stale. */
export const STALE_DAYS = 30;
/** Logged more than this many days after the day worked counts as late. */
export const LATE_LOG_DAYS = 2;
/** A description shorter than this says nothing a client, or an owner, can use. */
export const THIN_DESCRIPTION = 12;

const DAY_MS = 86400000;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const parse = (date) => Date.parse(`${date}T00:00:00Z`);
const format = (ms) => new Date(ms).toISOString().slice(0, 10);
const isWeekend = (date) => [0, 6].includes(new Date(parse(date)).getUTCDay());
const cents = (value) => Math.round(value * 100) / 100;
const oneDecimal = (value) => Math.round(value * 10) / 10;
const ratio = (top, bottom) => (bottom > 0 ? Math.round((top / bottom) * 1000) / 1000 : null);

export function validDate(value) {
  return typeof value === "string" && isoDate.test(value) && !Number.isNaN(parse(value));
}

/** Mon-Fri dates from..to inclusive. Public holidays are not known and not guessed. */
export function weekdaysBetween(from, to) {
  const days = [];
  for (let ms = parse(from); ms <= parse(to); ms += DAY_MS) {
    const date = format(ms);
    if (!isWeekend(date)) days.push(date);
  }
  return days;
}

function daysBefore(today, date) {
  return Math.round((parse(today) - parse(date)) / DAY_MS);
}

function blank(member) {
  return {
    userId: member.userId,
    email: member.email,
    role: member.role,
    minutes: 0, entries: 0, captured: 0,
    billableMinutes: 0, internalMinutes: 0,
    billed: 0, unbilled: 0, staleUnbilled: 0,
    weekendMinutes: 0, lateEntries: 0, thinEntries: 0,
    dates: new Set(), projects: new Map(), activities: new Map(),
    lastEntryDate: null,
  };
}

function absorb(bucket, entry, { today, internal }) {
  const minutes = Number(entry.minutes);
  const value = Number(entry.capturedAmount) || 0;
  bucket.minutes += minutes;
  bucket.entries += 1;
  bucket.captured += value;
  if (internal) bucket.internalMinutes += minutes; else bucket.billableMinutes += minutes;
  if (entry.billedOnIssued) bucket.billed += value; else bucket.unbilled += value;
  if (!entry.onCertificate && daysBefore(today, entry.date) > STALE_DAYS) bucket.staleUnbilled += value;
  if (isWeekend(entry.date)) bucket.weekendMinutes += minutes;
  if (entry.createdDate && daysBefore(entry.createdDate, entry.date) > LATE_LOG_DAYS) bucket.lateEntries += 1;
  if (String(entry.description || "").trim().length < THIN_DESCRIPTION) bucket.thinEntries += 1;
  bucket.dates.add(entry.date);
  if (!bucket.lastEntryDate || entry.date > bucket.lastEntryDate) bucket.lastEntryDate = entry.date;

  const project = bucket.projects.get(entry.projectId)
    ?? { projectId: entry.projectId, code: entry.projectCode, name: entry.projectName, minutes: 0, captured: 0 };
  project.minutes += minutes;
  project.captured += value;
  bucket.projects.set(entry.projectId, project);

  const activity = bucket.activities.get(entry.activityType)
    ?? { activityType: entry.activityType, minutes: 0, internal };
  activity.minutes += minutes;
  bucket.activities.set(entry.activityType, activity);
}

function finish(bucket, { standardMinutes, weekdays, today }) {
  const hours = bucket.minutes / 60;
  const projects = [...bucket.projects.values()].sort((a, b) => b.minutes - a.minutes);
  const worked = weekdays.filter((day) => bucket.dates.has(day)).length;
  return {
    userId: bucket.userId,
    email: bucket.email,
    role: bucket.role,
    entries: bucket.entries,
    minutes: bucket.minutes,
    hours: oneDecimal(hours),
    billableHours: oneDecimal(bucket.billableMinutes / 60),
    internalHours: oneDecimal(bucket.internalMinutes / 60),
    // Logged time over the standard week. Over 1 is overtime, and is shown as
    // such rather than capped: a 120% month is something an owner should see.
    utilisation: ratio(bucket.minutes, standardMinutes),
    // Share of logged time that is client work rather than running the firm.
    billablePct: ratio(bucket.billableMinutes, bucket.minutes),
    captured: cents(bucket.captured),
    // Captured value per logged hour: the rate this person's time actually
    // realised, which drops when their mix leans on internal work.
    capturedPerHour: hours > 0 ? cents(bucket.captured / hours) : null,
    billed: cents(bucket.billed),
    unbilled: cents(bucket.unbilled),
    staleUnbilled: cents(bucket.staleUnbilled),
    billedPct: ratio(bucket.billed, bucket.captured),
    daysLogged: bucket.dates.size,
    avgHoursPerDay: bucket.dates.size ? oneDecimal(hours / bucket.dates.size) : null,
    // Weekdays up to today with nothing logged: either leave, or a timesheet
    // that has not been filled in. The report cannot tell which and says so.
    daysMissing: weekdays.length - worked,
    weekendHours: oneDecimal(bucket.weekendMinutes / 60),
    lateEntries: bucket.lateEntries,
    thinEntries: bucket.thinEntries,
    projectCount: projects.length,
    topProject: projects[0]
      ? { code: projects[0].code, name: projects[0].name, share: ratio(projects[0].minutes, bucket.minutes) }
      : null,
    lastEntryDate: bucket.lastEntryDate,
    daysSinceLastEntry: bucket.lastEntryDate ? daysBefore(today, bucket.lastEntryDate) : null,
    projects: projects.map((p) => ({ ...p, captured: cents(p.captured) })),
    activities: [...bucket.activities.values()].sort((a, b) => b.minutes - a.minutes),
  };
}

/**
 * `entries` are timeEntryRow-shaped plus three derived flags the query adds:
 * `onCertificate` (pulled onto any live certificate), `billedOnIssued` (onto an
 * issued one) and `createdDate` (the day it was typed in).
 */
export function buildTeamReport({ members, entries, from, to, today }) {
  const end = to < today ? to : today;
  const weekdays = from <= end ? weekdaysBetween(from, end) : [];
  const standardMinutes = weekdays.length * STANDARD_DAY_MINUTES;
  const ctx = { standardMinutes, weekdays, today };

  const byPerson = new Map(members.map((m) => [m.userId, blank(m)]));
  const firm = blank({ userId: null, email: null, role: null });
  const jobs = new Map();

  for (const entry of entries) {
    const internal = INTERNAL_ACTIVITY_TYPES.includes(entry.activityType);
    if (!byPerson.has(entry.userId)) {
      byPerson.set(entry.userId, blank({ userId: entry.userId, email: entry.userEmail, role: null }));
    }
    absorb(byPerson.get(entry.userId), entry, { today, internal });
    absorb(firm, entry, { today, internal });

    const job = jobs.get(entry.projectId) ?? {
      projectId: entry.projectId, code: entry.projectCode, name: entry.projectName,
      minutes: 0, captured: 0, people: new Map(),
    };
    job.minutes += Number(entry.minutes);
    job.captured += Number(entry.capturedAmount) || 0;
    const person = job.people.get(entry.userId)
      ?? { userId: entry.userId, email: byPerson.get(entry.userId).email, minutes: 0, captured: 0 };
    person.minutes += Number(entry.minutes);
    person.captured += Number(entry.capturedAmount) || 0;
    job.people.set(entry.userId, person);
    jobs.set(entry.projectId, job);
  }

  const people = [...byPerson.values()]
    .map((bucket) => finish(bucket, ctx))
    .sort((a, b) => b.captured - a.captured || b.minutes - a.minutes || String(a.email).localeCompare(String(b.email)));

  const active = people.filter((p) => p.entries > 0);
  const firmRow = finish(firm, {
    // The firm's standard is every member's, so firm utilisation is a true
    // average over the whole team and idle people pull it down.
    standardMinutes: standardMinutes * Math.max(people.length, 1),
    weekdays, today,
  });

  return {
    period: {
      from, to, through: end,
      weekdays: weekdays.length,
      standardHours: standardMinutes / 60,
      standardDayHours: STANDARD_DAY_MINUTES / 60,
    },
    firm: {
      people: people.length,
      activePeople: active.length,
      hours: firmRow.hours,
      billableHours: firmRow.billableHours,
      internalHours: firmRow.internalHours,
      utilisation: firmRow.utilisation,
      billablePct: firmRow.billablePct,
      captured: firmRow.captured,
      capturedPerHour: firmRow.capturedPerHour,
      billed: firmRow.billed,
      unbilled: firmRow.unbilled,
      staleUnbilled: firmRow.staleUnbilled,
      billedPct: firmRow.billedPct,
      projectCount: firmRow.projectCount,
      lateEntries: firmRow.lateEntries,
      thinEntries: firmRow.thinEntries,
      entries: firmRow.entries,
      activities: firmRow.activities,
    },
    people,
    projects: [...jobs.values()]
      .map((job) => ({
        projectId: job.projectId, code: job.code, name: job.name,
        minutes: job.minutes, hours: oneDecimal(job.minutes / 60),
        captured: cents(job.captured),
        people: [...job.people.values()]
          .sort((a, b) => b.minutes - a.minutes)
          .map((p) => ({ ...p, captured: cents(p.captured) })),
      }))
      .sort((a, b) => b.captured - a.captured || b.minutes - a.minutes),
    notes: [
      "Value is captured (hours x rate when logged), not income received.",
      "Utilisation is logged hours over an 8-hour weekday; public holidays and leave are not known.",
    ],
  };
}
