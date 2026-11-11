// Excel download of the bill already on screen.
//
// This is the priced rollup from schedule.js (one line per SKU), laid out so
// it can be printed or handed on. It is not the ASAQS tender: no trade order,
// section columns, preliminaries, or VAT. Amounts are formulas, so a rate
// typed in the sheet updates the line and the totals. A line with no rate
// keeps Rate and Amount empty; it is not written as zero.

import { familyHeadingAt, scheduleCode } from "./schedule.js";

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const WIDTHS = [12, 22, 46, 10, 14, 16, 18, 22];

const STYLE = {
  title: 1,
  subtitle: 2,
  label: 3,
  value: 4,
  header: 5,
  band: 6,
  text: 7,
  wrap: 8,
  center: 9,
  qty: 10,
  qtyInt: 11,
  rate: 12,
  amount: 13,
  subtotal: 14,
  subtotalMoney: 15,
  total: 16,
  totalMoney: 17,
  note: 18,
  item: 19,
  subhead: 20,
};

/** `{job}-bill-of-quantities.xlsx`, or a plain name when the job number is empty. */
export function boqDownloadName(jobNumber) {
  const code = String(jobNumber || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return code ? `${code}-bill-of-quantities.xlsx` : "bill-of-quantities.xlsx";
}

/**
 * One-sheet workbook. `rows` are schedule.js BOQ lines. `rateBookEffective`
 * is the kicker phrase ("from 1 March 2026") or empty. `prepared` is the
 * date printed on the sheet.
 */
export function boqWorkbook({
  rows = [],
  jobNumber = "",
  clientName = "",
  rateBookName = "",
  rateBookEffective = "",
  symbol = "R",
  prepared = new Date(),
} = {}) {
  const when = prepared instanceof Date ? prepared : new Date(prepared);
  const preparedLabel = formatDate(when);
  const effective = String(rateBookEffective || "").replace(/^from\s+/i, "");
  const sheet = billSheet({
    rows,
    jobNumber: String(jobNumber || "").trim(),
    clientName: String(clientName || "").trim(),
    rateBookName: String(rateBookName || "").trim() || "None loaded",
    effective,
    preparedLabel,
  });
  return zipStore([
    { name: "[Content_Types].xml", data: contentTypes() },
    { name: "_rels/.rels", data: rootRels() },
    { name: "docProps/core.xml", data: coreProps(preparedLabel) },
    { name: "xl/workbook.xml", data: workbookXml(sheet.headerRow) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels() },
    { name: "xl/styles.xml", data: stylesXml(symbol || "R") },
    { name: "xl/worksheets/sheet1.xml", data: sheet.xml },
  ]);
}

/** Read a stored (uncompressed) xlsx back to UTF-8 parts. For tests. */
export function readStoredXlsx(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let offset = 0;
  const utf8 = new TextDecoder();
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const name = utf8.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    files[name] = utf8.decode(bytes.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return files;
}

function billSheet({ rows, jobNumber, clientName, rateBookName, effective, preparedLabel }) {
  const headerRow = 8;
  const groups = groupByCategory(rows);
  const unpriced = rows.filter((row) => !row.priced || !Number.isFinite(Number(row.rate))).length;
  const cells = [];
  const merges = [];
  const rateRows = [];

  writeMerged(cells, merges, 1, "BILL OF QUANTITIES", STYLE.title);
  writeMerged(cells, merges, 2, "Measured from the drawing", STYLE.subtitle);
  writePair(cells, 4, "Job no.", jobNumber, "Client", clientName);
  writePair(cells, 5, "Rate book", rateBookName, effective ? "Effective" : "", effective);
  writePair(cells, 6, "Prepared", preparedLabel, "", "");
  headerCells(cells, headerRow);

  let row = headerRow + 1;
  const subtotalRows = [];
  groups.forEach((group, index) => {
    if (index > 0) row += 1;
    const section = index + 1;
    writeMerged(cells, merges, row, `${section}  ${group.category}`, STYLE.band);
    row += 1;
    const firstItem = row;
    group.rows.forEach((line, item) => {
      const family = familyHeadingAt(group.rows, item);
      if (family) {
        writeMerged(cells, merges, row, family, STYLE.subhead);
        row += 1;
      }
      writeItem(cells, row, `${section}.${String(item + 1).padStart(2, "0")}`, line);
      rateRows.push(row);
      row += 1;
    });
    const lastItem = row - 1;
    writeSubtotal(cells, row, firstItem, lastItem);
    subtotalRows.push(row);
    row += 1;
  });

  if (groups.length) row += 1;
  const totalRow = row;
  const totalFormula = subtotalRows.length
    ? `SUM(${subtotalRows.map((n) => `G${n}`).join(",")})`
    : null;
  writeTotal(cells, merges, totalRow, totalFormula);
  row = totalRow;
  if (unpriced) {
    row += 1;
    const noun = unpriced === 1 ? "line has" : "lines have";
    const verb = unpriced === 1 ? "is" : "are";
    writeMerged(
      cells,
      merges,
      row,
      `${unpriced} ${noun} no rate and ${verb} excluded from the total.`,
      STYLE.note,
    );
  }

  const lastRow = row;
  const xml = worksheetXml({
    cells,
    merges,
    headerRow,
    lastRow,
    jobNumber,
    preparedLabel,
    rateRows,
  });
  return { xml, headerRow };
}

function groupByCategory(rows) {
  const groups = [];
  for (const row of rows) {
    const category = String(row.category || "").trim() || "Uncategorised";
    let group = groups[groups.length - 1];
    if (!group || group.category !== category) {
      group = { category, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

function writePair(cells, row, leftLabel, leftValue, rightLabel, rightValue) {
  cells.push(textCell(`A${row}`, STYLE.label, leftLabel));
  cells.push(textCell(`B${row}`, STYLE.value, leftValue));
  if (rightLabel) cells.push(textCell(`D${row}`, STYLE.label, rightLabel));
  if (rightValue) cells.push(textCell(`E${row}`, STYLE.value, rightValue));
}

function headerCells(cells, row) {
  ["Item", "Model", "Description", "Unit", "Qty", "Rate", "Amount", "Remarks"].forEach((label, i) => {
    cells.push(textCell(`${COLS[i]}${row}`, STYLE.header, label));
  });
}

function writeItem(cells, row, item, line) {
  const unit = line.unit || "";
  const priced = Boolean(line.priced) && Number.isFinite(Number(line.rate));
  cells.push(textCell(`A${row}`, STYLE.item, item));
  cells.push(textCell(`B${row}`, STYLE.text, scheduleCode(line)));
  cells.push(textCell(`C${row}`, STYLE.wrap, line.description || ""));
  cells.push(textCell(`D${row}`, STYLE.center, unit));
  cells.push(numberCell(`E${row}`, unit === "ea" ? STYLE.qtyInt : STYLE.qty, Number(line.qty) || 0));
  if (priced) {
    cells.push(numberCell(`F${row}`, STYLE.rate, Number(line.rate)));
    cells.push(formulaCell(`G${row}`, STYLE.amount, `E${row}*F${row}`));
  } else {
    cells.push(blankCell(`F${row}`, STYLE.rate));
  }
  cells.push(blankCell(`H${row}`, STYLE.text));
}

function writeSubtotal(cells, row, first, last) {
  for (const col of COLS) {
    if (col === "G") {
      cells.push(formulaCell(`${col}${row}`, STYLE.subtotalMoney, `SUM(G${first}:G${last})`));
    } else if (col === "C") {
      cells.push(textCell(`${col}${row}`, STYLE.subtotal, "Subtotal"));
    } else {
      cells.push(blankCell(`${col}${row}`, STYLE.subtotal));
    }
  }
}

function writeTotal(cells, merges, row, formula) {
  merges.push(`A${row}:F${row}`);
  for (const col of COLS) {
    if (col === "A") cells.push(textCell(`${col}${row}`, STYLE.total, "Total (priced lines only)"));
    else if (col === "G") {
      cells.push(formula
        ? formulaCell(`${col}${row}`, STYLE.totalMoney, formula)
        : numberCell(`${col}${row}`, STYLE.totalMoney, 0));
    } else cells.push(blankCell(`${col}${row}`, STYLE.total));
  }
}

function writeMerged(cells, merges, row, value, style) {
  merges.push(`A${row}:G${row}`);
  COLS.forEach((col, i) => {
    cells.push(i === 0 ? textCell(`${col}${row}`, style, value) : blankCell(`${col}${row}`, style));
  });
}

function textCell(ref, style, value) {
  return { ref, style, kind: "s", value: cleanText(value) };
}

function numberCell(ref, style, value) {
  return { ref, style, kind: "n", value: Number.isFinite(value) ? value : 0 };
}

function formulaCell(ref, style, formula) {
  return { ref, style, kind: "f", value: formula };
}

function blankCell(ref, style) {
  return { ref, style, kind: "b" };
}

function worksheetXml({ cells, merges, headerRow, lastRow, jobNumber, preparedLabel, rateRows }) {
  const byRow = new Map();
  for (const cell of cells) {
    const row = Number(cell.ref.replace(/^\D+/, ""));
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(cell);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b).map((row) => {
    const height = rowHeight(row, byRow.get(row));
    const ht = height ? ` ht="${height}" customHeight="1"` : "";
    const body = byRow.get(row).map(renderCell).join("");
    return `<row r="${row}"${ht}>${body}</row>`;
  }).join("");
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";
  const blanks = rateRows.length
    ? `<conditionalFormatting sqref="${rateRows.map((n) => `F${n}`).join(" ")}"><cfRule type="containsBlanks" dxfId="0" priority="1"><formula>LEN(TRIM(F${rateRows[0]}))=0</formula></cfRule></conditionalFormatting>`
    : "";
  const footerLeft = excelText(jobNumber || "Bill of quantities");
  const footerRight = excelText(preparedLabel);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:H${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0" showGridLines="0">
      <pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${WIDTHS.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
  <sheetData>${rows}</sheetData>
  ${mergeXml}
  ${blanks}
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.55" right="0.55" top="0.7" bottom="0.7" header="0.3" footer="0.3"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
  <headerFooter>
    <oddHeader>&amp;LStudioPractice&amp;RBill of quantities</oddHeader>
    <oddFooter>&amp;L${footerLeft}&amp;CPrepared by StudioPractice · Page &amp;P of &amp;N&amp;R${footerRight}</oddFooter>
  </headerFooter>
</worksheet>`;
}

function rowHeight(row, cells) {
  if (row === 1) return 32;
  if (row === 3 || row === 7) return 8;
  const wrap = cells.find((cell) => cell.style === STYLE.wrap);
  if (!wrap) return row === 8 ? 20 : 18;
  const lines = String(wrap.value || "").split("\n").reduce((n, part) => n + Math.max(1, Math.ceil(part.length / 48)), 0);
  return Math.min(72, Math.max(18, lines * 15));
}

function renderCell(cell) {
  const style = ` s="${cell.style}"`;
  if (cell.kind === "b") return `<c r="${cell.ref}"${style}/>`;
  if (cell.kind === "n") return `<c r="${cell.ref}"${style}><v>${num(cell.value)}</v></c>`;
  if (cell.kind === "f") return `<c r="${cell.ref}"${style}><f>${xml(cell.value)}</f></c>`;
  const space = /^\s|\s$/.test(cell.value) ? ` xml:space="preserve"` : "";
  return `<c r="${cell.ref}" t="inlineStr"${style}><is><t${space}>${xml(cell.value)}</t></is></c>`;
}

function stylesXml(symbol) {
  const money = xml(moneyFormat(symbol));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0.000"/>
    <numFmt numFmtId="165" formatCode="#,##0"/>
    <numFmt numFmtId="166" formatCode="${money}"/>
  </numFmts>
  <fonts count="9">
    <font><sz val="11"/><color rgb="FF1A1612"/><name val="Calibri"/></font>
    <font><b/><sz val="20"/><color rgb="FF1A1612"/><name val="Cambria"/></font>
    <font><i/><sz val="10"/><color rgb="FF8A8074"/><name val="Calibri"/></font>
    <font><sz val="9"/><color rgb="FF8A8074"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF1A1612"/><name val="Calibri"/></font>
    <font><sz val="11"/><color rgb="FF243044"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FF1A1612"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FFB2451E"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1A1612"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFE8DC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F3EA"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="6">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="medium"><color rgb="FFB2451E"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE0D8CC"/></bottom><diagonal/></border>
    <border><left style="thick"><color rgb="FFB2451E"/></left><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top style="medium"><color rgb="FF1A1612"/></top><bottom/><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FF1A1612"/></top><bottom style="double"><color rgb="FF1A1612"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="21">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="6" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="166" fontId="5" fillId="4" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="0" borderId="5" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="166" fontId="8" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="1">
    <dxf><fill><patternFill patternType="solid"><fgColor rgb="FFF8EDD6"/></patternFill></fill></dxf>
  </dxfs>
</styleSheet>`;
}

function moneyFormat(symbol) {
  const safe = String(symbol || "R").replace(/"/g, "\"\"");
  return `"${safe}" #,##0.00`;
}

function workbookXml(headerRow) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr/>
  <workbookViews><workbookView activeTab="0"/></workbookViews>
  <sheets><sheet name="Bill" sheetId="1" r:id="rId1"/></sheets>
  <definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">Bill!$${headerRow}:$${headerRow}</definedName></definedNames>
  <calcPr calcMode="auto" fullCalcOnLoad="1"/>
</workbook>`;
}

function workbookRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
}

function contentTypes() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
}

function coreProps(preparedLabel) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Bill of quantities</dc:title>
  <dc:creator>StudioPractice</dc:creator>
  <dc:description>Measured from the drawing. Prepared ${xml(preparedLabel)}.</dc:description>
</cp:coreProperties>`;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

function cleanText(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function xml(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Excel header/footer codes use &. A literal ampersand is &&, then XML-escaped. */
function excelText(value) {
  return xml(cleanText(value).replace(/&/g, "&&"));
}

function num(value) {
  const rounded = Math.round(Number(value) * 1e8) / 1e8;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function zipStore(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.data);
    const crc = crc32(data);
    const local = localHeader(name, data, crc, now);
    locals.push(local, data);
    centrals.push(centralHeader(name, data, crc, now, offset));
    offset += local.length + data.length;
  }
  const central = concat(centrals);
  const end = eocd(files.length, central.length, offset);
  return concat([...locals, central, end]);
}

function localHeader(name, data, crc, date) {
  const { time, day } = dosDate(date);
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, day, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  header.set(name, 30);
  return header;
}

function centralHeader(name, data, crc, date, offset) {
  const { time, day } = dosDate(date);
  const header = new Uint8Array(46 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, day, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.length, true);
  view.setUint32(24, data.length, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(name, 46);
  return header;
}

function eocd(count, centralSize, centralOffset) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

function dosDate(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
