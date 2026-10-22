import { test } from "node:test";
import assert from "node:assert/strict";

import { compile } from "../compile.js";
import { PlanStore, normalizeDoc } from "../model.js";
import { hasClickDraft } from "../click-draw.js";
import { isolateShows } from "../level-view.js";
import { expandServiceRefs, normalizeServices, pruneServices, serviceLayerVisible, serviceSystemsPresent } from "../service-model.js";
import {
  addRoutePoint,
  applyDrainageFall,
  connectNode,
  createNetwork,
  createRiser,
  deleteServiceRefs,
  drainageReport,
  edgeMeasure,
  liftNode,
  modifyRefusal,
  moveServiceNode,
  networkLevels,
  nodeAbsoluteZ,
  parseGradient,
  rehomeConnectedNodes,
  removeServiceNode,
  riserMarkers,
  routeProfile,
  serviceLevelView,
  serviceMassingRoutes,
  serviceTakeoff,
  splitServiceEdge,
} from "../services.js";
import { serviceInspectorModel, servicePanelHtml, serviceSkuChoices } from "../service-panel.js";

// A small stack with three storeys and two pipe types. The pipe with a stated
// wasteFactor and minimum gradient is the one the BOM and drainage checks use;
// "PLAIN" states neither, so nothing may be invented for it.
const pack = {
  name: "Services test pack",
  system: { defaultLevel: "L0" },
  levels: [
    { id: "L0", name: "Ground", elevation: 0 },
    { id: "L1", name: "First", elevation: 3 },
    { id: "L2", name: "Second", elevation: 5.8 },
  ],
  skus: [
    {
      id: "DRAIN110", name: "Drain 110", category: "drainage", unit: "m", draw: "pipe",
      geometry: { diameter: 0.11 },
      schedule: { report: ["length"] },
      compliance: { minGradient: 1 / 60 },
      cost: { wasteFactor: 0.05 },
    },
    {
      id: "PLAIN", name: "Plain pipe", category: "drainage", unit: "m", draw: "pipe",
      geometry: { diameter: 0.05 },
      schedule: { report: ["length"] },
    },
    {
      id: "TRAP", name: "Floor trap", category: "drainage", unit: "ea",
      geometry: { width: 0.2, depth: 0.2 },
    },
  ],
};

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

function net(overrides = {}) {
  return { id: "n1", name: "DR-01", system: "drainage", status: "planned", ...overrides };
}
function node(id, x, y, level, offset, extra = {}) {
  return { id, networkId: "n1", x, y, level, offset, ...extra };
}
function edge(id, a, b, extra = {}) {
  return { id, networkId: "n1", fromNode: a, toNode: b, sku: "DRAIN110", mode: "measured", ...extra };
}
function docOf(nodes, edges, extra = {}) {
  return normalizeDoc({ serviceNetworks: [net()], serviceNodes: nodes, serviceEdges: edges, ...extra });
}

// --- 1. level-relative -> absolute elevation --------------------------------

test("absolute elevation is the level elevation plus the node's offset, derived", () => {
  const n = node("a", 0, 0, "L1", 0.3);
  close(nodeAbsoluteZ(pack, n), 3.3);
  assert.equal(nodeAbsoluteZ(pack, node("b", 0, 0, "L1", null)), null, "no offset is not zero");
  assert.equal(nodeAbsoluteZ(pack, node("c", 0, 0, "NOPE", 0.3)), null, "an unknown level is not guessed");
});

test("the document stores offsets only, never absolute elevation or length", () => {
  const doc = docOf(
    [node("a", 0, 0, "L1", 0.3, { z: 3.3 }), node("b", 3, 4, "L1", 0.3)],
    [edge("e", "a", "b", { length: 5 })],
  );
  assert.equal("z" in doc.serviceNodes[0], false);
  assert.equal("absoluteZ" in doc.serviceNodes[0], false);
  assert.equal("length" in doc.serviceEdges[0], false);
});

// --- 2. horizontal, sloped, vertical 3D length ------------------------------

test("true length is hypot of plan and vertical difference", () => {
  const doc = docOf(
    [
      node("a", 0, 0, "L0", 0), node("b", 3, 4, "L0", 0), node("c", 3, 8, "L0", -3),
      node("d", 3, 8, "L0", 2.4),
    ],
    [edge("h", "a", "b"), edge("s", "b", "c"), edge("v", "c", "d")],
  );
  const by = (id) => edgeMeasure(doc, pack, doc.serviceEdges.find((e) => e.id === id));
  close(by("h").length, 5);
  assert.equal(by("h").slope, 0);
  close(by("s").length, 5); // 4 m along, 3 m down
  close(by("s").slope, -0.75);
  close(by("v").length, 5.4);
  assert.equal(by("v").vertical, true);
  assert.equal(by("v").slope, null, "a riser has no gradient");
});

test("an unresolved height leaves the length unknown rather than the plan length", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", null), node("b", 4, 0, "L0", 0)],
    [edge("e", "a", "b")],
  );
  const m = edgeMeasure(doc, pack, doc.serviceEdges[0]);
  assert.equal(m.dz, null);
  assert.equal(m.length, null);
  const takeoff = serviceTakeoff(doc, pack);
  assert.equal(takeoff.runs[0].include, false);
  assert.match(takeoff.warnings.join(" "), /not counted/);
});

// --- 3. 14.6 m horizontal + 2.4 m riser = 17.0 m ----------------------------

function riserDoc() {
  // L1 datum 3.0, L2 datum 5.8: a node at L2 -0.1 is 5.7, 2.4 above L1 +0.3 (3.3).
  return docOf(
    [node("a", 0, 0, "L1", 0.3), node("b", 14.6, 0, "L1", 0.3), node("c", 14.6, 0, "L2", -0.1)],
    [edge("run", "a", "b"), edge("riser", "b", "c")],
  );
}

test("14.6 m horizontal plus a 2.4 m riser is 17.0 m", () => {
  const takeoff = serviceTakeoff(riserDoc(), pack);
  const network = takeoff.networks[0];
  close(network.measuredLength, 17.0, 1e-9);
  close(network.horizontalLength, 14.6, 1e-9);
  close(network.verticalLength, 2.4, 1e-9);
  assert.equal(network.runs, 2);
});

// --- 4. a three-level network -----------------------------------------------

function threeLevelDoc() {
  return docOf(
    [
      node("a", 0, 0, "L0", 0.2), node("b", 5, 0, "L0", 0.2),
      node("c", 5, 0, "L1", 0.2), node("d", 5, 6, "L1", 0.2),
      node("e", 5, 6, "L2", 0.2), node("f", 9, 6, "L2", 0.2),
    ],
    [
      edge("r0", "a", "b"), edge("up1", "b", "c"), edge("r1", "c", "d"),
      edge("up2", "d", "e"), edge("r2", "e", "f"),
    ],
  );
}

test("one network can span three levels, bottom to top", () => {
  const doc = threeLevelDoc();
  assert.deepEqual(networkLevels(doc, pack, "n1"), ["L0", "L1", "L2"]);
  const takeoff = serviceTakeoff(doc, pack);
  assert.equal(takeoff.networks.length, 1);
  // 5 + 3 + 6 + 2.8 + 4
  close(takeoff.networks[0].measuredLength, 20.8, 1e-9);
});

// --- 5. per-level route and riser visibility --------------------------------

test("each level shows its own runs and a marker naming where the riser goes", () => {
  const doc = threeLevelDoc();
  const l0 = serviceLevelView(doc, pack, "L0");
  const l1 = serviceLevelView(doc, pack, "L1");
  const l2 = serviceLevelView(doc, pack, "L2");

  assert.deepEqual(l0.runs.map((m) => m.edge.id), ["r0"]);
  assert.deepEqual(l1.runs.map((m) => m.edge.id), ["r1"]);
  assert.deepEqual(l2.runs.map((m) => m.edge.id), ["r2"]);
  for (const view of [l0, l1, l2]) {
    assert.equal(view.runs.some((m) => m.edge.id.startsWith("up")), false, "a riser is never drawn as a run");
  }

  const [m0] = riserMarkers(doc, pack, "L0");
  assert.equal(m0.kind, "up");
  assert.match(m0.label, /to First/);

  const [m1a, m1b] = riserMarkers(doc, pack, "L1");
  const lower = [m1a, m1b].find((m) => m.x === 5 && m.y === 0);
  const upper = [m1a, m1b].find((m) => m.y === 6);
  assert.equal(lower.kind, "down");
  assert.match(lower.label, /from Ground/);
  assert.equal(upper.kind, "up");
  assert.match(upper.label, /to Second/);

  const [m2] = riserMarkers(doc, pack, "L2");
  assert.equal(m2.kind, "down");
  assert.match(m2.label, /from First/);
});

test("a node that rises and drops at one point shows one combined marker", () => {
  const doc = docOf(
    [node("a", 2, 2, "L0", 0.2), node("b", 2, 2, "L1", 0.2), node("c", 2, 2, "L2", 0.2)],
    [edge("e1", "a", "b"), edge("e2", "b", "c")],
  );
  const markers = riserMarkers(doc, pack, "L1");
  assert.equal(markers.length, 1);
  assert.equal(markers[0].kind, "through");
  assert.match(markers[0].label, /to Second/);
  assert.match(markers[0].label, /from Ground/);
});

test("an unresolved riser says so instead of guessing a direction", () => {
  const doc = docOf(
    [node("a", 1, 1, "L0", null), node("b", 1, 1, "L1", 0.2)],
    [edge("e", "a", "b")],
  );
  const [m] = riserMarkers(doc, pack, "L0");
  assert.equal(m.kind, "riser");
  assert.match(m.label, /unresolved/);
});

test("the plan lists each service system that has a route, and hiding one is only a view flag", () => {
  const doc = normalizeDoc({
    serviceNetworks: [
      { id: "g", name: "GS-01", system: "gas", status: "planned" },
      { id: "c", name: "CW-01", system: "coldWater", status: "planned" },
      { id: "e", name: "EL-01", system: "electrical", status: "existing" },
    ],
  });
  assert.deepEqual(serviceSystemsPresent(doc), ["coldWater", "electrical", "gas"]);
  assert.deepEqual(serviceSystemsPresent(normalizeDoc({})), []);
  const hidden = new Set(["gas"]);
  assert.equal(serviceLayerVisible("gas", hidden), false);
  assert.equal(serviceLayerVisible("coldWater", hidden), true);
  assert.equal(doc.serviceNetworks.length, 3, "hiding a system does not remove its network");
});

test("the services role is kept in a floor plan and dropped from a ceiling or roof cut", () => {
  assert.equal(isolateShows("floor", "service"), true);
  assert.equal(isolateShows("ceiling", "service"), false);
  assert.equal(isolateShows("roof", "service"), false);
});

// --- 6. riser relocation keeps Z --------------------------------------------

test("moving any part of a riser moves both ends in plan and changes no height", () => {
  const doc = riserDoc();
  const before = doc.serviceNodes.map((n) => ({ id: n.id, level: n.level, offset: n.offset }));
  const moved = moveServiceNode(doc, "c", 20, 3);
  assert.deepEqual(moved.sort(), ["b", "c"]);
  for (const id of ["b", "c"]) {
    const n = doc.serviceNodes.find((x) => x.id === id);
    assert.equal(n.x, 20);
    assert.equal(n.y, 3);
  }
  assert.deepEqual(doc.serviceNodes.map((n) => ({ id: n.id, level: n.level, offset: n.offset })), before);
});

test("dragging a riser edge or a node through the store moves the whole column", () => {
  const store = new PlanStore(riserDoc());
  const refs = expandServiceRefs(store.doc, [{ kind: "serviceEdge", id: "riser" }]);
  assert.deepEqual(refs.filter((r) => r.kind === "serviceNode").map((r) => r.id).sort(), ["b", "c"]);
  assert.equal(refs.some((r) => r.kind === "serviceEdge" && r.id === "riser"), true);
  const snaps = store.snapshotMoveTargets([{ kind: "serviceNode", id: "c" }]);
  assert.equal(snaps.length, 2);
  store.applyMoveSnapshot(snaps, 1, 1, null);
  const b = store.doc.serviceNodes.find((n) => n.id === "b");
  const c = store.doc.serviceNodes.find((n) => n.id === "c");
  assert.equal(b.x, c.x);
  assert.equal(b.y, c.y);
  assert.equal(c.offset, -0.1);
  assert.equal(c.level, "L2");
});

test("a riser is made at the same X/Y, by relative change or by level plus offset", () => {
  const doc = docOf([node("a", 3, 4, "L0", 0.5)], []);
  const up = createRiser(doc, pack, "a", { delta: 2.4 });
  assert.equal(up.ok, true);
  const top = doc.serviceNodes.find((n) => n.id === up.nodeId);
  assert.equal(top.x, 3);
  assert.equal(top.y, 4);
  close(top.offset, 2.9);

  const toLevel = createRiser(doc, pack, "a", { level: "L1", offset: 0.1 });
  assert.equal(toLevel.ok, true);
  const dest = doc.serviceNodes.find((n) => n.id === toLevel.nodeId);
  assert.equal(dest.level, "L1");
  assert.equal(dest.x, 3);
  close(nodeAbsoluteZ(pack, dest), 3.1);

  assert.equal(createRiser(doc, pack, "a", { delta: 0 }).ok, false);
  assert.equal(createRiser(doc, pack, "a", { level: "NOPE", offset: 0 }).ok, false);
});

// --- 7 & 8. BOM: schematic exclusion, no double counting --------------------

test("schematic runs are drawn and measured but never reach the BOM", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 10, 0, "L0", 0), node("c", 10, 5, "L0", 0)],
    [edge("m", "a", "b"), edge("s", "b", "c", { mode: "schematic" })],
  );
  const takeoff = serviceTakeoff(doc, pack);
  assert.equal(takeoff.runs.find((r) => r.edge.id === "s").include, false);
  assert.equal(takeoff.runs.find((r) => r.edge.id === "s").reason, "schematic");
  close(takeoff.networks[0].measuredLength, 10);
  close(takeoff.networks[0].schematicLength, 5);

  const payload = compile(doc, pack);
  const rows = payload.instances.filter((i) => i.kind === "serviceEdge");
  assert.deepEqual(rows.map((r) => r.elementId), ["m"]);
});

test("a riser crossing levels is one BOM row, not one per floor", () => {
  const payload = compile(riserDoc(), pack);
  const rows = payload.instances.filter((i) => i.kind === "serviceEdge");
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.elementId === "riser").length, 1);
  close(rows.reduce((s, r) => s + r.length, 0), 17.0, 1e-9);
  // Filed once, under the lower end's level.
  assert.equal(rows.find((r) => r.elementId === "riser").level, "L1");
  const grandTotal = rows.reduce((s, r) => s + r.length, 0);
  const perNetwork = payload.services.networks[0].measuredLength;
  close(grandTotal, perNetwork);
});

test("a duplicate run between the same two points is never counted twice", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 4, 0, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "a")],
  );
  assert.equal(doc.serviceEdges.length, 1);
  close(serviceTakeoff(doc, pack).networks[0].measuredLength, 4);
});

test("wasteFactor is material wastage after the measured length, never a route allowance", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 10, 0, "L0", 0), node("c", 10, 4, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c", { sku: "PLAIN" })],
  );
  const rows = compile(doc, pack).instances.filter((i) => i.kind === "serviceEdge");
  const withWaste = rows.find((r) => r.elementId === "e1");
  const without = rows.find((r) => r.elementId === "e2");
  close(withWaste.length, 10);
  close(withWaste.orderLength, 10.5);
  assert.equal(without.orderLength, undefined, "no stated factor, so none is applied");
  close(without.length, 4);
});

test("SKU, rate and element references survive into the row; untyped runs are not counted", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 6, 0, "L0", 0), node("c", 6, 2, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c", { sku: null })],
  );
  const payload = compile(doc, pack);
  const rows = payload.instances.filter((i) => i.kind === "serviceEdge");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].elementId, "e1");
  assert.equal(rows[0].model, "DRAIN110");
  assert.equal(rows[0].networkId, "n1");
  assert.equal(rows[0].system, "drainage");
  assert.match(payload.warnings.join(" "), /no pipe or conduit type/);
});

// --- 9. normalisation of old and new documents ------------------------------

test("an old document with no service arrays loads with three empty ones", () => {
  const doc = normalizeDoc({ rooms: [] });
  assert.deepEqual(doc.serviceNetworks, []);
  assert.deepEqual(doc.serviceNodes, []);
  assert.deepEqual(doc.serviceEdges, []);
});

test("normalisation drops malformed rows and never invents a plausible value", () => {
  const out = normalizeServices({
    serviceNetworks: [net(), net({ id: "bad", system: "steam" }), { id: "n1", system: "gas" }],
    serviceNodes: [
      node("a", 0, 0, "L0", null),
      node("b", 1, "x", "L0", 0),
      { id: "c", networkId: "ghost", x: 0, y: 0 },
      node("d", 2, 0, undefined, 1),
    ],
    serviceEdges: [
      edge("ok", "a", "d"),
      edge("loop", "a", "a"),
      edge("dangling", "a", "gone"),
      { id: "x", networkId: "ghost", fromNode: "a", toNode: "d" },
      edge("odd", "d", "a", { mode: "fancy" }),
    ],
  });
  assert.deepEqual(out.serviceNetworks.map((n) => n.id), ["n1"]);
  assert.deepEqual(out.serviceNodes.map((n) => n.id), ["a", "d"]);
  assert.equal(out.serviceNodes[0].offset, null, "an unknown offset stays null, not 0");
  assert.equal(out.serviceNodes[1].level, null);
  assert.deepEqual(out.serviceEdges.map((e) => e.id), ["ok"], "the duplicate pair and bad ends are gone");
});

test("a round trip through JSON reproduces a new document exactly", () => {
  const doc = threeLevelDoc();
  const again = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(again.serviceNetworks, doc.serviceNetworks);
  assert.deepEqual(again.serviceNodes, doc.serviceNodes);
  assert.deepEqual(again.serviceEdges, doc.serviceEdges);
});

// --- 10. undo, persistence, dangling references ------------------------------

test("a route click is one undo step and undo restores the previous document", () => {
  const saved = [];
  const store = new PlanStore(normalizeDoc({}), { sink: { save: (d) => saved.push(JSON.parse(JSON.stringify(d))) } });
  store.pushUndo();
  const network = createNetwork(store.doc, { system: "drainage" });
  const first = addRoutePoint(store.doc, pack, { networkId: network.id, level: "L0", offset: 0, sku: "DRAIN110" }, { x: 0, y: 0 });
  store.pushUndo();
  const second = addRoutePoint(store.doc, pack, {
    networkId: network.id, fromNodeId: first.nodeId, level: "L0", offset: -0.1, sku: "DRAIN110",
  }, { x: 6, y: 0 });
  store.persist();
  assert.equal(second.ok, true);
  assert.equal(store.doc.serviceEdges.length, 1);

  assert.equal(store.undo(), true);
  assert.equal(store.doc.serviceEdges.length, 0);
  assert.equal(store.doc.serviceNodes.length, 1);
  assert.equal(store.undo(), true);
  assert.equal(store.doc.serviceNetworks.length, 0);
  assert.equal(store.doc.serviceNodes.length, 0);

  const last = saved.at(-1);
  assert.deepEqual(last.serviceNodes, []);
  const withRoute = saved.find((d) => d.serviceEdges.length === 1);
  assert.deepEqual(normalizeDoc(withRoute).serviceEdges, withRoute.serviceEdges);
});

test("drawing chains from the last point, reuses a point clicked again, and refuses a speck", () => {
  const doc = normalizeDoc({});
  const network = createNetwork(doc, { system: "drainage" });
  const route = { networkId: network.id, level: "L0", offset: 0, sku: "DRAIN110" };
  const a = addRoutePoint(doc, pack, route, { x: 0, y: 0 });
  const b = addRoutePoint(doc, pack, { ...route, fromNodeId: a.nodeId }, { x: 5, y: 0 });
  const c = addRoutePoint(doc, pack, { ...route, fromNodeId: b.nodeId }, { x: 5, y: 4 });
  const back = addRoutePoint(doc, pack, { ...route, fromNodeId: c.nodeId }, { x: 0.02, y: 0.03 }, { tol: 0.15 });
  assert.equal(back.nodeId, a.nodeId, "clicking an existing point joins it");
  assert.equal(back.createdNode, false);
  assert.equal(doc.serviceNodes.length, 3);
  assert.equal(doc.serviceEdges.length, 3);

  const speck = addRoutePoint(doc, pack, { ...route, fromNodeId: c.nodeId }, { x: 5.01, y: 4.6 }, { tol: 0.001 });
  assert.equal(speck.ok, true);
  const tooShort = addRoutePoint(doc, pack, { ...route, fromNodeId: speck.nodeId }, { x: 5.01, y: 4.62 }, { tol: 0.001 });
  assert.equal(tooShort.ok, false);
});

test("deleting a point takes its runs; deleting the last run drops the network", () => {
  const doc = threeLevelDoc();
  deleteServiceRefs(doc, [{ kind: "serviceNode", id: "c" }]);
  assert.equal(doc.serviceEdges.some((e) => e.fromNode === "c" || e.toNode === "c"), false);
  assert.equal(doc.serviceNodes.some((n) => n.id === "c"), false);

  const one = docOf([node("a", 0, 0, "L0", 0), node("b", 3, 0, "L0", 0)], [edge("e", "a", "b")]);
  deleteServiceRefs(one, [{ kind: "serviceEdge", id: "e" }]);
  assert.equal(one.serviceNodes.length, 0, "no stranded endpoints");
  assert.equal(one.serviceNetworks.length, 0, "no empty network");
});

test("deleting a placed component clears a connection to it instead of dangling", () => {
  const doc = normalizeDoc({
    items: [{ id: "trap1", sku: "TRAP", x: 1, y: 1, level: "L0" }],
    serviceNetworks: [net()],
    serviceNodes: [
      node("a", 1.1, 1.1, "L0", 0, { connectedRef: { kind: "item", id: "trap1" } }),
      node("b", 5, 1.1, "L0", -0.1),
    ],
    serviceEdges: [edge("e", "a", "b")],
  });
  assert.deepEqual(doc.serviceNodes[0].connectedRef, { kind: "item", id: "trap1" });
  doc.items = [];
  pruneServices(doc);
  assert.equal(doc.serviceNodes[0].connectedRef, null);
  assert.equal(doc.serviceEdges.length, 1, "the route stays");

  const loaded = normalizeDoc({
    serviceNetworks: [net()],
    serviceNodes: [node("a", 0, 0, "L0", 0, { connectedRef: { kind: "item", id: "never-existed" } }), node("b", 4, 0, "L0", 0)],
    serviceEdges: [edge("e", "a", "b")],
  });
  assert.equal(loaded.serviceNodes[0].connectedRef, null);
});

test("connecting moves the point (and its riser) onto the component and keeps its height", () => {
  const doc = normalizeDoc({
    items: [{ id: "trap1", sku: "TRAP", x: 2, y: 2, level: "L1" }],
    serviceNetworks: [net()],
    serviceNodes: [node("a", 9, 9, "L1", 0.3), node("b", 9, 9, "L0", 0.3), node("c", 15, 9, "L0", 0.3)],
    serviceEdges: [edge("e", "a", "b"), edge("f", "b", "c")],
  });
  const res = connectNode(doc, pack, "a", "trap1");
  assert.equal(res.ok, true);
  const a = doc.serviceNodes.find((n) => n.id === "a");
  const b = doc.serviceNodes.find((n) => n.id === "b");
  assert.deepEqual([a.x, a.y], [2.1, 2.1]);
  assert.deepEqual([b.x, b.y], [2.1, 2.1], "the riser stays vertical");
  assert.equal(a.offset, 0.3);
  assert.equal(b.level, "L0");

  // Components on another level are refused rather than silently moved.
  doc.items.push({ id: "trap0", sku: "TRAP", x: 0, y: 0, level: "L0" });
  assert.equal(connectNode(doc, pack, "a", "trap0").ok, false);

  // The component moves; its point follows.
  doc.items[0].x = 7;
  doc.items[0].y = 8;
  assert.equal(rehomeConnectedNodes(doc, pack), 1, "one connected point moved; its riser partner came with it");
  close(doc.serviceNodes.find((n) => n.id === "a").x, 7.1);
  close(doc.serviceNodes.find((n) => n.id === "b").y, 8.1);
});

test("a service selection refuses modify operations that would break a riser", () => {
  assert.equal(modifyRefusal([{ kind: "segment", id: "w" }]), null);
  assert.match(modifyRefusal([{ kind: "serviceEdge", id: "e" }]), /riser/i);
});

test("a route in progress is a click draft, so Escape drops it before leaving the tool", () => {
  assert.equal(hasClickDraft({}), false);
  assert.equal(hasClickDraft({ serviceRoute: { networkId: "n1", fromNodeId: "a" } }), true);
  assert.equal(hasClickDraft({ serviceRoute: null, serviceConnect: { nodeId: "a" } }), true);
});

// --- drainage ----------------------------------------------------------------

test("drainage warns on a gradient below the type's stated minimum, and only then", () => {
  const flat = docOf([node("a", 0, 0, "L0", 0), node("b", 6, 0, "L0", -0.05)], [edge("e", "a", "b")]);
  assert.equal(drainageReport(flat, pack).some((f) => f.code === "below-min-gradient"), true);

  const good = docOf([node("a", 0, 0, "L0", 0), node("b", 6, 0, "L0", -0.15)], [edge("e", "a", "b")]);
  assert.equal(drainageReport(good, pack).some((f) => f.severity === "warn"), false);
});

test("drainage warns when the flow direction runs uphill", () => {
  const uphill = docOf([node("a", 0, 0, "L0", 0), node("b", 6, 0, "L0", 0.2)], [edge("e", "a", "b")]);
  assert.equal(drainageReport(uphill, pack).some((f) => f.code === "uphill"), true);
});

test("drainage warns when two runs leave one point (inconsistent direction)", () => {
  const doc = docOf(
    [node("a", 5, 0, "L0", 0), node("b", 0, 0, "L0", -0.1), node("c", 10, 0, "L0", -0.1)],
    [edge("e1", "a", "b"), edge("e2", "a", "c")],
  );
  assert.equal(drainageReport(doc, pack).some((f) => f.code === "divergent-flow"), true);
});

test("drainage says unresolved rather than passing a run whose heights are unknown", () => {
  const doc = docOf([node("a", 0, 0, "L0", null), node("b", 6, 0, "L0", -0.1)], [edge("e", "a", "b")]);
  const report = drainageReport(doc, pack);
  assert.equal(report[0].code, "elevations-unresolved");
  assert.equal(report[0].severity, "warn");
});

test("a type with no stated minimum is reported as unable to check, never guessed", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 6, 0, "L0", -0.001)],
    [edge("e", "a", "b", { sku: "PLAIN" })],
  );
  const report = drainageReport(doc, pack);
  assert.deepEqual(report.map((f) => [f.severity, f.code]), [["info", "no-min-gradient"]]);
});

test("setting a fall writes the downstream height, not a stored slope", () => {
  const doc = docOf([node("a", 0, 0, "L0", 0.5), node("b", 6, 0, "L0", 0.5)], [edge("e", "a", "b")]);
  const res = applyDrainageFall(doc, pack, "e", parseGradient("1:60"));
  assert.equal(res.ok, true);
  close(doc.serviceNodes.find((n) => n.id === "b").offset, 0.4);
  assert.equal(doc.serviceNodes.find((n) => n.id === "a").offset, 0.5, "upstream end untouched");
  assert.equal("slope" in doc.serviceEdges[0], false);
  assert.equal(drainageReport(doc, pack).some((f) => f.severity === "warn"), false);

  // Refusals: unknown upstream height, a riser, a non-drainage network.
  const unknown = docOf([node("a", 0, 0, "L0", null), node("b", 6, 0, "L0", 0)], [edge("e", "a", "b")]);
  assert.equal(applyDrainageFall(unknown, pack, "e", 1 / 60).ok, false);
  assert.equal(applyDrainageFall(riserDoc(), pack, "riser", 1 / 60).ok, false);
});

test("gradients parse from 1:n, percent or a ratio, and nothing else", () => {
  close(parseGradient("1:60"), 1 / 60);
  close(parseGradient("1.7%"), 0.017);
  close(parseGradient("0.02"), 0.02);
  assert.equal(parseGradient("steep"), null);
  assert.equal(parseGradient("1:0"), null);
  assert.equal(parseGradient(""), null);
});

// --- route profile and inspector ---------------------------------------------

test("the route profile reads absolute Z against distance along the route", () => {
  const profile = routeProfile(riserDoc(), pack, "run");
  assert.equal(profile.resolved, true);
  assert.equal(profile.points.length, 3);
  close(profile.points[0].z, 3.3);
  close(profile.points[2].z, 5.7);
  close(profile.points[1].s, 14.6);
  close(profile.points[2].s, 14.6, 1e-9); // the riser is a step at one chainage
  assert.deepEqual(profile.levels.length >= 2, true);
});

test("the inspector reports plan length, vertical difference, true length and slope for a run", () => {
  const doc = riserDoc();
  const model = serviceInspectorModel(doc, pack, [{ kind: "serviceEdge", id: "riser" }]);
  assert.equal(model.mode, "edges");
  assert.equal(model.system, "drainage");
  close(model.single.length, 2.4);
  close(model.single.dz, 2.4);
  assert.equal(model.single.vertical, true);
  const html = servicePanelHtml({ doc, pack, ui: { system: "drainage", offsetText: "0.00", mode: "measured" }, model, showRoute: false });
  assert.match(html, /True length/);
  assert.match(html, /Absolute|Elevation/);
  assert.doesNotMatch(html, /v2-service-profile/); // the profile lives under the plan now
});

test("types offered are only the length-measured pipes the template really has", () => {
  assert.deepEqual(serviceSkuChoices(pack, "drainage").map((s) => s.id), ["DRAIN110", "PLAIN"]);
  assert.deepEqual(serviceSkuChoices({ skus: [] }, "gas"), []);
});

// --- node editing: add, remove, drag ----------------------------------------

test("adding a node splits a run in two, keeps type and mode, and interpolates height", () => {
  const doc = docOf([node("a", 0, 0, "L0", 0), node("b", 10, 0, "L0", -1)], [edge("e", "a", "b", { sku: "PLAIN" })]);
  const res = splitServiceEdge(doc, pack, "e", { x: 4, y: 0.3 });
  assert.equal(res.ok, true);
  assert.equal(doc.serviceEdges.length, 2);
  const mid = doc.serviceNodes.find((n) => n.id === res.nodeId);
  close(mid.x, 4);
  close(mid.y, 0);
  close(mid.offset, -0.4);
  assert.deepEqual(doc.serviceEdges.map((e) => e.sku), ["PLAIN", "PLAIN"]);
  const sum = doc.serviceEdges.reduce((s, e) => s + edgeMeasure(doc, pack, e).length, 0);
  close(sum, Math.hypot(10, 1), 1e-6); // splitting never changes the total
});

test("a node added on a run with an unstated end stays unresolved, and a riser cannot be split", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", null), node("b", 10, 0, "L0", 0), node("c", 10, 0, "L0", 2)],
    [edge("e", "a", "b"), edge("v", "b", "c")],
  );
  const res = splitServiceEdge(doc, pack, "e", { x: 5, y: 0 });
  assert.equal(doc.serviceNodes.find((n) => n.id === res.nodeId).offset, null);
  assert.equal(splitServiceEdge(doc, pack, "v", { x: 10, y: 0 }).ok, false);
});

test("removing a node between two runs heals them into one", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 5, 0, "L0", 0), node("c", 10, 0, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c")],
  );
  const res = removeServiceNode(doc, "b");
  assert.equal(res.healed, true);
  assert.equal(doc.serviceNodes.length, 2);
  assert.equal(doc.serviceEdges.length, 1);
  assert.deepEqual([doc.serviceEdges[0].fromNode, doc.serviceEdges[0].toNode], ["a", "c"]);
});

test("removing a junction, end or riser node deletes it with its runs instead of healing", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 5, 0, "L0", 0), node("c", 5, 0, "L0", 2), node("d", 9, 0, "L0", 2)],
    [edge("e1", "a", "b"), edge("v", "b", "c"), edge("e2", "c", "d")],
  );
  const res = removeServiceNode(doc, "b"); // joins a run and a riser: no single run to heal into
  assert.equal(res.healed, false);
  assert.equal(doc.serviceEdges.some((e) => e.fromNode === "b" || e.toNode === "b"), false);
});

test("dragging a node moves it with its riser column and keeps heights", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 5, 0, "L0", 0), node("c", 5, 0, "L0", 2.4)],
    [edge("e", "a", "b"), edge("v", "b", "c")],
  );
  moveServiceNode(doc, "b", 6, 2);
  const by = (id) => doc.serviceNodes.find((n) => n.id === id);
  assert.deepEqual([by("c").x, by("c").y, by("c").offset], [6, 2, 2.4]);
});
test("lifting a mid-route node makes a vertical step, not a slope", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 5, 0, "L0", 0), node("c", 10, 0, "L0", 0)],
    [edge("e1", "a", "b"), edge("e2", "b", "c")],
  );
  const res = liftNode(doc, pack, "b", 1.5, "e1");
  assert.equal(res.ok, true);
  const top = doc.serviceNodes.find((n) => n.id === res.nodeId);
  assert.deepEqual([top.x, top.y, top.offset], [5, 0, 1.5]);
  // The run ahead now leaves from the lifted node; the run behind stays level.
  assert.equal(doc.serviceEdges.find((e) => e.id === "e2").fromNode, top.id);
  assert.equal(doc.serviceEdges.find((e) => e.id === "e1").toNode, "b");
  const profile = routeProfile(doc, pack, "e1");
  const zs = profile.points.map((p) => p.z);
  assert.deepEqual(zs, [0, 0, 1.5, 1.5]);
  close(profile.points[1].s, profile.points[2].s, 1e-9); // the step is at one chainage
  close(profile.chainage, 10);
  close(doc.serviceEdges.reduce((s, e) => s + edgeMeasure(doc, pack, e).length, 0), 11.5, 1e-9);
});

test("lifting the top of an existing rise makes it taller; lifting an end adds a rise", () => {
  const doc = docOf(
    [node("a", 0, 0, "L0", 0), node("b", 5, 0, "L0", 0), node("c", 5, 0, "L0", 2), node("d", 9, 0, "L0", 2)],
    [edge("e1", "a", "b"), edge("v", "b", "c"), edge("e2", "c", "d")],
  );
  liftNode(doc, pack, "c", 0.5, "e1");
  close(doc.serviceNodes.find((n) => n.id === "c").offset, 2.5);
  assert.equal(doc.serviceNodes.length, 4, "no extra node for a rise that already exists");
  const res = liftNode(doc, pack, "d", 1, "e1");
  assert.equal(res.createdNode, true);
  assert.equal(liftNode(doc, pack, "a", 0, "e1").ok, false);
});

test("3D routes use absolute height and the system colour, and skip an unresolved end", () => {
  const doc = normalizeDoc({
    serviceNetworks: [
      net({ id: "cw", system: "coldWater", name: "CW-01" }),
      net({ id: "ex", system: "gas", status: "existing", name: "GS-01" }),
    ],
    serviceNodes: [
      node("a", 0, 0, "L0", 0.4, { networkId: "cw" }),
      node("b", 2, 0, "L0", 1.2, { networkId: "cw" }),
      node("c", 4, 0, "L0", null, { networkId: "cw" }),
      node("d", 0, 1, "L1", 0.2, { networkId: "ex" }),
      node("e", 0, 1, "L0", 0.2, { networkId: "ex" }),
    ],
    serviceEdges: [
      edge("e1", "a", "b", { networkId: "cw", sku: "PLAIN" }),
      edge("e2", "b", "c", { networkId: "cw" }),
      edge("e3", "d", "e", { networkId: "ex", mode: "schematic", sku: null }),
    ],
  });
  const routes = serviceMassingRoutes(doc, pack);
  assert.equal(routes.length, 2, "the run with no offset is left out");
  const cold = routes.find((route) => route.id === "e1");
  assert.deepEqual(cold.a, [0, 0, 0.4]);
  assert.deepEqual(cold.b, [2, 0, 1.2]);
  assert.equal(cold.colour, "#2675b8");
  assert.equal(cold.system, "coldWater");
  assert.equal(cold.status, "planned");
  assert.equal(cold.dash, null);
  assert.equal(cold.diameter, 0.05);
  const gas = routes.find((route) => route.id === "e3");
  assert.equal(gas.colour, "#8d5aa7");
  assert.equal(gas.status, "existing");
  assert.equal(gas.dash, "schematic");
  assert.equal(gas.diameter, null);
  close(gas.a[2], 3.2);
  close(gas.b[2], 0.2);
});