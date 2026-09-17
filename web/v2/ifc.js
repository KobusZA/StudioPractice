// Export a v2 document as an IFC 2x3 file that Revit opens on its own.
//
// This is the "picture and permit leave the app" half of the purpose test: a
// builder draws here, and the firm's Revit user opens the result as real walls,
// doors, windows and rooms rather than tracing over a picture of them. It does
// not need the C# connector - File > Open > IFC is Revit's own importer - which
// is the whole point: the drawing has to survive without our add-in installed.
//
// Two consequences of importing without the add-in, both deliberate:
//
//  1. **Types arrive by name, not by identity.** Revit's IFC importer creates a
//     type per distinct `ObjectType` string, so we write the template's own
//     "family : type" there (`sku.revit`, which build-pack.js reads straight off
//     Export Catalog). The imported wall is therefore labelled with the type the
//     firm actually builds with, and a user maps it to the real template type in
//     one step. We never pick a lookalike type for them - a SKU with no recorded
//     template type is reported, exactly as an unmapped Revit category is in
//     build-pack.js.
//  2. **Everything geometric comes from `compile()`**, never re-derived here.
//     Wall heights and base elevations in particular are the *attach-resolved*
//     ones, so an IFC wall standing on a foundation lands at the same elevation
//     the BOQ priced. A second derivation would be a second chance to disagree.
//
// Scope is the permit-drawing core the customer chose: levels, walls, doors,
// windows, rooms. Floors, roofs, beams, stairs and placed items are compiled
// already and are a later addition to this file, not a redesign of it.

import { compile } from "./compile.js";
import { skuById } from "./openings.js";

const SCHEMA = "IFC2X3";
const APP_NAME = "StudioPractice Planner";
const APP_ID = "SP_PLANNER";

// --- STEP primitives -------------------------------------------------------

const GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/**
 * A GlobalId derived from the element's own id rather than randomly.
 *
 * Re-exporting an unchanged drawing then produces byte-identical ids, so a
 * Revit user who re-opens a revised IFC sees the same elements updated instead
 * of a second copy of the building beside the first.
 */
export function ifcGuid(seed) {
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (let i = 0; i < seed.length; i += 1) {
    for (let w = 0; w < 4; w += 1) {
      words[w] = (words[w] ^ (seed.charCodeAt(i) + w * 31 + i)) >>> 0;
      words[w] = Math.imul(words[w], 16777619) >>> 0;
      words[w] = (((words[w] << 13) | (words[w] >>> 19)) >>> 0);
    }
  }

  let n = 0n;
  for (const word of words) n = (n << 32n) | BigInt(word >>> 0);

  const chars = [];
  for (let i = 0; i < 21; i += 1) {
    chars.push(GUID_CHARS[Number(n & 63n)]);
    n >>= 6n;
  }
  chars.push(GUID_CHARS[Number(n & 3n)]);
  return chars.reverse().join("");
}

/** A STEP real always carries a decimal point; `0` on its own is not one. */
function r(value) {
  const n = Number.isFinite(value) ? value : 0;
  if (Math.abs(n) < 1e-9) return "0.";
  const fixed = n.toFixed(6).replace(/0+$/, "");
  return fixed.endsWith(".") ? fixed : fixed;
}

/** A STEP string, or `$` for the unknowns the schema lets us leave unset. */
function s(value) {
  if (value === null || value === undefined || value === "") return "$";
  const text = String(value).replace(/\\/g, "\\\\").replace(/'/g, "''");
  // IFC 2x3 strings are ISO-8859-1; anything above it (a µ, a °, a curly
  // quote in a room name) goes through the schema's own \X2\ escape rather
  // than being dropped.
  const encoded = text.replace(/[^\x20-\x7E]+/g, (run) => {
    const hex = [...run].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("");
    return `\\X2\\${hex}\\X0\\`;
  });
  return `'${encoded}'`;
}

class StepFile {
  constructor() {
    this.lines = [];
    this.cache = new Map();
  }

  add(type, attrs) {
    const ref = `#${this.lines.length + 1}`;
    this.lines.push(`${ref}= ${type}(${attrs.join(",")});`);
    return ref;
  }

  /** Points and directions repeat constantly; one entity each keeps files small. */
  shared(key, make) {
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key);
  }

  point3(x, y, z) {
    return this.shared(`p3:${r(x)},${r(y)},${r(z)}`, () =>
      this.add("IFCCARTESIANPOINT", [`(${r(x)},${r(y)},${r(z)})`]));
  }

  point2(x, y) {
    return this.shared(`p2:${r(x)},${r(y)}`, () =>
      this.add("IFCCARTESIANPOINT", [`(${r(x)},${r(y)})`]));
  }

  dir3(x, y, z) {
    return this.shared(`d3:${r(x)},${r(y)},${r(z)}`, () =>
      this.add("IFCDIRECTION", [`(${r(x)},${r(y)},${r(z)})`]));
  }

  dir2(x, y) {
    return this.shared(`d2:${r(x)},${r(y)}`, () =>
      this.add("IFCDIRECTION", [`(${r(x)},${r(y)})`]));
  }

  /** An axis placement at a point, optionally turned to face along `dir`. */
  axis3(x, y, z, dx = null, dy = null) {
    const turned = dx !== null && dy !== null;
    const key = `a3:${r(x)},${r(y)},${r(z)},${turned ? `${r(dx)},${r(dy)}` : "-"}`;
    return this.shared(key, () => this.add("IFCAXIS2PLACEMENT3D", [
      this.point3(x, y, z),
      this.dir3(0, 0, 1),
      turned ? this.dir3(dx, dy, 0) : this.dir3(1, 0, 0),
    ]));
  }

  /**
   * A placement at local (0,0,0) that is *not* the geometric context's WCS.
   * Revit's importer has been seen to skip a swept solid whose Position is the
   * same entity as IfcGeometricRepresentationContext.WorldCoordinateSystem.
   */
  sweepOrigin() {
    return this.add("IFCAXIS2PLACEMENT3D", [
      this.point3(0, 0, 0),
      this.dir3(0, 0, 1),
      this.dir3(1, 0, 0),
    ]);
  }
}

/**
 * The plan canvas draws +y downwards (screen coordinates); Revit and IFC put
 * +y north. Negating y on the way out keeps the plan's handedness, so a room
 * on the north side of the house does not import onto the south side. This is
 * the only coordinate change the exporter makes - no re-origining, no rotation,
 * because the plan is already assumed true-north and true-scale (the same
 * assumption the underlay calibration and the SG reference point make).
 */
function flip(point) {
  return [point[0], -point[1]];
}

// --- the export ------------------------------------------------------------

/**
 * @returns {{ text: string, fileName: string, report: object }} or `null` when
 * there is no pack to compile against.
 */
export function exportIfc(doc, pack, { now = new Date(), author = "", organisation = "Studio Practice" } = {}) {
  const out = compile(doc, pack);
  if (!out) return null;

  const report = {
    counts: { levels: 0, walls: 0, doors: 0, windows: 0, rooms: 0 },
    skipped: [],
    unmappedTypes: [],
    // Drawn, compiled, priced - and not in this file, because this version
    // exports the permit-drawing core only. A scheduling block has to be
    // visible as one (PHILOSOPHY.md), so the user is told what stayed behind
    // rather than discovering it missing in Revit.
    notExported: [
      ["floors and slabs", (doc?.slabs || []).length],
      ["roofs", (doc?.roofs || []).length],
      ["beams", (doc?.beams || []).length],
      ["stairs", (doc?.stairs || []).length],
      ["placed items", (doc?.items || []).length],
    ].filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`),
    warnings: [...(out.warnings || [])],
  };

  const formsById = new Map((out.sketchForms || []).map((f) => [f.elementId, f]));
  const rowsById = new Map((out.instances || []).map((row) => [row.elementId, row]));

  const f = new StepFile();
  const originAxis = f.axis3(0, 0, 0);

  // --- header records ------------------------------------------------------
  const person = f.add("IFCPERSON", ["$", s(author), "$", "$", "$", "$", "$", "$"]);
  const org = f.add("IFCORGANIZATION", ["$", s(organisation), "$", "$", "$"]);
  const personOrg = f.add("IFCPERSONANDORGANIZATION", [person, org, "$"]);
  const app = f.add("IFCAPPLICATION", [org, s("2"), s(APP_NAME), s(APP_ID)]);
  const stamp = Math.floor(now.getTime() / 1000);
  const owner = f.add("IFCOWNERHISTORY", [personOrg, app, "$", ".ADDED.", "$", "$", "$", String(stamp)]);

  const metre = f.add("IFCSIUNIT", ["*", ".LENGTHUNIT.", "$", ".METRE."]);
  const sqm = f.add("IFCSIUNIT", ["*", ".AREAUNIT.", "$", ".SQUARE_METRE."]);
  const cbm = f.add("IFCSIUNIT", ["*", ".VOLUMEUNIT.", "$", ".CUBIC_METRE."]);
  const rad = f.add("IFCSIUNIT", ["*", ".PLANEANGLEUNIT.", "$", ".RADIAN."]);
  const units = f.add("IFCUNITASSIGNMENT", [`(${[metre, sqm, cbm, rad].join(",")})`]);

  const context = f.add("IFCGEOMETRICREPRESENTATIONCONTEXT", [
    "$", s("Model"), "3", "1.E-05", originAxis, f.dir2(0, 1),
  ]);
  const bodyContext = f.add("IFCGEOMETRICREPRESENTATIONSUBCONTEXT", [
    s("Body"), s("Model"), "*", "*", "*", "*", context, "$", ".MODEL_VIEW.", "$",
  ]);
  const axisContext = f.add("IFCGEOMETRICREPRESENTATIONSUBCONTEXT", [
    s("Axis"), s("Model"), "*", "*", "*", "*", context, "$", ".GRAPH_VIEW.", "$",
  ]);

  // --- spatial structure ---------------------------------------------------
  const project = f.add("IFCPROJECT", [
    s(ifcGuid(`project:${pack.id}`)), owner, s(pack.name || "Project"), "$", "$", "$", "$",
    `(${context})`, units,
  ]);

  const sitePlacement = f.add("IFCLOCALPLACEMENT", ["$", originAxis]);
  const site = f.add("IFCSITE", [
    s(ifcGuid(`site:${pack.id}`)), owner, s(doc?.site?.erfNumber ? `Erf ${doc.site.erfNumber}` : "Site"),
    "$", "$", sitePlacement, "$", "$", ".ELEMENT.", "$", "$", "$", "$", "$",
  ]);

  const buildingPlacement = f.add("IFCLOCALPLACEMENT", [sitePlacement, originAxis]);
  const building = f.add("IFCBUILDING", [
    s(ifcGuid(`building:${pack.id}`)), owner, s(pack.name || "Building"), "$", "$",
    buildingPlacement, "$", "$", ".ELEMENT.", "$", "$", "$",
  ]);

  const storeys = new Map();
  for (const level of pack.levels || []) {
    const elevation = level.elevation ?? 0;
    const placement = f.add("IFCLOCALPLACEMENT", [buildingPlacement, f.axis3(0, 0, elevation)]);
    const ref = f.add("IFCBUILDINGSTOREY", [
      s(ifcGuid(`storey:${level.id}`)), owner, s(level.name || level.id), "$", "$",
      placement, "$", "$", ".ELEMENT.", r(elevation),
    ]);
    storeys.set(level.id, { ref, placement, elevation, level });
  }
  report.counts.levels = storeys.size;

  if (!storeys.size) {
    report.skipped.push("The pack states no levels, so nothing can be placed in a storey.");
    return { text: null, fileName: fileNameFor(pack), report };
  }

  const fallbackStorey = storeys.get(pack.system?.defaultLevel) || [...storeys.values()][0];
  const storeyFor = (levelId) => storeys.get(levelId) || fallbackStorey;

  // Elements gathered per storey, because IFC contains them in one
  // relationship per spatial structure rather than one per element.
  const contained = new Map([...storeys.keys()].map((id) => [id, []]));
  const spaces = new Map([...storeys.keys()].map((id) => [id, []]));
  const place = (levelId, ref) => contained.get(storeyFor(levelId).level.id).push(ref);

  // Type objects, one per wall SKU, so Revit names the imported wall type after
  // the template type rather than inventing "Wall 1", "Wall 2".
  const wallTypes = new Map();
  const seenUnmapped = new Set();

  /** The "family : type" string Revit's importer turns into a type name. */
  function objectTypeFor(sku, elementLabel) {
    const revit = sku?.revit;
    if (revit?.family && revit?.type) return `${revit.family} : ${revit.type}`;
    if (sku && !seenUnmapped.has(sku.id)) {
      seenUnmapped.add(sku.id);
      report.unmappedTypes.push(
        `${elementLabel} "${sku.name}" has no template family/type recorded, so it imports as the IFC type "${sku.name}". Map it to a Revit type after opening.`,
      );
    }
    return sku?.name || elementLabel;
  }

  // --- property sets -------------------------------------------------------
  const psetRels = [];

  function attachProperties(elementRef, name, seed, entries) {
    const props = entries
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value, type = "IFCTEXT"]) => f.add("IFCPROPERTYSINGLEVALUE", [
        s(key), "$", `${type}(${type === "IFCTEXT" || type === "IFCLABEL" ? s(value) : r(value)})`, "$",
      ]));
    if (!props.length) return;
    const pset = f.add("IFCPROPERTYSET", [
      s(ifcGuid(`pset:${name}:${seed}`)), owner, s(name), "$", `(${props.join(",")})`,
    ]);
    psetRels.push([elementRef, pset, `${name}:${seed}`]);
  }

  /**
   * The SKU and schedule facts that make the imported model still priceable:
   * the SKU id ties a Revit element back to a row in this app's BOQ, and the
   * rate reference points at the rate book the way the pack does (rates
   * themselves stay out - a shared file must not carry prices).
   */
  function schedulePset(elementRef, row, seed) {
    if (!row) return;
    attachProperties(elementRef, "SP_SKU", seed, [
      ["SkuId", row.model],
      ["Category", row.category],
      ["Unit", row.unit],
      ["RateRef", row.rateRef],
      ["ColourClass", row.colourClass],
      ["Status", row.status],
      ["PlannerId", row.elementId],
    ]);
    attachProperties(elementRef, "SP_Schedule", seed, [
      ["Length", row.length ?? null, "IFCLENGTHMEASURE"],
      ["Area", row.area ?? null, "IFCAREAMEASURE"],
      ["Volume", row.volume ?? null, "IFCVOLUMEMEASURE"],
      ["Count", row.count ?? null, "IFCCOUNTMEASURE"],
    ]);
  }

  // --- walls ---------------------------------------------------------------
  const wallRefs = new Map();

  for (const wall of out.walls || []) {
    const sku = skuById(pack, wall.sku);
    const form = formsById.get(wall.id);
    const curve = form?.profileLoops?.[0]?.curves?.[0];
    const label = sku?.name || wall.sku || wall.id;

    if (!curve) {
      report.skipped.push(`Wall "${label}" has no drawn line and was left out.`);
      continue;
    }
    if (!(wall.thickness > 0)) {
      report.skipped.push(`Wall "${label}" states no thickness, so no solid could be written for it.`);
      continue;
    }
    if (!(wall.height > 0)) {
      report.skipped.push(`Wall "${label}" resolves to no height, so no solid could be written for it.`);
      continue;
    }

    const [x1, y1] = flip(curve.start);
    const [x2, y2] = flip(curve.end);
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!(length > 1e-6)) {
      report.skipped.push(`Wall "${label}" is zero length and was left out.`);
      continue;
    }

    const storey = storeyFor(wall.level);
    const ux = (x2 - x1) / length;
    const uy = (y2 - y1) / length;
    const placement = f.add("IFCLOCALPLACEMENT", [
      storey.placement,
      f.axis3(x1, y1, (wall.baseElevation ?? storey.elevation) - storey.elevation, ux, uy),
    ]);

    // Axis first: Revit reads it as the wall's location line, which is what
    // makes the imported wall editable as a wall rather than as a lump.
    const axisCurve = f.add("IFCPOLYLINE", [`(${f.point2(0, 0)},${f.point2(length, 0)})`]);
    const axisRep = f.add("IFCSHAPEREPRESENTATION", [axisContext, s("Axis"), s("Curve2D"), `(${axisCurve})`]);

    const profile = f.add("IFCRECTANGLEPROFILEDEF", [
      ".AREA.", "$",
      f.add("IFCAXIS2PLACEMENT2D", [f.point2(length / 2, 0), "$"]),
      r(length), r(wall.thickness),
    ]);
    const solid = f.add("IFCEXTRUDEDAREASOLID", [profile, f.sweepOrigin(), f.dir3(0, 0, 1), r(wall.height)]);
    const bodyRep = f.add("IFCSHAPEREPRESENTATION", [bodyContext, s("Body"), s("SweptSolid"), `(${solid})`]);
    const shape = f.add("IFCPRODUCTDEFINITIONSHAPE", ["$", "$", `(${axisRep},${bodyRep})`]);

    const objectType = objectTypeFor(sku, "Wall");
    const ref = f.add("IFCWALLSTANDARDCASE", [
      s(ifcGuid(`wall:${wall.id}`)), owner, s(label), "$", s(objectType), placement, shape, s(wall.id),
    ]);

    wallRefs.set(wall.id, { ref, placementRef: placement, x1, y1, ux, uy, storey, wall });
    place(wall.level, ref);
    report.counts.walls += 1;

    if (sku && !wallTypes.has(sku.id)) {
      wallTypes.set(sku.id, {
        ref: f.add("IFCWALLTYPE", [
          s(ifcGuid(`walltype:${sku.id}`)), owner, s(objectType), "$", "$", "$", "$",
          s(sku.id), "$", ".STANDARD.",
        ]),
        members: [],
        thickness: wall.thickness,
        objectType,
      });
    }
    if (sku) wallTypes.get(sku.id).members.push(ref);

    schedulePset(ref, rowsById.get(wall.id), wall.id);
    attachProperties(ref, "SP_Wall", wall.id, [
      ["External", wall.external ? "True" : "False"],
      ["AttachedTo", wall.attachedTo],
      ["Level", storey.level.name || storey.level.id],
    ]);
  }

  for (const { ref, members, thickness, objectType } of wallTypes.values()) {
    if (!members.length) continue;
    f.add("IFCRELDEFINESBYTYPE", [
      s(ifcGuid(`reltype:${ref}`)), owner, "$", "$", `(${members.join(",")})`, ref,
    ]);
    // IfcWallStandardCase without a layer set is not a standard case. Revit's
    // importer then has nothing to hang a wall type on and the file opens as
    // an empty project — which looks like "nothing happened".
    const mat = f.add("IFCMATERIAL", [s(objectType)]);
    const layer = f.add("IFCMATERIALLAYER", [mat, r(thickness), ".F."]);
    const set = f.add("IFCMATERIALLAYERSET", [`(${layer})`, s(objectType)]);
    const usage = f.add("IFCMATERIALLAYERSETUSAGE", [set, ".AXIS2.", ".POSITIVE.", r(-thickness / 2)]);
    f.add("IFCRELASSOCIATESMATERIAL", [
      s(ifcGuid(`mat:${ref}`)), owner, "$", "$", `(${members.join(",")})`, usage,
    ]);
  }

  // --- doors and windows ---------------------------------------------------
  //
  // Each one is two elements plus two relationships, which is how IFC says
  // "this hole is cut in that wall, and this leaf fills that hole": an
  // IfcOpeningElement voiding the wall, and the door or window filling the
  // opening. Revit needs the void to actually cut the imported wall.
  for (const opening of doc?.openings || []) {
    const form = formsById.get(opening.id);
    const row = rowsById.get(opening.id);
    if (!form || !row) continue; // compile() already rejected it - it has no valid host

    const sku = skuById(pack, opening.sku);
    const host = wallRefs.get(row.hostWallId);
    const label = sku?.name || opening.sku || opening.id;
    if (!host) {
      report.skipped.push(`${label} has no exported host wall, so it was left out.`);
      continue;
    }

    const curve = form.profileLoops?.[0]?.curves?.[0];
    const width = form.profileLoops?.[0]?.length ?? 0;
    const height = form.depth ?? 0;
    if (!curve || !(width > 1e-6) || !(height > 1e-6)) {
      report.skipped.push(`${label} states no width or height, so no opening could be cut for it.`);
      continue;
    }

    // Distance along the host wall's axis to the opening's midpoint, in the
    // wall's own local coordinates - which is exactly the frame the opening's
    // placement is expressed in.
    const [ax, ay] = flip(curve.start);
    const [bx, by] = flip(curve.end);
    const u = ((ax + bx) / 2 - host.x1) * host.ux + ((ay + by) / 2 - host.y1) * host.uy;
    const sill = form.sill ?? 0;

    // The host wall's own placement is the parent, so the opening sits in wall
    // coordinates and moves with the wall exactly as it does on the canvas.
    const placement = f.add("IFCLOCALPLACEMENT", [host.placementRef, f.axis3(u, 0, sill)]);

    const box = (xDim, yDim, depth) => {
      const profile = f.add("IFCRECTANGLEPROFILEDEF", [
        ".AREA.", "$", f.add("IFCAXIS2PLACEMENT2D", [f.point2(0, 0), "$"]), r(xDim), r(yDim),
      ]);
      const solid = f.add("IFCEXTRUDEDAREASOLID", [profile, f.sweepOrigin(), f.dir3(0, 0, 1), r(depth)]);
      const rep = f.add("IFCSHAPEREPRESENTATION", [bodyContext, s("Body"), s("SweptSolid"), `(${solid})`]);
      return f.add("IFCPRODUCTDEFINITIONSHAPE", ["$", "$", `(${rep})`]);
    };

    // The void is cut slightly deeper than the wall so the two faces never
    // land coplanar, which is the usual cause of an opening that imports but
    // does not visibly cut anything.
    const voidShape = box(width, host.wall.thickness + 0.02, height);
    const openingRef = f.add("IFCOPENINGELEMENT", [
      s(ifcGuid(`void:${opening.id}`)), owner, s(`${label} opening`), "$", "$",
      placement, voidShape, s(opening.id),
    ]);
    f.add("IFCRELVOIDSELEMENT", [
      s(ifcGuid(`voids:${opening.id}`)), owner, "$", "$", host.ref, openingRef,
    ]);

    const isWindow = sku?.category === "window";
    const leafShape = box(width, host.wall.thickness, height);
    const leafRef = f.add(isWindow ? "IFCWINDOW" : "IFCDOOR", [
      s(ifcGuid(`opening:${opening.id}`)), owner, s(label), "$", s(objectTypeFor(sku, isWindow ? "Window" : "Door")),
      placement, leafShape, s(opening.id), r(height), r(width),
    ]);
    f.add("IFCRELFILLSELEMENT", [
      s(ifcGuid(`fills:${opening.id}`)), owner, "$", "$", openingRef, leafRef,
    ]);

    place(host.wall.level, leafRef);
    if (isWindow) report.counts.windows += 1;
    else report.counts.doors += 1;

    schedulePset(leafRef, row, opening.id);
    attachProperties(leafRef, isWindow ? "SP_Window" : "SP_Door", opening.id, [
      ["HostWall", row.hostWallId],
      ["External", row.external ? "True" : "False"],
      ["SillHeight", isWindow ? sill : null, "IFCLENGTHMEASURE"],
    ]);
  }

  // --- rooms ---------------------------------------------------------------
  for (const room of out.rooms || []) {
    const form = formsById.get(room.id);
    const loop = form?.profileLoops?.[0]?.curves || [];
    if (loop.length < 3) {
      report.skipped.push(`Room "${room.name || room.id}" has no closed outline and was left out.`);
      continue;
    }

    const storey = storeyFor(room.level);
    const points = loop.map((c) => flip(c.start));
    const polyline = f.add("IFCPOLYLINE", [`(${points.map(([x, y]) => f.point2(x, y)).join(",")},${f.point2(points[0][0], points[0][1])})`]);
    const profile = f.add("IFCARBITRARYCLOSEDPROFILEDEF", [".AREA.", "$", polyline]);

    // A room with no known ceiling height is written without a solid rather
    // than extruded to a plausible one: the space, its name and its area are
    // facts, its volume is not.
    let shape = "$";
    if (room.ceilingHeight > 0) {
      const solid = f.add("IFCEXTRUDEDAREASOLID", [profile, f.sweepOrigin(), f.dir3(0, 0, 1), r(room.ceilingHeight)]);
      const rep = f.add("IFCSHAPEREPRESENTATION", [bodyContext, s("Body"), s("SweptSolid"), `(${solid})`]);
      shape = f.add("IFCPRODUCTDEFINITIONSHAPE", ["$", "$", `(${rep})`]);
    } else {
      report.skipped.push(`Room "${room.name || room.id}" has no ceiling height, so it imports as a named area without a volume.`);
    }

    const placement = f.add("IFCLOCALPLACEMENT", [storey.placement, f.axis3(0, 0, 0)]);
    const ref = f.add("IFCSPACE", [
      s(ifcGuid(`space:${room.id}`)), owner, s(room.name || room.id), "$", "$",
      placement, shape, s(room.name || room.id), ".ELEMENT.", ".INTERNAL.", r(storey.elevation),
    ]);

    spaces.get(storey.level.id).push(ref);
    report.counts.rooms += 1;

    attachProperties(ref, "SP_Room", room.id, [
      ["PlannerId", room.id],
      ["Use", room.use],
      ["SansClass", room.sansClass],
      ["Area", room.area, "IFCAREAMEASURE"],
      ["Perimeter", room.perimeter, "IFCLENGTHMEASURE"],
      ["MinDimension", room.minDimension, "IFCLENGTHMEASURE"],
      // Stated, because a concave room's minimum dimension is an upper bound
      // and a plans examiner reading this file deserves to know which it is.
      ["MinDimensionExact", room.minDimensionExact ? "True" : "False"],
      ["CeilingHeight", room.ceilingHeight ?? null, "IFCLENGTHMEASURE"],
      ["Status", room.status],
    ]);
  }

  // --- relationships -------------------------------------------------------
  f.add("IFCRELAGGREGATES", [s(ifcGuid(`agg:project:${pack.id}`)), owner, "$", "$", project, `(${site})`]);
  f.add("IFCRELAGGREGATES", [s(ifcGuid(`agg:site:${pack.id}`)), owner, "$", "$", site, `(${building})`]);
  f.add("IFCRELAGGREGATES", [
    s(ifcGuid(`agg:building:${pack.id}`)), owner, "$", "$", building,
    `(${[...storeys.values()].map((st) => st.ref).join(",")})`,
  ]);

  for (const [levelId, refs] of contained) {
    if (!refs.length) continue;
    f.add("IFCRELCONTAINEDINSPATIALSTRUCTURE", [
      s(ifcGuid(`contained:${levelId}`)), owner, "$", "$", `(${refs.join(",")})`, storeys.get(levelId).ref,
    ]);
  }

  // A space is part of the storey, not something stored in it, so it is
  // aggregated rather than contained - the distinction Revit reads to make
  // rooms rooms instead of generic elements.
  for (const [levelId, refs] of spaces) {
    if (!refs.length) continue;
    f.add("IFCRELAGGREGATES", [
      s(ifcGuid(`spaces:${levelId}`)), owner, "$", "$", storeys.get(levelId).ref, `(${refs.join(",")})`,
    ]);
  }

  for (const [elementRef, pset, seed] of psetRels) {
    f.add("IFCRELDEFINESBYPROPERTIES", [
      s(ifcGuid(`defines:${seed}`)), owner, "$", "$", `(${elementRef})`, pset,
    ]);
  }

  const fileName = fileNameFor(pack);
  return { text: assemble(f, fileName, now, author, organisation), fileName, report };
}

function fileNameFor(pack) {
  const base = (pack?.name || "plan").replace(/[^\w\-. ]+/g, "").trim() || "plan";
  return `${base}.ifc`;
}

function assemble(f, fileName, now, author, organisation) {
  const timestamp = now.toISOString().replace(/\.\d+Z$/, "");
  return [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('ViewDefinition [CoordinationView_V2.0]'),'2;1');`,
    // The author list is a list of strings, so an unnamed author is an empty
    // list - not a list containing the `$` that means "unset" everywhere else.
    `FILE_NAME(${s(fileName)},'${timestamp}',${author ? `(${s(author)})` : "()"},(${s(organisation)}),${s(APP_NAME)},${s(APP_NAME)},'');`,
    `FILE_SCHEMA(('${SCHEMA}'));`,
    "ENDSEC;",
    "DATA;",
    ...f.lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

/** Levels the pack states but nothing was drawn on still import, as empty storeys. */
export function ifcSummary(report) {
  const c = report.counts;
  return `${c.walls} walls, ${c.doors} doors, ${c.windows} windows, ${c.rooms} rooms across ${c.levels} levels`;
}
