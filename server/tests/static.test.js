// The static handler is tested by calling it directly rather than over HTTP: an
// HTTP client normalises `..` out of a path before it ever leaves, so a request
// through fetch() proves nothing about what happens when a raw path arrives.

import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStatic } from "../src/static.js";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");

/** Enough of a ServerResponse for the handler, and it records what it was told. */
function fakeRes() {
  return {
    status: null,
    headers: null,
    ended: false,
    piped: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end() { this.ended = true; return this; },
    on() { return this; },
    once() { return this; },
    emit() { return this; },
    write() { return true; },
  };
}

async function serve(path, method = "HEAD") {
  const res = fakeRes();
  await createStatic(WEB_DIR)({ method, url: path, headers: {} }, res);
  return res;
}

test("the root redirects to the planner rather than serving it in place", async () => {
  const res = await serve("/");
  // Served in place, the page's own relative URLs - ./ui.js, ./v2.css,
  // ../samples/tsp-pack.json - resolve against "/" and 404, which presents as
  // a blank app rather than as a broken route.
  assert.equal(res.status, 302);
  assert.equal(res.headers.Location, "/v2/index.html");
});

test("the planner's index is served at its own address", async () => {
  const res = await serve("/v2/index.html");
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "text/html; charset=utf-8");
});

test("the type pack is reachable at the address the page asks for", async () => {
  // ../samples/tsp-pack.json, resolved from /v2/index.html.
  const res = await serve("/samples/tsp-pack.json");
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "application/json; charset=utf-8");
});

test("a module is served as javascript, so the browser will import it", async () => {
  const res = await serve("/v2/sync.js");
  assert.equal(res.status, 200);
  // A wrong content type here is a blank page and a console error about a
  // MIME type, which reads as a bug in the app rather than in the server.
  assert.equal(res.headers["Content-Type"], "text/javascript; charset=utf-8");
});

test("a path that climbs out of the web directory is refused", async () => {
  for (const path of [
    "/../server/.env",
    "/../../.gitignore",
    "/v2/../../server/src/auth.js",
    "/%2e%2e/%2e%2e/.gitignore",
    "/..%2f..%2fserver%2fsrc%2fauth.js",
  ]) {
    const res = await serve(path);
    // Either refused outright or resolved to something that does not exist.
    // What must never happen is a 200 for a file outside web/.
    assert.notEqual(res.status, 200, path);
    assert.ok(res.status === 403 || res.status === 404, `${path} gave ${res.status}`);
  }
});

test("a directory is not listed", async () => {
  const res = await serve("/v2");
  assert.equal(res.status, 403);
});

test("a missing file is a 404", async () => {
  const res = await serve("/v2/not-a-real-file.js");
  assert.equal(res.status, 404);
});

test("a write method is refused with an Allow header", async () => {
  const res = await serve("/v2/index.html", "POST");
  assert.equal(res.status, 405);
  assert.equal(res.headers.Allow, "GET, HEAD");
});
