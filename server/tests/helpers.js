// Server tests run against a real Postgres, per the plan's §12, because every
// rule worth testing here is enforced in SQL: the org scope is a predicate, the
// If-Match check is a WHERE clause, and the soft delete is a partial index. A
// fake would only prove the fake agrees with itself.
//
//   cd server && docker compose up -d && npm test
//
// Isolation comes from each test signing up its own firm rather than from
// truncating between tests. That is closer to how the server actually runs, and
// it means a test cannot pass by accident on a table another test emptied.

import { createServer } from "node:http";
import { after } from "node:test";
import { createApi } from "../src/api.js";
import { createPool } from "../src/db.js";
import { sid } from "../src/ids.js";

export const TEST_DATABASE_URL = process.env.DATABASE_URL
  || "postgres://studiopractice:studiopractice@localhost:5440/studiopractice";

let shared = null;

/**
 * One pool and one server for the whole file. Returns a base url plus a factory
 * for cookie-keeping clients, so a test can hold two signed-in firms at once -
 * which is what the isolation tests need.
 *
 * The schema is applied once by `pretest`, not here. node --test runs each file
 * in its own process, so migrating per file means one process applying the
 * schema while another is mid-transaction on the same tables, which Postgres
 * settles by killing one of them. See db.js's migrate().
 */
export async function testServer(options = {}) {
  if (shared) return shared;
  const pool = createPool(TEST_DATABASE_URL);
  const api = createApi(pool, { secureCookies: false, ...options });
  const server = createServer(async (req, res) => {
    if (await api(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  shared = { pool, server, baseUrl: `http://127.0.0.1:${port}` };

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    shared = null;
  });

  return shared;
}

/** A fetch that remembers its session cookie, i.e. one signed-in browser. */
export function agent(baseUrl) {
  let cookie = null;
  return {
    get cookie() { return cookie; },
    async request(method, path, { body, headers = {} } = {}) {
      // GET and HEAD may not carry one, and a test that sweeps several routes
      // with the same body should not have to special-case which.
      const sendBody = body !== undefined && method !== "GET" && method !== "HEAD";
      const res = await fetch(new URL(path, baseUrl), {
        method,
        headers: {
          ...(sendBody ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: sendBody ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.() || [];
      for (const value of set) {
        const pair = value.split(";")[0];
        if (pair.split("=")[1] === "") cookie = null;
        else cookie = pair;
      }
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body: text ? JSON.parse(text) : null,
      };
    },
    get(path, init) { return this.request("GET", path, init); },
    post(path, body, init) { return this.request("POST", path, { body, ...init }); },
    patch(path, body, init) { return this.request("PATCH", path, { body, ...init }); },
    put(path, body, init) { return this.request("PUT", path, { body, ...init }); },
    del(path, init) { return this.request("DELETE", path, init); },
  };
}

/** A fresh firm with a fresh owner, signed in. */
export async function signedUpAgent(baseUrl, { orgName = "Test Firm" } = {}) {
  const client = agent(baseUrl);
  const email = `${sid("t").toLowerCase()}@example.com`;
  const res = await client.post("/api/auth/sign-up", {
    email, password: "correct horse battery", orgName,
  });
  if (res.status !== 201) throw new Error(`sign-up failed: ${JSON.stringify(res.body)}`);
  return { client, email, account: res.body };
}

/**
 * A document in the shape model.js writes, minus everything a server test does
 * not care about. Deliberately not imported from web/v2/model.js: the server
 * treats the document as opaque jsonb, and a test that shared the client's
 * constructor would hide the day those two disagree.
 */
export function testDoc(overrides = {}) {
  return {
    schema: "sp.doc/2",
    id: `doc${Math.random().toString(36).slice(2, 8)}`,
    name: null,
    packId: "tsp-pack",
    site: null,
    rooms: [],
    segments: [],
    slabs: [],
    roofs: [],
    openings: [],
    items: [],
    beams: [],
    stairs: [],
    groups: [],
    sheets: [],
    floorsRevealed: 0,
    levels: [],
    ...overrides,
  };
}

/** A firm, signed in, with one job already created. */
export async function firmWithProject(baseUrl, { name = "Job A", doc = testDoc() } = {}) {
  const { client, account } = await signedUpAgent(baseUrl);
  const created = await client.post("/api/projects", { name, doc });
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  return { client, account, project: created.body.project, doc };
}
