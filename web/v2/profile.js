// Preview SaaS chrome for the signed-in account menu.
//
// Email, firm name, role and membership date come from the session. Job count
// is the live library. Name, practice address and licence dates are derived
// here rather than billed: there is no subscription table yet, and a random
// number on each load would look like a different product every refresh.

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

const PRACTICE_ADDRESSES = [
  { street: "12 Bree Street", city: "Cape Town", code: "8001" },
  { street: "44 Loop Street", city: "Cape Town", code: "8001" },
  { street: "8 Ryneveld Street", city: "Stellenbosch", code: "7600" },
  { street: "21 Florida Road", city: "Durban", code: "4001" },
  { street: "3 Seventh Street", city: "Johannesburg", code: "2193" },
];

export function displayNameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "";
  const words = local.split(/[._+\-]+/).filter(Boolean);
  if (!words.length) return "Signed-in user";
  return words.map(titleWord).join(" ");
}

export function initialsFromName(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = words[0][0] || "";
  const last = words.length > 1 ? words[words.length - 1][0] : (words[0][1] || "");
  return (first + last).toUpperCase();
}

export function roleLabel(role) {
  const raw = String(role || "").trim();
  if (!raw) return "Member";
  return titleWord(raw);
}

export function formatDuration(ms, { future = false } = {}) {
  const abs = Math.abs(Number(ms) || 0);
  if (abs < DAY_MS) return future ? "less than a day" : "today";
  const days = Math.round(abs / DAY_MS);
  if (days < 45) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30.44);
  if (months < 18) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"}`;
}

export function formatDate(iso) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Stable practice card for an org: same firm always gets the same address. */
export function practiceAddress(orgId, orgName) {
  const pick = PRACTICE_ADDRESSES[stableIndex(orgId || orgName, PRACTICE_ADDRESSES.length)];
  return {
    firm: String(orgName || "").trim() || "Your firm",
    street: pick.street,
    city: pick.city,
    code: pick.code,
    lines: [pick.street, `${pick.city} ${pick.code}`, "South Africa"],
  };
}

/**
 * Annual Studio/Practice licence whose anniversary is the membership date.
 * Always points at the next renewal so an old account does not look expired
 * just because billing is not wired.
 */
export function simulatedLicense(session, now = Date.now()) {
  const start = Date.parse(session?.memberSince) || now;
  let renewsAt = start + YEAR_MS;
  while (renewsAt <= now) renewsAt += YEAR_MS;
  const remainingMs = renewsAt - now;
  const owner = session?.role === "owner";
  return {
    level: owner ? "Studio" : "Practice",
    seatsUsed: 1,
    seatsIncluded: owner ? 5 : 1,
    renewsAt: new Date(renewsAt).toISOString(),
    remainingMs,
    yearProgress: 1 - Math.min(1, remainingMs / YEAR_MS),
  };
}

export function accountCard(session, { jobCount = 0, now = Date.now() } = {}) {
  const email = session?.email || "";
  const name = displayNameFromEmail(email);
  const license = simulatedLicense(session, now);
  const address = practiceAddress(session?.orgId, session?.orgName);
  const memberSince = session?.memberSince || null;
  const memberMs = memberSince ? Math.max(0, now - Date.parse(memberSince)) : 0;
  return {
    name,
    initials: initialsFromName(name),
    email,
    role: roleLabel(session?.role),
    orgName: address.firm,
    address,
    jobCount: Number(jobCount) || 0,
    memberSince,
    memberFor: memberSince ? formatDuration(memberMs) : "—",
    license,
    licenseLeft: formatDuration(license.remainingMs, { future: true }),
    licenseRenews: formatDate(license.renewsAt),
  };
}

function titleWord(word) {
  const lower = String(word).toLowerCase();
  return lower ? lower[0].toUpperCase() + lower.slice(1) : "";
}

function stableIndex(key, modulo) {
  const text = String(key || "firm");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulo;
}
