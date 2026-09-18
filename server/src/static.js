// The planner's own files, served from the same origin as the API.
//
// Same origin is the point: the session is an httpOnly SameSite=Lax cookie, and
// a cross-origin planner would need CORS with credentials plus a cookie the
// browser is increasingly reluctant to send. Serving web/ here means the
// deployed app has one origin and the cookie story is boring.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = new Map(Object.entries({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
}));

export function createStatic(rootDir, { index = "/v2/index.html" } = {}) {
  const root = resolve(rootDir);

  return async function serve(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return true;
    }

    const url = new URL(req.url, "http://localhost");

    // A redirect, not the index's bytes served at "/". The planner loads its
    // modules, its stylesheet and its type pack by relative URL, and all of
    // those resolve against the *document's* address: served at "/", the page's
    // own "./ui.js" becomes "/ui.js" and 404s, which looks like a blank app
    // with no error rather than a misconfigured route.
    if (url.pathname === "/") {
      res.writeHead(302, { Location: index, "Cache-Control": "no-store" }).end();
      return true;
    }

    const requested = url.pathname;
    const target = resolve(join(root, normalize(decodeURIComponent(requested))));
    // Resolve first, then check containment: `..` and an absolute path both
    // collapse into `target`, so one comparison covers both rather than a list
    // of patterns to blacklist.
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403).end();
      return true;
    }

    let info;
    try {
      info = await stat(target);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return true;
    }
    if (info.isDirectory()) {
      res.writeHead(403).end();
      return true;
    }

    res.writeHead(200, {
      "Content-Type": TYPES.get(extname(target).toLowerCase()) || "application/octet-stream",
      "Content-Length": info.size,
      // The planner is a set of ES modules that import each other by name; a
      // cached stale module against a fresh one is the worst kind of bug to
      // chase. Correctness first, and a real deployment fingerprints instead.
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    createReadStream(target).pipe(res);
    return true;
  };
}
