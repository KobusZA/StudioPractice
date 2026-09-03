const OFFICE_URL = "./samples/studio-office.json";
const PHASE_ORDER = ["concept", "revit", "takeoff", "contracts", "orders", "site"];
const PHASE_LABELS = {
  concept: "Concept",
  revit: "Revit extract",
  takeoff: "Priced takeoff",
  contracts: "Contracts",
  orders: "Orders",
  site: "Site",
};

let office = null;
let selectedProjectId = null;
let selectedFormId = null;
let selectedPoId = null;
let selectedMilestoneId = null;

const officeEls = {
  disclaimer: document.getElementById("office-disclaimer"),
  projectPhase: document.getElementById("filter-project-phase"),
  projectCards: document.getElementById("project-cards"),
  projectsCaption: document.getElementById("projects-caption"),
  projectKicker: document.getElementById("project-detail-kicker"),
  projectMeta: document.getElementById("project-detail-meta"),
  projectSummary: document.getElementById("project-detail-summary"),
  openModel: document.getElementById("btn-open-model"),
  companyMeta: document.getElementById("company-meta"),
  legalProject: document.getElementById("filter-legal-project"),
  legalStatus: document.getElementById("filter-legal-status"),
  legalBody: document.getElementById("legal-body"),
  legalCaption: document.getElementById("legal-caption"),
  legalKicker: document.getElementById("legal-detail-kicker"),
  legalMeta: document.getElementById("legal-detail-meta"),
  legalNotes: document.getElementById("legal-detail-notes"),
  poProject: document.getElementById("filter-po-project"),
  poStatus: document.getElementById("filter-po-status"),
  purchasesBody: document.getElementById("purchases-body"),
  purchasesCaption: document.getElementById("purchases-caption"),
  poKicker: document.getElementById("po-detail-kicker"),
  poMeta: document.getElementById("po-detail-meta"),
  poNotes: document.getElementById("po-detail-notes"),
  supplierList: document.getElementById("supplier-list"),
  timelineProject: document.getElementById("filter-timeline-project"),
  phaseBar: document.getElementById("phase-bar"),
  timelineBody: document.getElementById("timeline-body"),
  timelineCaption: document.getElementById("timeline-caption"),
  milestoneKicker: document.getElementById("milestone-detail-kicker"),
  milestoneMeta: document.getElementById("milestone-detail-meta"),
  milestoneNotes: document.getElementById("milestone-detail-notes"),
};

function officeMoney(value) {
  if (typeof money === "function") {
    return money(value);
  }
  const n = Number(value) || 0;
  return `R${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtDate(value) {
  if (!value) {
    return "—";
  }
  return value;
}

function projectById(id) {
  return (office?.projects || []).find((p) => p.id === id) || null;
}

function supplierById(id) {
  return (office?.suppliers || []).find((s) => s.id === id) || null;
}

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "signed" || s === "delivered" || s === "on site") {
    return "ok";
  }
  if (s === "issued" || s === "buying" || s === "construction" || s === "procurement") {
    return "warn";
  }
  return "draft";
}

function pill(status) {
  return `<span class="pill ${statusClass(status)}">${escapeHtml(status || "—")}</span>`;
}

function fillSelect(select, items, allLabel) {
  if (!select) {
    return;
  }
  const current = select.value;
  const extras = [...select.querySelectorAll("option")].filter((opt) => opt.value && !items.some((i) => i.value === opt.value));
  const keepStatus = extras.length && select.id.includes("status");
  if (!keepStatus) {
    select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
      items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
    if ([...select.options].some((opt) => opt.value === current)) {
      select.value = current;
    }
  }
}

function fillProjectFilters() {
  const items = (office?.projects || []).map((p) => ({ value: p.id, label: p.name }));
  fillSelect(officeEls.legalProject, items, "All projects");
  fillSelect(officeEls.poProject, items, "All projects");
  fillSelect(officeEls.timelineProject, items, "All projects");
  const phases = [...new Set((office?.projects || []).map((p) => p.phase))];
  fillSelect(officeEls.projectPhase, phases.map((p) => ({ value: p, label: p })), "All");
}

function syncProjectFilters(id) {
  selectedProjectId = id;
  if (officeEls.legalProject) {
    officeEls.legalProject.value = id || "";
  }
  if (officeEls.poProject) {
    officeEls.poProject.value = id || "";
  }
  if (officeEls.timelineProject) {
    officeEls.timelineProject.value = id || "";
  }
}

function renderCompany() {
  const c = office?.company;
  if (!officeEls.companyMeta) {
    return;
  }
  if (!c) {
    return;
  }
  officeEls.companyMeta.innerHTML = `
    <div><dt>Firm</dt><dd>${escapeHtml(c.name)}</dd></div>
    <div><dt>Role</dt><dd>${escapeHtml(c.role)}</dd></div>
    <div><dt>City</dt><dd>${escapeHtml(c.city)}</dd></div>
    <div><dt>Trainer</dt><dd>${escapeHtml(c.trainedBy)}</dd></div>`;
  if (officeEls.disclaimer) {
    officeEls.disclaimer.textContent = office.disclaimer || "";
  }
}

function renderProjectDetail(project) {
  if (!project) {
    officeEls.projectKicker.textContent = "Select a project";
    officeEls.projectMeta.innerHTML = `
      <div><dt>Code</dt><dd>—</dd></div>
      <div><dt>Client</dt><dd>—</dd></div>
      <div><dt>Site</dt><dd>—</dd></div>
      <div><dt>Value</dt><dd>—</dd></div>`;
    officeEls.projectSummary.textContent = office?.company?.trainingNote || "";
    officeEls.openModel.hidden = true;
    return;
  }
  officeEls.projectKicker.textContent = project.phase;
  officeEls.projectMeta.innerHTML = `
    <div><dt>Code</dt><dd>${escapeHtml(project.code)}</dd></div>
    <div><dt>Client</dt><dd>${escapeHtml(project.client)}</dd></div>
    <div><dt>Site</dt><dd>${escapeHtml(project.location)}</dd></div>
    <div><dt>Value</dt><dd>${officeMoney(project.contractValue)}</dd></div>`;
  officeEls.projectSummary.textContent = `${project.summary} Next: ${project.nextMilestone}`;
  officeEls.openModel.hidden = !project.linkedSample;
  officeEls.openModel.textContent = project.linkedSampleLabel || "Open linked model";
}

function renderProjects() {
  if (!officeEls.projectCards) {
    return;
  }
  const phase = officeEls.projectPhase?.value || "";
  const list = (office?.projects || []).filter((p) => !phase || p.phase === phase);
  officeEls.projectsCaption.textContent = office
    ? `${office.company.name} · ${list.length} job${list.length === 1 ? "" : "s"}`
    : "Demo contractor office";
  officeEls.projectCards.innerHTML = list.length
    ? list.map((p) => `
      <article class="project-card ${p.id === selectedProjectId ? "selected" : ""}" data-id="${escapeHtml(p.id)}" tabindex="0">
        <div class="project-card-top">
          <strong>${escapeHtml(p.name)}</strong>
          ${pill(p.status)}
        </div>
        <p>${escapeHtml(p.client)} · ${escapeHtml(p.location)}</p>
        <div class="project-card-foot">
          <span>${escapeHtml(p.phase)}</span>
          <span>${officeMoney(p.contractValue)}</span>
        </div>
        <p class="next">${escapeHtml(p.nextMilestone)}</p>
      </article>`).join("")
    : `<p class="hint">No projects in this filter.</p>`;
  renderProjectDetail(projectById(selectedProjectId));
}

function filteredForms() {
  const pid = officeEls.legalProject?.value || "";
  const status = officeEls.legalStatus?.value || "";
  return (office?.forms || []).filter((f) => (!pid || f.projectId === pid) && (!status || f.status === status));
}

function renderLegalDetail(form) {
  if (!form) {
    officeEls.legalKicker.textContent = "Select a row";
    officeEls.legalMeta.innerHTML = `
      <div><dt>Type</dt><dd>—</dd></div>
      <div><dt>Status</dt><dd>—</dd></div>
      <div><dt>Parties</dt><dd>—</dd></div>
      <div><dt>Dates</dt><dd>—</dd></div>`;
    officeEls.legalNotes.textContent = "Demo forms only — not legal advice.";
    return;
  }
  officeEls.legalKicker.textContent = form.status;
  officeEls.legalMeta.innerHTML = `
    <div><dt>Type</dt><dd>${escapeHtml(form.type)}</dd></div>
    <div><dt>Status</dt><dd>${pill(form.status)}</dd></div>
    <div><dt>Parties</dt><dd>${escapeHtml(form.parties)}</dd></div>
    <div><dt>Dates</dt><dd>${fmtDate(form.issued)} / ${fmtDate(form.signed)}</dd></div>`;
  officeEls.legalNotes.textContent = form.notes;
}

function renderLegal() {
  const rows = filteredForms();
  officeEls.legalCaption.textContent = `${rows.length} form${rows.length === 1 ? "" : "s"}`;
  officeEls.legalBody.innerHTML = rows.length
    ? rows.map((f) => {
      const project = projectById(f.projectId);
      return `<tr data-id="${escapeHtml(f.id)}" class="${f.id === selectedFormId ? "selected" : ""}">
        <td>${escapeHtml(f.type)}</td>
        <td>${escapeHtml(project?.name || f.projectId)}</td>
        <td>${pill(f.status)}</td>
        <td>${fmtDate(f.issued)}</td>
        <td>${fmtDate(f.signed)}</td>
      </tr>`;
    }).join("")
    : `<tr class="muted"><td colspan="5">No forms in this filter.</td></tr>`;
  renderLegalDetail((office?.forms || []).find((f) => f.id === selectedFormId) || null);
}

function filteredPurchases() {
  const pid = officeEls.poProject?.value || "";
  const status = officeEls.poStatus?.value || "";
  return (office?.purchases || []).filter((p) => (!pid || p.projectId === pid) && (!status || p.status === status));
}

function renderPoDetail(row) {
  if (!row) {
    officeEls.poKicker.textContent = "Select a row";
    officeEls.poMeta.innerHTML = `
      <div><dt>Supplier</dt><dd>—</dd></div>
      <div><dt>Trade</dt><dd>—</dd></div>
      <div><dt>Model</dt><dd>—</dd></div>
      <div><dt>Issued</dt><dd>—</dd></div>`;
    officeEls.poNotes.textContent = "Quantities follow TSP codes on the Cost tab.";
    return;
  }
  const supplier = supplierById(row.supplierId);
  officeEls.poKicker.textContent = row.poNumber;
  officeEls.poMeta.innerHTML = `
    <div><dt>Supplier</dt><dd>${escapeHtml(row.supplier)}</dd></div>
    <div><dt>Trade</dt><dd>${escapeHtml(supplier?.trade || "—")}</dd></div>
    <div><dt>Model</dt><dd>${escapeHtml(row.model || "—")}</dd></div>
    <div><dt>Issued</dt><dd>${fmtDate(row.issued)}</dd></div>`;
  officeEls.poNotes.textContent = `${row.description} · ${row.qty} ${row.unit} · ${officeMoney(row.amount)}. ${supplier?.contact || ""}`;
}

function renderPurchases() {
  const rows = filteredPurchases();
  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  officeEls.purchasesCaption.textContent = `${rows.length} lines · ${officeMoney(total)}`;
  officeEls.purchasesBody.innerHTML = rows.length
    ? rows.map((r) => {
      const project = projectById(r.projectId);
      return `<tr data-id="${escapeHtml(r.id)}" class="${r.id === selectedPoId ? "selected" : ""}">
        <td>${escapeHtml(r.poNumber)}</td>
        <td>${escapeHtml(project?.name || r.projectId)}</td>
        <td>${escapeHtml(r.supplier)}</td>
        <td class="wrap">${escapeHtml(r.description)}</td>
        <td>${escapeHtml(String(r.qty))} ${escapeHtml(r.unit)}</td>
        <td class="num">${officeMoney(r.amount)}</td>
        <td>${pill(r.status)}</td>
      </tr>`;
    }).join("")
    : `<tr class="muted"><td colspan="7">No purchases in this filter.</td></tr>`;
  officeEls.supplierList.innerHTML = (office?.suppliers || [])
    .map((s) => `<li><span>${escapeHtml(s.name)}</span><span>${escapeHtml(s.trade)}</span></li>`)
    .join("") || "<li>No suppliers</li>";
  renderPoDetail((office?.purchases || []).find((p) => p.id === selectedPoId) || null);
}

function filteredMilestones() {
  const pid = officeEls.timelineProject?.value || "";
  return (office?.milestones || [])
    .filter((m) => !pid || m.projectId === pid)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function renderPhaseBar(rows) {
  const kinds = new Set(rows.map((m) => m.kind));
  const last = PHASE_ORDER.reduce((acc, kind, i) => (kinds.has(kind) ? i : acc), -1);
  officeEls.phaseBar.innerHTML = PHASE_ORDER.map((kind, i) => {
    const active = kinds.has(kind);
    const reached = i <= last;
    const filled = i < last;
    return `
    <div class="phase-step ${active ? "active" : ""} ${reached ? "reached" : ""} ${filled ? "filled" : ""}" role="listitem">
      <span class="phase-track"></span>
      <span class="phase-dot"></span>
      <span class="phase-label">${escapeHtml(PHASE_LABELS[kind])}</span>
    </div>`;
  }).join("");
}

function renderMilestoneDetail(row) {
  if (!row) {
    officeEls.milestoneKicker.textContent = "Select a row";
    officeEls.milestoneMeta.innerHTML = `
      <div><dt>Date</dt><dd>—</dd></div>
      <div><dt>Kind</dt><dd>—</dd></div>
      <div><dt>Project</dt><dd>—</dd></div>
      <div><dt>Phase</dt><dd>—</dd></div>`;
    officeEls.milestoneNotes.textContent = "Flow: concept → Revit extract → priced takeoff → contracts → orders → site.";
    return;
  }
  const project = projectById(row.projectId);
  officeEls.milestoneKicker.textContent = row.label;
  officeEls.milestoneMeta.innerHTML = `
    <div><dt>Date</dt><dd>${fmtDate(row.date)}</dd></div>
    <div><dt>Kind</dt><dd>${escapeHtml(PHASE_LABELS[row.kind] || row.kind)}</dd></div>
    <div><dt>Project</dt><dd>${escapeHtml(project?.name || row.projectId)}</dd></div>
    <div><dt>Phase</dt><dd>${escapeHtml(project?.phase || "—")}</dd></div>`;
  officeEls.milestoneNotes.textContent = project?.summary || "";
}

function renderTimeline() {
  const rows = filteredMilestones();
  officeEls.timelineCaption.textContent = `${rows.length} milestone${rows.length === 1 ? "" : "s"}`;
  renderPhaseBar(rows);
  officeEls.timelineBody.innerHTML = rows.length
    ? rows.map((m) => {
      const project = projectById(m.projectId);
      return `<tr data-id="${escapeHtml(m.id)}" class="${m.id === selectedMilestoneId ? "selected" : ""}">
        <td>${fmtDate(m.date)}</td>
        <td>${escapeHtml(project?.name || m.projectId)}</td>
        <td>${escapeHtml(m.label)}</td>
        <td>${escapeHtml(PHASE_LABELS[m.kind] || m.kind)}</td>
      </tr>`;
    }).join("")
    : `<tr class="muted"><td colspan="4">No milestones in this filter.</td></tr>`;
  renderMilestoneDetail((office?.milestones || []).find((m) => m.id === selectedMilestoneId) || null);
}

function renderOfficeAll() {
  if (!office) {
    return;
  }
  fillProjectFilters();
  renderCompany();
  renderProjects();
  renderLegal();
  renderPurchases();
  renderTimeline();
}

function renderOfficeView(name) {
  if (!office) {
    return;
  }
  if (name === "projects") {
    renderProjects();
  }
  if (name === "legal") {
    renderLegal();
  }
  if (name === "purchases") {
    renderPurchases();
  }
  if (name === "timeline") {
    renderTimeline();
  }
}

async function loadOffice(switchToProjects) {
  const res = await fetch(OFFICE_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Could not load demo office");
  }
  office = await res.json();
  renderOfficeAll();
  if (switchToProjects && typeof setView === "function") {
    setView("projects");
    if (typeof showBanner === "function") {
      showBanner(`${office.company.name} office loaded. Walk through Projects, Legal, Purchases, and Timeline.`, "ok");
    }
  }
}

officeEls.projectPhase?.addEventListener("change", () => renderProjects());
officeEls.legalProject?.addEventListener("change", () => {
  selectedProjectId = officeEls.legalProject.value || selectedProjectId;
  renderLegal();
});
officeEls.legalStatus?.addEventListener("change", () => renderLegal());
officeEls.poProject?.addEventListener("change", () => {
  selectedProjectId = officeEls.poProject.value || selectedProjectId;
  renderPurchases();
});
officeEls.poStatus?.addEventListener("change", () => renderPurchases());
officeEls.timelineProject?.addEventListener("change", () => {
  selectedProjectId = officeEls.timelineProject.value || selectedProjectId;
  renderTimeline();
});

officeEls.projectCards?.addEventListener("click", (event) => {
  const card = event.target.closest(".project-card");
  if (!card) {
    return;
  }
  syncProjectFilters(card.dataset.id);
  renderOfficeAll();
});

officeEls.legalBody?.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-id]");
  if (!row) {
    return;
  }
  selectedFormId = row.dataset.id;
  const form = (office?.forms || []).find((f) => f.id === selectedFormId);
  if (form) {
    selectedProjectId = form.projectId;
  }
  renderLegal();
});

officeEls.purchasesBody?.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-id]");
  if (!row) {
    return;
  }
  selectedPoId = row.dataset.id;
  const po = (office?.purchases || []).find((p) => p.id === selectedPoId);
  if (po) {
    selectedProjectId = po.projectId;
  }
  renderPurchases();
});

officeEls.timelineBody?.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-id]");
  if (!row) {
    return;
  }
  selectedMilestoneId = row.dataset.id;
  const mile = (office?.milestones || []).find((m) => m.id === selectedMilestoneId);
  if (mile) {
    selectedProjectId = mile.projectId;
  }
  renderTimeline();
});

officeEls.openModel?.addEventListener("click", async () => {
  const project = projectById(selectedProjectId);
  if (!project?.linkedSample || typeof loadJson !== "function") {
    return;
  }
  try {
    await loadJson(project.linkedSample, `${project.name} · sample plan`);
    if (typeof refreshExtras === "function") {
      refreshExtras();
    }
    setView("plan");
    showBanner(`Loaded ${project.name} floor plan. Cost tab uses the TSP catalog.`, "ok");
  } catch (err) {
    showBanner(err.message || "Could not load linked plan.", "error");
  }
});

document.getElementById("btn-office")?.addEventListener("click", async () => {
  try {
    await loadOffice(true);
  } catch (err) {
    if (typeof showBanner === "function") {
      showBanner(err.message || "Demo office failed to load.", "error");
    }
  }
});

loadOffice(false).catch(() => {
  if (officeEls.projectCards) {
    officeEls.projectCards.innerHTML = `<p class="hint">Could not load samples/studio-office.json.</p>`;
  }
});
