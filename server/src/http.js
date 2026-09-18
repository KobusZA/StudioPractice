// A router over node:http. No framework, for the same reason the rest of this
// repository has one dependency: what a framework would add here is a body
// parser, a cookie parser and pattern matching, and all three are twenty lines.

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Routes are `[method, pattern, handler]`, where a pattern segment starting
 * with `:` captures. Matching is exact on segment count - no prefix matching,
 * so a typo'd path 404s rather than falling into a neighbouring handler.
 */
export function createRouter(routes) {
  const compiled = routes.map(([method, pattern, handler]) => ({
    method,
    segments: pattern.split("/").filter(Boolean),
    handler,
  }));

  return function match(method, pathname) {
    const parts = pathname.split("/").filter(Boolean);
    for (const route of compiled) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < parts.length; i += 1) {
        const expected = route.segments[i];
        if (expected.startsWith(":")) params[expected.slice(1)] = decodeURIComponent(parts[i]);
        else if (expected !== parts[i]) { ok = false; break; }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * The session cookie. httpOnly so script cannot read it, and SameSite=Lax so a
 * cross-site form POST does not carry it - which is what stands in for a CSRF
 * token in this slice. Secure is conditional only because plain-HTTP localhost
 * is how this is developed; anything hosted sets it.
 */
export function sessionCookie(name, value, { maxAgeMs, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedCookie(name, { secure }) {
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export async function readJsonBody(req, { limit = MAX_BODY_BYTES } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Refused while it arrives rather than after: a document large enough to
    // matter is large enough not to want a copy of in memory first.
    if (size > limit) throw new HttpError(413, "Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
}

export function sendJson(res, status, payload, headers = {}) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}
