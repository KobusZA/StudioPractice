import { createServer } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/api.js";
import { createPool } from "../src/db.js";
import {
  generateVisualization, parseDataImage, VISUALIZE_EXAMPLES, VISUALIZE_PROMPT,
  MAX_VISUALIZE_PROMPT, resolveVisualizePrompt, withReferenceImages,
} from "../src/visualize.js";
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
  assert.match(body, /gpt-image-2\.5-sunburst/);
  assert.match(body, /name="image\[\]"/);
  assert.equal(body.split('name="image[]"').length - 1, 1);
  assert.ok(body.includes(VISUALIZE_PROMPT.slice(0, 40)));
  assert.equal(body.includes("opposite side"), false);
});

test("extra views stay behind the camera, and a single image is not relabelled", () => {
  assert.equal(withReferenceImages("Keep it.", []), "Keep it.");
  const both = withReferenceImages("Keep it.", ["opposite", "roof"]);
  assert.match(both, /first image is the photograph/);
  assert.match(both, /second image is the opposite side/);
  assert.match(both, /third image is a higher view/);
  const roofOnly = withReferenceImages("Keep it.", ["roof"]);
  assert.match(roofOnly, /second image is a higher view/);
  assert.equal(roofOnly.includes("opposite side"), false);
});

test("the edit call sends the camera, the opposite side and the roof", async () => {
  const fetch = fakeOpenai(() => openaiResponse(200, { data: [{ b64_json: PNG_1X1 }] }));
  await generateVisualization({
    apiKey: "sk-test",
    images: [
      { role: "camera", image: DRAWING },
      { role: "opposite", image: DRAWING },
      { role: "roof", image: DRAWING },
    ],
    prompt: "Painted plaster.",
    fetch,
  });
  const body = fetch.calls[0].body.toString("utf8");
  assert.equal(body.split('name="image[]"').length - 1, 3);
  assert.match(body, /filename="drawing.png"/);
  assert.match(body, /filename="opposite.png"/);
  assert.match(body, /filename="roof.png"/);
  assert.match(body, /Painted plaster/);
  assert.match(body, /opposite side/);
  assert.match(body, /higher view/);
  assert.match(body, /Do not average the images/);
});

test("a fourth view is refused before OpenAI is called", async () => {
  const fetch = fakeOpenai(() => openaiResponse(200, { data: [{ b64_json: PNG_1X1 }] }));
  await assert.rejects(
    () => generateVisualization({
      apiKey: "sk-test",
      images: [DRAWING, DRAWING, DRAWING, DRAWING],
      fetch,
    }),
    (error) => error.status === 400 && /three/.test(error.message),
  );
  assert.equal(fetch.calls.length, 0);
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

test("a blank prompt is the built-in one, and a custom prompt is the one sent", () => {
  assert.equal(resolveVisualizePrompt("  "), VISUALIZE_PROMPT);
  assert.equal(resolveVisualizePrompt("Face brick walls."), "Face brick walls.");
  assert.throws(() => resolveVisualizePrompt(12), /must be text/);
  assert.throws(() => resolveVisualizePrompt("x".repeat(MAX_VISUALIZE_PROMPT + 1)), /too long/);
});

test("example prompts stay inside the limit and still describe the massing", () => {
  assert.ok(VISUALIZE_EXAMPLES.length >= 4);
  for (const example of VISUALIZE_EXAMPLES) {
    assert.ok(example.prompt.length <= MAX_VISUALIZE_PROMPT, example.id);
    assert.match(example.prompt, /coloured 3D massing model/);
    assert.match(example.prompt, /Do not add floors/);
    assert.equal(resolveVisualizePrompt(example.prompt), example.prompt);
  }
});

test("visualize sends the client's prompt instead of the built-in one", async () => {
  const fetch = fakeOpenai(() => openaiResponse(200, { data: [{ b64_json: PNG_1X1 }] }));
  await generateVisualization({
    apiKey: "sk-test",
    image: DRAWING,
    prompt: "Painted plaster and a corrugated roof. Keep the model.",
    fetch,
  });
  const body = fetch.calls[0].body.toString("utf8");
  assert.match(body, /Painted plaster and a corrugated roof/);
  assert.equal(body.includes(VISUALIZE_PROMPT.slice(0, 40)), false);
});

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
    assert.match(res.body.error, /OPENAI_API_KEY/);
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

test("a prompt past the limit is refused before OpenAI is called", async () => {
  const openaiFetch = fakeOpenai(() => openaiResponse(200, { data: [{ b64_json: PNG_1X1 }] }));
  const { baseUrl, close } = await visualizeServer({ openaiApiKey: "sk-test", openaiFetch });
  try {
    const { client } = await signedUpAgent(baseUrl);
    const res = await client.post("/api/visualize", {
      image: DRAWING,
      prompt: "x".repeat(MAX_VISUALIZE_PROMPT + 1),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /too long/);
    assert.equal(openaiFetch.calls.length, 0);
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
