// Photorealistic visualization of the current 3D massing snapshot.
//
// The OpenAI call is the same shape as the mobile helper in lib/gpt.js —
// a Bearer key and a POST to api.openai.com — except this one also sends
// the snapshot. From an orbit view the client may send two more: the
// opposite side, then a higher view of the roof. The first image stays
// the camera. /v1/images/generations (DALL-E 3) cannot see an upload, and
// the prompt treats that upload as the design. /v1/images/edits is the
// endpoint that accepts both. gpt-image-1 was shut down on 23 October 2026;
// gpt-image-2.5-sunburst is the replacement the images API documents.
//
// The wording lives in web/v2 so the 3D panel can show the same text it sends.
// A blank client prompt falls back to that built-in wording.

import { resolveVisualizePrompt, withReferenceImages } from "../../web/v2/visualize-prompts.js";

export {
  MAX_VISUALIZE_PROMPT,
  VISUALIZE_BUILTIN,
  VISUALIZE_EXAMPLES,
  VISUALIZE_PROMPT,
  resolveVisualizePrompt,
  visualizePromptId,
  withReferenceImages,
} from "../../web/v2/visualize-prompts.js";

const MAX_REFERENCE_IMAGES = 3;

const DATA_IMAGE = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function parseDataImage(dataUrl) {
  const match = typeof dataUrl === "string" ? dataUrl.trim().match(DATA_IMAGE) : null;
  if (!match) return null;
  const type = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  let bytes;
  try {
    bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  return { type, bytes, filename: type === "image/jpeg" ? "drawing.jpg" : "drawing.png" };
}

export async function generateVisualization({
  apiKey,
  image,
  images,
  prompt,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  const { files, roles } = collectImages(image, images);
  const text = withReferenceImages(resolveVisualizePrompt(prompt), roles);
  if (!apiKey) {
    const error = new Error("Generate model needs an OpenAI API key. Set OPENAI_API_KEY on the server and restart.");
    error.status = 503;
    throw error;
  }

  const encoded = encodeMultipart(
    {
      model: "gpt-image-2.5-sunburst",
      prompt: text,
      size: "1536x1024",
      quality: "high",
    },
    files,
  );

  const res = await fetchImpl("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": encoded.contentType,
    },
    body: encoded.body,
  });

  const payload = await readJson(res);
  const item = payload?.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return item.url;

  throw openaiFailure(payload, res.status);
}

function openaiFailure(payload, httpStatus) {
  const code = payload?.error?.code;
  const upstream = String(payload?.error?.message || `OpenAI returned ${httpStatus}`);
  if (code === "insufficient_quota" || /no credits remaining/i.test(upstream)) {
    const error = new Error("OpenAI has no credits remaining. Add credits on the OpenAI billing page.");
    error.status = 402;
    error.code = "insufficient_quota";
    return error;
  }
  const error = new Error(redact(upstream));
  error.status = 502;
  error.code = code || "openai_error";
  error.param = payload?.error?.param || "";
  return error;
}

function redact(text) {
  return String(text || "").replace(/sk-[A-Za-z0-9_-]+/g, "sk-…").slice(0, 300);
}

function collectImages(image, images) {
  if (images != null && !Array.isArray(images)) {
    const error = new Error("Images must be a list");
    error.status = 400;
    throw error;
  }
  const list = Array.isArray(images) && images.length ? images : (image ? [image] : []);
  if (!list.length) {
    const error = new Error("A drawing image is required");
    error.status = 400;
    throw error;
  }
  if (list.length > MAX_REFERENCE_IMAGES) {
    const error = new Error("Send at most three views");
    error.status = 400;
    throw error;
  }
  const files = [];
  const roles = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const data = typeof item === "string" ? item : item?.image;
    const parsed = parseDataImage(data);
    if (!parsed) {
      const error = new Error("A drawing image is required");
      error.status = 400;
      throw error;
    }
    const role = item && typeof item === "object" ? String(item.role || "") : "";
    const name = role === "opposite" ? "opposite" : role === "roof" ? "roof" : "drawing";
    parsed.filename = parsed.type === "image/jpeg" ? `${name}.jpg` : `${name}.png`;
    files.push(parsed);
    if (i > 0 && (role === "opposite" || role === "roof")) roles.push(role);
  }
  return { files, roles };
}

function encodeMultipart(fields, files) {
  const boundary = `----sp${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const push = (part) => chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part, "utf8"));
  for (const [name, value] of Object.entries(fields)) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    push(`${value}\r\n`);
  }
  for (const file of files) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="image[]"; filename="${file.filename}"\r\n`);
    push(`Content-Type: ${file.type}\r\n\r\n`);
    push(file.bytes);
    push("\r\n");
  }
  push(`--${boundary}--\r\n`);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks),
  };
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
