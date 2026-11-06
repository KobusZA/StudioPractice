// Companies on this installation: how many jobs each has, and who may sign in.
// The server refuses this page's API unless the session is a platform
// administrator. Fees and banking are not requested and are not shown.

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

const el = (id) => document.getElementById(id);

function when(value) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(parsed?.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return parsed;
}

const PAGE = 40;

const state = {
  session: null,
  companies: [],
  query: "",
  totalCompanies: 0,
  totalJobs: 0,
  companyId: null,
  company: null,
};

function showApp(session) {
  state.session = session;
  el("gate").hidden = true;
  el("app").hidden = false;
  el("who").textContent = session.email;
  el("practice-link").hidden = !session.orgId;
}

async function boot() {
  el("sign-out").addEventListener("click", async () => {
    await call("POST", "/api/auth/sign-out", {}).catch(() => {});
    location.reload();
  });
  el("nav-companies").addEventListener("click", () => {
    state.companyId = null;
    state.company = null;
    paintList();
  });
  el("gate-form").addEventListener("submit", onSignIn);
  el("main").addEventListener("click", onClick);
  el("main").addEventListener("change", onChange);
  el("main").addEventListener("submit", onSubmit);

  const session = await call("GET", "/api/auth/session").catch(() => ({ signedIn: false }));
  if (!session.signedIn) {
    el("gate").hidden = false;
    return;
  }
  showApp(session);
  if (!session.platformAdmin) {
    paintDenied();
    return;
  }
  await loadList();
}

async function onSignIn(event) {
  event.preventDefault();
  el("gate-error").textContent = "";
  try {
    const session = await call("POST", "/api/auth/sign-in", {
      email: el("gate-email").value,
      password: el("gate-password").value,
    });
    showApp(session);
    if (!session.platformAdmin) {
      paintDenied();
      return;
    }
    await loadList();
  } catch (error) {
    el("gate-error").textContent = error.message;
  }
}

function paintDenied() {
  el("main").innerHTML = `
    <div class="denied">
      <h1>Not an administrator</h1>
      <p>This account can use the practice, but it cannot see other companies.</p>
    </div>`;
}

async function loadList({ append = false } = {}) {
  if (!append) el("main").innerHTML = `<p class="note-line">Loading…</p>`;
  const offset = append ? state.companies.length : 0;
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (state.query) params.set("q", state.query);
  try {
    const page = await call("GET", `/api/admin/companies?${params}`);
    state.companies = append ? state.companies.concat(page.companies) : page.companies;
    state.totalCompanies = page.totalCompanies;
    state.totalJobs = page.totalJobs;
    state.companyId = null;
    state.company = null;
    paintList();
  } catch (error) {
    el("main").innerHTML = `<p class="note-line">${esc(error.message)}</p>`;
  }
}

function paintList() {
  const companies = state.companies;
  const more = companies.length < state.totalCompanies;
  el("nav-companies").setAttribute("aria-current", "page");
  el("main").innerHTML = `
    <h1>Companies</h1>
    <p class="note-line">${state.totalCompanies} ${state.totalCompanies === 1 ? "company" : "companies"}
      · ${state.totalJobs} live ${state.totalJobs === 1 ? "job" : "jobs"}</p>
    <form class="form" data-form="search">
      <div class="fields">
        <div class="field">
          <label for="company-query">Find a company</label>
          <input id="company-query" name="q" value="${esc(state.query)}" placeholder="Name" />
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Search</button>
      </div>
    </form>
    ${companies.length ? `
      <table class="grid">
        <thead><tr><th>Company</th><th class="num">People</th><th class="num">Jobs</th><th>Opened</th></tr></thead>
        <tbody>
          ${companies.map((company) => `
            <tr class="row-link" data-open-company="${esc(company.id)}">
              <td><button type="button" class="admin-company" data-open-company="${esc(company.id)}">${esc(company.name)}</button></td>
              <td class="num">${company.memberCount}</td>
              <td class="num">${company.jobCount}</td>
              <td>${esc(when(company.createdAt))}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${more ? `<p><button type="button" class="btn" data-more>Show more</button></p>` : ""}`
    : `<p>${state.query ? "No company has that name." : "No companies are registered yet."}</p>`}`;
}

async function openCompany(orgId) {
  el("main").innerHTML = `<p class="note-line">Loading…</p>`;
  try {
    state.companyId = orgId;
    state.company = (await call("GET", `/api/admin/companies/${encodeURIComponent(orgId)}`)).company;
    paintCompany();
  } catch (error) {
    el("main").innerHTML = `<p class="note-line">${esc(error.message)}</p>`;
  }
}

function paintCompany() {
  const company = state.company;
  el("nav-companies").removeAttribute("aria-current");
  el("main").innerHTML = `
    <button type="button" class="admin-back" data-back>← All companies</button>
    <h1>${esc(company.name)}</h1>
    <p class="note-line">Opened ${esc(when(company.createdAt))}</p>
    <div class="kpis">
      <div class="kpi"><b>${company.jobCount}</b><span>${company.jobCount === 1 ? "Live job" : "Live jobs"}</span></div>
      <div class="kpi"><b>${company.memberCount}</b><span>${company.memberCount === 1 ? "Person with access" : "People with access"}</span></div>
    </div>

    <h2>Jobs</h2>
    ${company.jobs.length ? `
      <table class="grid">
        <thead><tr><th>Code</th><th>Job</th><th>Client</th><th>Type</th><th>Status</th><th>Opened</th></tr></thead>
        <tbody>
          ${company.jobs.map((job) => `
            <tr class="row-link" data-open-job="${esc(job.id)}">
              <td><span class="code-cell">${esc(job.code || "—")}</span></td>
              <td><button type="button" class="admin-company" data-open-job="${esc(job.id)}">${esc(job.name || job.code || "Open job")}</button></td>
              <td>${esc(job.clientName || "—")}</td>
              <td>${esc(job.typeCode || "—")}</td>
              <td>${esc(job.status || "—")}</td>
              <td>${esc(when(job.openedAt || job.createdAt))}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <p class="note-line" data-job-error></p>` : `<p>This company has no jobs yet.</p>`}

    <h2>Access</h2>
    <p class="note-line">A new person needs a password of at least 10 characters. Tell them the password yourself — nothing is emailed.
      Leave the password blank when the email already has an account. They keep that password, and after they sign in they can switch to this company.</p>
    <form class="form" data-form="grant">
      <div class="fields">
        <div class="field">
          <label for="grant-email">Email</label>
          <input id="grant-email" name="email" type="email" autocomplete="off" required />
        </div>
        <div class="field">
          <label for="grant-password">Password</label>
          <input id="grant-password" name="password" type="text" autocomplete="off" />
        </div>
        <div class="field">
          <label for="grant-role">Access</label>
          <select id="grant-role" name="role">
            <option value="employee" selected>Employee — work and hours, no fees</option>
            <option value="owner">Owner — fees, costs, and people</option>
          </select>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Give access</button>
      </div>
      <p class="note-line" data-grant-error></p>
    </form>

    ${company.members.length ? `
      <table class="grid">
        <thead><tr><th>Person</th><th>Access</th><th>Since</th><th></th></tr></thead>
        <tbody>
          ${company.members.map((member) => `
            <tr>
              <td>${esc(member.email)}</td>
              <td>
                <select class="member-role" data-role-for="${esc(member.userId)}" aria-label="Access for ${esc(member.email)}">
                  <option value="employee"${member.role === "employee" ? " selected" : ""}>Employee</option>
                  <option value="owner"${member.role === "owner" ? " selected" : ""}>Owner</option>
                </select>
              </td>
              <td>${esc(when(member.createdAt))}</td>
              <td><button type="button" class="btn btn-sm" data-revoke="${esc(member.userId)}">Remove access</button></td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<p>Nobody has access.</p>`}
    <p class="note-line" data-member-error></p>`;
}

async function openJob(projectId) {
  const note = el("main").querySelector("[data-job-error]");
  if (note) note.textContent = "";
  try {
    await call("POST", `/api/admin/companies/${encodeURIComponent(state.companyId)}/jobs/${encodeURIComponent(projectId)}/open`);
    location.assign(`/practice/index.html?project=${encodeURIComponent(projectId)}`);
  } catch (error) {
    if (note) note.textContent = error.message;
  }
}

async function onClick(event) {
  const job = event.target.closest("[data-open-job]");
  if (job && state.companyId) {
    await openJob(job.dataset.openJob);
    return;
  }
  const open = event.target.closest("[data-open-company]");
  if (open) {
    await openCompany(open.dataset.openCompany);
    return;
  }
  if (event.target.closest("[data-back]")) {
    state.companyId = null;
    state.company = null;
    paintList();
    return;
  }
  if (event.target.closest("[data-more]")) {
    await loadList({ append: true });
    return;
  }
  const revoke = event.target.closest("[data-revoke]");
  if (!revoke || !state.companyId) return;
  const member = state.company.members.find((row) => row.userId === revoke.dataset.revoke);
  if (!member) return;
  if (!confirm(`Remove ${member.email}'s access to ${state.company.name}?`)) return;
  try {
    await call("DELETE", `/api/admin/companies/${encodeURIComponent(state.companyId)}/members/${encodeURIComponent(member.userId)}`);
    await openCompany(state.companyId);
  } catch (error) {
    const note = el("main").querySelector("[data-member-error]");
    if (note) note.textContent = error.message;
  }
}

async function onChange(event) {
  const select = event.target.closest("[data-role-for]");
  if (!select || !state.companyId) return;
  const userId = select.dataset.roleFor;
  try {
    await call("PATCH", `/api/admin/companies/${encodeURIComponent(state.companyId)}/members/${encodeURIComponent(userId)}`, {
      role: select.value,
    });
    await openCompany(state.companyId);
  } catch (error) {
    const note = el("main").querySelector("[data-member-error]");
    if (note) note.textContent = error.message;
    await openCompany(state.companyId);
  }
}

async function onSubmit(event) {
  const search = event.target.closest("[data-form='search']");
  if (search) {
    event.preventDefault();
    state.query = search.q.value.trim();
    await loadList();
    return;
  }
  const form = event.target.closest("[data-form='grant']");
  if (!form || !state.companyId) return;
  event.preventDefault();
  const note = form.querySelector("[data-grant-error]");
  note.textContent = "";
  const body = {
    email: form.email.value,
    role: form.role.value,
  };
  if (form.password.value) body.password = form.password.value;
  try {
    await call("POST", `/api/admin/companies/${encodeURIComponent(state.companyId)}/members`, body);
    await openCompany(state.companyId);
  } catch (error) {
    note.textContent = error.message;
  }
}

boot();
