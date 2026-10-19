import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addressSuggestions,
  chooseGeocodeHit,
  geocodeCandidatesFromPayload,
  metresPerPixel,
  normalizeSatelliteUnderlay,
  parseCoordinates,
  resolveLocation,
  satelliteView,
  suggestAddresses,
  worldPixel,
} from "../satellite.js";
import { clearUnderlay, loadSatelliteUnderlay, restoreSatelliteUnderlay, underlayBitmap } from "../underlay.js";
import { emptyDoc, normalizeDoc } from "../model.js";
import { ribbonItems } from "../ribbon.js";

const close = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// --- coordinates ----------------------------------------------------------

test("decimal coordinates parse as copied from a map", () => {
  assert.deepEqual(parseCoordinates("-25.7479, 28.2293"), { lat: -25.7479, lng: 28.2293 });
  assert.deepEqual(parseCoordinates("  -25.7479 28.2293 "), { lat: -25.7479, lng: 28.2293 });
  assert.deepEqual(parseCoordinates("-25.7479;28.2293"), { lat: -25.7479, lng: 28.2293 });
});

test("comma decimals parse when the pair is space separated", () => {
  assert.deepEqual(parseCoordinates("-25,7479 28,2293"), { lat: -25.7479, lng: 28.2293 });
});

test("degrees, minutes and seconds parse with hemisphere letters in either order", () => {
  const dms = parseCoordinates(`25°44'52.4"S 28°13'45.5"E`);
  close(dms.lat, -(25 + 44 / 60 + 52.4 / 3600));
  close(dms.lng, 28 + 13 / 60 + 45.5 / 3600);
  const swapped = parseCoordinates(`28°13'45.5"E, 25°44'52.4"S`);
  close(swapped.lat, dms.lat);
  close(swapped.lng, dms.lng);
  const decimalHemi = parseCoordinates("25.7479 S, 28.2293 E");
  close(decimalHemi.lat, -25.7479);
  close(decimalHemi.lng, 28.2293);
});

const ABERDEEN = {
  candidates: [
    {
      address: "94 Aberdeen Road, Centurion, City of Tshwane, Gauteng, 0157",
      location: { x: 28.176316287451, y: -25.831564998176 },
      score: 93.06,
      attributes: { Score: 93.06, Addr_type: "PointAddress" },
    },
    {
      address: "0014, City of Tshwane, Gauteng",
      location: { x: 28.1738163, y: -25.8364978 },
      score: 81.53,
      attributes: { Score: 81.53, Addr_type: "Postal" },
    },
  ],
};

test("a street match is kept and a postal-code centroid is not", () => {
  const candidates = geocodeCandidatesFromPayload(ABERDEEN);
  const hit = chooseGeocodeHit(candidates);
  assert.equal(hit.label, "94 Aberdeen Road, Centurion, City of Tshwane, Gauteng, 0157");
  close(hit.lat, -25.831564998176, 1e-9);
  close(hit.lng, 28.176316287451, 1e-9);
  const hints = addressSuggestions(candidates, [
    { label: "94 Aberdeen Road, Centurion, City of Tshwane, Gauteng, 0157", magicKey: "same" },
    { label: "94 Aberdeen Street, Johannesburg, City of Johannesburg, Gauteng, 2092", magicKey: "other" },
    { label: "0014, City of Tshwane, Gauteng", magicKey: "postal" },
  ]);
  assert.equal(hints.length, 2);
  assert.equal(hints[0].lat, hit.lat);
  assert.equal(hints[1].magicKey, "other");
  assert.equal(chooseGeocodeHit(candidates.filter((c) => c.kind === "Postal")), null);
});

test("addresses and impossible coordinates are not coordinates", () => {
  assert.equal(parseCoordinates("12 Church Street, Pretoria"), null);
  assert.equal(parseCoordinates("95, 28"), null);
  assert.equal(parseCoordinates("-25.7, 190"), null);
  assert.equal(parseCoordinates(`25°S 28°S`), null);
  assert.equal(parseCoordinates(""), null);
});

// --- scale ----------------------------------------------------------------

test("ground resolution follows the Web Mercator formula", () => {
  close(metresPerPixel(0, 19), 0.29858, 1e-5);
  close(metresPerPixel(-25.7479, 19), 0.29858 * Math.cos((25.7479 * Math.PI) / 180), 1e-5);
  close(metresPerPixel(-25.7479, 18), 2 * metresPerPixel(-25.7479, 19), 1e-9);
});

test("the equator and prime meridian sit at the centre of the world", () => {
  const p = worldPixel(0, 0, 3);
  close(p.x, 256 * 4);
  close(p.y, 256 * 4);
  assert.ok(worldPixel(-25, 28, 3).y > p.y, "south is further down");
});

test("a 200 m view is sized by the ground resolution and fully covered by tiles", () => {
  const view = satelliteView(-25.7479, 28.2293, 19, 200);
  close(view.size * view.metresPerPixel, 200, view.metresPerPixel);
  for (const axis of ["dx", "dy"]) {
    const starts = [...new Set(view.tiles.map((t) => t[axis]))].sort((a, b) => a - b);
    assert.ok(starts[0] <= 0, `${axis}: the first tile starts at or before the image edge`);
    assert.ok(starts.at(-1) + 256 >= view.size, `${axis}: the last tile reaches the far edge`);
    starts.slice(1).forEach((s, i) => assert.equal(s - starts[i], 256, `${axis}: tiles abut`));
  }
});

// --- persistence -------------------------------------------------------------

function satellitePlacement(overrides = {}) {
  return {
    name: "Satellite: -25.74790, 28.22930",
    pixelWidth: 746,
    pixelHeight: 746,
    x: -100,
    y: -100,
    metresPerPixel: 0.268,
    opacity: 0.7,
    rotation: 0,
    hidden: false,
    calibrated: true,
    source: { type: "satellite", lat: -25.7479, lng: 28.2293, zoom: 19, areaMetres: 200, label: "-25.74790, 28.22930" },
    ...overrides,
  };
}

test("a satellite underlay survives a reload; a PDF one is still dropped", () => {
  const withSatellite = normalizeDoc({ ...emptyDoc(), underlay: satellitePlacement() });
  assert.deepEqual(withSatellite.underlay, satellitePlacement());

  const withPdf = normalizeDoc({ ...emptyDoc(), underlay: { name: "scan.pdf", x: 0, y: 0, metresPerPixel: 0.01 } });
  assert.equal(withPdf.underlay, undefined);
});

test("a malformed satellite placement is dropped rather than half-loaded", () => {
  assert.equal(normalizeSatelliteUnderlay(satellitePlacement({ metresPerPixel: 0 })), null);
  assert.equal(normalizeSatelliteUnderlay(satellitePlacement({ x: "0" })), null);
  assert.equal(normalizeSatelliteUnderlay({ ...satellitePlacement(), source: { type: "satellite", lat: 99, lng: 0, zoom: 19, areaMetres: 200 } }), null);
});

// --- loading, with the network stubbed --------------------------------------

function stubBrowser({ missingAbove = Infinity } = {}) {
  const saved = { fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap, OffscreenCanvas: globalThis.OffscreenCanvas };
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const zoom = Number(String(url).match(/\/tile\/(\d+)\//)?.[1]);
    if (zoom > missingAbove) return { ok: false, status: 404 };
    return { ok: true, status: 200, blob: async () => ({}) };
  };
  globalThis.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { drawImage() {} }; }
    transferToImageBitmap() { return { width: this.width, height: this.height }; }
  };
  return {
    requests,
    restore() { Object.assign(globalThis, saved); },
  };
}

test("a satellite view loads calibrated, north-up and centred on the given point", async () => {
  const browser = stubBrowser();
  try {
    const doc = emptyDoc();
    const result = await loadSatelliteUnderlay(doc, "-25.7479, 28.2293", { x: 10, y: 20 });
    assert.equal(result.ok, true, result.message);
    const u = doc.underlay;
    assert.equal(u.calibrated, true);
    assert.equal(u.rotation, 0);
    assert.equal(u.source.zoom, 19);
    close(u.metresPerPixel, metresPerPixel(-25.7479, 19), 1e-12);
    close(u.x + (u.pixelWidth * u.metresPerPixel) / 2, 10);
    close(u.y + (u.pixelHeight * u.metresPerPixel) / 2, 20);
    assert.ok(browser.requests.every((r) => r.includes("blankTile=false")));
  } finally {
    browser.restore();
    clearUnderlay({});
  }
});

test("where the sharpest imagery is missing, the next zoom down is used", async () => {
  const browser = stubBrowser({ missingAbove: 17 });
  try {
    const doc = emptyDoc();
    const result = await loadSatelliteUnderlay(doc, "-25.7479, 28.2293", { x: 0, y: 0 });
    assert.equal(result.ok, true, result.message);
    assert.equal(doc.underlay.source.zoom, 17);
  } finally {
    browser.restore();
    clearUnderlay({});
  }
});

test("a reopened satellite underlay fetches its pixels once", async () => {
  const browser = stubBrowser();
  try {
    clearUnderlay({});
    const doc = normalizeDoc({ ...emptyDoc(), underlay: satellitePlacement() });
    const pending = restoreSatelliteUnderlay(doc);
    assert.ok(pending, "a restore starts");
    assert.equal(restoreSatelliteUnderlay(doc), null, "a second redraw does not start another");
    assert.equal(await pending, "shown");
    assert.ok(underlayBitmap());
    assert.equal(restoreSatelliteUnderlay(doc), null, "nothing to do once it is showing");
  } finally {
    browser.restore();
    clearUnderlay({});
  }
});

test("an address the map knows is resolved, including a street abbreviated as St", async () => {
  const saved = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const body = String(url).includes("/suggest")
      ? { suggestions: [{ text: "94 Aberdeen Street, Johannesburg, City of Johannesburg, Gauteng, 2092, ZAF", magicKey: "jhb", isCollection: false }] }
      : ABERDEEN;
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const hit = await resolveLocation("94 Aberdeen St, Clubview, Centurion, 0014");
    assert.equal(hit.ok, true, hit.message);
    close(hit.lat, -25.831564998176, 1e-9);
    close(hit.lng, 28.176316287451, 1e-9);
    assert.match(urls[0], /findAddressCandidates/);
    assert.match(urls[0], /countryCode=ZAF/);
    assert.match(urls[0], /Aberdeen/);

    const hints = await suggestAddresses("94 Aberdeen St, Clubview");
    assert.equal(hints[0].label, "94 Aberdeen Road, Centurion, City of Tshwane, Gauteng, 0157");
    assert.equal(hints[1].label, "94 Aberdeen Street, Johannesburg, City of Johannesburg, Gauteng, 2092");
    assert.deepEqual(await suggestAddresses("-25.7479, 28.2293"), []);
  } finally {
    globalThis.fetch = saved;
  }
});

test("an address the geocoder does not know stays a miss", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) });
  try {
    const hit = await resolveLocation("Nowhere Road, Faketown");
    assert.equal(hit.ok, false);
    assert.match(hit.message, /Could not find/);
  } finally {
    globalThis.fetch = saved;
  }
});

// --- ribbon -------------------------------------------------------------------

test("Satellite is a ribbon command beside PDF / image", () => {
  assert.equal(ribbonItems().get("satellite")?.command, "satellite");
});
