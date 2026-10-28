import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { sniffUnderlay } from "../src/assets.js";
import { readRawBody } from "../src/http.js";
import { openStore } from "../src/store.js";
import { withTransaction } from "../src/db.js";
import { firmWithProject, signedUpAgent, testDoc, testServer } from "./helpers.js";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("sniff accepts a PDF or image and refuses a type that disagrees", () => {
  assert.equal(sniffUnderlay(PDF, "application/pdf"), "application/pdf");
  assert.equal(sniffUnderlay(PDF, "application/octet-stream"), "application/pdf");
  assert.equal(sniffUnderlay(PNG, "image/png"), "image/png");
  assert.equal(sniffUnderlay(PDF, "image/png"), null);
  assert.equal(sniffUnderlay(Buffer.from("hello"), "application/pdf"), null);
  assert.equal(sniffUnderlay(Buffer.alloc(0), "application/pdf"), null);
});

test("a body over the limit is refused while it is still arriving", async () => {
  const req = Readable.from([Buffer.alloc(5), Buffer.alloc(5)]);
  await assert.rejects(
    () => readRawBody(req, { limit: 8, message: "too big" }),
    (error) => error.status === 413 && error.message === "too big",
  );
});

async function postFile(baseUrl, client, path, bytes, mime) {
  const res = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "Content-Type": mime, Cookie: client.cookie },
    body: bytes,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function getFile(baseUrl, client, assetId) {
  const res = await fetch(new URL(`/api/assets/${assetId}`, baseUrl), {
    headers: client.cookie ? { Cookie: client.cookie } : {},
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, mime: res.headers.get("content-type"), buf };
}

test("a plan file round-trips, and another firm cannot read it", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);
  const other = await signedUpAgent(baseUrl);

  const stored = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  assert.equal(stored.status, 201);
  assert.equal(stored.body.asset.mime, "application/pdf");
  assert.equal(stored.body.asset.byteLength, PDF.length);
  assert.equal(stored.body.asset.projectId, project.id);

  const fetched = await getFile(baseUrl, client, stored.body.asset.id);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.mime, "application/pdf");
  assert.deepEqual(fetched.buf, PDF);

  const stolen = await getFile(baseUrl, other.client, stored.body.asset.id);
  assert.equal(stolen.status, 404);

  const unsigned = await getFile(baseUrl, { cookie: null }, stored.body.asset.id);
  assert.equal(unsigned.status, 401);
});

test("a file that is not a PDF or image is refused", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);
  const refused = await postFile(
    baseUrl, client, `/api/projects/${project.id}/assets`, Buffer.from("not a plan"), "application/pdf",
  );
  assert.equal(refused.status, 400);
});

test("the drawing may name its own file, and naming a new one releases the old", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);
  const first = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  const second = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PNG, "image/png");
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const named = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, sheetSet: { pdfName: "plans.pdf", assetId: first.body.asset.id, pages: [] } } },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(named.status, 200);

  // The first save names the PDF. The image was uploaded after the drawing
  // was last saved, so that save must not release it: an autosave in the same
  // moment would otherwise delete the file the next save is about to name.
  // This save names the image, which is what importing a different sheet does.
  const replaced = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, underlay: { assetId: second.body.asset.id, name: "scan.png" } } },
    { headers: { "If-Match": named.body.drawing.revision } },
  );
  assert.equal(replaced.status, 200);
  assert.equal((await getFile(baseUrl, client, first.body.asset.id)).status, 404);
  assert.equal((await getFile(baseUrl, client, second.body.asset.id)).status, 200);

  const foreign = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, sheetSet: { assetId: "ast_missing", pages: [] } } },
    { headers: { "If-Match": replaced.body.drawing.revision } },
  );
  assert.equal(foreign.status, 400);
});

const PDF_B = Buffer.from("%PDF-1.4\n2 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

function sourced(doc, ...assets) {
  return {
    ...doc,
    sheetSet: {
      pdfName: "plans.pdf",
      sources: assets.map((id, i) => ({ id: `src${i + 1}`, name: `plans-${i + 1}.pdf`, assetId: id, mime: "application/pdf" })),
      pages: [],
    },
  };
}

test("saving a drawing that no longer names an asset releases it", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);
  const stored = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  const named = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: sourced(doc, stored.body.asset.id) },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(named.status, 200);
  const cleared = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc },
    { headers: { "If-Match": named.body.drawing.revision } },
  );
  assert.equal(cleared.status, 200);
  // Removing the last source and saving frees the bytes, so they stop counting toward the quota.
  assert.equal((await getFile(baseUrl, client, stored.body.asset.id)).status, 404);
});

test("every source of a sheet set keeps its file, and a removed source's file goes", async () => {
  const { baseUrl } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);
  const a = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  const b = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF_B, "application/pdf");
  const both = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: sourced(doc, a.body.asset.id, b.body.asset.id) },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(both.status, 200);
  assert.equal((await getFile(baseUrl, client, a.body.asset.id)).status, 200);
  assert.equal((await getFile(baseUrl, client, b.body.asset.id)).status, 200);

  const onlyA = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: sourced(doc, a.body.asset.id) },
    { headers: { "If-Match": both.body.drawing.revision } },
  );
  assert.equal(onlyA.status, 200);
  assert.equal((await getFile(baseUrl, client, a.body.asset.id)).status, 200);
  assert.equal((await getFile(baseUrl, client, b.body.asset.id)).status, 404);
});

test("the same save does not release an asset a drawing_revision still names", async () => {
  const { baseUrl, pool } = await testServer();
  const { client, project, doc } = await firmWithProject(baseUrl);
  const stored = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  const named = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: sourced(doc, stored.body.asset.id) },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(named.status, 200);
  // A recovery snapshot of the drawing as it was while it named the file.
  await pool.query(
    `insert into drawing_revision (drawing_id, revision, doc, created_by)
          values ($1, $2, $3, 'test')`,
    [project.drawing.id, 900, sourced(doc, stored.body.asset.id)],
  );
  const cleared = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc },
    { headers: { "If-Match": named.body.drawing.revision } },
  );
  assert.equal(cleared.status, 200);
  assert.equal((await getFile(baseUrl, client, stored.body.asset.id)).status, 200);
});

test("a second upload of the same hash returns the existing asset id", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);
  const first = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  const again = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  assert.equal(first.status, 201);
  assert.equal(again.status, 201);
  assert.equal(again.body.asset.id, first.body.asset.id);

  // Asked before sending: the hash alone finds it; another file or another type does not.
  const sha256 = createHash("sha256").update(PDF).digest("hex");
  const hit = await client.post(`/api/projects/${project.id}/assets/lookup`, { sha256, mime: "application/pdf" });
  assert.equal(hit.status, 200);
  assert.equal(hit.body.asset.id, first.body.asset.id);
  const wrongMime = await client.post(`/api/projects/${project.id}/assets/lookup`, { sha256, mime: "image/png" });
  assert.equal(wrongMime.body.asset, null);
  const other = await client.post(`/api/projects/${project.id}/assets/lookup`, {
    sha256: createHash("sha256").update(PDF_B).digest("hex"), mime: "application/pdf",
  });
  assert.equal(other.body.asset, null);

  const different = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF_B, "application/pdf");
  assert.notEqual(different.body.asset.id, first.body.asset.id);
});

test("a duplicate job gets its own copy of the file", async () => {
  const { baseUrl } = await testServer();
  const doc = testDoc({ name: "Erf 23" });
  const { client, project } = await firmWithProject(baseUrl, { name: "Erf 23", doc });
  const stored = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  const named = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, sheetSet: { pdfName: "plans.pdf", assetId: stored.body.asset.id, pages: [] } } },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(named.status, 200);

  const copy = await client.post(`/api/projects/${project.id}/duplicate`);
  assert.equal(copy.status, 201);
  const copyId = copy.body.project.drawing.doc.sheetSet.assetId;
  assert.notEqual(copyId, stored.body.asset.id);
  const copied = await getFile(baseUrl, client, copyId);
  assert.equal(copied.status, 200);
  assert.deepEqual(copied.buf, PDF);

  // Replacing the original must not blank the copy.
  const next = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PNG, "image/png");
  const replaced = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: { ...doc, sheetSet: { pdfName: "other.pdf", assetId: next.body.asset.id, pages: [] } } },
    { headers: { "If-Match": named.body.drawing.revision } },
  );
  assert.equal(replaced.status, 200);
  assert.equal((await getFile(baseUrl, client, stored.body.asset.id)).status, 404);
  assert.deepEqual((await getFile(baseUrl, client, copyId)).buf, PDF);
});

test("a duplicate job gets its own copy of every source file", async () => {
  const { baseUrl } = await testServer();
  const doc = testDoc({ name: "Erf 24" });
  const { client, project } = await firmWithProject(baseUrl, { name: "Erf 24", doc });
  const a = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  const b = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF_B, "application/pdf");
  const named = await client.put(
    `/api/drawings/${project.drawing.id}`,
    { doc: sourced(doc, a.body.asset.id, b.body.asset.id) },
    { headers: { "If-Match": project.drawing.revision } },
  );
  assert.equal(named.status, 200);
  const copy = await client.post(`/api/projects/${project.id}/duplicate`);
  assert.equal(copy.status, 201);
  const sources = copy.body.project.drawing.doc.sheetSet.sources;
  assert.equal(sources.length, 2);
  for (const [i, source] of sources.entries()) {
    assert.notEqual(source.assetId, [a, b][i].body.asset.id);
    assert.deepEqual((await getFile(baseUrl, client, source.assetId)).buf, [PDF, PDF_B][i]);
  }
});

test("a deleted job hides its file until the job is restored", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithProject(baseUrl);
  const stored = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PDF, "application/pdf");
  assert.equal((await client.del(`/api/projects/${project.id}`)).status, 200);
  assert.equal((await getFile(baseUrl, client, stored.body.asset.id)).status, 404);
  assert.equal((await client.post(`/api/projects/${project.id}/restore`)).status, 200);
  assert.deepEqual((await getFile(baseUrl, client, stored.body.asset.id)).buf, PDF);
});

test("the firm quota refuses a file that would exceed it", async () => {
  const { baseUrl, pool } = await testServer();
  const { client, account, project } = await firmWithProject(baseUrl);
  await withTransaction(pool, async (db) => {
    const store = openStore(db, {
      orgId: account.orgId, userId: account.userId, role: account.role,
    });
    await assert.rejects(
      () => store.putUnderlayAsset(project.id, {
        mime: "application/pdf", bytes: PDF, quota: PDF.length - 1,
      }),
      (error) => error.name === "ValidationError",
    );
    // The refusal must not have left a row the drawing could name.
    const asset = await store.putUnderlayAsset(project.id, {
      mime: "application/pdf", bytes: PDF, quota: PDF.length,
    });
    assert.equal(asset.byteLength, PDF.length);
  });
  // The successful insert committed with the transaction. It is this firm's file.
  const listed = await postFile(baseUrl, client, `/api/projects/${project.id}/assets`, PNG, "image/png");
  assert.equal(listed.status, 201);
});
