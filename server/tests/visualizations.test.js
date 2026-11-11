import test from "node:test";
import assert from "node:assert/strict";
import { pngFromDataUrl } from "../src/assets.js";
import { firmWithProject, signedUpAgent, testServer } from "./helpers.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function dataPng(bytes) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

test("pngFromDataUrl accepts a PNG and refuses anything else", () => {
  assert.deepEqual(pngFromDataUrl(dataPng(PNG)), PNG);
  assert.equal(pngFromDataUrl("data:image/jpeg;base64,aaaa"), null);
  assert.equal(pngFromDataUrl("not a picture"), null);
  assert.throws(() => pngFromDataUrl(dataPng(Buffer.alloc(13 * 1024 * 1024))), /12 MB/);
});

test("a kept picture stays on the job when the drawing is saved", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);
  const other = await signedUpAgent(baseUrl);

  const kept = await client.post(`/api/projects/${project.id}/visualizations`, {
    image: dataPng(PNG),
    prompt: "Face brick walls.",
  });
  assert.equal(kept.status, 201);
  assert.equal(kept.body.alreadyKept, false);
  assert.equal(kept.body.asset.mime, "image/png");
  assert.equal(kept.body.asset.prompt, "Face brick walls.");
  assert.equal(kept.body.asset.byteLength, PNG.length);

  const again = await client.post(`/api/projects/${project.id}/visualizations`, {
    image: dataPng(PNG),
    prompt: "A different instruction",
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyKept, true);
  assert.equal(again.body.asset.id, kept.body.asset.id);

  const listed = await client.get(`/api/projects/${project.id}/visualizations`);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.visualizations.map((item) => item.id), [kept.body.asset.id]);

  const file = await fetch(new URL(`/api/assets/${kept.body.asset.id}`, baseUrl), {
    headers: { Cookie: client.cookie },
  });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);

  const saved = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, name: "After the picture" } },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(saved.status, 200);
  const still = await client.get(`/api/projects/${project.id}/visualizations`);
  assert.equal(still.body.visualizations.length, 1);

  const stolen = await other.client.get(`/api/projects/${project.id}/visualizations`);
  assert.equal(stolen.status, 404);
  const stolenFile = await fetch(new URL(`/api/assets/${kept.body.asset.id}`, baseUrl), {
    headers: { Cookie: other.client.cookie },
  });
  assert.equal(stolenFile.status, 404);

  const refused = await client.post(`/api/projects/${project.id}/visualizations`, {
    image: "data:image/png;base64,aGVsbG8=",
  });
  assert.equal(refused.status, 400);

  const removed = await client.del(`/api/projects/${project.id}/visualizations/${kept.body.asset.id}`);
  assert.equal(removed.status, 200);
  assert.equal((await client.get(`/api/projects/${project.id}/visualizations`)).body.visualizations.length, 0);
  const gone = await fetch(new URL(`/api/assets/${kept.body.asset.id}`, baseUrl), {
    headers: { Cookie: client.cookie },
  });
  assert.equal(gone.status, 404);
});

test("duplicating a job copies its kept pictures", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);
  const kept = await client.post(`/api/projects/${project.id}/visualizations`, {
    image: dataPng(PNG_B),
    prompt: "Roof from above",
  });
  assert.equal(kept.status, 201);
  const copy = await client.post(`/api/projects/${project.id}/duplicate`);
  assert.equal(copy.status, 201);
  const pictures = await client.get(`/api/projects/${copy.body.project.id}/visualizations`);
  assert.equal(pictures.status, 200);
  assert.equal(pictures.body.visualizations.length, 1);
  assert.equal(pictures.body.visualizations[0].prompt, "Roof from above");
  assert.notEqual(pictures.body.visualizations[0].id, kept.body.asset.id);
  const file = await fetch(new URL(`/api/assets/${pictures.body.visualizations[0].id}`, baseUrl), {
    headers: { Cookie: client.cookie },
  });
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG_B);
});
