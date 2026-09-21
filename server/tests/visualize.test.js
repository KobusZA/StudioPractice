import { createServer } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/api.js";
import { createPool } from "../src/db.js";
import { generateVisualization, parseDataImage, VISUALIZE_PROMPT } from "../src/visualize.js";
import { signedUpAgent, TEST_DATABASE_URL } from "./helpers.js";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DRAWING = `data:image/png;base64,${PNG_1X1}`;

function fakeOpenai(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return handler(calls[calls.length - 1]);
  };
  fn.calls = calls;
  return fn;
}

function openaiResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() { return JSON.stringify(payload); },
  };
}

test("a data URL is decoded and a junk string is refused", () => {
  const parsed = parseDataImage(DRAWING);
  assert.equal(parsed.type, "image/png");
  assert.ok(parsed.bytes.length);
  assert.equal(parseDataImage("not-an-image"), null);
  assert.equal(parseDataImage("data:text/plain;base64,YQ=="), null);
});

test("the OpenAI edit call carries the drawing and the client prompt", async () => {
  const fetch = fakeOpenai(() => openaiResponse(200, { data: [{ b64_json: PNG_1X1 }] }));
  const image = await generateVisualization({
    apiKey: "sk-test",
    image: DRAWING,
    fetch,
  });
  assert.equal(image, `data:image/png;base64,${PNG_1X1}`);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, "https://api.openai.com/v1/images/edits");
  assert.equal(fetch.calls[0].headers.Authorization, "Bearer sk-test");
  const body = fetch.calls[0].body.toString("utf8");
  assert.match(body, /gpt-image-1/);
  assert.match(body, /name="image\[\]"/);
  assert.ok(body.includes(VISUALIZE_PROMPT.slice(0, 40)));
});

/**
 * A private server per case. helpers.testServer() is one process-wide
 * singleton, and these cases disagree on the OpenAI key.
 */
async function visualizeServer(options = {}) {
  const pool = createPool(TEST_DATABASE_URL);
  const api = createApi(pool, { secureCookies: false, ...options });
  const server = createServer(async (req, res) => {
    if (await api(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

test("visualize requires a session", async () => {
  const { baseUrl, close } = await visualizeServer({
    openaiApiKey: "sk-test",
    openaiFetch: fakeOpenai(() => openaiResponse(200, { data: [{ b64_json: PNG_1X1 }] })),
  });
  try {
    const res = await fetch(new URL("/api/visualize", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: DRAWING }),
    });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("visualize is 503 when no key is configured", async () => {
  const { baseUrl, close } = await visualizeServer({ openaiApiKey: "" });
  try {
    const { client } = await signedUpAgent(baseUrl);
    const res = await client.post("/api/visualize", { image: DRAWING });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "Visualization is not configured");
  } finally {
    await close();
  }
});

test("visualize returns the rendered image and never calls OpenAI without one", async () => {
  const openaiFetch = fakeOpenai(() => openaiResponse(200, { data: [{ b64_json: PNG_1X1 }] }));
  const { baseUrl, close } = await visualizeServer({ openaiApiKey: "sk-test", openaiFetch });
  try {
    const { client } = await signedUpAgent(baseUrl);

    const missing = await client.post("/api/visualize", {});
    assert.equal(missing.status, 400);
    assert.equal(openaiFetch.calls.length, 0);

    const ok = await client.post("/api/visualize", { image: DRAWING });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.image, `data:image/png;base64,${PNG_1X1}`);
    assert.equal(openaiFetch.calls.length, 1);
  } finally {
    await close();
  }
});

test("an exhausted OpenAI balance is a 402 the planner can show", async () => {
  const openaiFetch = fakeOpenai(() => openaiResponse(429, {
    error: { message: "You have no credits remaining. Add credits to continue.", code: "insufficient_quota" },
  }));
  const { baseUrl, close } = await visualizeServer({ openaiApiKey: "sk-test", openaiFetch });
  try {
    const { client } = await signedUpAgent(baseUrl);
    const res = await client.post("/api/visualize", { image: DRAWING });
    assert.equal(res.status, 402);
    assert.match(res.body.error, /no credits remaining/i);
    assert.equal(JSON.stringify(res.body).includes("sk-test"), false);
  } finally {
    await close();
  }
});

test("an OpenAI failure is a 502 without leaking the upstream body", async () => {
  const openaiFetch = fakeOpenai(() => openaiResponse(400, {
    error: { message: "billing hard stop sk-live-secret" },
  }));
  const { baseUrl, close } = await visualizeServer({ openaiApiKey: "sk-test", openaiFetch });
  try {
    const { client } = await signedUpAgent(baseUrl);
    const res = await client.post("/api/visualize", { image: DRAWING });
    assert.equal(res.status, 502);
    assert.equal(res.body.error, "The visualization could not be generated");
    assert.equal(JSON.stringify(res.body).includes("sk-live-secret"), false);
  } finally {
    await close();
  }
});
