import { test } from "node:test";
import assert from "node:assert/strict";

import { compile } from "../compile.js";
import { normalizeDoc } from "../model.js";
import { boqRows, bomRows } from "../schedule.js";
import { bendClass, bendDeflection, runGradient, serviceTakeoff } from "../services.js";

const pack = {
  name: "Bend test pack",
  system: { defaultLevel: "L0" },
  levels: [
    { id: "L0", name: "Ground", elevation: 0 },
    { id: "L1", name: "First", elevation: 3 },
  ],
  skus: [
    {
      id: "DRAIN110", name: "Drain 110", category: "drainage", unit: "m", draw: "pipe",
      geometry: { diameter: 0.11 }, schedule: { report: ["length"] }, cost: { wasteFactor: null },
    },
    {
      id: "PLAIN", name: "Plain pipe", category: "drainage", unit: "m", draw: "pipe",
      geometry: { diameter: 0.05 }, schedule: { report: ["length"] },
    },
    {
      id: "BEND90", name: "Drain bend 90", category: "drainage", unit: "ea", draw: "pipe",
      geometry: { diameter: 0.11 }, schedule: { report: ["count"] }, cost: { rateRef: "BEND90" },
    },
  ],
};

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

const node = (id, x, y, level, offset) => ({ id, networkId: "n1", x, y, level, offset });
const edge = (id, a, b, extra = {}) => ({ id, networkId: "n1", fromNode: a, toNode: b, sku: "DRAIN110", mode: "measured", ...extra });
const docOf = (nodes, edges) => normalizeDoc({
  serviceNetworks: [{ id: "n1", name: "DR-01", system: "drainage", status: "planned" }],
  serviceNodes: nodes,
  serviceEdges: edges,
});

test("deflection is 0 for straight on, 90 for a right angle, and class snaps within tolerance", () => {
  close(bendDeflection([1, 0, 0], [1, 0, 0]), 0);
  close(bendDeflection([1, 0, 0], [0, 1, 0]), 90);
  close(bendDeflection([1, 0, 0], [1, 1, 0]), 45);
  close(bendDeflection([1, 0, 0], [0, 0, 1]), 90, 1e-6);
  assert.equal(bendClass(90), 90);
  assert.equal(bendClass(46.5), 45);
  assert.equal(bendClass(22.5), 22.5);
  assert.equal(bendClass(70), null, "a 70 degree bend is not rounded to a fitting");
});

test("a corner in plan is one 90 degree bend; a straight node is none", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 4, 0, "L0", 0), node("c", 4, 3, "L0", 0), node("d", 4, 6, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "d")],
  );
  const { bends, networks } = serviceTakeoff(doc, pack);
  assert.equal(bends.length, 1);
  assert.equal(bends[0].nodeId, "b");
  close(bends[0].angle, 90);
  assert.equal(bends[0].standard, 90);
  assert.equal(networks[0].bends, 1);
});

test("a riser meeting a horizontal run is a 90 degree bend", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0.3), node("b", 5, 0, "L0", 0.3), node("c", 5, 0, "L1", 0.3)],
    [edge("run", "a", "b"), edge("riser", "b", "c")],
  );
  const { bends } = serviceTakeoff(doc, pack);
  assert.equal(bends.length, 1);
  close(bends[0].angle, 90);
});

test("a 45 degree turn and a non-standard turn are told apart", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 4, 0, "L0", 0), node("c", 8, 4, "L0", 0), node("d", 8, 10, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "d")],
  );
  const { bends } = serviceTakeoff(doc, pack);
  assert.equal(bends.length, 2);
  assert.equal(bends.find((b) => b.nodeId === "b").standard, 45);
  assert.equal(bends.find((b) => b.nodeId === "c").standard, 45);

  const odd = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 4, 0, "L0", 0), node("c", 5, 3, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c")],
  );
  const [bend] = serviceTakeoff(odd, pack).bends;
  assert.equal(bend.standard, null);
  close(bend.angle, 71.565, 0.01);
});

test("a junction of three runs is not a bend", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 4, 0, "L0", 0), node("c", 8, 0, "L0", 0), node("d", 4, 4, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "b", "d")],
  );
  assert.equal(serviceTakeoff(doc, pack).bends.length, 0);
});

test("a change of pipe type at a turn is a transition: warned, not counted as a bend", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 4, 0, "L0", 0), node("c", 4, 3, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c", { sku: "PLAIN" })],
  );
  const takeoff = serviceTakeoff(doc, pack);
  assert.equal(takeoff.bends[0].mixed, true);
  assert.equal(takeoff.networks[0].bends, 0);
  assert.match(takeoff.warnings.join(" "), /adaptor/);
  const bends = compile(doc, pack).instances.filter((r) => r.angle !== undefined);
  assert.equal(bends.length, 0);
});

test("an unresolved height gives no direction, so no bend is invented", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", null), node("b", 4, 0, "L0", null), node("c", 4, 3, "L0", null)],
    [edge("e1", "a", "b"), edge("e2", "b", "c")],
  );
  assert.equal(serviceTakeoff(doc, pack).bends.length, 0);
});

function cornerDoc() {
  return docOf(
    [node("a", 0, 0, "L0", 0), node("b", 4, 0, "L0", 0), node("c", 4, 3, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c")],
  );
}

test("with no fitting type in the template a bend is a derived, countable, unpriced line", () => {
  const rows = bomRows(compile(cornerDoc(), pack)).filter((r) => r.category === "Service fittings");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].derived, true);
  assert.equal(rows[0].qty, 1);
  assert.equal(rows[0].unit, "ea");
  assert.match(rows[0].description, /90° bend, Drain 110/);
  assert.equal(rows[0].elements[0].angle, 90);

  const boq = boqRows(compile(cornerDoc(), pack), null).find((r) => r.category === "Service fittings");
  assert.equal(boq.priced, false);
  assert.equal(boq.rate, null, "no rate on file is null, not 0");
  assert.equal(boq.amount, null);

  // A QS can price it by the derived code.
  const priced = boqRows(compile(cornerDoc(), pack), {
    rates: [{ model: "BEND-90:DRAIN110", unit: "ea", rate: 85, description: "90° bend" }],
  }).find((r) => r.category === "Service fittings");
  assert.equal(priced.priced, true);
  close(priced.amount, 85);
});

test("where the pipe names a fitting SKU the bend is that fitting and prices from it", () => {
  const withFitting = structuredClone(pack);
  withFitting.skus.find((s) => s.id === "DRAIN110").fittings = { bend90: "BEND90" };
  const out = compile(cornerDoc(), withFitting);
  const bend = out.instances.find((r) => r.model === "BEND90");
  assert.ok(bend, "a row for the named fitting");
  assert.equal(bend.count, 1);
  assert.equal(bend.rateRef, "BEND90");
  assert.equal(bend.derived, undefined);
  assert.equal(out.instances.filter((r) => r.category === "Service fittings").length, 0);
});

test("a run's row carries its grade, and a riser carries none", () => {
  const doc = docOf(
    [
      node("a", 0, 0, "L0", 0), node("b", 6, 0, "L0", -0.1),
      node("c", 6, 0, "L1", 0.2),
    ],
    [edge("e1", "a", "b"), edge("e2", "b", "c")],
  );
  const rows = compile(doc, pack).instances.filter((r) => r.kind === "serviceEdge");
  const run = rows.find((r) => r.elementId === "e1");
  close(run.slope, -1 / 60, 1e-9);
  assert.equal(run.gradient, "1:60 fall");
  const riser = rows.find((r) => r.elementId === "e2");
  assert.equal(riser.slope, null);
  assert.equal(riser.gradient, null);

  const line = bomRows(compile(doc, pack)).find((r) => r.model === "DRAIN110");
  assert.equal(line.elements.find((e) => e.id === "e1").gradient, "1:60 fall");
  assert.equal("gradient" in line.elements.find((e) => e.id === "e2"), false);
});

test("runGradient reads fall, rise and level, and is null when unknown", () => {
  assert.equal(runGradient(-0.0125), "1:80 fall");
  assert.equal(runGradient(0.1), "1:10 rise");
  assert.equal(runGradient(0), "level");
  assert.equal(runGradient(null), null);
});
