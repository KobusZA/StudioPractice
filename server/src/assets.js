// The underlay file lives in `asset`, not in the drawing document.
//
// A scanned sheet is tens of megabytes. Putting those bytes in `drawing.doc`
// would copy them into every autosave and every revision snapshot. The drawing
// keeps the placement and an id; this module is the rules around the bytes.

/** One plan set. Large enough for a multi-page concept PDF, small enough to refuse a dump. */
export const MAX_UNDERLAY_BYTES = 128 * 1024 * 1024;

/** Live files across the firm. A deleted job does not count; see the quota query. */
export const ORG_UNDERLAY_QUOTA_BYTES = 4 * 1024 * 1024 * 1024;

const UNDERLAY_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function declaredMime(header) {
  const mime = String(header || "").split(";")[0].trim().toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  return mime;
}

/**
 * What the bytes actually are, not what the request claims. A declared type
 * that disagrees is refused. `application/octet-stream` and an empty type
 * defer to the bytes, which is what a browser gives a file it does not know.
 * Returns the mime to store, or null.
 */
export function sniffUnderlay(bytes, contentType) {
  if (!bytes || bytes.length < 5) return null;
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let detected = null;
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") detected = "application/pdf";
  else if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) detected = "image/png";
  else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) detected = "image/jpeg";
  else if (b.length >= 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a")) detected = "image/gif";
  else if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") detected = "image/webp";
  if (!detected || !UNDERLAY_MIMES.has(detected)) return null;
  const declared = declaredMime(contentType);
  if (declared && declared !== "application/octet-stream" && declared !== detected) return null;
  return detected;
}

/**
 * Ids the drawing says it is showing: every source file of the sheet set, the
 * single-file fields older documents carry, and an image underlay. A
 * satellite source has no file and contributes none.
 */
export function underlayAssetIds(doc) {
  const ids = [];
  const push = (id) => {
    if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
  };
  for (const source of Array.isArray(doc?.sheetSet?.sources) ? doc.sheetSet.sources : []) {
    if (source && source.mime !== "satellite") push(source.assetId);
  }
  push(doc?.sheetSet?.assetId);
  push(doc?.underlay?.assetId);
  return ids;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A client-supplied hash, lower-cased, or null when it is not 64 hex characters. */
export function cleanSha256(value) {
  const hex = String(value ?? "").trim().toLowerCase();
  return SHA256_HEX.test(hex) ? hex : null;
}

/**
 * Point a copied drawing at its own copies of the files. An id with no copy
 * is removed, so the copy does not keep a pointer at the original job's row.
 * Returns whether the document changed.
 */
export function retargetUnderlayAssets(doc, map) {
  const retarget = (holder) => {
    if (!holder || typeof holder.assetId !== "string" || !holder.assetId) return false;
    if (map[holder.assetId]) holder.assetId = map[holder.assetId];
    else delete holder.assetId;
    return true;
  };
  const sheet = retarget(doc?.sheetSet);
  const image = retarget(doc?.underlay);
  let sources = false;
  for (const source of Array.isArray(doc?.sheetSet?.sources) ? doc.sheetSet.sources : []) {
    if (source && source.mime !== "satellite" && retarget(source)) sources = true;
  }
  return sheet || image || sources;
}
