# Competitor UX/permissions research — personal reference

Personal reference only. Not part of the app, not a plan, not reviewed by
anyone else. Compiled from Cursor-agent research done in this repo over the
last 30 days (two research passes: a navigation/IA deep dive on 2026‑09‑23,
and a permissions/RBAC pass on 2026‑09‑27). Where the original research
said "could not verify," that's preserved below rather than smoothed over.

Sources, if you want to go back to the raw chats:
- Navigation/IA deep dive: subagent report inside chat `d1475bd6-3902-41d1-ba5a-0d0622fec4df` (triggered by the "look at the layout of the website... do a deep dive into the gui, the UX" prompt).
- Permissions/RBAC pass: chat `aa596896-f511-4bb3-9e81-e0d44089f0a8`, written up in `PERMISSIONS-PROPOSAL.md`.

---

## Part 1 — Navigation & information architecture

Research question: how do comparable products lay out navigation, and in
particular — is there a persistent all-jobs list next to job detail, or a
list→detail (index page) model; is there a separate executive/portfolio
dashboard; how is "what stage is this job at" represented; and how do you
switch between jobs?

Everything below comes from vendor documentation/help-centre pages retrieved
during research — not G2/Capterra screenshots or YouTube demos (those were
not retrieved). Where the docs didn't say enough to be sure, it's marked
"could not verify" rather than guessed.

### Monograph

- **Nav**: left menu — Dashboard, Smart Inbox, Projects (Milestones, Tasks,
  Templates, Archive sub-tabs), Staff (incl. Staffing), Money (Invoices,
  Unbilled, Invoices Received), Reports (Profit, Utilization, Profit
  Forecast), Settings. Full exact sidebar label list not confirmed in one
  place.
- **All-jobs list**: index → detail, not a persistent rail. Clicking a
  project opens its own Project-Specific Overview page.
- **Executive dashboard**: yes, and the closest analogue to a firm-wide
  view. Business Performance (Net Profit, Utilization, 3-month projections),
  Team Work Insights (# projects over-budget/trending over, # staff over
  capacity), Recent Projects, Timesheets, Assigned Work, Invoices & Bills.
  **Each risk widget links to a pre-filtered project list** — that's how
  Monograph gets a "risk view" without spending permanent screen width on
  a rail.
- **Process/stage**: a phase Gantt with a **Money Gantt** burn bar under
  each phase (fills in as time is logged; hover shows Fee Planned / Time
  Logged / Invoiced / Paid). Plus a coarse status pill (Active, Proposed,
  Paused, Completed, Canceled). Not a kanban — "where are we" = how much of
  each phase's fee is burnt, positioned in time.
- **Job switching**: "Recent Projects" = 6 most recently viewed. Filters +
  "Copy Filtered View" link. No command palette found.
- **Permissions** (from the RBAC pass): the one deliberate **exception** in
  the whole set — Monograph does *not* decouple money visibility from task
  editing. Their own support docs record customers asking for this
  separation and being told no: "we believe anyone with edit permission
  should be aware of billable rates." Worth remembering as a counter-example,
  not a model to copy.

### BQE Core

- **Nav**: collapsible/reorderable side menu of modules (drag to reorder in
  User Settings), global Search, breadcrumbs, a Favorites list capped at 10
  screens. Configurable start-up screen (Dashboard / Last Screen / specific
  screen).
- **All-jobs list**: explicit list ↔ detail — `Project List View` vs
  `Project Center` (Overview, Structure, Budget, Transactions, Documents,
  To-Dos, Notes, Settings). **Fee Schedules is a first-class sibling of
  Projects** under Templates & Tools — maps directly onto a fee-templates
  object if you have one.
- **Executive dashboard**: yes, role-based, configurable, predefined
  role-based dashboards, up to 9 widgets each (Standard/Wide/Tall), shareable.
- **Process/stage**: hierarchy (phases nest in projects, shown via
  breadcrumbs) + sortable/status columns + column chooser + anchored column
  totals. No kanban-by-stage found.
- **Job switching**: Favorites (max 10), global search, per-tab independent
  search state, breadcrumbs.
- **Permissions**: granular toggles on a security profile — `Allow read
  rate` / `Show bill rate` / `Show cost rate` are independent checkboxes
  from time-entry/task-edit rights. "Manage Access" can hide $ per screen
  (Budget, Fee Schedule) while task access stays on.

### Deltek Ajera

- **Nav**: main menu + left icon column; dashboard is the home screen with
  editable "Design Mode" widget layout.
- **All-jobs list**: **genuine simultaneous master-detail** — the strongest
  precedent found for a persistent rail. The **Project Command Center** has
  a Project list (configurable columns, optional Gantt/timeline, searchable
  by ID/description/client) *and* a Project detail pane (project tree / WBS
  on the left, tabs — Project Info, Manage, Invoices, Report — on the right)
  in one screen. There's also a separate, lighter **"Projects in the
  browser"** grid for fast inline bulk-editing of status/dates/cost across
  many projects at once (changed rows bolded), which opens through to the
  full Command Center. **Ajera runs a fast bulk-edit list and a deep
  master-detail workspace as two different screens over the same data,
  rather than making one screen do both.**
- **Executive dashboard**: yes, explicitly role-differentiated — separate
  dashboard docs for PMs, accountants, employees, marketing, principals. PM
  dashboard: "Identify project slippage early." Widgets link through to the
  specific record (same widget→filtered-view pattern as Monograph).
- **Process/stage**: WBS tree + editable project/phase status; status
  changes cascade down from project to phases (closing a project closes its
  phases). Not a kanban.
- **Job switching**: search within the persistent list by ID/description/
  client; remembered column & display preferences.
- **Permissions**: role-based, per-module. Labor cost access has 4 levels
  (Full / Subtotals only / Final totals only / None), independent of
  project/task edit rights. Explicit warning: full cost access reveals
  salaries — grant carefully.

### Deltek Vantagepoint

- **Nav**: left Navigation pane listing all "applications," a **Find
  Application** search tool, organised around **Hubs** (Projects, Employees,
  Contacts, Firms) with forms as tabs. Availability depends on activated
  modules + security role.
- **All-jobs list**: **sticky selection across hub applications** — the most
  interesting middle path found. Select a project in the Dashboard, switch
  to Billing Terms, and the same project (and even the same WBS element) is
  still selected. Gets the continuity benefit of a persistent rail (never
  re-pick the job) without spending screen width on one. Could not verify
  whether list and detail panes are ever shown side by side.
- **Executive dashboard**: yes, several — Project Manager, Project Planning,
  CRM, BD Active Pursuits, BD Hit Rate — built from "dashparts," with
  dashboard-level filters and drill-through summary→detail. A separate
  per-project Dashboard form shows 5 swappable/enlargeable dashparts.
- **Process/stage**: WBS levels + project status + hoverable warning
  indicators on the record itself. Pursuit stages live in CRM. No
  kanban-by-stage confirmed.
- **Job switching**: search navigation controls, saved/ad-hoc/SQL-where
  searches (permission-gated, shareable), list paging, Find Application.
- **Permissions**: same 4-level labor-cost-access model as Ajera (Full /
  Subtotals only / Final totals only / None), independent of edit rights.

### Rapport3 (now Milient)

- **Nav**: Home dashboard + module tabs (Projects w/ Overview, Finance, HR,
  Admin), governed by a Control Panel/Security Console down to individual
  report and panel level.
- **All-jobs list**: an **overlay-detail** pattern, neither rail nor pure
  index. The organising unit is the "panel" — multiple panels visible at
  once on a dashboard, and the Project Summary Panel has buttons that open
  Performance Summary / Performance Graphs / related projects **without
  leaving the home dashboard screen** (drill-in modal, not a rail).
- **Executive dashboard**: yes — the Home Dashboard.
- **Process/stage**: could not verify a stage pipeline. QA Tasks and
  "Gateway Documents" exist as panel names (suggests stage-gates) but no
  UI documentation found — not characterised further.
- **Job switching**: could not verify.
- **Permissions**: not covered in the RBAC pass.

### Total Synergy

The most directly instructive case — Synergy **publicly redesigned and
documented** its project navigation twice in the last ~18 months.

- **Nav**: side nav (Projects > Projects List) + redesigned top nav with
  Search moved left, a new **"My Work"** section, profile menu.
- **Project workspace**: tabs, and **they deliberately killed the global
  project switcher** (Oct 2025). Replaced "one large dropdown with multiple
  levels" with in-project tabs (Overview, Breakdown, Schedule, Financials,
  Invoices, Transactions, Billing, Contacts, Documents, More). Their own
  FAQ: *"How do I get back to Projects now that I can't click the Project
  drop-down menu?"* → *"With the same amount of clicks as before, from Side
  Navigation, click Projects > Projects List."* A vendor with a large AEC
  base looked at a global switcher, judged it not worth its cost, and
  defended the removal on **click-count parity**.
- **Executive dashboard**: yes, explicitly positioned as the **entry point**
  to any portfolio review — Projects Overview shows active-project count,
  residual fee, revenue forecast, recovery, gross profit, sliceable by
  Office/Discipline/Cost Centre/Slice. Documented drill-down ladder: *"Use
  Projects Overview as the first screen... drilling into detail... use
  Portfolio Summary to find which offices or PMs are driving it, then
  Projects Snapshot or Project Summary for the individual projects."*
  Right-click → Drill Through → Project Detail.
- **Process/stage**: **Stage is a first-class data dimension**, not a board
  — Stage Status, Stage Discipline, Stage Cost Centre are filter axes/metric
  qualifiers (e.g. "Recovery excludes no-billing stages"). Inside a project,
  Breakdown and Schedule are separate tabs; clicking a coloured status
  bubble updates project status. They also removed the old stats bar in
  favour of "dashboards inside the project."
- **Job switching**: global Search, Projects List, My Work. Per-project
  dropdown deliberately removed.
- **Permissions**: fixed access tiers + up to 6 custom roles. "Assistant
  Project Manager" can create projects/stages/tasks but never sees costs or
  financial reports; "Project Manager" adds invoicing but still no
  salary/cost data. Actuals/profitability gated to Director+ only.

### ArchiOffice (legacy — treat as historical evidence only)

BQE: "ArchiOffice is a legacy product... We no longer actively sell
ArchiOffice." Migrating customers go through full re-orientation.

- **Nav**: nav bar between modules + Dashboard.
- Two ideas worth keeping: **"Portals"** — sub-tabs (e.g. on Contacts,
  Projects) that surface related info from elsewhere, using the same widget
  vocabulary as the Dashboard (a consistency idea that survives into
  Rapport3's panels); and the **Record Navigator** — prev/next links at the
  bottom of list screens (Contacts, Time/Expense, Projects) to page through
  a found set. Cheapest job-switching affordance of any product researched:
  no rail, just prev/next within your current filtered result, carried into
  the detail view.
- **Process/stage**: could not verify (only migration-mapping evidence:
  "Additional Services" → Projects/Phases in Core; Projects/Tasks → Activity
  Items).

### Mosaic

**The one product whose primary workspace is genuinely close to a
persistent rail + job detail design.**

- **Nav**: left sidebar of "spaces" — Planner, Workload, Budget, Project
  Management. Permission-gated.
- **All-jobs list**: **persistent left project list beside a timeline** —
  but critically, the right pane is not "one job's detail," it's a
  cross-project grid whose **rows are the projects themselves** (each
  expandable to show team members, open roles, work plans on the timeline;
  you can select multiple projects to view side by side). Comparison across
  jobs is the actual task, so co-presence is the point — not navigation.
  Paired with a member-centric mirror ("Workload" = same data, member
  perspective) and a split view fusing both for capacity checking.
- **Executive dashboard**: could not verify a firm-level KPI dashboard.
  Portfolio-level views found: Workload's capacity heat-map, and a Budget
  "Progress Chart" (Hours, Spent/Planned, Scope, Billing, Invoiced).
  Project-profitability/billing/revenue forecasts marked "Coming Soon."
- **Process/stage**: phase bars, milestones, baselines, dependencies
  (Blocking/Waiting On/Hold), sub-phase toggles, per-phase gauge (hours
  logged+staffed / hours planned) with a "rebalance hours" action. No
  kanban. "Gantt View" listed as Coming Soon (current timeline = schedule
  bar chart, not dependency-linked Gantt).
- **Job switching — best-documented pinning model found**: a **Starred
  portfolio** ("your personal shortcut list, always at the top... Starring
  does not move the project — it creates a shortcut"), a **My Projects**
  auto-list (projects you've logged time to or have future plans on),
  search by name *or* number, filters (PM/client/portfolio/status), and
  grouping switchable between Portfolios (default) / Members / All Projects
  — "All Projects" is one option among several, not the default. Repeated
  advice: "Star your active projects so they load instantly."
- **Permissions**: fixed access levels. Base Member/Work Planner can fully
  plan and edit work but see budgets only in **hours/%, never dollars**;
  a Budget Manager tier adds $ visibility.

### Harvest + Forecast

- **Harvest nav**: sidebar — Timesheet (Day/Week/Calendar + approval),
  Projects, Invoices (+ Configure), Reports ("analysis hub" — Time, Budgets,
  Expenses, Team capacity, Invoices). Deliberately simplified IA in a recent
  redesign ("a simpler way to move through Harvest").
- **All-jobs list**: list → detail with drill-down inside Reports (Reports >
  Time has Clients/Projects/Tasks/Team tabs; rows expand in place; "See full
  project report" link).
- **Executive dashboard**: could not verify a widget dashboard — closest
  portfolio artefact is the Projects page with Scheduled/Delta columns.
- **Process/stage**: **none.** Harvest has budgets and a progress graph but
  deliberately does *not* model process/stage at all — useful as the
  clearest contrast case: same core objects (time, projects, invoices), no
  process representation.
- **Forecast layout**: Projects view (alphabetical by client, expandable to
  assignments) or Team view; Day/Week/Month zoom; a clock icon reveals
  remaining budgeted hours (greyed, linked to Harvest). Same structural
  family as Mosaic Planner: persistent left entity list + right timeline,
  entity/person toggle.
- **Job switching**: could not verify a command palette, recents, or
  pinning in either product.
- **Permissions**: fixed roles + optional flag. Members never see rates;
  Managers get an *optional* "see/edit billable rates and amounts"
  permission layered on top of normal project/task management.

### Productive.io

- **Nav**: dashboard is the landing screen (switchable via dropdown).
  Verified modules: Tasks, Projects, Deals, Budgets, Contacts, Invoices,
  Company Time, Docs, Resourcing, Reports, Expenses, Purchase Orders,
  Employees.
- **All-jobs list**: list → detail, but **the most user-configurable detail
  view found** — each project has a tab bar where **each tab is a saved
  view** (Tasks/Docs/Deals/Budgets/Invoices/Forms/Expenses/POs/Scenarios/
  Time/Reports/Feed). Public views auto-pin for everyone; **private tabs
  appear only for their creator**. A second, collapsible project sidebar
  (top-right) holds General info/Workflows/Custom fields/More actions —
  i.e. frequent data → horizontal tabs, settings/metadata → collapsible side
  panel.
- **Executive dashboard**: yes — multiple, switchable, shareable dashboards;
  widgets from reports or templates; auto-refresh every 60s; full-screen
  mode for widget-heavy setups.
- **Process/stage**: **Workflows** = sets of task statuses applied per task
  to organise work "in phases" (default: task started / task closed;
  custom workflows configurable). Reports cover "project progress, stages,
  last activity, profit, margins." Kanban is available as a *view option*
  on tasks, not the primary frame.
- **Job switching**: views dropdown + saved views. No command palette
  verified.
- **Permissions**: fixed permission sets. Staff/Coordinator manage tasks
  with **zero financial visibility**; Manager sees budget usage but not
  cost/profit; Profitability Manager adds profit/revenue; **only Admin**
  sees cost rates.

### Scoro

- **Nav**: sidebar of modules incl. Dashboard, Projects. Projects has three
  distinct surfaces: project list, project timeline view, individual
  project view.
- **All-jobs list**: list → detail, but with **two different portfolio
  views**. The project list: table, filter/group/sort, column chooser, live
  summary bar of key metrics. Quote: *"The project list gives an overview of
  projects by stages"*; *"the project status lets you quickly understand at
  what stage a project is right now."* The **project timeline view** is a
  portfolio Gantt — all future/in-progress projects on one graph, expand a
  project to reveal phases/milestones, colour-coded progress bars, zoom
  week/quarter/year.
- **Project view**: reorderable, hideable tabs (gear icon) — Tasks, Budget,
  Time, Bookings, Finances, Details, Comments. Tasks has sub-tabs: Task
  list, **Gantt chart**, **Task board** (kanban), Events, Calendar.
- **Executive dashboard**: yes — widgets, result metrics, **ratio metrics**
  (ratio between two results), charts, drag-and-drop, resizable dashlets,
  multiple named dashboards, a dashboard library.
- **Process/stage**: **the only product researched that ships all four
  representations at once** — status/stage column (groupable list), a
  phase+milestone Gantt, a kanban Task board, and a portfolio timeline. If
  you genuinely don't know which representation a practice needs, Scoro's
  answer is "ship all of them, let firms hide what they don't use" (tabs are
  user-hideable).
- **Job switching**: could not verify command palette or pinning.
- **Permissions**: modular permission sets. `View project income and cost`
  and `View labor cost of other users` are separate flags — someone can see
  hours/quantity progress on a budget without ever seeing $ or cost.

### Karbon

- **Nav**: side menu — Triage, Work, Contacts, Insights, Timesheets, My
  Week, profile. Unread-count badges on Triage.
- **All-jobs list**: list/board → detail — "Work" is a **Kanban board or
  list view**, saved views (reorderable/renamed/deleted/shared). Real
  client-first axis: contact pages carry their own work list, remembered
  column config, completed work hidden by default.
- **Executive dashboard — two different things both called "dashboard,"
  and the distinction matters:**
  1. **Insights** — real analytics: Client/Colleague Leaderboards
     (drillable to per-entity sub-charts), and a **work-status sub-chart**
     showing "the average number of days work is spent in each primary
     status," expandable to *sub*-status — explicitly "to identify
     bottlenecks."
  2. **"Work dashboards"** — not charts at all, **saved filtered Kanban
     views** (e.g. "Partner Dashboard: filter Client Owner = you, sort by
     Due Date"; a bottleneck dashboard filtered to "Waiting On Us" statuses;
     "New Deal Dashboard: filter Work Type = Sales-Pipeline"). **Karbon's
     "executive view" is a saved filter over the same board everyone works
     in — one IA, many lenses**, not a separate screen with different
     components.
- **Process/stage — the strongest process-championing found, by a wide
  margin, and it's a closed loop, not just a board**:
  - Fixed **primary** status spine (Planned → Ready To Start → In Progress
    → Waiting → Complete), controlled across all Karbon accounts, plus
    editable **secondary** statuses scoped per work type.
  - Each work item is itself a checklist (task sections → tasks, subtasks,
    **client tasks**, checklist items, from templates).
  - **Automators** auto-advance status (e.g. move to In Progress when the
    first task completes; change due date when all client tasks complete;
    reassign tasks when status changes) — every firing logs to the work
    timeline.
  - Templates define the process → automators advance it → the kanban
    displays it → Insights measures days-in-status to find where it stalls.
- **Job switching**: saved/shareable/reorderable views, top-right search,
  unread badges. Triage offers **two densities** — an Outlook-style 3-column
  Split view, and a compact list view with reduced row height — toggleable
  any time, kept as two options even after 6 months of beta with hundreds
  of customers rather than picking one. No command palette verified.
- **Permissions**: `View dollar amounts` is a single on/off switch,
  orthogonal to "who can create/edit/delete work."

### Xero Practice Manager

- **Nav**: Clients / Jobs tabs; Jobs opens the Job Manager. Vocabulary: job
  categories, states, tasks; job templates; recurring jobs.
- **All-jobs list**: list → detail, with **documented context-loss pain** —
  a Xero product-ideas thread: switching between Clients and Jobs tabs after
  a session timeout "is taking them to random different areas of XPM instead
  of back to where they were." (An auth bug, but illustrates the failure
  mode list→detail is exposed to that sticky-selection models aren't — every
  tab switch is a chance to lose your place.) Users separately asked for
  **custom/hideable columns** on the Job Manager grid, not for a permanent
  rail.
- **Executive dashboard**: could not verify.
- **Process/stage**: job states + template-generated task checklists. Could
  not verify a kanban board by job state.
- **Permissions**: not covered in the RBAC pass (not in that product list).

### Ignition

Incomplete entry — only job-creation behaviour verified, not top-level nav
or whether it has a pipeline board.

- Proposal editor is a **stepper**; its Automation step is a wizard for
  "One workflow per proposal" vs "One workflow per project," mapping service
  templates to XPM job templates.
- Notable IA move: **moved workflow management out of the proposal and onto
  the client** — a "Workflow" tab lets you deploy a job or set up a
  recurring frequency independent of any proposal, with "a complete picture
  of all the job templates in use for each client" under the Client view.
  Client-first, jobs as children — the Karbon shape, not the project-
  register shape.

### Linear

- **Nav**: sidebar — Inbox, My Issues, Active issues, Backlog, Board,
  Projects, Cycles, Views (custom), Teams, Favorites.
- **Job-switching — richest set found, and all *on demand*, never
  persistent**:
  - **Command menu (`Cmd/Ctrl K`)** — search any issue/feature or take any
    action; context-ranked ("if you're looking at cycles, the menu shows
    cycle-related commands first"). Linear's own guidance: build a habit of
    hitting it "before taking any action in the app, period."
  - `O` + key opens a specific entity type from anywhere (`O P` project,
    `O C` cycle, `O F` favorite, `O U` user).
  - Favorites (star anything), `/` for search.
- **List/board switching**: `Cmd/Ctrl B` toggles list/board on issue views;
  `Shift V` opens Display options (order/group/layout/columns), which can be
  saved **personally or as the workspace default**; manual ordering updates
  for everyone in the workspace. Projects/initiatives support list, board,
  and timeline.
- **Process**: status-based workflow; group-by-status; board columns by
  status; timeline for projects.
- **Transferable principle**: the sidebar holds **saved lenses** (Active,
  Backlog, Views, Favorites), never the full item list — reaching a
  specific item is the palette's job, not navigation's.
- **Permissions**: coarse — Admin/Member/Guest scoped by team/list
  membership, no field-level money concept at all (Linear doesn't carry $
  data). Useful mainly as a reminder that pure work-tracking tools don't
  need a money-visibility axis — not a counter-argument to having one where
  you do carry $ data.

### Height

- **Nav**: collapsible sidebar — Inbox, Teams, lists (flat, no hierarchy —
  "all presented on the same level"), Views, recently-opened tasks;
  workspace switcher bottom-right.
- **Two affordances directly relevant to a job-detail question**:
  1. **Task preview pane that doesn't replace the list** (`Cmd+Return`
     opens a right-side preview; `Cmd+Shift+Return` goes full screen) — two
     levels of detail commitment from the same list, preview beside or
     expand over.
  2. **Per-list visualisation switching, explicitly treated as disposable**
     — "You can switch visualizations constantly on any list type... we
     often do it during meetings to get a different perspective. As long as
     you don't save your changes, nothing happens." Options: spreadsheet,
     list, board/kanban, calendar, Gantt (number keys 1–4 switch views).
- **Command palette**: `Ctrl K` — everything across Height, incl. changing
  visualisation, task attributes, dark mode, workspace. Custom keyboard
  shortcuts supported.
- **Process**: kanban by status (editable columns, subsectioning) + Gantt
  with dependencies + an "Auto" button for autonomous housekeeping,
  configurable per Team/Project/List/View.
- **Permissions**: same as Linear — coarse Admin/Member/Guest, no $ concept.

---

## Part 2 — Synthesis (from the navigation deep dive)

### Comparison table

| Product | All-jobs list while in one job | Primary "where are we" device |
|---|---|---|
| Monograph | No — index→detail | Phase Gantt + Money Gantt burn bar |
| BQE Core | No — List View / Detail View | WBS ("Structure") + status column |
| Deltek Ajera | **Yes** — list + detail in Project Command Center | WBS project tree; status cascades to phases |
| Deltek Vantagepoint | Selection is *sticky* across hub applications | WBS levels + status + warning indicators |
| Rapport3 | Drill-in overlays from Home dashboard | Could not verify (QA tasks / gateway docs exist) |
| Total Synergy | No — switcher deliberately removed | Stage as data dimension + status bubble |
| ArchiOffice (legacy) | No — record navigator pages the found set | Could not verify |
| Mosaic | **Yes** — project list beside timeline | Phase bars, milestones, dependencies, per-phase gauges |
| Harvest + Forecast | No (Forecast: persistent project list + timeline) | None — budget burn only |
| Productive.io | No — per-project saved-view tabs | Workflows as "phases"; stage reporting |
| Scoro | No — but two portfolio views | All four: status, Gantt, kanban board, portfolio timeline |
| Karbon | No — board/list→detail | **Status spine + task checklists + automators** |
| Xero Practice Manager | No — Clients/Jobs tabs | Job states + template task lists |
| Ignition | Could not verify | Proposal stepper; client Workflow tab |
| Linear | No — sidebar holds lenses, not items | Status workflow; board columns |
| Height | Preview pane beside the list | Kanban / Gantt, switchable per list |

### Two schools for "process championing"

1. **Status-pipeline school** — Karbon, Scoro's task board, XPM job states,
   Linear, Height, Productive workflows. Organising question: *which bucket
   is this in, and who is blocking it.* Karbon is the most complete because
   it closes a loop: fixed status spine → checklist inside each item →
   automators that advance status → Insights that measures days-in-status.
   This fits accounting practice management well because a job (e.g. a tax
   return) is short, repeating, template-identical, and cleanly done/not
   done — stage is genuinely the most informative fact about it.

2. **Phase-timeline-with-money school** — Monograph, Mosaic, Ajera,
   Vantagepoint, Scoro's Gantt, Total Synergy. Organising question: *how
   much of this phase's fee is consumed, and are we there in time.*
   Monograph's Money Gantt is the purest expression. **No AEC product in
   this research makes a kanban-by-stage its primary project surface** —
   because architectural phases are contractual, sequential, individually
   priced, and can overlap (a job can be 80% through DD on fee while CD has
   already started; kanban's one-column-per-item constraint destroys that
   information). Where AEC products do treat stage as first-class, it's as
   a **data dimension** (filter/metric qualifier — Total Synergy's Stage
   Status/Discipline/Cost Centre), not a board layout.

**Implication drawn for this app**: a rail sorted by worst realisation is
closer to the AEC consensus than to Karbon — it champions financial process
position, not workflow stage, which fits phase-based fee scales. But every
AEC product expresses risk as **filtered views/per-phase indicators
reachable from a portfolio surface**, not as a permanent ranking — risk
ranking is a query, and queries belong on a dashboard, not baked into
navigation. Scoro is the one product that ships every representation at
once with hideable tabs, as a hedge for "we don't know which one we need."

### Persistent rail vs list→detail — the trade-offs, with evidence

- **Only two products put a persistent all-jobs list beside a detail
  pane** — Mosaic's Planner and Ajera's Project Command Center — and in
  both, the right pane isn't "one job's detail," it's a grid whose **rows
  are the projects**. Cross-project comparison *is* the task, so
  co-presence is the visualisation, not navigation. A layout where the rail
  is pure navigation (pick one job) and the main pane shows just that job's
  tabs is **the configuration the evidence least supports** — neither
  Mosaic nor Ajera is a precedent for it.
- **Three vendors give direct evidence against a permanent global job
  switcher**: Total Synergy removed one and defended it on click-count
  parity; Xero users asked for *custom/hideable columns*, not a fixed rail;
  Mosaic pins a personal *subset* (Starred, My Projects), not the full list
  — "All Projects" is one grouping option among several, not the default.
- **The strongest argument *for* a persistent rail** is real: losing your
  place / re-establishing context on every tool switch (see the Xero
  complaint). **Vantagepoint's sticky selection** solves exactly this at
  zero horizontal cost — pick a project once, it persists as you move
  between hub applications, including the selected WBS element.
- **The scaling problem every vendor solved that a fixed list doesn't**:
  every product assumes the all-jobs list needs filtering, saved views, and
  personal subsets, because practices have more jobs than fit on a screen
  (Monograph: 5 filter types + shareable "Copy Filtered View"; Mosaic:
  search by name/number, multi-filter, 3 groupings, starring; Karbon: saved
  shareable views; Scoro: filter/group/sort/column chooser/summary bar). A
  risk-sorted list is one view; these ship the machinery for many. Also
  worth noting: **a rail that reorders itself as work happens defeats
  spatial memory** — every product offering pinning (Mosaic Starred, BQE
  Favorites, Linear Favorites) offers a *stable* position precisely because
  users rely on location memory.
- **Where a persistent rail genuinely wins, undisputed**: bulk triage,
  comparison, rapid sequential inspection. Ajera's answer is instructive —
  rather than one screen doing both jobs, it ships **two** surfaces over
  the same data (fast inline bulk-edit grid + deep single-project Command
  Center). Karbon similarly ships two Triage densities (3-column Split view
  vs compact list) and kept both even after 6 months of beta testing.

### Relevant UX/IA literature cited in the research

- **NN/g, [Left-Side Vertical Navigation on Desktop](https://www.nngroup.com/articles/vertical-nav/)** — vertical left nav "can accommodate as many top-tier items as needed"; users look at the left half of the screen 80% of the time. Cost: less room for content, taller pages.
- **NN/g, [Menu-Design Checklist: 17 UX Guidelines](https://www.nngroup.com/articles/menu-design/)** — primary nav in apps belongs on the left; "Provide Local Navigation Menus for Closely Related Content... rather than forcing users to pogo-stick up and down your hierarchy."
- **NN/g, [Short-Term Memory and Web Usability](https://www.nngroup.com/articles/short-term-memory-and-web-usability/)** — the "7-item rule" for menus is a myth: "the entire idea of a menu is to rely on recognition rather than recall... if you make a menu too short, the choices become overly abstract and obscure."
- **[UX Myths #23](https://uxmyths.com/post/931925744/myth-23-choices-should-always-be-limited-to-seven)** — collects counter-evidence to the "7 items" rule, incl. Tufte's critique of the underlying memory studies.
- **Microsoft [List/details pattern](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details)**, **[Android canonical layouts](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts)** — list-detail is a *content* pattern with an explicit side-by-side-vs-stacked decision based on width, requiring a visible selection state. Android guidance explicitly separates this from navigation: "Navigation Drawer is for navigation only and not for displaying a master list with corresponding detail."
- **NN/g, [The Anatomy of a List Entry](https://www.nngroup.com/articles/list-entries/)** — treat each row like a mini-webpage; top-left gets the most attention; keep placement of corresponding fields consistent across rows so users can compare.
- **NN/g, [Data Tables: Four Major User Tasks](https://www.nngroup.com/articles/data-tables/)** — "A nonmodal side panel allows for the full display (and editing) of a single record while still allowing the user to view the rest of the table's data" (this is what Height's preview pane and Rapport3's drill-in overlays are doing).
- **NN/g, [Basic Patterns for Mobile Navigation](https://www.nngroup.com/articles/mobile-navigation-patterns/)** — a navigation hub "incurs an extra step... for each use." Works fine when users stay in one branch per session; costly when they sweep across many branches (Linear/Height's command palette exists specifically to avoid this cost).
- **NN/g, [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)** and **[Information Scent](https://www.nngroup.com/articles/information-scent/)** — get the split right between what's shown up front vs. what requires a click; label links so their likely payoff is obvious.
- **NN/g, [Dashboards: Making Charts and Graphs Easier to Understand](https://www.nngroup.com/articles/dashboards-preattentive/)** and **[Choosing Chart Types](https://www.nngroup.com/articles/choosing-chart-types/)** — use length/2D position (bar/line/scatter) because they're processed pre-attentively; avoid pie/donut/gauge/radar/3D and treemaps on dashboards.
- **Bach et al., "Dashboard Design Patterns," IEEE TVCG 29(1), 2023** — systematic review of 144 real dashboards: 61% single page, details-on-demand in 71%, drill-down in 55%, cross-page nav in 76%, personalisation in only 23%. Recommended design sequence: data/info → structure → visual representation → page layout → screen space → interactivity.

### Explicitly "could not verify" (from the navigation research — don't treat as settled)

- G2/Capterra screenshots and YouTube demo descriptions were not retrieved for any product.
- Whether Vantagepoint ever shows list and detail simultaneously (only sticky selection + a list/detail toggle confirmed).
- A command palette in any practice-management product other than Linear and Height.
- Rapport3's stage/process UI, and its job-switching affordances generally.
- A firm-level executive KPI dashboard in Mosaic.
- A widget-style dashboard in Harvest, or any dashboard in Xero Practice Manager.
- Whether XPM offers a kanban by job state.
- Ignition's top-level nav and whether it has a pipeline board.
- Monograph's complete, exact sidebar label list (pieced together from multiple articles, not stated in one place).
- Any product that sorts a persistent navigation element by a risk/profitability metric — none found; risk ranking always appeared as a filter, widget, or index-page sort.

---

## Part 3 — Permissions / role-based access research

Research question: should the same project show different things to
different people — e.g. an employee can add a task, log time, pick an
activity type, view/edit a drawing, but not see the fee, tariff, or
billed/cost amounts?

**Headline finding: yes, decoupling money visibility from operational
editing is the dominant, near-universal pattern.** The one deliberate
exception is Monograph (see above). Two implementation styles recur:

| Tool | Style | How money is gated separately from work |
|---|---|---|
| **BQE Core** | Granular toggles on a security profile | `Allow read rate` / `Show bill rate` / `Show cost rate` are independent checkboxes from time-entry/task edit rights. "Manage Access" can hide $ per-screen (Budget, Fee Schedule) while task/activity access stays intact. |
| **Deltek Vantagepoint/Ajera** | Role-based, per-module | Labor cost access has 4 levels (Full / Subtotals only / Final totals only / None) independent of project/task edit rights. Full cost access flagged as revealing salaries — grant carefully. |
| **Total Synergy** | Fixed access tiers + custom | "Assistant Project Manager" creates projects/stages/tasks but never sees costs/financial reports; "Project Manager" adds invoicing but still no salary/cost data. Actuals/profitability gated to Director+ only. |
| **Karbon** | Toggle on top of role | `View dollar amounts` is a single on/off switch, orthogonal to "who can create, edit, delete work." |
| **Scoro** | Modular permission sets | `View project income and cost` and `View labor cost of other users` are separate flags; hours/quantity progress visible without $ or cost. |
| **Mosaic** | Fixed access levels | Base Member/Work Planner fully plans/edits work but sees budgets only in hours/%, never dollars; Budget Manager tier adds $ visibility. |
| **Harvest** | Fixed roles + optional flag | Members never see rates; Managers get an *optional* "see/edit billable rates and amounts" permission layered on top of normal project/task management. |
| **Productive.io** | Fixed permission sets | Staff/Coordinator manage tasks with zero financial visibility; Manager sees budget usage but not cost/profit; Profitability Manager adds profit/revenue; only Admin sees cost rates. |
| **Monograph** (exception) | Fixed roles, deliberately coupled | Anyone with edit access to a project sees its rates and budget — no separation, by design; customer requests for separation declined. |
| **Linear / Height** | Coarse, not domain-specific | Admin/Member/Guest scoped by team/list membership only, no field-level money concept — these tools don't carry $ data at all, so not really comparable; useful mainly as a reminder that pure PM tools don't need this axis. |

### The recurring shape, distilled

1. A **base role** governs *what you can do* — log time, add/strike tasks,
   pick activity types, attach/edit drawings, change status. Essentially
   "assigned to the project or not."
2. An **independent flag/tier** governs *what money you can see* — rate/
   tariff, budget/quoted amount, captured $ (vs. hours), certified/billed $,
   cost/margin, write-down amounts and reasons.
3. Several tools split money itself into **tiers rather than one switch**:
   hours/quantity always visible → billable $ visible with a flag →
   cost/margin visible only to the top tier (Mosaic, Productive, BQE, Scoro
   all do this three-way split). **Cost rate (what staff are paid) is
   almost universally the most locked-down field** — more restricted than
   billed/quoted amounts.
4. Write-down reason and certificate history tend to travel with the
   "billed $" gate, not the task-edit gate.

Note: this permissions research did not cover Rapport3, ArchiOffice, or
Xero Practice Manager (not asked about in that pass) — treat those as gaps,
not as "no permission model."

---

## Bottom line, both passes combined

- **Navigation**: the AEC-specific consensus is phase-timeline + money burn
  as the primary "where are we" device, not a kanban; a persistent all-jobs
  rail is only well-supported when the detail pane is itself a cross-project
  grid (Mosaic, Ajera) — otherwise sticky-selection (Vantagepoint) or a
  well-filtered dashboard (Monograph, Total Synergy) gets the same benefit
  without the permanent screen cost. Risk ranking belongs in a filter/
  dashboard widget, not baked into a fixed nav order.
- **Permissions**: decoupling "can edit work" from "can see money" (and
  further splitting money into hours → billed → cost tiers) is the
  practically universal pattern across this whole category. Monograph's
  refusal to do so is the one outlier, and it's a documented complaint
  point for their customers, not a design worth copying.
