// The operator's view across firms. Firm routes go through openStore and
// cannot name an org; these queries can, and they are only called after
// api.js has checked platform_admin.
//
// What comes back is operational: who the company is, how many live jobs it
// has, and who can sign in. Fees, budgets, rates and banking stay in the
// firm. A count of jobs is not a count of money.

import { withTransaction } from "./db.js";
import { addMembership, AuthError, inviteMember, normalizeEmail } from "./auth.js";
import { ROLES } from "./permissions.js";

/**
 * @param q company name, matched anywhere. Empty lists every company.
 * @param limit page size. Null returns the whole match, which the tests use;
 *   the site always asks for a page because this installation already holds
 *   thousands of firms from the test suite.
 */
export async function listCompanies(pool, { q = "", limit = null, offset = 0 } = {}) {
  const term = String(q || "").trim();
  const like = term ? `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
  const filter = like ? "and o.name ilike $1 escape '\\'" : "";
  const params = like ? [like] : [];
  const totals = await pool.query(
    `select count(*)::int as companies,
            coalesce(sum(job_count), 0)::int as jobs
       from (
         select (select count(*)::int from project p
                  where p.org_id = o.id and p.deleted_at is null) as job_count
           from org o
          where o.deleted_at is null
            ${filter}
       ) s`,
    params,
  );
  const listParams = [...params];
  let paging = "";
  if (limit !== null) {
    listParams.push(limit);
    paging += ` limit $${listParams.length}`;
    listParams.push(offset);
    paging += ` offset $${listParams.length}`;
  }
  const { rows } = await pool.query(
    `select o.id, o.name, o.created_at,
            (select count(*)::int from project p
              where p.org_id = o.id and p.deleted_at is null) as job_count,
            (select count(*)::int from membership m
              where m.org_id = o.id and m.deleted_at is null) as member_count
       from org o
      where o.deleted_at is null
        ${filter}
      order by job_count desc, lower(o.name) asc, o.id asc
      ${paging}`,
    listParams,
  );
  return {
    companies: rows.map(companySummary),
    totalCompanies: totals.rows[0].companies,
    totalJobs: totals.rows[0].jobs,
  };
}

/** Null when the company is missing or already closed. */
export async function getCompany(pool, orgId) {
  const { rows } = await pool.query(
    `select id, name, created_at from org
      where id = $1 and deleted_at is null`,
    [orgId],
  );
  if (!rows[0]) return null;
  const [members, jobs] = await Promise.all([
    pool.query(
      `select u.id as user_id, u.email, m.role, m.created_at
         from membership m
         join app_user u on u.id = m.user_id and u.deleted_at is null
        where m.org_id = $1 and m.deleted_at is null
        order by m.created_at`,
      [orgId],
    ),
    pool.query(
      `select id, code, name, client_name, status, type_code, opened_at, created_at
         from project
        where org_id = $1 and deleted_at is null
        order by coalesce(opened_at, created_at) desc`,
      [orgId],
    ),
  ]);
  return {
    ...companySummary({ ...rows[0], job_count: jobs.rows.length, member_count: members.rows.length }),
    members: members.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
    })),
    jobs: jobs.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      clientName: row.client_name,
      status: row.status,
      typeCode: row.type_code,
      openedAt: row.opened_at,
      createdAt: row.created_at,
    })),
  };
}

/**
 * Give someone a sign-in on this company.
 *
 * A new email gets an account, same rules as a firm owner inviting someone
 * (a real password, a role of owner or employee). An email that already has
 * an account is attached and keeps its password. They may already belong to
 * other companies; signing in works in one of them at a time, and they switch.
 */
export async function grantCompanyAccess(pool, { orgId, invitedBy, email, password, role = "employee" }) {
  if (!ROLES.includes(role)) throw new AuthError(400, `role must be one of: ${ROLES.join(", ")}`);
  const clean = normalizeEmail(email);
  if (!clean.includes("@")) throw new AuthError(400, "A valid email is required");
  if (!(await companyExists(pool, orgId))) throw new AuthError(404, "No such company");

  const { rows } = await pool.query(
    `select id from app_user where lower(email) = $1 and deleted_at is null`,
    [clean],
  );
  if (!rows[0]) {
    return inviteMember(pool, { orgId, invitedBy, email: clean, password, role });
  }
  return addMembership(pool, {
    orgId, userId: rows[0].id, invitedBy, email: clean, role,
  });
}

export async function setCompanyMemberRole(pool, { orgId, userId, role }) {
  if (!ROLES.includes(role)) throw new AuthError(400, `role must be one of: ${ROLES.join(", ")}`);
  return withTransaction(pool, async (client) => {
    const current = await liveMembership(client, orgId, userId);
    if (!current) throw new AuthError(404, "That person does not have access to this company");
    if (current.role === "owner" && role !== "owner") await assertNotLastOwner(client, orgId);
    await client.query(
      `update membership set role = $3
        where org_id = $1 and user_id = $2 and deleted_at is null`,
      [orgId, userId, role],
    );
    return { userId, email: current.email, role };
  });
}

/** End their access to this company. The account, and the time they logged, stay. */
export async function revokeCompanyAccess(pool, { orgId, userId }) {
  return withTransaction(pool, async (client) => {
    const current = await liveMembership(client, orgId, userId);
    if (!current) throw new AuthError(404, "That person does not have access to this company");
    if (current.role === "owner") await assertNotLastOwner(client, orgId);
    await client.query(
      `update membership set deleted_at = now()
        where org_id = $1 and user_id = $2 and deleted_at is null`,
      [orgId, userId],
    );
    return { userId, email: current.email, role: current.role };
  });
}

function companySummary(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    jobCount: Number(row.job_count),
    memberCount: Number(row.member_count),
  };
}

async function companyExists(pool, orgId) {
  const { rows } = await pool.query(
    `select id from org where id = $1 and deleted_at is null`,
    [orgId],
  );
  return Boolean(rows[0]);
}

async function liveMembership(client, orgId, userId) {
  const { rows } = await client.query(
    `select m.role, u.email
       from membership m
       join app_user u on u.id = m.user_id and u.deleted_at is null
       join org o on o.id = m.org_id and o.deleted_at is null
      where m.org_id = $1 and m.user_id = $2 and m.deleted_at is null`,
    [orgId, userId],
  );
  return rows[0] || null;
}

async function assertNotLastOwner(client, orgId) {
  const { rows } = await client.query(
    `select count(*)::int as n from membership
      where org_id = $1 and role = 'owner' and deleted_at is null`,
    [orgId],
  );
  if (rows[0].n <= 1) throw new AuthError(400, "A company must keep at least one owner");
}
