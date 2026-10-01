// The practice-ops API, from the browser. Same origin as the server that
// serves this page, so the session cookie travels on its own and there is no
// token for this file to hold.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.body = body || {};
  }
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
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed;
}

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const api = {
  session: () => call("GET", "/api/auth/session"),
  signIn: (body) => call("POST", "/api/auth/sign-in", body),
  signUp: (body) => call("POST", "/api/auth/sign-up", body),
  signOut: () => call("POST", "/api/auth/sign-out", {}),

  // Owner-only server-side (server/src/api.js's handleInviteTeamMember); the
  // button that calls this is hidden for anyone else, see app.js's
  // `isOwner()`.
  listTeam: () => call("GET", "/api/team"),
  inviteTeamMember: (body) => call("POST", "/api/team", body),
  teamRoster: () => call("GET", "/api/team/roster"),
  updateTeamMember: (id, body) => call("PATCH", `/api/team/${encodeURIComponent(id)}`, body),
  removeTeamMember: (id) => call("DELETE", `/api/team/${encodeURIComponent(id)}`),

  // Owner-only server-side. Captured value per person, job and activity.
  teamReport: ({ from, to } = {}) => {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const suffix = query.toString();
    return call("GET", `/api/team/report${suffix ? `?${suffix}` : ""}`);
  },

  reference: () => call("GET", "/api/practice/reference"),
  orgSettings: () => call("GET", "/api/org/settings"),
  putOrgSettings: (body) => call("PUT", "/api/org/settings", body),
  feeTemplate: (code) => call("GET", `/api/fee-templates/${encodeURIComponent(code)}`),
  // Owner-only server-side. Replace-all: a template is edited as one document.
  putFeeTemplate: (code, body) => call("PUT", `/api/fee-templates/${encodeURIComponent(code)}`, body),
  resetFeeTemplate: (code) => call("POST", `/api/fee-templates/${encodeURIComponent(code)}/reset`, {}),

  listRegister: () => call("GET", "/api/register"),
  getRegisterProject: (id) => call("GET", `/api/register/${encodeURIComponent(id)}`),
  createRegisterProject: (body) => call("POST", "/api/register", body),
  updateRegisterProject: (id, body) => call("PATCH", `/api/register/${encodeURIComponent(id)}`, body),
  // A canvas for a job that was opened without one. The planner still requires
  // a document; this is how a township job grows one and a rezoning does not.
  attachDrawing: (id, body) => call("POST", `/api/projects/${encodeURIComponent(id)}/drawing`, body),
  // Outlines for every drawing in the firm, in one request. The whole
  // document is never asked for here - a preview has no use for it.
  drawingPreviews: () => call("GET", "/api/practice/drawing-previews"),
  financials: (id) => call("GET", `/api/projects/${encodeURIComponent(id)}/financials`),

  feeSchedule: (id) => call("GET", `/api/projects/${encodeURIComponent(id)}/fee-schedule`),
  // Replace-all. A schedule is revised the way a proposal is reissued.
  setFeeSchedule: (id, lines) => (
    call("PUT", `/api/projects/${encodeURIComponent(id)}/fee-schedule`, { lines })
  ),

  phases: (id) => call("GET", `/api/projects/${encodeURIComponent(id)}/phases`),

  setPhase: (id, body) => call("POST", `/api/projects/${encodeURIComponent(id)}/phase`, body),

  listTasks: (id) => call("GET", `/api/projects/${encodeURIComponent(id)}/tasks`),
  addTask: (id, body) => call("POST", `/api/projects/${encodeURIComponent(id)}/tasks`, body),
  // Striking is `status: "not_required"`. There is no delete.
  updateTask: (id, body) => call("PATCH", `/api/tasks/${encodeURIComponent(id)}`, body),

  listTimeEntries: (filters = {}) => call("GET", `/api/time-entries${query(filters)}`),
  createTimeEntry: (body) => call("POST", "/api/time-entries", body),
  deleteTimeEntry: (id) => call("DELETE", `/api/time-entries/${encodeURIComponent(id)}`),

  listCertificates: (projectId) => (
    call("GET", `/api/projects/${encodeURIComponent(projectId)}/certificates`)
  ),
  createCertificate: (projectId, body) => (
    call("POST", `/api/projects/${encodeURIComponent(projectId)}/certificates`, body)
  ),
  getCertificate: (id) => call("GET", `/api/certificates/${encodeURIComponent(id)}`),
  addScheduleLine: (id, body) => call("POST", `/api/certificates/${encodeURIComponent(id)}/lines`, body),
  addLinesFromTime: (id, body) => (
    call("POST", `/api/certificates/${encodeURIComponent(id)}/lines-from-time`, body)
  ),
  addLinesFromTasks: (id, tasks) => (
    call("POST", `/api/certificates/${encodeURIComponent(id)}/lines-from-tasks`, { tasks })
  ),
  addWriteDown: (id, body) => (
    call("POST", `/api/certificates/${encodeURIComponent(id)}/write-downs`, body)
  ),
  issueCertificate: (id) => call("POST", `/api/certificates/${encodeURIComponent(id)}/issue`, {}),
};
