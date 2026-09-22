import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "schema.sql");

/**
 * Timestamps come back as ISO strings rather than Date objects. Everything here
 * is handed to JSON.stringify eventually, and a `Date` serialises differently
 * depending on which layer touched it first; a string is the same fact
 * everywhere. jsonb is already parsed by pg, so `doc` needs no help.
 */
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (value) => (
  value === null ? null : new Date(value).toISOString()
));
// bigint. `revision` is the only one, and it is compared as a string in the
// If-Match header, so parsing it to a Number that silently loses precision past
// 2^53 buys nothing. pg returns it as a string already; this is here to say so.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => value);
// date. A calendar date has no time and no zone, and parsing one into a Date
// gives it both: a timesheet row entered on the 1st in Johannesburg reads as
// the 28th to anything that renders it as UTC, and a month's billing silently
// straddles the wrong boundary. The string is the fact.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new pg.Pool({ connectionString, max: 10 });
}

// Any constant will do; it only has to be the same in every process.
const MIGRATION_LOCK = 8253197;

/**
 * Apply schema.sql. Idempotent - every statement in it is `if not exists` - but
 * idempotent is not the same as concurrency-safe: two processes running
 * `create table if not exists` against the same tables deadlock, because each
 * takes locks on the objects it is checking in whatever order it reaches them.
 *
 * That is not a test-only problem. server.js migrates on boot, so two instances
 * starting together - a rolling deploy, or the moment a crashed one restarts -
 * race in exactly the same way. An advisory lock makes the whole apply
 * one-at-a-time, and it is released with the transaction whether or not the
 * schema applied cleanly.
 *
 * The lock does not make this safe to run *alongside live traffic*, and cannot:
 * the apply takes locks on the tables it touches, in file order, while a
 * request's transaction holds locks on the same tables in the order it needs
 * them, and Postgres resolves that by killing one of them. So this is a boot or
 * deploy step, never something a request path calls. The test suite learned this
 * the noisy way and now migrates once in `pretest` instead of once per file.
 */
export async function migrate(pool) {
  const sql = await readFile(SCHEMA_PATH, "utf8");
  await withTransaction(pool, async (client) => {
    await client.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await client.query(sql);
  });
}

/**
 * One transaction. Used for anything that writes more than one row, which is
 * most of it: a sign-up is a user, an org and a membership, and a half-created
 * account is worse than a failed one.
 */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
