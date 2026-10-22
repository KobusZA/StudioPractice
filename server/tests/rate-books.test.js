// The firm's own rate book: what a BOQ prices a drawing against. Four things
// matter and each is asserted through the HTTP surface - a new firm starts with
// the demo catalogue rather than with nothing, a book is replaced as one
// document, only an owner can write one, and a book a job was quoted off
// cannot be taken away.

import test from "node:test";
import assert from "node:assert/strict";
import { agent, firmWithRegisterProject, signedUpAgent, testServer } from "./helpers.js";
import { DEFAULT_RATE_BOOK } from "../src/defaults.js";

async function inviteEmployee(baseUrl, owner) {
  const email = `employee-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const invited = await owner.post("/api/team", { email, password: "correct horse battery" });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const client = agent(baseUrl);
  const signedIn = await client.post("/api/auth/sign-in", { email, password: "correct horse battery" });
  assert.equal(signedIn.status, 200);
  return client;
}

/** The firm's one seeded book, fetched whole. */
async function defaultBook(client) {
  const list = await client.get("/api/rate-books");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const header = list.body.rateBooks.find((book) => book.isDefault);
  assert.ok(header, "the firm has a default rate book");
  const got = await client.get(`/api/rate-books/${header.id}`);
  assert.equal(got.status, 200, JSON.stringify(got.body));
  return got.body.rateBook;
}

test("a new firm is seeded with one default book of the demo rates", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);

  const list = await client.get("/api/rate-books");
  assert.equal(list.body.rateBooks.length, 1);
  const [header] = list.body.rateBooks;
  assert.equal(header.isDefault, true);
  assert.equal(header.lines, DEFAULT_RATE_BOOK.rates.length);

  const book = await defaultBook(client);
  assert.equal(book.currency, "ZAR");
  assert.equal(book.symbol, "R");
  // The firm has to be able to tell at a glance that these are not its prices.
  assert.match(book.note, /Replace with the live price book/);
  const wall = book.rates.find((rate) => rate.model === "TSP_MAS009");
  assert.deepEqual(wall, {
    model: "TSP_MAS009",
    category: null,
    description: "Masonry wall 220mm (plaster)",
    unit: "m3",
    rate: 4250,
  });
  // A fallback is a line with no model of its own - exactly what findRate()
  // reaches for when the SKU itself has no price.
  const fallback = book.rates.find((rate) => rate.category === "Doors");
  assert.equal(fallback.model, null);
  assert.equal(fallback.rate, 4800);
});

test("seeding twice does not duplicate a book or its lines", async () => {
  const { baseUrl } = await testServer();
  const { client, email } = await signedUpAgent(baseUrl);
  // Signing in re-applies the defaults, which is the path an org created
  // before this table existed is fixed by.
  await client.post("/api/auth/sign-in", { email, password: "correct horse battery" });

  const list = await client.get("/api/rate-books");
  assert.equal(list.body.rateBooks.length, 1);
  assert.equal(list.body.rateBooks[0].lines, DEFAULT_RATE_BOOK.rates.length);
});

test("replace is whole-document: a removed line is gone", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const book = await defaultBook(client);

  const put = await client.put(`/api/rate-books/${book.id}`, {
    ...book,
    rates: book.rates.filter((rate) => rate.model !== "TSP_MAS009"),
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.rateBook.rates.length, book.rates.length - 1);
  assert.equal(put.body.rateBook.rates.some((rate) => rate.model === "TSP_MAS009"), false);
});

test("a bad line refuses the whole write and leaves the previous lines priced", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const book = await defaultBook(client);

  // `item` is not one of the four units qtyForUnit() measures; it would price
  // a wall as a count rather than as cubic metres.
  const badUnit = await client.put(`/api/rate-books/${book.id}`, {
    ...book,
    rates: [{ model: "TSP_NEW", description: "A new thing", unit: "item", rate: 10 }],
  });
  assert.equal(badUnit.status, 400, JSON.stringify(badUnit.body));

  const negative = await client.put(`/api/rate-books/${book.id}`, {
    ...book,
    rates: [{ model: "TSP_NEW", description: "A new thing", unit: "ea", rate: -1 }],
  });
  assert.equal(negative.status, 400);

  const neither = await client.put(`/api/rate-books/${book.id}`, {
    ...book,
    rates: [{ description: "Priced against nothing", unit: "ea", rate: 10 }],
  });
  assert.equal(neither.status, 400);

  const twice = await client.put(`/api/rate-books/${book.id}`, {
    ...book,
    rates: [
      { model: "TSP_DR900", description: "Door", unit: "ea", rate: 10 },
      { model: "tsp_dr900 ", description: "The same door again", unit: "ea", rate: 99 },
    ],
  });
  assert.equal(twice.status, 400);

  const still = await defaultBook(client);
  assert.equal(still.rates.length, book.rates.length);
  assert.equal(still.rates.find((rate) => rate.model === "TSP_MAS009").rate, 4250);
});

test("an employee cannot read or write the rate book", async () => {
  const { baseUrl } = await testServer();
  const { client: owner } = await signedUpAgent(baseUrl);
  const book = await defaultBook(owner);
  const employee = await inviteEmployee(baseUrl, owner);

  // The nav item is hidden for them; the store refuses regardless.
  assert.equal((await employee.get("/api/rate-books")).status, 403);
  assert.equal((await employee.get(`/api/rate-books/${book.id}`)).status, 403);
  assert.equal((await employee.put(`/api/rate-books/${book.id}`, { ...book, rates: [] })).status, 403);
  assert.equal((await employee.post("/api/rate-books", { name: "Mine" })).status, 403);
  assert.equal((await employee.post(`/api/rate-books/${book.id}/duplicate`, {})).status, 403);
  assert.equal((await employee.post(`/api/rate-books/${book.id}/default`, {})).status, 403);
  assert.equal((await employee.del(`/api/rate-books/${book.id}`)).status, 403);

  const still = await defaultBook(owner);
  assert.equal(still.rates.length, book.rates.length);
});

test("a duplicate is an independent book; editing the copy leaves the original", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const book = await defaultBook(client);

  const copied = await client.post(`/api/rate-books/${book.id}/duplicate`, {
    name: "2027 prices", effectiveFrom: "2027-01-01",
  });
  assert.equal(copied.status, 201, JSON.stringify(copied.body));
  const copy = copied.body.rateBook;
  assert.notEqual(copy.id, book.id);
  assert.equal(copy.isDefault, false, "a copy is not the default until it is made one");
  assert.equal(copy.rates.length, book.rates.length);

  const put = await client.put(`/api/rate-books/${copy.id}`, {
    ...copy,
    rates: copy.rates.map((rate) => (
      rate.model === "TSP_MAS009" ? { ...rate, rate: 4675 } : rate
    )),
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.rateBook.rates.find((r) => r.model === "TSP_MAS009").rate, 4675);

  const original = await client.get(`/api/rate-books/${book.id}`);
  assert.equal(original.body.rateBook.rates.find((r) => r.model === "TSP_MAS009").rate, 4250);

  // Exactly one default per firm, whichever way round it is set.
  const defaulted = await client.post(`/api/rate-books/${copy.id}/default`, {});
  assert.equal(defaulted.status, 200);
  assert.deepEqual(
    defaulted.body.rateBooks.filter((b) => b.isDefault).map((b) => b.id),
    [copy.id],
  );
});

test("two books cannot share a name", async () => {
  const { baseUrl } = await testServer();
  const { client } = await signedUpAgent(baseUrl);
  const book = await defaultBook(client);

  const clash = await client.post("/api/rate-books", { name: `  ${book.name.toLowerCase()} ` });
  assert.equal(clash.status, 400, JSON.stringify(clash.body));
});

test("a job records the book it was registered against, and that book cannot be deleted", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const book = await defaultBook(client);

  assert.equal(project.rateBookId, book.id);
  // And the planner sees it on open, which is how the drawing app knows what
  // to price the BOQ against.
  const opened = await client.get(`/api/projects/${project.id}`);
  assert.equal(opened.body.project.rateBookId, book.id);

  const refused = await client.del(`/api/rate-books/${book.id}`);
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.match(refused.body.error, /priced against this book/);

  // Pointed at something else, the book is free to go.
  const copied = await client.post(`/api/rate-books/${book.id}/duplicate`, { name: "2027 prices" });
  const moved = await client.patch(`/api/register/${project.id}`, {
    rateBookId: copied.body.rateBook.id,
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.project.rateBookId, copied.body.rateBook.id);
  assert.equal((await client.del(`/api/rate-books/${book.id}`)).status, 200);
  assert.equal((await client.get(`/api/rate-books/${book.id}`)).status, 404);
});

test("a job can be put back on the firm's default, and another firm's book is refused", async () => {
  const { baseUrl } = await testServer();
  const { client, project } = await firmWithRegisterProject(baseUrl);
  const { client: other } = await signedUpAgent(baseUrl, { orgName: "Other Firm" });
  const theirs = await defaultBook(other);

  const cleared = await client.patch(`/api/register/${project.id}`, { rateBookId: "" });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.project.rateBookId, null);

  const foreign = await client.patch(`/api/register/${project.id}`, { rateBookId: theirs.id });
  assert.equal(foreign.status, 400, JSON.stringify(foreign.body));
  assert.equal((await client.get(`/api/rate-books/${theirs.id}`)).status, 404);
});
