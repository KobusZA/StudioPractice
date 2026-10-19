// Satellite imagery as an underlay: an address or a coordinate in, a north-up
// image at true scale out.
//
// Unlike a scanned PDF, the scale is known rather than measured. Web Mercator
// tiles have a fixed ground resolution for a given zoom and latitude, so the
// sheet arrives calibrated and the two-click Set scale is only for
// fine-tuning against a measured distance.
//
// Imagery is Esri World Imagery. Address search is the Esri World Geocoding
// Service, limited to South Africa: it resolves the same street abbreviations
// and suburbs that a map does, which OpenStreetMap's gazetteer does not have
// for most of the country. Both are used without a key and both require
// attribution while the result is on screen (SATELLITE_ATTRIBUTION).
// Commercial use needs an ArcGIS Location Platform key instead.

const TILE_SIZE = 256;
const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const GEOCODE_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";
const SUGGEST_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest";

/** House, street and named-place matches. A postal-code centroid is not one of these. */
const SPECIFIC_ADDRESS = new Set(["PointAddress", "StreetAddress", "StreetName", "Subaddress", "POI"]);
const MIN_ADDRESS_SCORE = 75;

/** Ground metres per pixel at the equator, zoom 0: 2πR / 256 with R = 6 378 137 m. */
const EQUATOR_METRES_PER_PIXEL = 156543.03392;

/** Web Mercator stops here; beyond it the projection runs to infinity. */
const MAX_LATITUDE = 85.05112878;

/** Sharpest first. Rural areas often stop at 17 or 18, which is still traceable. */
const ZOOM_LEVELS = [19, 18, 17];

export const SATELLITE_AREA_METRES = 200;

export const SATELLITE_ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics · Search © Esri";

function validLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > MAX_LATITUDE || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// One axis of "25°44'52.4\"S" or "25.7479 S". Degrees alone is allowed so a
// decimal with a hemisphere letter parses through the same path.
const HEMISPHERE_PART = /(\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″”]|''|′′)\s*)?([NSEW])/gi;

/**
 * Read a typed coordinate. Accepts "-25.7479, 28.2293" (what Google Maps
 * copies on right-click), "-25,7479 28,2293" (comma decimals), and
 * degrees-minutes-seconds with hemisphere letters in either order. Returns
 * null for anything else, which the caller treats as an address.
 */
export function parseCoordinates(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;

  const decimal = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (decimal) return validLatLng(Number(decimal[1]), Number(decimal[2]));

  const commaDecimal = s.match(/^(-?\d{1,2},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)$/);
  if (commaDecimal) {
    return validLatLng(Number(commaDecimal[1].replace(",", ".")), Number(commaDecimal[2].replace(",", ".")));
  }

  const parts = [...s.matchAll(HEMISPHERE_PART)];
  if (parts.length !== 2) return null;
  let lat = null;
  let lng = null;
  for (const [, deg, min, sec, hemi] of parts) {
    const value = Number(deg) + Number(min || 0) / 60 + Number(sec || 0) / 3600;
    const h = hemi.toUpperCase();
    if (h === "N" || h === "S") lat = h === "S" ? -value : value;
    else lng = h === "W" ? -value : value;
  }
  if (lat === null || lng === null) return null;
  return validLatLng(lat, lng);
}

export function metresPerPixel(lat, zoom) {
  return (EQUATOR_METRES_PER_PIXEL * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Global Web Mercator pixel position of a coordinate at `zoom`, origin at the north-west corner of the world. */
export function worldPixel(lat, lng, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * The square image `areaMetres` across centred on the coordinate: its pixel
 * size, its ground resolution, and every tile it overlaps with the offset at
 * which that tile is drawn into it. Pure, so the maths is testable without a
 * network.
 */
export function satelliteView(lat, lng, zoom, areaMetres = SATELLITE_AREA_METRES) {
  const mpp = metresPerPixel(lat, zoom);
  const size = Math.max(1, Math.round(areaMetres / mpp));
  const centre = worldPixel(lat, lng, zoom);
  const left = Math.round(centre.x - size / 2);
  const top = Math.round(centre.y - size / 2);
  const tilesAcross = 2 ** zoom;

  const tiles = [];
  for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.floor((top + size - 1) / TILE_SIZE); ty++) {
    for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.floor((left + size - 1) / TILE_SIZE); tx++) {
      tiles.push({
        x: ((tx % tilesAcross) + tilesAcross) % tilesAcross,
        y: ty,
        dx: tx * TILE_SIZE - left,
        dy: ty * TILE_SIZE - top,
      });
    }
  }
  return { metresPerPixel: mpp, size, tiles };
}

/** `blankTile=false` makes a gap in coverage a 404 rather than a grey "no data" picture we would happily trace. */
function tileUrl(zoom, x, y) {
  return `${TILE_URL}/${zoom}/${y}/${x}?blankTile=false`;
}

async function fetchTile(zoom, x, y) {
  const res = await fetch(tileUrl(zoom, x, y));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the imagery server answered ${res.status}`);
  return createImageBitmap(await res.blob());
}

/**
 * Download and stitch the tiles for one view at exactly `zoom`. Resolves to
 * { ok: false, missing: true } when any tile has no imagery, so the caller
 * can step down a zoom level instead of showing a hole.
 */
export async function fetchSatelliteImage({ lat, lng, zoom, areaMetres = SATELLITE_AREA_METRES }) {
  const view = satelliteView(lat, lng, zoom, areaMetres);
  const canvas = new OffscreenCanvas(view.size, view.size);
  const ctx = canvas.getContext("2d");
  try {
    const drawn = await Promise.all(view.tiles.map(async (tile) => {
      const bmp = await fetchTile(zoom, tile.x, tile.y);
      if (!bmp) return false;
      ctx.drawImage(bmp, tile.dx, tile.dy);
      bmp.close();
      return true;
    }));
    if (drawn.includes(false)) return { ok: false, missing: true, message: "No satellite imagery at that zoom." };
  } catch (err) {
    return { ok: false, message: `Could not download the satellite imagery: ${err.message}` };
  }
  return { ok: true, bitmap: canvas.transferToImageBitmap(), metresPerPixel: view.metresPerPixel, zoom };
}

/** The sharpest zoom that has imagery for the whole square. */
export async function fetchBestSatelliteImage(lat, lng, areaMetres = SATELLITE_AREA_METRES) {
  for (const zoom of ZOOM_LEVELS) {
    const image = await fetchSatelliteImage({ lat, lng, zoom, areaMetres });
    if (image.ok || !image.missing) return image;
  }
  return { ok: false, message: "There is no detailed satellite imagery for that spot." };
}

function candidateUrl(query, { magicKey, limit = 5 } = {}) {
  const params = new URLSearchParams({
    f: "json",
    singleLine: query,
    maxLocations: String(limit),
    outFields: "Score,Addr_type",
  });
  if (magicKey) params.set("magicKey", magicKey);
  else params.set("countryCode", "ZAF");
  return `${GEOCODE_URL}?${params}`;
}

function suggestUrl(query) {
  const params = new URLSearchParams({
    f: "json",
    text: query,
    countryCode: "ZAF",
    maxSuggestions: "6",
  });
  return `${SUGGEST_URL}?${params}`;
}

async function fetchJson(url, signal) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`the address search answered ${res.status}`);
  const body = await res.json();
  if (body?.error) throw new Error(body.error.message || "the address search failed");
  return body;
}

/** Esri returns longitude as x and latitude as y. */
export function geocodeCandidatesFromPayload(payload) {
  const rows = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const out = [];
  for (const row of rows) {
    const where = validLatLng(Number(row?.location?.y), Number(row?.location?.x));
    if (!where || !row.address) continue;
    const score = Number(row.score ?? row.attributes?.Score);
    out.push({
      ...where,
      label: String(row.address),
      score: Number.isFinite(score) ? score : 0,
      kind: String(row.attributes?.Addr_type || ""),
    });
  }
  return out;
}

/** The match to load: a house or street ahead of a postal-code centroid. */
export function chooseGeocodeHit(candidates) {
  const specific = candidates.find((c) => SPECIFIC_ADDRESS.has(c.kind) && c.score >= MIN_ADDRESS_SCORE);
  if (specific) return specific;
  return candidates.find((c) => c.kind !== "Postal" && c.score >= 85) || null;
}

export function suggestHintsFromPayload(payload) {
  const rows = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  return rows.filter((row) => row?.text && !row.isCollection).map((row) => ({
    label: String(row.text).replace(/, ZAF$/, ""),
    magicKey: row.magicKey || "",
  }));
}

function samePlaceLabel(a, b) {
  const norm = (s) => String(s).toLowerCase().replace(/, zaf$/, "").trim();
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/** Matched places first, then typeahead hints that name somewhere the match list does not. */
export function addressSuggestions(candidates, hints = []) {
  const specific = candidates.filter((c) => SPECIFIC_ADDRESS.has(c.kind) && c.score >= MIN_ADDRESS_SCORE);
  const base = specific.length ? specific : candidates.filter((c) => c.kind !== "Postal" && c.score >= 80);
  const list = base.slice(0, 6).map(({ lat, lng, label }) => ({ lat, lng, label }));
  for (const hint of hints) {
    if (list.length >= 6 || !hint?.label) continue;
    // A full address makes the typeahead offer the postal code alone. That is
    // the suburb's centre, not the house, so it stays off the list once a
    // street match is already there.
    if (list.length && /^\d{4},/.test(hint.label)) continue;
    if (list.some((item) => samePlaceLabel(item.label, hint.label))) continue;
    list.push({ label: hint.label, magicKey: hint.magicKey || "" });
  }
  return list;
}

/**
 * South African addresses. `magicKey` is the token from a typeahead hint, and
 * pins the result to that exact suggestion.
 */
export async function geocodeAddress(query, { magicKey, signal } = {}) {
  const body = await fetchJson(candidateUrl(query, { magicKey, limit: magicKey ? 1 : 5 }), signal);
  const candidates = geocodeCandidatesFromPayload(body);
  if (magicKey) return candidates[0] || null;
  return chooseGeocodeHit(candidates);
}

/**
 * Matches for the address field. Coordinates are not searched. A short prefix
 * comes from the typeahead service; a fuller address also comes back as a
 * scored place, which is what resolves "St" to the road of that name.
 */
export async function suggestAddresses(query, { signal } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 3 || parseCoordinates(q)) return [];
  const settle = (promise) => promise.catch((err) => {
    if (err?.name === "AbortError") throw err;
    return [];
  });
  const [found, hinted] = await Promise.all([
    settle(fetchJson(candidateUrl(q), signal).then(geocodeCandidatesFromPayload)),
    settle(fetchJson(suggestUrl(q), signal).then(suggestHintsFromPayload)),
  ]);
  return addressSuggestions(found, hinted);
}

/** A hint the user picked: use its coordinate, or look the hint's token up. */
export async function locateSuggestion(item, { signal } = {}) {
  const direct = validLatLng(Number(item?.lat), Number(item?.lng));
  if (direct) return { ok: true, ...direct, label: item.label || formatLatLng(direct.lat, direct.lng) };
  if (!item?.magicKey || !item?.label) return { ok: false, message: "Could not use that suggestion." };
  try {
    const hit = await geocodeAddress(item.label, { magicKey: item.magicKey, signal });
    if (!hit) return { ok: false, message: `Could not find "${item.label}".` };
    return { ok: true, ...hit };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return { ok: false, message: `The address search failed: ${err.message}` };
  }
}

/** A typed coordinate is used as-is; anything else is looked up as an address. */
export async function resolveLocation(text) {
  const query = String(text ?? "").trim();
  if (!query) return { ok: false, message: "Type an address or coordinates first." };
  const coords = parseCoordinates(query);
  if (coords) return { ok: true, ...coords, label: formatLatLng(coords.lat, coords.lng) };
  try {
    const hit = await geocodeAddress(query);
    if (!hit) return { ok: false, message: `Could not find "${query}". Try a fuller address, or paste coordinates.` };
    return { ok: true, ...hit };
  } catch (err) {
    return { ok: false, message: `The address search failed: ${err.message}` };
  }
}

export function formatLatLng(lat, lng) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * Only a satellite underlay survives a reload: its pixels can be fetched again
 * from the saved coordinate, where a PDF's cannot. Anything malformed is
 * dropped rather than half-loaded.
 */
export function normalizeSatelliteUnderlay(raw) {
  const source = raw?.source;
  if (!source || source.type !== "satellite") return null;
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const numbers = [source.lat, source.lng, source.zoom, source.areaMetres, raw.x, raw.y, raw.metresPerPixel, raw.pixelWidth, raw.pixelHeight];
  if (!numbers.every(finite) || !validLatLng(source.lat, source.lng)) return null;
  if (raw.metresPerPixel <= 0 || raw.pixelWidth <= 0 || raw.pixelHeight <= 0) return null;
  return {
    name: typeof raw.name === "string" && raw.name ? raw.name : "Satellite",
    pixelWidth: raw.pixelWidth,
    pixelHeight: raw.pixelHeight,
    x: raw.x,
    y: raw.y,
    metresPerPixel: raw.metresPerPixel,
    opacity: finite(raw.opacity) ? Math.min(1, Math.max(0, raw.opacity)) : 0.7,
    rotation: finite(raw.rotation) ? raw.rotation : 0,
    hidden: Boolean(raw.hidden),
    calibrated: raw.calibrated !== false,
    source: {
      type: "satellite",
      lat: source.lat,
      lng: source.lng,
      zoom: source.zoom,
      areaMetres: source.areaMetres,
      label: typeof source.label === "string" ? source.label : null,
    },
  };
}
