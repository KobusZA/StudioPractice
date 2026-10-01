// Firm details: what a payment certificate prints above the line table.
//
// Owner-only, and empty until the firm types it in. Nothing is seeded: these
// are one firm's own trading name, VAT number and bank account, and a blank
// field on a printed certificate is a visible gap rather than a plausible
// invention. The certificate says so when a block is missing.

import { api } from "./api.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

/** [key, label, hint, wide?] in the order the certificate reads them. */
const GROUPS = [
  ["Letterhead", [
    ["tradingName", "Trading name", "As it should print, e.g. the Pty Ltd name"],
    ["addressLines", "Address", "One line per row; printed as typed", "area"],
    ["vatNumber", "VAT number"],
    ["companyReg", "Company registration number"],
  ]],
  ["Banking", [
    ["bankName", "Bank"],
    ["bankBranch", "Branch"],
    ["bankBranchCode", "Branch code"],
    ["bankAccountNo", "Account number"],
  ]],
  ["Contact", [
    ["contactName", "Contact name"],
    ["contactCell", "Contact cell"],
    ["contactEmail", "Contact email"],
    ["popEmail", "Proof of payment email", "Where the client should send proof of payment"],
  ]],
];

export const FIRM_FIELDS = GROUPS.flatMap(([, fields]) => fields.map(([key]) => key));

let saved = null;

export async function mountFirmSettings(host, ctx) {
  host.innerHTML = `<p class="note-line">Loading&hellip;</p>`;
  try {
    saved = (await api.orgSettings()).settings;
  } catch (error) {
    host.innerHTML = `<p class="note-line">${esc(error.message)}</p>`;
    return;
  }
  paint(host);
  if (host.dataset.firmBound) return;
  host.dataset.firmBound = "1";
  host.addEventListener("submit", async (event) => {
    if (event.target.dataset.form !== "firm") return;
    event.preventDefault();
    const body = Object.fromEntries(FIRM_FIELDS.map((key) => [
      key, event.target.elements[key].value,
    ]));
    try {
      saved = (await api.putOrgSettings(body)).settings;
      ctx.onSaved?.(saved);
      ctx.toast("Firm details saved.");
      paint(host);
    } catch (error) {
      ctx.toast(error.message, true);
    }
  });
}

function paint(host) {
  host.innerHTML = `
    <div class="tpl">
      <h1>Firm details</h1>
      <p class="note-line">Printed on every payment certificate. Nothing here is filled in for you:
        a certificate printed with a blank block says which block is blank.
        ${saved.orgName ? `Your firm is registered as <b>${esc(saved.orgName)}</b>; that is the name
        used until a trading name is entered.` : ""}</p>
      <form class="form" data-form="firm">
        ${GROUPS.map(([title, fields]) => `
          <h3 class="sec">${esc(title)}</h3>
          <div class="fields">
            ${fields.map(([key, label, hint, kind]) => `
              <div class="field${kind === "area" ? " wide" : ""}">
                <label for="firm-${key}">${esc(label)}</label>
                ${kind === "area"
    ? `<textarea id="firm-${key}" name="${key}" rows="3">${esc(saved[key])}</textarea>`
    : `<input id="firm-${key}" name="${key}" value="${esc(saved[key])}" />`}
                ${hint ? `<small class="muted">${esc(hint)}</small>` : ""}
              </div>`).join("")}
          </div>`).join("")}
        <div class="actions"><button class="btn btn-primary" type="submit">Save firm details</button></div>
      </form>
    </div>`;
}
