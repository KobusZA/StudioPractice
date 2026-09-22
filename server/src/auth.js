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
export async function signUp(pool, { email, password, orgName }) {
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
    const session = await issueSession(client, userId);
    // The role travels with the account rather than being looked up again: the
    // caller is about to render chrome that depends on it, and the membership
    // row it would re-read was written two statements ago.
    return {
      userId,
      orgId,
      email: clean,
      orgName: String(orgName || "").trim() || clean,
      role: "owner",
      memberSince: new Date().toISOString(),
      ...session,
    };
  });
}

/**
 * Sign-in. Rate limiting lives in the route (it needs the client address); what
 * is here is the part that must not leak which half was wrong. A missing
 * account and a wrong password return the same message, and an unknown email
 * still pays for a hash comparison so the response time does not answer the
 * question either.
 */
export async function signIn(pool, { email, password }) {
  const clean = normalizeEmail(email);
  const { rows } = await pool.query(
    `select id, password_hash from app_user
      where lower(email) = $1 and deleted_at is null`,
    [clean],
  );
  const user = rows[0];
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new AuthError(401, "Email or password is incorrect");

  // The org is resolved after the password, not joined into the lookup above:
  // a user whose firm was deleted has a correct password and no org, and
  // "email or password is incorrect" would be a lie about which thing is wrong.
  const { rows: memberships } = await pool.query(
    `select m.org_id, m.role, o.name as org_name, u.created_at as member_since
       from membership m
       join org o on o.id = m.org_id and o.deleted_at is null
       join app_user u on u.id = m.user_id
      where m.user_id = $1 and m.deleted_at is null
      limit 1`,
    [user.id],
  );
  if (!memberships[0]) throw new AuthError(403, "That account is not a member of a firm");

  const session = await issueSession(pool, user.id);
  return {
    userId: user.id,
    email: clean,
    orgId: memberships[0].org_id,
    orgName: memberships[0].org_name,
    role: memberships[0].role,
    memberSince: memberships[0].member_since,
    ...session,
  };
}

// A real hash of a value nobody knows, built with the live parameters, so the
// unknown-email path does exactly the work the known-email path does. Hardcoding
// a literal would drift the moment SCRYPT changes and quietly turn the timing
// back into an answer.
const DUMMY_HASH = await hashPassword(randomBytes(32).toString("base64url"));

export async function issueSession(queryable, userId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const offlineUntil = new Date(Date.now() + OFFLINE_LEASE_MS).toISOString();
  await queryable.query(
    `insert into session (id, token_hash, user_id, expires_at, offline_until, created_by)
          values ($1, $2, $3, $4, $5, $3)`,
    [sid("ses"), hashToken(token), userId, expiresAt, offlineUntil],
  );
  return { token, expiresAt, offlineUntil };
}

/**
 * Who is this request, and which firm's data may it see. Returns null rather
 * than throwing for anything that amounts to "not signed in", so a handler can
 * decide whether that is a 401 or just an anonymous read.
 *
 * The org comes from the membership join. There is no `app_user.org_id` to read
 * by accident - see schema.sql.
 */
export async function resolveSession(pool, token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `select s.id       as session_id,
            s.expires_at,
            s.offline_until,
            u.id        as user_id,
            u.email,
            u.created_at as member_since,
            m.org_id,
            m.role,
            o.name     as org_name
       from session s
       join app_user u on u.id = s.user_id and u.deleted_at is null
       join membership m on m.user_id = u.id and m.deleted_at is null
       join org o on o.id = m.org_id and o.deleted_at is null
      where s.token_hash = $1
        and s.deleted_at is null
        and s.expires_at > now()
      limit 1`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    orgId: row.org_id,
    orgName: row.org_name,
    role: row.role,
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
