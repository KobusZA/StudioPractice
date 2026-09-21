// Photorealistic visualization of the current 3D massing snapshot.
//
// The OpenAI call is the same shape as the mobile helper in lib/gpt.js —
// a Bearer key and a POST to api.openai.com — except this one also sends
// the drawing. /v1/images/generations (DALL-E 3) cannot see an upload, and
// the prompt below treats that upload as the design. /v1/images/edits with
// gpt-image-1 is the endpoint that accepts both.

export const VISUALIZE_PROMPT = `Transform the provided architectural drawing into a photorealistic architectural visualization.

IMPORTANT: Treat the uploaded drawing as the authoritative source for the building design. Preserve the architecture exactly as shown.

Preserve:
- Building footprint and overall proportions
- Number of floors
- Roof shape, roof pitch and roof structure
- Position, size and proportions of all windows and doors
- Wall positions and building volumes
- Porches, balconies, verandas, patios and other architectural elements
- Garage position and doors
- Steps, columns, walls and other structural features
- Relative position and proportions of all visible architectural elements

Do NOT redesign the building, add floors, remove rooms, move windows or doors, change the roof design, or introduce architectural features that are not present in the drawing.

Convert the drawing into a realistic finished building suitable for presentation to an architectural client.

Use:
- Realistic architectural materials
- Natural plaster, brick, concrete, timber, glass and metal where appropriate
- Physically realistic lighting and shadows
- Realistic reflections in windows
- Realistic landscaping appropriate to the building
- Natural-looking grass, plants, trees and paving
- High-quality realistic textures
- Professional architectural photography

Camera:
Create an attractive three-quarter exterior perspective showing the front and side of the building. Use a realistic eye-level architectural photography viewpoint with natural perspective and no extreme wide-angle distortion.

Lighting:
Use warm late-afternoon natural sunlight with realistic shadows and highlights. The building should be well illuminated and clearly visible.

Style:
Photorealistic architectural visualization, high-end architectural photography, realistic materials, realistic scale, realistic lighting, professional presentation quality.

The final image should look like a photograph of the completed building rather than a computer-generated sketch.

Do not include people unless they are specifically present in the source drawing.
Do not add text, dimensions, annotations, labels, watermarks or logos.`;

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
  prompt = VISUALIZE_PROMPT,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  const parsed = parseDataImage(image);
  if (!parsed) {
    const error = new Error("A drawing image is required");
    error.status = 400;
    throw error;
  }
  if (!apiKey) {
    const error = new Error("Visualization is not configured");
    error.status = 503;
    throw error;
  }

  const encoded = encodeMultipart(
    {
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: "high",
    },
    parsed,
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
  const error = new Error(upstream);
  error.status = 502;
  error.code = code || "openai_error";
  return error;
}

function encodeMultipart(fields, file) {
  const boundary = `----sp${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const push = (part) => chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part, "utf8"));
  for (const [name, value] of Object.entries(fields)) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    push(`${value}\r\n`);
  }
  push(`--${boundary}\r\n`);
  push(`Content-Disposition: form-data; name="image[]"; filename="${file.filename}"\r\n`);
  push(`Content-Type: ${file.type}\r\n\r\n`);
  push(file.bytes);
  push(`\r\n--${boundary}--\r\n`);
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
