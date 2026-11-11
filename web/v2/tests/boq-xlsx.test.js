import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../compile.js";
import { normalizeDoc } from "../model.js";
import { normalizePackUnits } from "../schema.js";
import { boqRows } from "../schedule.js";
import { boqDownloadName, boqWorkbook, readStoredXlsx } from "../boq-xlsx.js";

const pack = normalizePackUnits(
  JSON.parse(readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url))),
);
const rateBook = JSON.parse(
  readFileSync(new URL("../../samples/tsp-rates.json", import.meta.url)),
);

function sheetOf(bytes) {
  return readStoredXlsx(bytes)["xl/worksheets/sheet1.xml"];
}

test("the download name uses the job number, and stays plain when there is none", () => {
  assert.equal(boqDownloadName("G020"), "G020-bill-of-quantities.xlsx");
  assert.equal(boqDownloadName("  "), "bill-of-quantities.xlsx");
  assert.equal(boqDownloadName("G020/2"), "G020-2-bill-of-quantities.xlsx");
});

test("the workbook is the bill on screen: sections, formulas, and a blank where there is no rate", () => {
  const bytes = boqWorkbook({
    rows: [
      { category: "Masonry", model: "TSP_MAS009", description: "110 mm wall", unit: "m2", qty: 12.5, rate: 4250, priced: true },
      { category: "Masonry", model: "TSP_CON052", description: "Foundation", unit: "m3", qty: 2, rate: 100, priced: true },
      { category: "Doors", model: "DOOR-1", description: "Meranti door & frame", unit: "ea", qty: 3, rate: null, priced: false },
    ],
    jobNumber: "G020",
    clientName: "Gijzen & Sons",
    rateBookName: "2026 rates",
    rateBookEffective: "from 1 March 2026",
    symbol: "R",
    prepared: new Date(2026, 10, 11),
  });
  const parts = readStoredXlsx(bytes);
  const sheet = parts["xl/worksheets/sheet1.xml"];
  const styles = parts["xl/styles.xml"];

  assert.match(sheet, /BILL OF QUANTITIES/);
  assert.match(sheet, /Measured from the drawing/);
  assert.match(sheet, /G020/);
  assert.match(sheet, /Gijzen &amp; Sons/);
  assert.match(sheet, /2026 rates/);
  assert.match(sheet, /1 March 2026/);
  assert.match(sheet, /11 November 2026/);
  assert.match(sheet, /1 {2}Masonry/);
  assert.match(sheet, /2 {2}Doors/);
  assert.match(sheet, />1\.01</);
  assert.match(sheet, />1\.02</);
  assert.match(sheet, />2\.01</);
  assert.match(sheet, /Remarks/);
  assert.match(sheet, /<f>E10\*F10<\/f>/);
  assert.match(sheet, /<f>SUM\(G10:G11\)<\/f>/);
  assert.match(sheet, /<f>SUM\(G12,G16\)<\/f>/);
  assert.match(sheet, /Total \(priced lines only\)/);
  assert.match(sheet, /Meranti door &amp; frame/);
  assert.match(sheet, /<c r="F15" s="12"\/>/);
  assert.equal(sheet.includes('r="G15"'), false);
  assert.match(sheet, /containsBlanks/);
  assert.match(sheet, /Prepared by StudioPractice/);
  assert.match(sheet, /1 line has no rate and is excluded from the total/);
  assert.match(sheet, /ySplit="8"/);
  assert.match(sheet, /paperSize="9"/);
  assert.match(sheet, /orientation="landscape"/);
  assert.match(sheet, /fitToWidth="1"/);
  assert.match(parts["xl/workbook.xml"], /Bill!\$8:\$8/);
  assert.match(styles, /Cambria/);
  assert.match(styles, /FFB2451E/);
  assert.match(styles, /FF243044/);
  assert.match(styles, /FFEFE8DC/);
  assert.match(styles, /FFF8EDD6/);
  assert.match(styles, /style="double"/);
  assert.match(styles, /#,##0\.000/);
  assert.match(styles, /&quot;R&quot; #,##0\.00/);
});

test("a compiled bill keeps the rate-book figure and does not invent a zero", () => {
  const doc = normalizeDoc({
    rooms: [
      {
        id: "a", name: "Bathroom", use: "bathroom",
        rect: { x: 0, y: 0, w: 4, h: 3 },
        wallSku: "TSP_MAS009", floorSku: "TSP_RB016", status: "existing",
      },
    ],
  });
  const rows = boqRows(compile(doc, pack), rateBook);
  const wall = rows.find((row) => row.model === "TSP_MAS009");
  assert.equal(wall.rate, 4250);
  const sheet = sheetOf(boqWorkbook({
    rows,
    jobNumber: "",
    rateBookName: rateBook.name,
    symbol: rateBook.symbol,
    prepared: new Date(2026, 10, 11),
  }));
  assert.match(sheet, />4250</);
  assert.match(sheet, /<f>E\d+\*F\d+<\/f>/);
  assert.equal(sheet.includes(">0</v>"), false);
});

test("the BOQ panel has a download button, and the bill of materials does not get one by default", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="v2-schedule-download"[^>]*hidden/);
  const ui = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  assert.match(ui, /scheduleDownload\.hidden = !priced/);
});
