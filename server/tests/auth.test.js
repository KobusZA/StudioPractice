import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/api.js";
import { RateLimiter, hashPassword, normalizeEmail, verifyPassword } from "../src/auth.js";
import { agent, signedUpAgent, testServer } from "./helpers.js";

test("a password verifies against its own hash and nothing else", async () => {
  const stored = await hashPassword("correct horse battery");
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("correct horse batterz", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("a stored hash contains no plaintext and states its own cost", async () => {
  const stored = await hashPassword("a password nobody else knows");
  assert.equal(stored.includes("a password nobody else knows"), false);
  const [scheme, N, r, p] = stored.split("$");
  assert.equal(scheme, "scrypt");
  // Read back per row, so raising the cost later does not invalidate anything.
  assert.ok(Number(N) >= 16384 && Number(r) >= 8 && Number(p) >= 1);
});

test("a malformed hash is a failed verification, never a throw", async () => {
  for (const stored of ["", "nonsense", "scrypt$1$2$3", "bcrypt$1$2$3$4$5"]) {
    assert.equal(await verifyPassword("anything", stored), false);
  }
});

test("email is matched case- and whitespace-insensitively", () => {
  assert.equal(normalizeEmail("  Builder@Example.COM "), "builder@example.com");
});

test("sign-up creates a firm, signs the owner in, and reports the org", async () => {
  const { baseUrl } = await testServer();
  const { account, client } = await signedUpAgent(baseUrl, { orgName: "Acme Builders" });
  assert.ok(account.orgId);
  assert.equal(account.role, "owner");
  // The offline lease is issued now even though nothing reads it until step 7.
  assert.ok(Date.parse(account.offlineUntil) > Date.now());

  const session = await client.get("/api/auth/session");
  assert.equal(session.body.signedIn, true);
  assert.equal(session.body.orgId, account.orgId);
});

test("the session cookie is httpOnly and SameSite=Lax", async () => {
  const { baseUrl } = await testServer();
  const client = agent(baseUrl);
  const res = await fetch(new URL("/api/auth/sign-up", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `cookie${Date.now()}@example.com`,
      password: "correct horse battery",
      orgName: "Cookie Firm",
    }),
  });
  const [cookie] = res.headers.getSetCookie();
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(client.cookie, null);
});

/**
 * `Secure` is a property of the connection, not of the build, and getting it
 * wrong fails in the worst possible way: the browser silently drops the cookie
 * and sign-in appears to succeed and then not have happened, with nothing in any
 * log. So the deployed default is on, an explicit `COOKIE_SECURE=0` turns it off
 * for a plain-HTTP compose stack, and a value nobody can read as a boolean falls
 * back rather than being treated as truthy.
 */
test("the Secure flag follows COOKIE_SECURE, and NODE_ENV only when it is unset", async () => {
  const cookieFor = async (env) => {
    const api = createApi(null, {}, env);
    let header = null;
    const res = {
      setHeader: (name, value) => { if (name === "Set-Cookie") header = value; },
      writeHead() { return this; },
      end() { return this; },
    };
    // Sign-out with no cookie to revoke needs no database, and is the one route
    // that sets a cookie without one.
    await api({ method: "POST", url: "/api/auth/sign-out", headers: {} }, res);
    return header;
  };

  assert.doesNotMatch(await cookieFor({ NODE_ENV: "production", COOKIE_SECURE: "0" }), /Secure/);
  assert.match(await cookieFor({ NODE_ENV: "development", COOKIE_SECURE: "1" }), /Secure/);
  assert.match(await cookieFor({ NODE_ENV: "production" }), /Secure/);
  assert.doesNotMatch(await cookieFor({ NODE_ENV: "development" }), /Secure/);
  assert.match(await cookieFor({ NODE_ENV: "production", COOKIE_SECURE: "maybe" }), /Secure/);
});

test("an email cannot be registered twice", async () => {
  const { baseUrl } = await testServer();
  const client = agent(baseUrl);
  const email = `dupe${Date.now()}@example.com`;
  const first = await client.post("/api/auth/sign-up", {
    email, password: "correct horse battery", orgName: "First",
  });
  assert.equal(first.status, 201);
  const second = await client.post("/api/auth/sign-up", {
    email: email.toUpperCase(), password: "another long password", orgName: "Second",
  });
  assert.equal(second.status, 409);
});

test("a short password is refused before an account exists", async () => {
  const { baseUrl } = await testServer();
  const client = agent(baseUrl);
  const res = await client.post("/api/auth/sign-up", {
    email: `short${Date.now()}@example.com`, password: "short", orgName: "Short",
  });
  assert.equal(res.status, 400);
  const signIn = await client.post("/api/auth/sign-in", {
    email: `short${Date.now()}@example.com`, password: "short",
  });
  assert.equal(signIn.status, 401);
});

test("a wrong password and an unknown account are the same answer", async () => {
  const { baseUrl } = await testServer();
  const { email } = await signedUpAgent(baseUrl);
  const client = agent(baseUrl);

  const wrong = await client.post("/api/auth/sign-in", { email, password: "not the password" });
  const missing = await client.post("/api/auth/sign-in", {
    email: "nobody@example.com", password: "not the password",
  });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  // Which half was wrong is exactly what a credential-stuffing run wants.
  assert.equal(wrong.body.error, missing.body.error);
});

test("sign-out revokes the session rather than just dropping the cookie", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const cookie = client.cookie;

  await client.post("/api/auth/sign-out");
  assert.equal((await client.get("/api/auth/session")).body.signedIn, false);

  // The old cookie value, replayed. A cookie the server forgot to revoke would
  // still work here.
  const replay = agent(baseUrl);
  const res = await replay.request("GET", "/api/auth/session", { headers: { Cookie: cookie } });
  assert.equal(res.body.signedIn, false);
});

test("an unauthenticated request never reaches the library", async () => {
  const { baseUrl } = await testServer();
  const client = agent(baseUrl);
  for (const [method, path] of [
    ["GET", "/api/projects"],
    ["POST", "/api/projects"],
    ["GET", "/api/drawings/whatever"],
    ["PUT", "/api/drawings/whatever"],
  ]) {
    const res = await client.request(method, path, { body: {} });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test("sign-in attempts are rate limited, and a success clears the count", () => {
  let now = 0;
  const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: () => now });
  assert.equal(limiter.check("a"), true);
  assert.equal(limiter.check("a"), true);
  assert.equal(limiter.check("a"), true);
  assert.equal(limiter.check("a"), false);
  // A different key is a different attacker, and must not be locked out.
  assert.equal(limiter.check("b"), true);
  now += 1001;
  assert.equal(limiter.check("a"), true);

  limiter.clear("a");
  assert.equal(limiter.check("a"), true);
});

test("the rate limit actually refuses a sign-in over HTTP", async () => {
  const { baseUrl } = await testServer();
  // The limiter is keyed by address and email together, and every test here
  // signs up its own address, so spending this account's budget cannot lock out
  // another test.
  const { email } = await signedUpAgent(baseUrl);
  const client = agent(baseUrl);
  let sawLimit = false;
  for (let i = 0; i < 40 && !sawLimit; i += 1) {
    const res = await client.post("/api/auth/sign-in", { email, password: "wrong password" });
    if (res.status === 429) sawLimit = true;
    else assert.equal(res.status, 401);
  }
  assert.equal(sawLimit, true);
});
