# Brief: bringing practice operations to life

The customer said three things. There is no splash screen. There is no view where you see your projects the way Revit's Recent screen shows them. And screens such as **New job › Name the job** are correct but lifeless.

The users come from Revit. Keep what Revit's start screen does well: the drawing as the card, sort by date modified, a pin, and search. Then show what Revit cannot, because a job here is also money, time and a phase.

## What is there today

- **Palette and type.** Cream paper, ink, and one copper accent, with Fraunces over Source Sans 3. These are distinctive and stay.
- **Job page.** The tinted header band with a copper top edge and the job-code chip already reads as "a place you have entered".
- **Overview.** It already has a **Drawings** grid (`drawingsHtml`, 168 px tiles) and a **Recently opened** table. The tiles are small and sit near the bottom of a long page. Recently opened lives in memory (`state.recentIds`), so it is empty after every reload.
- **Most jobs have no drawing.** `drawingId` is null for most disciplines, and the code refuses a grey placeholder tile ("a picture of work that does not exist"). A Revit-style view therefore has to look good *without* a picture. The drawing is a bonus, not the card.
- **Sign-in.** `/` lands on practice ops, and its sign-in (`.gate`) is a plain cream form. The planner's dark ink-and-copper login (`--login-*` in `web/v2/v2.css`) is the most polished surface in the product, and practice users never see it.
- **One density everywhere.** Most text is 11–13 px. KPI values are 1.24 rem. Every border is a 1 px hairline, every radius 3–4 px, and every button 27–32 px. Nothing is allowed to be a moment.
- **No motion.** `practice.css` has one transition. Views, tabs, dialogs and saves swap instantly.
- **Inputs look disabled.** `.field input` fills with `--bg-primary`, the page colour, so a field on a cream card is beige on beige.
- **Copper does every job.** It is used for the primary button, the active tab, links, job codes, the "you are here" pill, kickers, flagged KPIs and sort arrows. When everything is copper, nothing leads.
- **Explanations are the same weight as content.** The `note-line` paragraphs are a deliberate voice and stay. But they are set at almost the same weight and width as the form or table they explain.

## Do not change

- The palette, the two typefaces, and the editorial tone of the copy.
- The settled practice-ops rules in `.cursor/skills/practice-ops/SKILL.md`, in particular: **show gaps, do not invent numbers.** A card for a job with no fee says "no fee", never "0%". A job with no drawing gets no fake picture.
- What any screen *does*. This brief is presentation only. No API, store or pricing change except the two small read-only fields named in Phase 2.
- Keyboard paths: Ctrl K, Escape, and tab order.

## Phase 0 — foundation

Everything later is built from these. On their own they should make the app look slightly more finished and nothing more.

**Shared tokens.** Create `web/shared/tokens.css` and load it before `practice.css` (and, in Phase 5, before `v2.css`). It holds:

- **Colour.** The existing palette, unchanged. Add `--field-bg: #fffdf8` and `--focus-ring: 0 0 0 3px var(--copper-tint-16)`.
- **Colour roles.** Each colour gets one job:
  - Copper is for the primary action, the "you are here" state, and flagged money.
  - Navy (`--navy`, already defined, unused) is for links and link-buttons.
  - Job codes and inactive tabs use ink.
  - Green and amber stay as status.
- **Radius.** `--radius-sm: 3px` for controls, `--radius-lg: 8px` for cards, frames and dialogs.
- **Depth.** `--lift-1` is a resting card: 0 1px 2px plus 0 2px 8px at 6% ink. `--lift-2` is a hovered card or menu: 0 4px 16px at 10% ink. `--lift-3` is a dialog: 0 18px 40px at 14% ink.
- **Motion.** `--ease: cubic-bezier(.2,.7,.2,1)`, `--t-fast: 120ms`, `--t: 200ms`, `--t-slow: 360ms`.
- **Reduced motion.** One `@media (prefers-reduced-motion: reduce)` block sets every duration to 0.01 ms.

**Fixes that use them.**

- `.field input`, `select` and `textarea` get `--field-bg` with `--hairline-strong`. On focus they get a copper border plus `--focus-ring`.
- `.btn`, `.chip`, the tabs, `.kpi`, the table rows and `.dwg-frame` all transition background, border-colour, box-shadow and transform over `--t-fast`.
- `.link-btn` and `.crumbs button` move from copper to navy. `.code-cell` and `.crumb-code` move from copper to ink, at weight 700.
- `.note-line` and `.composer-lead` cap at 62 ch and use `--ink-muted` at 12 px, so they read as margin notes.

**Acceptance.** Every input on every screen reads as a field at a glance. Only the primary action, the current job, and flagged money are copper. Turning on reduced motion in the OS removes all motion.

## Phase 1 — splash screen and sign-in

**Splash.** It is a placeholder until the customer sends artwork, so it must be one swappable asset.

- **Markup.** `<div id="splash">` is the first child of `<body>` in `web/practice/index.html`. It holds a centred `web/shared/splash/mark.svg` (for now, the "S" brand mark at 72 px), the name **StudioPractice** in Fraunces at 1.6 rem, and a 160 px copper progress hairline under it.
- **Look.** The background uses the planner's login: `--login-bg` ink with a radial `--login-bg-glow` behind the mark.
- **Timing.**
  - It stays until three things are done: fonts are loaded (`document.fonts.ready`), the session is checked, and the first `renderMain()` has painted.
  - It then fades out over `--t-slow` and is removed from the DOM.
  - It shows for at least 600 ms, so it never flashes.
  - It is skipped when the same tab reloads within the session (`sessionStorage`).
- **Signed out.** The splash cross-fades into the gate instead of fading to cream.
- **Replacing it.** Changing the artwork means swapping `mark.svg`, plus optionally a `--splash-art` background image. No code change.

**Sign-in gate.** Restyle `.gate` to match the planner's login:

- The ink background with the glow continues from the splash.
- The form sits on a `--login-card-bg` card with `--radius-lg` and `--lift-3`.
- The mark and the product name sit above the form.
- The "Create a firm" toggle animates its extra field open rather than popping it.

**Acceptance.**
1. A cold load shows the splash, then the app, with no flash of unstyled or half-loaded content.
2. Reloading within the same session skips the splash.
3. Signed out, the splash leads into the dark sign-in. Signing in fades to the app.
4. Swapping `mark.svg` changes the splash and nothing else.

## Phase 2 — Jobs as a gallery

This is the Revit Recent screen, made for jobs. **Jobs** gets a **Cards / List** toggle at the left of its toolbar, the same control as Revit's. **List** is today's table, unchanged. **Cards** is the new default. The choice is remembered per user in `localStorage`.

**The card** is 232 px wide, with `--radius-lg` and `--lift-1`. Hovering lifts it by 2 px to `--lift-2`. Top to bottom:

1. **Picture area, 150 px high.**
   - **With a drawing,** it shows the existing `drawPreview` canvas at card size, with a faint blueprint grid behind the plan.
   - **Without a drawing,** it is a title block, never a grey box. The job code is large (Fraunces, 2 rem) on a band tinted by project type, with the type name small underneath. This is a fact about the job, not a fake picture.
   - **A started but empty drawing** keeps the existing hatched paper.
2. **Code and description.** The code is in ink at weight 700. The description takes at most two lines, with an ellipsis.
3. **Client** in muted text, then **Edited** with a relative date ("2 days ago").
4. **Phase strip.** A 4 px bar across the card's bottom edge, one segment per phase. Done phases are ink, the current phase is copper, and future phases are hairline. A job with no phase list has no strip.
5. **Badges, top right of the picture.**
   - The fee badge reuses `.real` and keeps the same null rule: no fee means "no fee".
   - A copper dot appears for any warning the register already derives (over fee, worked never billed, on hold). Its tooltip names the warning.
6. **Pin, top left, visible on hover.** Pinned cards go into a **Pinned** row above everything else. Pins live in `localStorage` keyed by user and org in this phase. This is not `offline_pinned_at`, which means something else.

**Layout.**

- **Groups.** Cards are grouped into Pinned, This week, This month, and Older, by date edited. With any other sort, the groups collapse into one grid.
- **Toolbar.** The existing search box and filter chips stay and filter cards exactly as they filter rows. The sort control is a select: **Date edited** (default), Code, Client, Risk order.
- **Loading.** Cards fade up in a 20 ms stagger, capped at the first 24. Canvases paint when a card scrolls into view (`IntersectionObserver`), so 115 jobs stay cheap.
- **Opening.** Clicking a card opens the job. Double-clicking a card that has a drawing opens the planner, the way Revit opens a model.

**Two read-only fields.**

- **`lastEditedAt` on each register row.** The later of `project.updated_at`, the drawing's `updated_at`, and the latest time entry's `created_at`. Without it, "Date edited" would lie for a job that is only having time logged against it.
- **Recently opened persists.** `state.recentIds` moves to `localStorage` so it survives a reload.

**Overview** replaces its **Drawings** grid and **Recently opened** table with one **Recent** row: the six most recent cards, then **All jobs →**. The firm-wide KPIs and reports stay above it.

**Acceptance.**
1. Jobs opens in Cards and remembers List if you chose it.
2. A job with no drawing shows its title block, not an empty frame. A job with an empty drawing shows hatched paper. A job with a drawing shows its plan.
3. A job with no fee shows "no fee". D063 shows its over-fee dot. A job with no phases has no strip.
4. Pinning P074 puts it in Pinned, and it stays there after a reload.
5. Logging time on a job moves it to the front of "This week".
6. Search and filter chips give the same jobs in Cards and in List.
7. With 115 jobs, scrolling stays smooth and canvases paint as they arrive.

## Phase 3 — the New job composer

The screen in the customer's screenshot. Its content and order stay. Its staging changes.

- **Two columns at 1,000 px wide and above.** The form is on the left. On the right is a live **job card**: the Phase 2 card at 1.3× scale, filling in as the user types and chooses.
  - The code and description appear on the title block as they are typed.
  - The type tints the band.
  - Billing adds the fee badge, or "no fee".
  - The client fills the client line.
  - Below 1,000 px the card sits above the form at 0.8× scale.
- **Step rail.** The `.composer-steps` text tabs become a rail: numbered 22 px circles joined by a hairline. Done steps are ink with a tick, the current step is copper, and later steps are hairline. The line fills between steps over `--t`.
- **The form card.** It gets `--radius-lg` and `--lift-1`. Fields use Phase 0's `--field-bg`.
- **Explanatory copy.** The long note under the fields is cut to its first sentence. The rest goes behind **Why?**, a link-button that opens it in place. If the code clashes with an existing one, the note opens by itself and the clash is named in copper.
- **Changing steps.** The old step fades and slides 12 px left, and the new one comes in from the right, over `--t`.
- **Finishing.** On **Create**, the live card scales down and moves towards where it will sit in Jobs, over `--t-slow`. Then the job page opens, and its header band fades in from copper.

**Acceptance.**
1. Typing D063 and "Bon Accord township" shows both on the live card as they are typed.
2. The rail shows the step, its progress, and which steps are done. Keyboard users can still move between steps as they do today.
3. A duplicate code opens the note and names the clash.
4. With reduced motion, steps and the finish swap instantly, and nothing is lost.

## Phase 4 — Overview and job page

- **Greeting.** Overview opens with one Fraunces line at 1.8 rem, written from data that is already loaded. For example: "Good afternoon, Anna. Two jobs are past their fee." It says "Everything agrees." when nothing is flagged. A muted date line sits under it.
- **KPIs.** Values go to 2 rem Fraunces. On first paint each session they count up over `--t-slow`. A `null` value is never animated and shows its gap text. Flagged tiles keep the copper tint and gain `--lift-1`.
- **Fee bars.** They grow from zero to their width on first paint, over `--t-slow`.
- **Job header.** The drawing thumbnail grows from 164×100 to 240×150 with `--radius-lg`. A job with no drawing shows its title block at that size.
- **Tabs.** Changing tab cross-fades the panel over `--t-fast`.
- **Empty states.** Each `.empty` gets a small line drawing above its text, in ink at 40%, one stroke weight. Six are needed: a plan outline (no jobs), a clock (no time), a certificate (no certificates), a ticked list (nothing to flag), a magnifier (no match), and a pencil on paper (empty drawing). They are stored as inline SVG in `web/shared/illustrations/`. The text stays. The primary action, where there is one, becomes a real button under it.
- **Small confirmations.** Logging time ticks the row in green and fades it into the list. Issuing a certificate shows a stamp-style **Issued** mark on it, rotated 4°, for 600 ms.

**Acceptance.** These cases render:
- An empty firm.
- A job with no time.
- D063, which is over fee and never certified.
- P074, which has certificates and a write-down.

They render with the greeting, KPIs, empty-state drawings and title blocks, and no number is invented or animated from a null.

## Phase 5 — the planner joins up

- `web/v2/index.html` loads `web/shared/tokens.css`. `v2.css` keeps its own names and maps them to the shared tokens, so a palette change happens in one file.
- **Planner splash.** Opening a drawing from a job shows the Phase 1 splash with the job's code and description under the mark, instead of "Loading pack…". It stays until the pack is loaded and the plan has painted.
- **Back to the job.** The planner's top bar shows the job's code chip, styled as `#current-job.is-here`. Clicking it returns to the job page. One chip in both apps means the user is always in a job, whichever surface they are on.
- **Not here yet.** A dark theme for the planner is out of scope until the customer asks. The tokens make it a later palette swap rather than a rewrite.

## Order and size

| Phase | Depends on | Rough size |
|-------|------------|------------|
| 0 Foundation | — | ½ day |
| 1 Splash and sign-in | 0 | ½ day |
| 2 Jobs gallery | 0 | 2 days, including the two fields |
| 3 Composer | 0, 2 (card) | 1 day |
| 4 Overview and job page | 0, 2 | 1½ days |
| 5 Planner joins up | 0, 1 | ½ day |

Phases 1 and 2 are what the customer asked for and can ship together. Phase 1 swaps in the customer's artwork whenever it arrives.

## Verify in the browser

For each phase, exercise the flow rather than taking a single screenshot. Check:
- an empty firm;
- a firm with the seeded jobs (D063, P074, and the thin types W076, J065, P077, G025);
- an employee login, which cannot see billed figures;
- reduced motion turned on;
- a narrow window (about 900 px).
