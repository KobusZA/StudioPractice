import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeDoc } from "../model.js";
import { evaluateCompliance, groupFindingsByPart, summarizeFindings, RULE_PACK } from "../rules.js";
import { normalizePackUnits } from "../schema.js";

// The file on disk states geometry in millimetres (sp.pack/3); rules.js reads
// pack.system.wallHeight and SKU geometry in metres, so normalize at load
// exactly like ui.js does at runtime.
const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);

function findOne(findings, code, subjectMatch) {
  return findings.find((f) => f.code === code && (!subjectMatch || f.subject.includes(subjectMatch)));
}

// --- Part C -----------------------------------------------------------------

test("Part C: a bedroom with unknown ceiling height cannot be checked, not passed", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "b", name: "Main bedroom", use: "bedroom", rect: { x: 0, y: 0, w: 4, h: 4 }, wallSku: "TSP_MAS009" }],
  });
  // Sample pack's levels have floorToCeiling null (the documented gap), and
  // compile() falls back to system.wallHeight, so height is in fact known via
  // the fallback. Force the true "unknown" case by zeroing that fallback.
  const packNoHeight = structuredClone(pack);
  packNoHeight.system.wallHeight = null;
  const findings = evaluateCompliance(doc, packNoHeight);
  const height = findOne(findings, "part-c-height", "Main bedroom");
  assert.ok(height, "expected a Part C height finding");
  assert.equal(height.severity, "unknown");
});

test("Part C: a bedroom with a known height above 2.4 m passes", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "b", name: "Main bedroom", use: "bedroom", rect: { x: 0, y: 0, w: 4, h: 4 }, wallSku: "TSP_MAS009" }],
  });
  const findings = evaluateCompliance(doc, pack); // wallHeight fallback is 2.8 m
  const height = findOne(findings, "part-c-height", "Main bedroom");
  assert.equal(height.severity, "pass");
});

test("Part C: a bedroom narrower than 2 m fails the minimum-dimension test", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "b", name: "Tiny bedroom", use: "bedroom", rect: { x: 0, y: 0, w: 4, h: 1.5 }, wallSku: "TSP_MAS009" }],
  });
  const findings = evaluateCompliance(doc, pack);
  const dim = findOne(findings, "part-c-min-dimension", "Tiny bedroom");
  assert.equal(dim.severity, "fail");
});

test("Part C: a passage is checked against 2.1 m, not 2.4 m, and skips the dimension test", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "p", name: "Passage", use: "passage", rect: { x: 0, y: 0, w: 6, h: 1.2 }, wallSku: "TSP_MAS009" }],
  });
  const findings = evaluateCompliance(doc, pack);
  const height = findOne(findings, "part-c-height", "Passage");
  assert.equal(height.severity, "pass"); // 2.8 m fallback clears 2.1 m
  assert.equal(findOne(findings, "part-c-min-dimension", "Passage"), undefined);
});

test("Part C: a concave room's passing minimum dimension is advisory, not a firm pass", () => {
  const doc = normalizeDoc({
    rooms: [{
      id: "l", name: "L bedroom", use: "bedroom",
      shape: { kind: "poly", points: [[0, 0], [4, 0], [4, 4], [2, 4], [2, 2], [0, 2]] },
      wallSku: "TSP_MAS009",
    }],
  });
  const findings = evaluateCompliance(doc, pack);
  const dim = findOne(findings, "part-c-min-dimension", "L bedroom");
  assert.equal(dim.severity, "advisory");
});

// --- Part O -----------------------------------------------------------------

test("Part O: fixed-only windows cannot supply ventilation, so the finding is a fail, not silent", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "b", name: "Bedroom", use: "bedroom", rect: { x: 0, y: 0, w: 4, h: 4 }, wallSku: "TSP_MAS009" }],
    openings: [{ id: "o1", sku: "TSP_WN1812", roomId: "b", edge: "S", t: 0.5 }],
  });
  const findings = evaluateCompliance(doc, pack);
  const vent = findOne(findings, "part-o-vent", "Bedroom");
  assert.ok(vent);
  assert.equal(vent.severity, "fail");
  // Light: 1.8 x 1.2 = 2.16 m² against 10% of 16 m² = 1.6 m² required - passes.
  const light = findOne(findings, "part-o-light", "Bedroom");
  assert.equal(light.severity, "pass");
});

test("Part O: a room with no opening data at all still gets a fail, not skipped", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "b", name: "Windowless bedroom", use: "bedroom", rect: { x: 0, y: 0, w: 4, h: 4 }, wallSku: "TSP_MAS009" }],
  });
  const findings = evaluateCompliance(doc, pack);
  assert.equal(findOne(findings, "part-o-light", "Windowless bedroom").severity, "fail");
  assert.equal(findOne(findings, "part-o-vent", "Windowless bedroom").severity, "fail");
});

test("Part O: an unstated providesLight fact reports unknown, not a guessed fail", () => {
  const openPack = structuredClone(pack);
  const window = openPack.skus.find((s) => s.category === "window");
  window.compliance.providesLight = null;
  const doc = normalizeDoc({
    rooms: [{ id: "b", name: "Bedroom", use: "bedroom", rect: { x: 0, y: 0, w: 4, h: 4 }, wallSku: "TSP_MAS009" }],
    openings: [{ id: "o1", sku: window.id, roomId: "b", edge: "S", t: 0.5 }],
  });
  const findings = evaluateCompliance(doc, openPack);
  assert.equal(findOne(findings, "part-o-light", "Bedroom").severity, "unknown");
});

test("Part O: bathrooms have no light requirement, only ventilation", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "wc", name: "Bathroom", use: "bathroom", rect: { x: 0, y: 0, w: 2, h: 2 }, wallSku: "TSP_MAS009" }],
  });
  const findings = evaluateCompliance(doc, pack);
  assert.equal(findOne(findings, "part-o-light", "Bathroom"), undefined);
  assert.ok(findOne(findings, "part-o-vent", "Bathroom"));
});

test("Part O: a room use with no Part O requirement (garage) is skipped entirely", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "g", name: "Garage", use: "garage", rect: { x: 0, y: 0, w: 6, h: 6 }, wallSku: "TSP_MAS009" }],
  });
  const findings = evaluateCompliance(doc, pack);
  assert.equal(findings.filter((f) => f.part === "O").length, 0);
});

// --- Part M -----------------------------------------------------------------

function packWithStair(compliance, geometry) {
  const p = structuredClone(pack);
  p.skus.push({
    id: "TSP_TEST_STAIR",
    name: "Test stair",
    category: "stair",
    unit: "ea",
    draw: "stair",
    geometry: { width: 0.9, riser: 0.18, going: 0.28, ...geometry },
    cost: { rateRef: null, wasteFactor: null },
    compliance: {
      solidRisers: true, treadOverlap: true, landingLength: 0.9, maxFlightRise: 3.0, winders: false,
      ...compliance,
    },
    drawing: { colourClass: "concrete", hatch: null, symbol: null },
    schedule: { report: ["count"], scheduleName: null },
  });
  return p;
}

test("Part M: a compliant stair passes riser, going and the comfort sum", () => {
  const p = packWithStair();
  const doc = normalizeDoc({ stairs: [{ id: "s1", sku: "TSP_TEST_STAIR", x: 0, y: 0 }] });
  const findings = evaluateCompliance(doc, p);
  assert.equal(findOne(findings, "part-m-riser").severity, "pass");
  assert.equal(findOne(findings, "part-m-going").severity, "pass");
  assert.equal(findOne(findings, "part-m-riser-going-sum").severity, "pass");
  assert.equal(findOne(findings, "part-m-flight-rise").severity, "pass");
  assert.equal(findOne(findings, "part-m-landing").severity, "pass");
  assert.equal(findOne(findings, "part-m-solid-risers").severity, "pass");
  assert.equal(findOne(findings, "part-m-winders"), undefined, "no finding pushed when winders is false");
});

test("Part M: a riser over 200 mm fails, and flight rise over 3.6 m fails", () => {
  const p = packWithStair({ maxFlightRise: 4.0 }, { riser: 0.22 });
  const doc = normalizeDoc({ stairs: [{ id: "s1", sku: "TSP_TEST_STAIR", x: 0, y: 0 }] });
  const findings = evaluateCompliance(doc, p);
  assert.equal(findOne(findings, "part-m-riser").severity, "fail");
  assert.equal(findOne(findings, "part-m-flight-rise").severity, "fail");
});

test("Part M: null compliance facts report unknown, not a pass", () => {
  const p = packWithStair({ maxFlightRise: null, landingLength: null, solidRisers: null });
  const doc = normalizeDoc({ stairs: [{ id: "s1", sku: "TSP_TEST_STAIR", x: 0, y: 0 }] });
  const findings = evaluateCompliance(doc, p);
  assert.equal(findOne(findings, "part-m-flight-rise").severity, "unknown");
  assert.equal(findOne(findings, "part-m-landing").severity, "unknown");
  assert.equal(findOne(findings, "part-m-solid-risers").severity, "unknown");
});

test("Part M: open risers and winders are advisory, not a hard fail", () => {
  const p = packWithStair({ solidRisers: false, winders: true });
  const doc = normalizeDoc({ stairs: [{ id: "s1", sku: "TSP_TEST_STAIR", x: 0, y: 0 }] });
  const findings = evaluateCompliance(doc, p);
  assert.equal(findOne(findings, "part-m-solid-risers").severity, "advisory");
  assert.equal(findOne(findings, "part-m-winders").severity, "advisory");
});

test("Part M: a stair SKU that is never placed produces no findings", () => {
  const p = packWithStair();
  const doc = normalizeDoc({});
  const findings = evaluateCompliance(doc, p);
  assert.equal(findings.filter((f) => f.part === "M").length, 0);
});

// --- Zoning ------------------------------------------------------------------

function withMunicipality(municipality = "City of Cape Town") {
  const p = structuredClone(pack);
  p.locale.municipality = municipality;
  return p;
}

test("Zoning: no municipality means an honest unknown, not a skip", () => {
  const findings = evaluateCompliance(normalizeDoc({}), pack);
  const zoning = findOne(findings, "zoning-municipality");
  assert.ok(zoning);
  assert.equal(zoning.severity, "unknown");
});

test("Zoning: a known municipality with no property line drawn is unknown", () => {
  const findings = evaluateCompliance(normalizeDoc({}), withMunicipality());
  const zoning = findOne(findings, "zoning-property-line");
  assert.ok(zoning);
  assert.equal(zoning.severity, "unknown");
});

test("Zoning: a property line with no building line yet is unknown", () => {
  const doc = normalizeDoc({
    site: { propertyLine: { kind: "poly", points: [[0, 0], [20, 0], [20, 20], [0, 20]] } },
  });
  const findings = evaluateCompliance(doc, withMunicipality());
  const zoning = findOne(findings, "zoning-building-line");
  assert.ok(zoning);
  assert.equal(zoning.severity, "unknown");
});

test("Zoning: a room inside the building line passes, one outside it fails", () => {
  const doc = normalizeDoc({
    site: {
      propertyLine: { kind: "poly", points: [[0, 0], [20, 0], [20, 20], [0, 20]] },
      buildingLine: { kind: "poly", points: [[3, 3], [17, 3], [17, 17], [3, 17]], derived: true },
    },
    rooms: [
      { id: "in", name: "Inside room", use: "bedroom", rect: { x: 5, y: 5, w: 4, h: 4 }, wallSku: "TSP_MAS009" },
      { id: "out", name: "Outside room", use: "bedroom", rect: { x: 15, y: 15, w: 4, h: 4 }, wallSku: "TSP_MAS009" },
    ],
  });
  const findings = evaluateCompliance(doc, withMunicipality());
  assert.equal(findOne(findings, "zoning-setback", "Inside room").severity, "pass");
  assert.equal(findOne(findings, "zoning-setback", "Outside room").severity, "fail");
});

test("Zoning: a document with no rooms yet produces no setback findings", () => {
  const doc = normalizeDoc({
    site: {
      propertyLine: { kind: "poly", points: [[0, 0], [20, 0], [20, 20], [0, 20]] },
      buildingLine: { kind: "poly", points: [[3, 3], [17, 3], [17, 17], [3, 17]], derived: true },
    },
  });
  const findings = evaluateCompliance(doc, withMunicipality());
  assert.equal(findings.filter((f) => f.code === "zoning-setback").length, 0);
});

// --- grouping / summary ------------------------------------------------------

test("groupFindingsByPart sorts fail before unknown before advisory before pass", () => {
  const findings = [
    { part: "C", severity: "pass" },
    { part: "C", severity: "fail" },
    { part: "C", severity: "advisory" },
    { part: "C", severity: "unknown" },
  ];
  const byPart = groupFindingsByPart(findings);
  assert.deepEqual(byPart.get("C").map((f) => f.severity), ["fail", "unknown", "advisory", "pass"]);
});

test("summarizeFindings counts every severity", () => {
  const doc = normalizeDoc({
    rooms: [{ id: "b", name: "Bedroom", use: "bedroom", rect: { x: 0, y: 0, w: 4, h: 4 }, wallSku: "TSP_MAS009" }],
  });
  const findings = evaluateCompliance(doc, pack);
  const counts = summarizeFindings(findings);
  assert.equal(counts.fail + counts.pass + counts.advisory + counts.unknown, findings.length);
});

test("RULE_PACK is a versioned, dated document, per SCHEMA.md", () => {
  assert.equal(RULE_PACK.country, "ZA");
  assert.match(RULE_PACK.version, /^\d+\.\d+\.\d+$/);
  assert.match(RULE_PACK.effectiveDate, /^\d{4}-\d{2}-\d{2}$/);
});
