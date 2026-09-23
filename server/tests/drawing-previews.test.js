// Enough of a drawing to sketch it.
//
// The rule these hold is the one `listProjects` wrote down when it refused a
// thumbnail: no invented picture, and no shipping forty documents to draw a
// list. A preview is allowed only because it carries the geometry the firm
// actually drew and leaves the rest of the document in the database.

import test from "node:test";
import assert from "node:assert/strict";
import { firmWithRegisterProject, signedUpAgent, testDoc, testServer } from "./helpers.js";

/** A two-room plan with one free-standing wall, in metres. */
function drawnDoc() {
  return testDoc({
    rooms: [
      { id: "r1", level: "l0", name: "Lounge", shape: { kind: "rect", x: 0, y: 0, w: 6, h: 4 } },
      { id: "r2", level: "l0", name: "Kitchen", shape: { kind: "rect", x: 6, y: 0, w: 3, h: 4 } },
    ],
    segments: [
      { id: "s1", level: "l0", sku: "wall-230", x1: 0, y1: 6, x2: 9, y2: 6 },
    ],
    slabs: [
      { id: "sl1", level: "l0", shape: { kind: "rect", x: -0.3, y: -0.3, w: 9.6, h: 4.6 } },
    ],
  });
}

test("a job with a drawing gives back its outlines and nothing else", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, { code: "D101" });
  const attached = await client.post(`/api/projects/${project.id}/drawing`, {
    doc: drawnDoc(), packId: "tsp-pack",
  });
  assert.equal(attached.status, 201);

  const res = await client.get("/api/practice/drawing-previews");
  assert.equal(res.status, 200);
  assert.equal(res.body.previews.length, 1);

  const preview = res.body.previews[0];
  assert.equal(preview.projectId, project.id);
  assert.equal(preview.drawingId, attached.body.drawing.id);
  assert.equal(preview.rooms.length, 2);
  assert.equal(preview.slabs.length, 1);
  assert.equal(preview.segments.length, 1);
  assert.deepEqual(preview.rooms[0].shape, { kind: "rect", x: 0, y: 0, w: 6, h: 4 });
  assert.deepEqual(preview.segments[0], { x1: 0, y1: 6, x2: 9, y2: 6, level: "l0" });

  // The document is not shipped. A preview that carried `doc` would be the
  // forty-document list the library refused, wearing a different name.
  assert.equal(preview.doc, undefined);
  assert.equal(preview.rooms[0].name, undefined);
  assert.equal(preview.rooms[0].id, undefined);
});

test("a job with no drawing is absent, not present and blank", async () => {
  const { baseUrl } = await testServer();
  const { client } = await firmWithRegisterProject(baseUrl, { code: "R200" });

  const res = await client.get("/api/practice/drawing-previews");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.previews, []);
});

/**
 * Pressing "Start a drawing" mints a document before anybody has drawn on it,
 * so "has a drawing" and "has been drawn" are different facts. The preview
 * reports the second one by coming back empty rather than by being missing.
 */
test("a drawing nobody has drawn on comes back empty rather than missing", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, { code: "C088" });
  await client.post(`/api/projects/${project.id}/drawing`, {
    doc: testDoc(), packId: "tsp-pack",
  });

  const { body } = await client.get("/api/practice/drawing-previews");
  assert.equal(body.previews.length, 1);
  assert.deepEqual(body.previews[0].rooms, []);
  assert.deepEqual(body.previews[0].segments, []);
  assert.deepEqual(body.previews[0].slabs, []);
  assert.deepEqual(body.previews[0].roofs, []);
});

test("geometry that cannot be drawn is dropped rather than shipped", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, { code: "W076" });
  await client.post(`/api/projects/${project.id}/drawing`, {
    doc: testDoc({
      rooms: [
        { id: "r1", level: "l0", shape: { kind: "rect", x: 0, y: 0, w: 4, h: 3 } },
        { id: "r2", level: "l0" },
      ],
      segments: [
        { id: "s1", level: "l0", x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: "s2", level: "l0", x1: 0, y1: 0, x2: null, y2: 0 },
      ],
    }),
    packId: "tsp-pack",
  });

  const { body } = await client.get("/api/practice/drawing-previews");
  assert.equal(body.previews[0].rooms.length, 1, "the shapeless room is dropped");
  assert.equal(body.previews[0].segments.length, 1, "the wall with no end is dropped");
});

test("one firm's drawings are not another firm's", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl, { code: "S092" });
  await client.post(`/api/projects/${project.id}/drawing`, {
    doc: drawnDoc(), packId: "tsp-pack",
  });

  const { client: stranger } = await signedUpAgent(baseUrl, { orgName: "Another Firm" });
  const res = await stranger.get("/api/practice/drawing-previews");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.previews, []);
});
