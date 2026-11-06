// Accounts, passwords and sessions. Email and password only - no third-party
// identity provider in this slice (§8).
//
// The org a request may touch is resolved here, through `membership`, and
// handed to openStore(). Nothing downstream can reach a different firm's rows
// because nothing downstream is given the chance to name an org.

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { sid } from "./ids.js";
import { withTransaction } from "./db.js";
import { openStore } from "./store.js";
import { ROLES } from "./permissions.js";

const scrypt = promisify(scryptCb);

// scrypt rather than bcrypt/argon2 because it is in node:crypto, and this
// repository has kept its dependency count at one on purpose. The parameters
// are stored in the hash string, so raising them later does not invalidate
// existing passwords - verification reads each row's own cost.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// §6's lease: the licence check, not a convenience feature. Refreshed on every
// successful online use. Nothing reads it until step 7; it is issued now so a
// session created today is not missing the field when offline lands.
export const OFFLINE_LEASE_MS = 14 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "sp_session";

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return [
    "scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString("base64url"), Buffer.from(key).toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, expected] = parts;
  const expectedKey = Buffer.from(expected, "base64url");
  let key;
  try {
    key = await scrypt(password, Buffer.from(salt, "base64url"), expectedKey.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
  } catch {
    return false;
  }
  return key.length === expectedKey.length && timingSafeEqual(key, expectedKey);
}

/**
 * Sessions are recognised by hash. The plaintext token exists only in the
 * cookie, so a database dump is not a drawer full of live sessions and there is
 * no code path that can print one back out.
 */
export function hashToken(token) {
  return createHash("sha256").update(token).digest("base64url");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Comma-separated PLATFORM_ADMIN_EMAILS. Blank pieces and non-emails drop out. */
export function platformAdminEmailsFrom(value) {
  const emails = new Set();
  for (const part of String(value || "").split(",")) {
    const email = normalizeEmail(part);
    if (email.includes("@")) emails.add(email);
  }
  return emails;
}

/**
 * Turn the flag on for every live account whose email is listed. Never turns
 * it off: taking someone off the list is a deliberate update of the row, not
 * a side effect of editing the environment and restarting.
 */
export async function syncPlatformAdmins(pool, emails) {
  const list = [...emails];
  if (!list.length) return 0;
  const { rowCount } = await pool.query(
    `update app_user set platform_admin = true
      where deleted_at is null
        and platform_admin = false
        and lower(email) = any($1::text[])`,
    [list],
  );
  return rowCount;
}

export class AuthError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

/**
 * A firm and its first user, in one transaction. One org per account today; the
 * membership row is what says so, and it is what a second member would be added
 * to rather than a migration.
 */
export async function signUp(pool, { email, password, orgName, platformAdminEmails = new Set() }) {
  const clean = normalizeEmail(email);
  if (!clean.includes("@")) throw new AuthError(400, "A valid email is required");
  if (String(password || "").length < 10) {
    throw new AuthError(400, "A password of at least 10 characters is required");
  }

  const userId = sid("usr");
  const orgId = sid("org");
  const passwordHash = await hashPassword(password);

  return withTransaction(pool, async (client) => {
    try {
      await client.query(
        // The first user of a firm is its own author. See schema.sql.
        `insert into app_user (id, email, password_hash, created_by) values ($1, $2, $3, $1)`,
        [userId, clean, passwordHash],
      );
    } catch (error) {
      if (error.code === "23505") throw new AuthError(409, "That email is already registered");
      throw error;
    }
    await client.query(
      `insert into org (id, name, created_by) values ($1, $2, $3)`,
      [orgId, String(orgName || "").trim() || clean, userId],
    );
    await client.query(
      `insert into membership (id, user_id, org_id, role, created_by)
            values ($1, $2, $3, 'owner', $2)`,
      [sid("mem"), userId, orgId],
    );
    // The firm's type list and tariff bands, in the same transaction as the
    // firm. A register whose type dropdown is empty on the first screen is not
    // a working register, and seeding it on first use instead would mean a
    // read path that writes.
    await openStore(client, { orgId, userId }).seedPracticeDefaults();
    const platformAdmin = platformAdminEmails.has(clean);
    if (platformAdmin) {
      await client.query(`update app_user set platform_admin = true where id = $1`, [userId]);
    }
    const session = await issueSession(client, userId, orgId);
    const orgNameClean = String(orgName || "").trim() || clean;
    // The role travels with the account rather than being looked up again: the
    // caller is about to render chrome that depends on it, and the membership
    // row it would re-read was written two statements ago.
    return {
      userId,
      orgId,
      email: clean,
      orgName: orgNameClean,
      role: "owner",
      companies: [{ orgId, orgName: orgNameClean, role: "owner" }],
      platformAdmin,
      memberSince: new Date().toISOString(),
      ...session,
    };
  });
}

/**
 * A person under an existing firm. A new email gets an account (a real
 * password, then a membership). An email that already has an account is
 * attached: they keep the password they already have, and sign-in can switch
 * into this firm. One person may belong to several companies.
 *
 * No practice-defaults seeding here - that only ever runs once, for the org's
 * first user, and the org this person is joining already has its type list
 * and tariff bands.
 */
export async function inviteMember(pool, { orgId, invitedBy, email, password, role = "employee" }) {
  if (!ROLES.includes(role)) throw new AuthError(400, `role must be one of: ${ROLES.join(", ")}`);
  const clean = normalizeEmail(email);
  if (!clean.includes("@")) throw new AuthError(400, "A valid email is required");

  const { rows } = await pool.query(
    `select id from app_user where lower(email) = $1 and deleted_at is null`,
    [clean],
  );
  if (rows[0]) {
    return addMembership(pool, { orgId, userId: rows[0].id, invitedBy, email: clean, role });
  }
  if (String(password || "").length < 10) {
    throw new AuthError(400, "A password of at least 10 characters is required");
  }
  const userId = sid("usr");
  const passwordHash = await hashPassword(password);

  return withTransaction(pool, async (client) => {
    await client.query("savepoint new_user");
    try {
      await client.query(
        `insert into app_user (id, email, password_hash, created_by) values ($1, $2, $3, $4)`,
        [userId, clean, passwordHash, invitedBy],
      );
    } catch (error) {
      if (error.code !== "23505") throw error;
      // The address was registered between the lookup and the insert. The
      // transaction is aborted until the savepoint is rolled back; then this
      // is the same attach the lookup would have done.
      await client.query("rollback to savepoint new_user");
      const { rows: raced } = await client.query(
        `select id from app_user where lower(email) = $1 and deleted_at is null`,
        [clean],
      );
      if (!raced[0]) throw error;
      return addMembership(client, { orgId, userId: raced[0].id, invitedBy, email: clean, role });
    }
    await insertMembership(client, { orgId, userId, invitedBy, role });
    return { userId, email: clean, orgId, role };
  });
}

/** Attach an existing account to a firm. Refuses a second row in the same firm. */
export async function addMembership(queryable, { orgId, userId, invitedBy, email, role }) {
  if (!ROLES.includes(role)) throw new AuthError(400, `role must be one of: ${ROLES.join(", ")}`);
  const memberships = await listLiveMemberships(queryable, userId);
  if (memberships.some((row) => row.org_id === orgId)) {
    throw new AuthError(409, "That person already has access to this company");
  }
  await insertMembership(queryable, { orgId, userId, invitedBy, role });
  return { userId, email, orgId, role };
}

async function insertMembership(queryable, { orgId, userId, invitedBy, role }) {
  try {
    await queryable.query(
      `insert into membership (id, user_id, org_id, role, created_by)
            values ($1, $2, $3, $4, $5)`,
      [sid("mem"), userId, orgId, role, invitedBy],
    );
  } catch (error) {
    if (error.code === "23505") throw new AuthError(409, "That person already has access to this company");
    throw error;
  }
}

export async function listLiveMemberships(queryable, userId) {
  const { rows } = await queryable.query(
    `select m.org_id, m.role, o.name as org_name
       from membership m
       join org o on o.id = m.org_id and o.deleted_at is null
      where m.user_id = $1 and m.deleted_at is null
      order by m.created_at asc, m.id asc`,
    [userId],
  );
  return rows;
}

function companiesFrom(rows) {
  return rows.map((row) => ({
    orgId: row.org_id,
    orgName: row.org_name,
    role: row.role,
  }));
}

/**
 * Sign-in. Rate limiting lives in the route (it needs the client address); what
 * is here is the part that must not leak which half was wrong. A missing
 * account and a wrong password return the same message, and an unknown email
 * still pays for a hash comparison so the response time does not answer the
 * question either.
 */
export async function signIn(pool, { email, password, platformAdminEmails = new Set() }) {
  const clean = normalizeEmail(email);
  const { rows } = await pool.query(
    `select id, password_hash, platform_admin, created_at from app_user
      where lower(email) = $1 and deleted_at is null`,
    [clean],
  );
  const user = rows[0];
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new AuthError(401, "Email or password is incorrect");

  const platformAdmin = Boolean(user.platform_admin) || platformAdminEmails.has(clean);
  if (platformAdmin && !user.platform_admin) {
    await pool.query(`update app_user set platform_admin = true where id = $1`, [user.id]);
  }

  // The org is resolved after the password, not joined into the lookup above:
  // a user whose firm was deleted has a correct password and no org, and
  // "email or password is incorrect" would be a lie about which thing is wrong.
  const memberships = await listLiveMemberships(pool, user.id);
  if (!memberships.length) {
    // An operator may have no firm. Everyone else still has to belong to one.
    if (!platformAdmin) throw new AuthError(403, "That account is not a member of a firm");
    const session = await issueSession(pool, user.id, null);
    return {
      userId: user.id,
      email: clean,
      orgId: null,
      orgName: null,
      role: null,
      companies: [],
      platformAdmin: true,
      memberSince: user.created_at,
      ...session,
    };
  }

  // Stay in the company they last worked in. A brand-new sign-in, or a company
  // they have since left, opens the one they joined first.
  const { rows: previous } = await pool.query(
    `select org_id from session
      where user_id = $1 and org_id is not null
      order by created_at desc
      limit 1`,
    [user.id],
  );
  const membership = memberships.find((row) => row.org_id === previous[0]?.org_id) || memberships[0];
  // Idempotent: ON CONFLICT DO NOTHING. Firms created before practice defaults
  // existed arrive with an empty type list; signing in is when that is fixed.
  await openStore(pool, { orgId: membership.org_id, userId: user.id }).seedPracticeDefaults();

  const session = await issueSession(pool, user.id, membership.org_id);
  return {
    userId: user.id,
    email: clean,
    orgId: membership.org_id,
    orgName: membership.org_name,
    role: membership.role,
    companies: companiesFrom(memberships),
    platformAdmin,
    memberSince: user.created_at,
    ...session,
  };
}

// A real hash of a value nobody knows, built with the live parameters, so the
// unknown-email path does exactly the work the known-email path does. Hardcoding
// a literal would drift the moment SCRYPT changes and quietly turn the timing
// back into an answer.
const DUMMY_HASH = await hashPassword(randomBytes(32).toString("base64url"));

export async function issueSession(queryable, userId, orgId = null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const offlineUntil = new Date(Date.now() + OFFLINE_LEASE_MS).toISOString();
  await queryable.query(
    `insert into session (id, token_hash, user_id, org_id, expires_at, offline_until, created_by)
          values ($1, $2, $3, $4, $5, $6, $3)`,
    [sid("ses"), hashToken(token), userId, orgId, expiresAt, offlineUntil],
  );
  return { token, expiresAt, offlineUntil };
}

/** Move this sign-in into another company the person already belongs to. */
export async function setSessionCompany(pool, { sessionId, userId, orgId }) {
  const memberships = await listLiveMemberships(pool, userId);
  const membership = memberships.find((row) => row.org_id === orgId);
  if (!membership) throw new AuthError(403, "That account is not a member of that company");
  await pool.query(
    `update session set org_id = $2 where id = $1 and deleted_at is null`,
    [sessionId, orgId],
  );
  await openStore(pool, { orgId, userId }).seedPracticeDefaults();
  return membership;
}

/**
 * Who is this request, and which firm's data may it see. Returns null rather
 * than throwing for anything that amounts to "not signed in", so a handler can
 * decide whether that is a 401 or just an anonymous read.
 *
 * The company comes from a live membership. `session.org_id` only chooses which
 * of those memberships this sign-in is in. There is no `app_user.org_id`.
 */
export async function resolveSession(pool, token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `select s.id       as session_id,
            s.expires_at,
            s.offline_until,
            s.org_id   as session_org_id,
            u.id        as user_id,
            u.email,
            u.platform_admin,
            u.created_at as member_since
       from session s
       join app_user u on u.id = s.user_id and u.deleted_at is null
      where s.token_hash = $1
        and s.deleted_at is null
        and s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  const memberships = await listLiveMemberships(pool, row.user_id);
  let current = memberships.find((membership) => membership.org_id === row.session_org_id) || null;
  // A session from before this column existed, or a company they have left,
  // opens another firm they still belong to. One write, then later requests
  // find the row directly.
  if (!current && memberships[0]) {
    current = memberships[0];
    await pool.query(
      `update session set org_id = $2 where id = $1 and deleted_at is null`,
      [row.session_id, current.org_id],
    );
  }
  if (!current && !row.platform_admin) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    orgId: current ? current.org_id : null,
    orgName: current ? current.org_name : null,
    role: current ? current.role : null,
    companies: companiesFrom(memberships),
    platformAdmin: Boolean(row.platform_admin),
    memberSince: row.member_since,
    expiresAt: row.expires_at,
    offlineUntil: row.offline_until,
  };
}

/** The lease is extended by using the app online, which is the whole idea. */
export async function refreshOfflineLease(pool, sessionId) {
  const offlineUntil = new Date(Date.now() + OFFLINE_LEASE_MS).toISOString();
  await pool.query(
    `update session set offline_until = $2 where id = $1 and deleted_at is null`,
    [sessionId, offlineUntil],
  );
  return offlineUntil;
}

/** Sign-out is a soft delete, like everything else here. */
export async function revokeSession(pool, token) {
  if (!token) return;
  await pool.query(
    `update session set deleted_at = now()
      where token_hash = $1 and deleted_at is null`,
    [hashToken(token)],
  );
}

/**
 * Sign-in attempts per email-and-address, in memory. A fixed window, and
 * deliberately the simplest thing that works for one instance: behind more than
 * one process this stops being a limit and has to move to the database or a
 * shared cache. Recorded here rather than discovered later.
 */
export class RateLimiter {
  constructor({ limit = 10, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }

  /** True when the attempt is allowed, and counts it. */
  check(key) {
    const now = this.now();
    const fresh = (this.hits.get(key) || []).filter((at) => now - at < this.windowMs);
    if (fresh.length >= this.limit) {
      this.hits.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    if (this.hits.size > 10000) this.#sweep(now);
    return true;
  }

  /** A successful sign-in clears the count, so a typo streak is not a lockout. */
  clear(key) {
    this.hits.delete(key);
  }

  #sweep(now) {
    for (const [key, at] of this.hits) {
      if (!at.some((t) => now - t < this.windowMs)) this.hits.delete(key);
    }
  }
}
