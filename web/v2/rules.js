// Week 2: the live SANS 10400 compliance rule engine.
//
// SCHEMA.md is explicit that a SKU carries physical facts, never a verdict,
// and that "rule packs are not in this schema" - regulation thresholds live in
// a separate versioned document with an effective date. RULE_PACK below is
// that document. It never touches the SKU pack or the drawn document; it only
// reads the facts both already expose and turns them into a verdict.
//
// A finding is one of:
//   "pass"      - the fact satisfies the threshold.
//   "fail"      - the fact violates the threshold.
//   "advisory"  - the geometry-derived fact is an upper bound (a concave
//                 room's minDimension) or the regulation allows the
//                 configuration under conditions this engine does not model
//                 (open risers, winders on a secondary stair). Read it, do not
//                 sign off on it.
//   "unknown"   - a required fact is null. This is complianceGaps() territory:
//                 the firm has not supplied it, so the engine refuses to guess
//                 and refuses to silently pass.
//
// Every finding names the regulation clause it comes from, so a plans
// examiner query maps straight back to one line here.

import { pointInPoly } from "./geom.js";
import { roomPolygon, shapePolygon } from "./model.js";
import { skuById, wallForOpening } from "./openings.js";
import { deriveWalls } from "./walls.js";
import { compile } from "./compile.js";

export const RULE_PACK = {
  id: "sans10400-za",
  version: "1.0.0",
  country: "ZA",
  // The edition currently enforced. A rule pack is versioned and dated so a
  // finding can be reproduced against the regulation that was in force on the
  // submission date, per SCHEMA.md's "why the shape is what it is" #1.
  effectiveDate: "2022-01-01",
  source: "SANS 10400-C, -M, -O (2022 as amended)",

  partC: {
    // Room classes the "no dimension less than 2 m" rule applies to.
    minDimension: 2.0,
    minDimensionClasses: ["bedroom", "habitable", "kitchen"],
    // Minimum floor-to-ceiling height per SANS class. Regulation actually
    // requires 2.4 m over at least 70% of a habitable room's floor area;
    // the document model only carries one ceilingHeight number per room
    // (SCHEMA.md's open decision #1), so this checks the single number and
    // the finding says so rather than implying the 70% test ran.
    minHeightByClass: {
      bedroom: 2.4,
      habitable: 2.4,
      kitchen: 2.4,
      passage: 2.1,
      bathroom: 2.1,
      toilet: 2.1,
      laundry: 2.1,
      scullery: 2.1,
    },
  },

  partO: {
    // Fraction of floor area required as glazed (light) and openable
    // (ventilation) area, by SANS class. A class absent here (garage, store,
    // outdoor, other) has no Part O light/vent requirement and is skipped.
    byClass: {
      bedroom: { light: 0.10, vent: 0.05 },
      habitable: { light: 0.10, vent: 0.05 },
      kitchen: { light: 0.05, vent: 0.025 },
      laundry: { light: 0.05, vent: 0.025 },
      scullery: { light: 0.05, vent: 0.025 },
      // Bathrooms and toilets have no natural-light minimum (mechanical
      // extraction is an accepted alternative under Part O), only ventilation.
      bathroom: { vent: 0.035 },
      toilet: { vent: 0.035 },
    },
  },

  partM: {
    maxRiser: 0.20,
    minGoing: 0.25,
    // 2 x riser + going, the standard "comfort" formula Part M keys its
    // going/riser pairing off.
    minRiserGoingSum: 0.55,
    maxRiserGoingSum: 0.70,
    maxFlightRise: 3.6,
  },

  zoning: {
    // A single uniform setback per municipality, in metres. A real scheme
    // varies this by boundary (front/side/rear) and zoning use, which needs
    // a municipal scheme document this rule pack does not carry yet - see
    // site.js's deriveBuildingLine, which this table feeds. A municipality
    // absent here reports "unknown", never a guessed distance.
    setbackByMunicipality: {
      "City of Cape Town": 3.0,
      "City of Johannesburg": 3.0,
      eThekwini: 3.0,
    },
  },
};

function push(findings, entry) {
  findings.push(entry);
}

function roomClassLabel(room) {
  return room.name ? `${room.name} (${room.use})` : room.use;
}

// --- Part C -----------------------------------------------------------------

function checkPartC(compiled, rules, findings) {
  for (const room of compiled.rooms) {
    if (rules.partC.minDimensionClasses.includes(room.use)) {
      const min = rules.partC.minDimension;
      if (room.minDimension < min) {
        push(findings, {
          part: "C", code: "part-c-min-dimension", severity: "fail",
          subject: roomClassLabel(room), roomId: room.id,
          message: `${roomClassLabel(room)}: narrowest dimension ${Math.round(room.minDimension * 1000)} mm is below the ${Math.round(min * 1000)} mm SANS 10400-C minimum.`,
        });
      } else {
        push(findings, {
          part: "C", code: "part-c-min-dimension",
          severity: room.minDimensionExact ? "pass" : "advisory",
          subject: roomClassLabel(room), roomId: room.id,
          message: room.minDimensionExact
            ? `${roomClassLabel(room)}: narrowest dimension ${Math.round(room.minDimension * 1000)} mm meets the ${Math.round(min * 1000)} mm minimum.`
            : `${roomClassLabel(room)}: narrowest dimension is at most ${Math.round(room.minDimension * 1000)} mm (concave room, upper bound). Passes the ${Math.round(min * 1000)} mm minimum on this estimate, but confirm on the free-polygon shape.`,
        });
      }
    }

    const minHeight = rules.partC.minHeightByClass[room.use];
    if (minHeight === undefined) continue;
    if (room.ceilingHeight === null || room.ceilingHeight === undefined) {
      push(findings, {
        part: "C", code: "part-c-height", severity: "unknown",
        subject: roomClassLabel(room), roomId: room.id,
        message: `${roomClassLabel(room)}: floor-to-ceiling height is not known yet (level floorToCeiling is null). Cannot check the ${Math.round(minHeight * 1000)} mm minimum.`,
      });
    } else if (room.ceilingHeight < minHeight) {
      push(findings, {
        part: "C", code: "part-c-height", severity: "fail",
        subject: roomClassLabel(room), roomId: room.id,
        message: `${roomClassLabel(room)}: ceiling height ${Math.round(room.ceilingHeight * 1000)} mm is below the ${Math.round(minHeight * 1000)} mm SANS 10400-C minimum.`,
      });
    } else {
      push(findings, {
        part: "C", code: "part-c-height", severity: "pass",
        subject: roomClassLabel(room), roomId: room.id,
        message: `${roomClassLabel(room)}: ceiling height ${Math.round(room.ceilingHeight * 1000)} mm meets the ${Math.round(minHeight * 1000)} mm minimum (checked as one number over the whole room, not the 70%-of-area test).`,
      });
    }
  }
}

// --- Part O -----------------------------------------------------------------

/**
 * Per-room light/vent area, plus whether a serving opening's relevant fact is
 * still null. Distinct from openings.js's roomOpeningAreas, which silently
 * treats a null fact as "does not contribute" - correct for a quantity total,
 * wrong for a compliance verdict, which must say "unknown" rather than a
 * false "fail".
 */
function roomLightVentFacts(doc, pack, walls) {
  const byRoom = new Map();
  const row = (roomId) => {
    if (!byRoom.has(roomId)) {
      byRoom.set(roomId, { glazedArea: 0, openableArea: 0, lightUnknown: false, ventUnknown: false });
    }
    return byRoom.get(roomId);
  };

  for (const opening of doc.openings || []) {
    const wall = wallForOpening(doc, pack, walls, opening);
    if (!wall) continue;
    const sku = skuById(pack, opening.sku);
    if (!sku) continue;
    const g = sku.geometry || {};
    const c = sku.compliance || {};
    const openingArea = (g.width || 0) * (g.height || 0);
    if (openingArea <= 0) continue;

    const roomIds = opening.roomId ? [opening.roomId] : wall.roomIds;
    for (const roomId of roomIds) {
      const r = row(roomId);
      if (sku.category === "window") {
        if (c.providesLight === null) r.lightUnknown = true;
        else if (c.providesLight) r.glazedArea += openingArea;
      }
      if (c.providesVentilation === null) {
        r.ventUnknown = true;
      } else if (c.providesVentilation) {
        if (c.openableAreaFraction === null) {
          r.ventUnknown = true;
        } else {
          r.openableArea += openingArea * c.openableAreaFraction;
        }
      }
    }
  }
  return byRoom;
}

function checkPartO(doc, pack, compiled, walls, rules, findings) {
  const facts = roomLightVentFacts(doc, pack, walls);
  for (const room of compiled.rooms) {
    const thresholds = rules.partO.byClass[room.use];
    if (!thresholds) continue;
    const f = facts.get(room.id) || { glazedArea: 0, openableArea: 0, lightUnknown: false, ventUnknown: false };

    if (thresholds.light !== undefined) {
      const needed = room.area * thresholds.light;
      if (f.lightUnknown) {
        push(findings, {
          part: "O", code: "part-o-light", severity: "unknown", subject: roomClassLabel(room), roomId: room.id,
          message: `${roomClassLabel(room)}: at least one window serving this room has not confirmed whether it provides light. Cannot check the ${(thresholds.light * 100).toFixed(0)}% of floor area minimum.`,
        });
      } else if (f.glazedArea < needed) {
        push(findings, {
          part: "O", code: "part-o-light", severity: "fail", subject: roomClassLabel(room), roomId: room.id,
          message: `${roomClassLabel(room)}: ${f.glazedArea.toFixed(2)} m² glazed against ${needed.toFixed(2)} m² required (${(thresholds.light * 100).toFixed(0)}% of ${room.area.toFixed(2)} m²).`,
        });
      } else {
        push(findings, {
          part: "O", code: "part-o-light", severity: "pass", subject: roomClassLabel(room), roomId: room.id,
          message: `${roomClassLabel(room)}: ${f.glazedArea.toFixed(2)} m² glazed meets the ${needed.toFixed(2)} m² requirement.`,
        });
      }
    }

    const neededVent = room.area * thresholds.vent;
    if (f.ventUnknown) {
      push(findings, {
        part: "O", code: "part-o-vent", severity: "unknown", subject: roomClassLabel(room), roomId: room.id,
        message: `${roomClassLabel(room)}: at least one opening serving this room has not confirmed its openable fraction. Cannot check the ${(thresholds.vent * 100).toFixed(1)}% ventilation minimum.`,
      });
    } else if (f.openableArea < neededVent) {
      push(findings, {
        part: "O", code: "part-o-vent", severity: "fail", subject: roomClassLabel(room), roomId: room.id,
        message: `${roomClassLabel(room)}: ${f.openableArea.toFixed(2)} m² openable against ${neededVent.toFixed(2)} m² required (${(thresholds.vent * 100).toFixed(1)}% of ${room.area.toFixed(2)} m²).`,
      });
    } else {
      push(findings, {
        part: "O", code: "part-o-vent", severity: "pass", subject: roomClassLabel(room), roomId: room.id,
        message: `${roomClassLabel(room)}: ${f.openableArea.toFixed(2)} m² openable meets the ${neededVent.toFixed(2)} m² requirement.`,
      });
    }
  }
}

// --- Part M -----------------------------------------------------------------

function checkPartM(doc, pack, rules, findings) {
  const usedSkuIds = new Set((doc.stairs || []).map((s) => s.sku));
  for (const skuId of usedSkuIds) {
    const sku = skuById(pack, skuId);
    if (!sku || sku.category !== "stair") continue;
    const g = sku.geometry || {};
    const c = sku.compliance || {};
    const subject = sku.name;

    if (typeof g.riser === "number") {
      push(findings, {
        part: "M", code: "part-m-riser",
        severity: g.riser <= rules.partM.maxRiser ? "pass" : "fail",
        subject, skuId,
        message: `${subject}: riser ${(g.riser * 1000).toFixed(0)} mm against a ${(rules.partM.maxRiser * 1000).toFixed(0)} mm maximum.`,
      });
    }
    if (typeof g.going === "number") {
      push(findings, {
        part: "M", code: "part-m-going",
        severity: g.going >= rules.partM.minGoing ? "pass" : "fail",
        subject, skuId,
        message: `${subject}: going ${(g.going * 1000).toFixed(0)} mm against a ${(rules.partM.minGoing * 1000).toFixed(0)} mm minimum.`,
      });
    }
    if (typeof g.riser === "number" && typeof g.going === "number") {
      const sum = 2 * g.riser + g.going;
      const ok = sum >= rules.partM.minRiserGoingSum && sum <= rules.partM.maxRiserGoingSum;
      push(findings, {
        part: "M", code: "part-m-riser-going-sum", severity: ok ? "pass" : "fail", subject, skuId,
        message: `${subject}: 2 x riser + going = ${(sum * 1000).toFixed(0)} mm, against the ${(rules.partM.minRiserGoingSum * 1000).toFixed(0)}-${(rules.partM.maxRiserGoingSum * 1000).toFixed(0)} mm range.`,
      });
    }

    if (c.maxFlightRise === null || c.maxFlightRise === undefined) {
      push(findings, {
        part: "M", code: "part-m-flight-rise", severity: "unknown", subject, skuId,
        message: `${subject}: flight rise not supplied. Cannot check against the ${Math.round(rules.partM.maxFlightRise * 1000)} mm maximum without a landing.`,
      });
    } else {
      push(findings, {
        part: "M", code: "part-m-flight-rise",
        severity: c.maxFlightRise <= rules.partM.maxFlightRise ? "pass" : "fail",
        subject, skuId,
        message: `${subject}: flight rise ${Math.round(c.maxFlightRise * 1000)} mm against the ${Math.round(rules.partM.maxFlightRise * 1000)} mm maximum before a landing is required.`,
      });
    }

    if (c.landingLength === null || c.landingLength === undefined) {
      push(findings, {
        part: "M", code: "part-m-landing", severity: "unknown", subject, skuId,
        message: `${subject}: landing length not supplied. A landing must be at least as long as the stair is wide (${Math.round((g.width ?? 0) * 1000)} mm).`,
      });
    } else if (typeof g.width === "number") {
      push(findings, {
        part: "M", code: "part-m-landing",
        severity: c.landingLength >= g.width ? "pass" : "fail",
        subject, skuId,
        message: `${subject}: landing length ${Math.round(c.landingLength * 1000)} mm against the ${Math.round(g.width * 1000)} mm stair width it must at least match.`,
      });
    }

    if (c.solidRisers === null || c.solidRisers === undefined) {
      push(findings, {
        part: "M", code: "part-m-solid-risers", severity: "unknown", subject, skuId,
        message: `${subject}: whether risers are solid (closed) has not been confirmed.`,
      });
    } else if (!c.solidRisers) {
      push(findings, {
        part: "M", code: "part-m-solid-risers", severity: "advisory", subject, skuId,
        message: `${subject}: open risers. Permitted in some occupancies but flagged - confirm this stair's occupancy allows it.`,
      });
    } else {
      push(findings, {
        part: "M", code: "part-m-solid-risers", severity: "pass", subject, skuId,
        message: `${subject}: risers are solid (closed).`,
      });
    }

    if (c.winders) {
      push(findings, {
        part: "M", code: "part-m-winders", severity: "advisory", subject, skuId,
        message: `${subject}: winders present. Discouraged on a main access route - confirm this is not the only means of escape.`,
      });
    }
  }
}

// --- Zoning & setbacks -------------------------------------------------------

function checkZoning(doc, pack, compiled, findings) {
  const municipality = pack.locale?.municipality;
  if (!municipality) {
    push(findings, {
      part: "Zoning", code: "zoning-municipality", severity: "unknown", subject: "Site",
      message: "pack.locale.municipality is not set. Setback and coverage rules are municipality-specific and cannot be selected yet.",
    });
    return;
  }

  const propertyLine = doc.site?.propertyLine ? shapePolygon(doc.site.propertyLine) : [];
  if (propertyLine.length < 3) {
    push(findings, {
      part: "Zoning", code: "zoning-property-line", severity: "unknown", subject: "Site",
      message: `Municipality "${municipality}" is known, but no property line has been drawn yet (Site > Property line). Setbacks cannot be measured.`,
    });
    return;
  }

  const buildingLine = doc.site?.buildingLine ? shapePolygon(doc.site.buildingLine) : [];
  if (buildingLine.length < 3) {
    push(findings, {
      part: "Zoning", code: "zoning-building-line", severity: "unknown", subject: "Site",
      message: "A property line is drawn, but there is no building line yet. Run Site > Building line to derive one, or draw one by hand.",
    });
    return;
  }

  // Every room's footprint must sit inside the building line. Checked per
  // room, like every other part, rather than one pass/fail for the whole
  // site, so a single encroaching room does not hide behind the rest of a
  // compliant plan. Nothing is pushed for a document with no rooms yet, the
  // same convention Part M uses for a stair SKU that is never placed.
  for (const room of compiled.rooms) {
    const raw = (doc.rooms || []).find((r) => r.id === room.id);
    if (!raw) continue;
    const poly = roomPolygon(raw);
    const encroaches = poly.some(([x, y]) => !pointInPoly(x, y, buildingLine));
    push(findings, {
      part: "Zoning", code: "zoning-setback",
      severity: encroaches ? "fail" : "pass",
      subject: roomClassLabel(room), roomId: room.id,
      message: encroaches
        ? `${roomClassLabel(room)}: extends beyond the building line. Move it inside the setback, or confirm the setback distance for "${municipality}".`
        : `${roomClassLabel(room)}: sits within the building line.`,
    });
  }
}

/**
 * Run every Week 2 check against a document and pack. Returns a flat list of
 * findings; group by `part` for display. `rulePack` defaults to the shipped
 * SANS edition but is a parameter so a fixture, or a future second edition,
 * can be substituted without touching this file.
 */
export function evaluateCompliance(doc, pack, rulePack = RULE_PACK) {
  const findings = [];
  if (!pack) return findings;
  const compiled = compile(doc, pack);
  const walls = deriveWalls(doc, pack);

  checkPartC(compiled, rulePack, findings);
  checkPartO(doc, pack, compiled, walls, rulePack, findings);
  checkPartM(doc, pack, rulePack, findings);
  checkZoning(doc, pack, compiled, findings);

  return findings;
}

const SEVERITY_ORDER = ["fail", "unknown", "advisory", "pass"];

/** Findings grouped by regulation part, worst severity first within each part. */
export function groupFindingsByPart(findings) {
  const byPart = new Map();
  for (const finding of findings) {
    if (!byPart.has(finding.part)) byPart.set(finding.part, []);
    byPart.get(finding.part).push(finding);
  }
  for (const list of byPart.values()) {
    list.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  }
  return byPart;
}

/** Counts per severity, for a one-line summary badge. */
export function summarizeFindings(findings) {
  const counts = { pass: 0, fail: 0, advisory: 0, unknown: 0 };
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  return counts;
}
