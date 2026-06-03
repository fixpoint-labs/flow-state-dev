# Feature 03 — New Analysis button + modal

> Status: spec / not yet implemented
> Owner-direction required: this is the flagship example app (`examples/trading-desk`). Per the
> root oversight role, implementation work here needs explicit owner sign-off before merge.
> Scope: **UI only.** No flow, schema, or server changes are required by this feature.

---

## 1. Problem & outcome

### Problem

The "run an analysis" controls are crammed into the 44px header (`components/topbar.tsx`) as an
inline `<form>` between the brand mark and the theme toggle: a ticker `<input>`, a date `<input>`,
two `Segmented` toggles (`costPreset`, `dataSource`), and a Run button. The two optional thesis
fields (`userThesis` + `userThesisRationale`) are split off into a *different* place — the
`ThesesPane` empty-selection state (`components/theses/theses-pane.tsx` → `ThesisInput`). So the
single conceptual act "configure and start a run" is fragmented across two components and a
permanently-occupied header strip that has no room to grow.

This blocks the rest of v2: feature 4 (portfolio-aware analysis) needs an account/portfolio
selector on the *same* input surface, and there is nowhere to put it. The header is already full.

### Outcome

- A single **"New Analysis"** button in the header opens a dedicated modal that owns the entire
  run-input surface: ticker, date, `costPreset`, `dataSource`, and the two thesis fields.
- The header reclaims its space — only the button, brand mark, layout label, and theme toggle
  remain. The inline `<form>`, the two `Segmented` toggles, and the ticker/date inputs leave
  `TopBar`.
- The modal validates input (non-empty ticker, valid `YYYY-MM-DD` date, thesis length guidance)
  and submits via the **existing** resolve-or-create handshake (`handleRun`), so dedupe-by-tuple,
  title generation, and the `pendingDispatch` dispatch ordering are preserved exactly.
- The thesis fields move *into* the modal. `ThesesPane` no longer owns run-input — it becomes a
  pure report-output renderer (this is also a prerequisite for the feature 1 Past Reports
  read-only view, which reuses `ThesesPane` without a thesis form).
- The modal has an explicit, labelled, currently-empty **"Portfolio (coming soon)"** slot so
  feature 4 can drop an account/holding selector in with zero structural rework.

Success is verifiable by: (a) clicking "New Analysis" opens the modal; (b) filling it and
submitting starts a streaming run identical to today's header-form run (same session keying, same
SSE behavior); (c) a sub-20-char thesis still produces the soft Phase 6 warning; (d) the header no
longer contains any run-input fields; (e) `pnpm --filter @flow-state-dev/example-trading-desk
typecheck` and `test` pass.

---

## 2. Design decision: native `<dialog>`, NOT a route

Two implementation paths exist (the Understand phase flagged both): a real App Router route
(`app/analyze/page.tsx`) vs. an in-page modal.

**Decision: in-page native `<dialog>` modal**, mirroring the existing `SettingsDialog`
(`components/settings-dialog.tsx`). Rationale:

1. The run-input form must call `handleRun`, which lives inside `TradingDeskApp` and is entangled
   with the `pendingDispatch` effect + `useSession` rebinding. A separate route would need its own
   `FlowProvider` mount (the provider lives in `page.tsx`, not `layout.tsx`) and would have to
   *re-implement* the entire resolve-or-create + dispatch-ordering handshake. That handshake is
   subtle (two effects that fight each other via a guard) and duplicating it is the single biggest
   risk in this whole v2 set. Keep one copy.
2. `SettingsDialog` already proves the native-`<dialog>` pattern in this codebase: focus trap,
   scrim, Escape-to-close for free; driven imperatively from an `open` prop via `showModal()` /
   `close()`. Match it exactly — conformance over taste (project rule 8).
3. No routing scaffold exists today and this feature does not need one. Features 1 (Past Reports)
   and 3 (Portfolio) will introduce an in-page **view switcher** in `TradingDeskApp`; the modal is
   orthogonal to that and works under any view.

> Cross-feature note: do NOT introduce App Router routes as part of this feature. If features 1/3
> later add a view switcher, the "New Analysis" button stays in the header and remains reachable
> from every view. The modal does not care which view is active.

---

## 3. Data model / schemas

**No new schemas.** This feature is a pure relocation of existing fields plus validation. The
authoritative shapes already exist and are unchanged:

- `analyzeInputSchema` (`src/flows/trading-desk/flow-schema.ts`) — the action payload. Already
  carries `ticker`, `date`, `costPreset`, `dataSource`, `userThesis` (`.nullable()`),
  `userThesisRationale` (`.nullable()`). This is **not** a generator output, so BP-016 does not
  apply — its `.default()` / `.nullable()` usage is legal and stays as-is.
- `sessionStateSchema` (`src/flows/trading-desk/state.ts`) — frozen run config. Unchanged.
- The 20-char thesis gate lives in `seedSession` (`flow.ts`), server-side. **Do not** move or
  duplicate that gate into the client. The client may surface a *hint* about the 20-char threshold
  for UX, but the authoritative gate stays server-side (a sub-threshold thesis is treated as no
  thesis → Phase 6 skipped + `userThesisWarning` set). The status bar already renders
  `userThesisWarning` via `useClientData`.

### The client-side `AnalyzeTuple` (existing, unchanged)

The session-keying contract is the four-field tuple in `app/page.tsx`:

```ts
type AnalyzeTuple = {
  ticker: string;
  date: string;
  costPreset: CostPreset;     // "fast" | "full"
  dataSource: DataSourceMode; // "fixture" | "live"
};
```

`findSessionForTuple` matches it by strict `===` against `session.metadata`. `titleForTuple`
builds the browsable title (`TICKER · date · preset · source`). **These must not change** — the
Past Reports list (feature 1) and modal dedupe both depend on this exact metadata shape.

### Client validation shape (new, modal-local)

The modal owns a small local validation helper. Keep it inline in the modal file (single consumer
— no need to lift per BP-018). Suggested shape:

```ts
type DraftErrors = {
  ticker?: string;   // "Ticker is required"
  date?: string;     // "Use YYYY-MM-DD"
};
```

Validation rules (mirror what the server schema enforces + a date-format nicety the schema does
not):

- `ticker`: required, `.trim().length > 0`. Uppercased on input (the header already does
  `toUpperCase()` — preserve that). Block submit if empty.
- `date`: required, must match `/^\d{4}-\d{2}-\d{2}$/`. (`analyzeInputSchema` only requires
  `min(1)`, so format validation is a UX add, not a contract.) Block submit if malformed.
- `costPreset` / `dataSource`: always valid (segmented, can't be empty).
- `userThesis` / `userThesisRationale`: optional, `maxLength={1500}` on the textarea (matches the
  schema cap). **No** hard block on sub-20-char — instead show an inline *hint* ("≥ 20 chars to
  run the thesis audit") so the user understands why Phase 6 may be skipped. The server is the
  authority.

---

## 4. Server / persistence changes

**None.** This feature touches no server code, no store interfaces, no flow actions.

- Session creation still goes through `createSessionClient({ baseUrl: "" }).createSession({
  flowKind, userId, title, metadata })` (the existing direct-client call in `handleRun`, used
  because `flow.createSession` forwards only `metadata`, not a browsable `title`).
- The run still dispatches via `session.sendAction("analyze", { ...tuple, userThesis,
  userThesisRationale })`.
- Persistence (filesystem store, `createFilesystemStores`) is untouched.

For completeness, the store/HTTP surfaces this feature *relies on* (but does not modify):
`createSessionClient().createSession(...)` → `POST /api/flows/sessions`, and the existing
`sendActionStream` → action dispatch path. No new methods.

---

## 5. Flow changes

**None.** No new blocks, generators, sequencers, routers, schemas, capabilities, or presets.

The action payload, the `analyze` pipeline, `seedSession`, and the `client.expose` whitelist are
all unchanged. BP-011/012/014/016 and the capability model are not engaged by this feature because
it adds no flow code.

> If a reviewer asks "should the date-format validation be a server-side guard too?" — out of
> scope for this feature. The pipeline already tolerates arbitrary date strings (fixture mode
> ignores `args.date` and reads the pinned snapshot; live mode passes it through). Adding a server
> date guard is a separate change and not required for the modal to work.

---

## 6. UI changes

### 6.1 Component tree (after)

```
app/page.tsx
  Page                          (FlowProvider wrap — unchanged)
    TradingDeskApp              (owns all run-orchestration state — unchanged ownership)
      TopBar                    (SLIMMED: brand + New-Analysis button + layout label + theme)
      <main>
        ThesesPane              (NO LONGER takes thesisForm — pure report renderer)
        TranscriptPane          (unchanged)
      StatusBar                 (unchanged)
      SettingsDialog            (unchanged)
      NewAnalysisDialog   <NEW> (native <dialog>; owns the full run-input surface)
```

### 6.2 New file: `components/new-analysis-dialog.tsx`

A native `<dialog>` modal, structurally cloned from `SettingsDialog`. It is a **controlled,
stateless-about-persistence** component: the parent (`TradingDeskApp`) owns the field state (it
already does — `ticker`, `date`, `costPreset`, `dataSource`, `userThesis`, `userThesisRationale`
all live there). The dialog receives those values + change handlers + `open` / `onClose` /
`onSubmit` props.

> Why keep state in the parent rather than draft-inside-the-dialog (the way `SettingsDialog`
> drafts instructions)? Because `TradingDeskApp` *already* derives `tuple`, `matchedSessionId`,
> and `isExistingSession` from these fields, and drives the active-session-sync effect off them.
> Moving the source of truth into the dialog would break that derivation and the auto-select sync.
> Pass them down; let the parent stay the owner. (`SettingsDialog` drafts because its fields have
> no parent-side derivation — different situation.)

Props:

```ts
type NewAnalysisDialogProps = {
  open: boolean;
  onClose: () => void;

  // Identity tuple (controlled by parent)
  ticker: string;
  date: string;
  costPreset: CostPreset;       // import type from "@/components/topbar"
  dataSource: DataSourceMode;
  onTickerChange: (v: string) => void;
  onDateChange: (v: string) => void;
  onCostPresetChange: (v: CostPreset) => void;
  onDataSourceChange: (v: DataSourceMode) => void;

  // Optional thesis (controlled by parent)
  userThesis: string;
  userThesisRationale: string;
  onUserThesisChange: (v: string) => void;
  onUserThesisRationaleChange: (v: string) => void;

  // Submit: parent's handleRun. Dialog validates, then calls this and closes.
  onSubmit: () => void;
  /** True while the matched session is streaming — disables submit + shows "running…". */
  isRunning: boolean;
  /** Whether the current tuple maps to an existing run (button label: "Re-run" vs "Run analysis"). */
  isExistingSession: boolean;
};
```

Behavior:

- Drive the `<dialog>` imperatively from `open` (same `useEffect` as `SettingsDialog`:
  `dialog.showModal()` / `dialog.close()`).
- On submit: run client validation (section 3). If errors, set `DraftErrors` state and do **not**
  close or call `onSubmit`. If valid, call `onSubmit()` then `onClose()`. The parent's `handleRun`
  takes it from there (resolve-or-create + `pendingDispatch`).
- The submit button label: `isRunning ? "running…" : isExistingSession ? "Re-run analysis" : "Run
  analysis"`. Disable when `isRunning` or when there is a current validation error.
- Use the existing `Segmented` component for `costPreset` and `dataSource` (lift the
  `COST_PRESET_OPTIONS` / `DATA_SOURCE_OPTIONS` constants — see section 6.5).
- Use the OKLCH `--c-*` tokens for all styling (consistency with `SettingsDialog`).

### 6.3 ASCII mockup of the modal

```
┌─ New analysis ───────────────────────────────────────────── ✕ ┐
│ Configure a run. Sessions are keyed by ticker · date ·         │
│ preset · source — re-running the same four resolves the        │
│ existing report instead of creating a new one.                 │
├────────────────────────────────────────────────────────────────┤
│  TICKER                      DATE                               │
│  ┌──────────────┐            ┌──────────────────┐              │
│  │ NVDA         │            │ 2026-05-06       │              │
│  └──────────────┘            └──────────────────┘              │
│  ⚠ Ticker is required        ⚠ Use YYYY-MM-DD                  │
│                                                                │
│  PRESET   [ fast | full ]    SOURCE  [ fixture | live ]        │
│                                                                │
│  ┌─ Portfolio (coming soon) ─────────────────────────────┐    │
│  │  Account / holdings selection lands here in v2.        │    │
│  │  Disabled placeholder — see feature 4.                 │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ── Your thesis (optional) ────────────────────────────────    │
│  We analyze the ticker blind to this, then test our findings   │
│  against it. ≥ 20 chars to run the thesis audit (Phase 6).     │
│  THESIS                                                        │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ e.g. NVDA data-center growth decelerates faster than…   │    │
│  │                                                          │    │
│  └────────────────────────────────────────────────────────┘    │
│  WHY (optional)                                                │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ What's the reasoning behind it?                          │    │
│  └────────────────────────────────────────────────────────┘    │
├────────────────────────────────────────────────────────────────┤
│                                   [ Cancel ]  [ Run analysis ]  │
└────────────────────────────────────────────────────────────────┘
```

The "Portfolio (coming soon)" block is a static, disabled `<fieldset>`/`<div>` with a one-line
note. It exists purely so feature 4 has a labelled mount point — no logic, no state.

### 6.4 `TopBar` slimming (`components/topbar.tsx`)

Remove from `TopBar`:

- The `<form onSubmit={handleSubmit}>` wrapper and `handleSubmit`.
- The ticker `<input>` and its `<label>`.
- The date `<input>` and its `<label>`.
- Both `<Segmented>` toggles.
- The submit `<button>` (Run / re-run).
- The `Play` icon import (now unused) — remove it (rule 3: clean up your own orphans).
- The `COST_PRESET_OPTIONS` / `DATA_SOURCE_OPTIONS` consts (moved — see 6.5).
- Props that no longer apply: `ticker`, `date`, `costPreset`, `dataSource`, `onTickerChange`,
  `onDateChange`, `onCostPresetChange`, `onDataSourceChange`, `isExistingSession`. (`onRun` is
  renamed `onNewAnalysis`; `isRunning` stays — see below.)

Add to `TopBar`:

- A single **"New Analysis"** button where the form used to sit (right of the brand mark). Use the
  existing accent-button styling. A `+` glyph (`lucide-react` `Plus`) reads better than `Play`
  here. Disable nothing by default; the modal handles the running state. (Optionally show a small
  "running…" affordance when `isRunning`, but the button should still open the modal — the user
  may want to start a *different* run while one streams. Keep it enabled.)
- New props: `onNewAnalysis: () => void` and keep `isRunning: boolean` (only if you render a
  running affordance; otherwise drop it too). Keep `theme` / `onThemeToggle` / the layout label
  exactly as-is.

Resulting `TopBar` is: brand mark · "New Analysis" button · (ml-auto) layout label · theme toggle.

Keep the `CostPreset` / `DataSourceMode` type exports in `topbar.tsx` (they're imported across the
app — `app/page.tsx`, and the new dialog). Do not move the types.

### 6.5 Shared segmented option constants

`COST_PRESET_OPTIONS` and `DATA_SOURCE_OPTIONS` currently live in `topbar.tsx` and are consumed by
the two `Segmented` toggles. They move to the modal (their only remaining consumer). Put them at
the top of `components/new-analysis-dialog.tsx`. Do **not** create a shared constants file — single
consumer (BP-018 / rule 2: no abstraction for single-use). If a future feature needs them in two
places, lift then.

### 6.6 `ThesesPane` becomes thesis-form-free (`components/theses/theses-pane.tsx`)

The thesis form moves into the modal, so `ThesesPane` stops owning run-input:

- Remove the `thesisForm` prop and the `ThesisFormProps` type from `ThesesPaneProps`.
- Remove the `ThesisInput` component and its usage in `EmptySelection`.
- `EmptySelection` keeps only the "Pick a phase entry on the left…" helper text (now centered on
  its own). Trim the now-unused `cn` import only if nothing else uses it (it's still used
  elsewhere in the file — leave it).

This is the surgical change that unblocks feature 1's read-only Past Report view, which reuses
`ThesesPane` and must not require a thesis form. After this change `ThesesPane`'s props are
`{ session, memoStatus }` — exactly what a finished/past report needs.

> Verify after editing: `ThesisFormProps`, `ThesisInput`, and the `1500` maxLength literals are
> fully removed from `theses-pane.tsx` (the modal now owns them). The `disabled` gating that
> `ThesisInput` had (`session.isStreaming`) is reproduced in the modal as the thesis textareas'
> `disabled={isRunning}` — but note the modal can stay editable even mid-stream since the modal's
> fields feed the *next* run, frozen at click via the parent's `handleRun`. Prefer **not**
> disabling the modal thesis fields on `isRunning` — the user configuring a new run while an old
> one streams should be able to type a thesis. (The old `ThesisInput` disabled-on-stream behavior
> was an artifact of the form living in the report pane; it doesn't apply once the form is a
> dedicated "new run" modal.)

### 6.7 `app/page.tsx` wiring changes

Minimal. `TradingDeskApp` already owns every field and `handleRun`. Changes:

1. Add `const [newAnalysisOpen, setNewAnalysisOpen] = useState(false);`.
2. Change the `TopBar` usage: drop the field/handler props; pass
   `onNewAnalysis={() => setNewAnalysisOpen(true)}` and keep `theme` / `onThemeToggle` (+
   `isRunning={session.isStreaming}` only if you kept the running affordance).
3. Drop the `thesisForm={...}` prop from `<ThesesPane>` — it's now just
   `<ThesesPane session={session} memoStatus={memoStatus} />`.
4. Mount `<NewAnalysisDialog>` near `<SettingsDialog>`, fully controlled:

```tsx
<NewAnalysisDialog
  open={newAnalysisOpen}
  onClose={() => setNewAnalysisOpen(false)}
  ticker={ticker}
  date={date}
  costPreset={costPreset}
  dataSource={dataSource}
  onTickerChange={setTicker}
  onDateChange={setDate}
  onCostPresetChange={setCostPreset}
  onDataSourceChange={setDataSource}
  userThesis={userThesis}
  userThesisRationale={userThesisRationale}
  onUserThesisChange={setUserThesis}
  onUserThesisRationaleChange={setUserThesisRationale}
  onSubmit={() => { void handleRun(); }}
  isRunning={session.isStreaming}
  isExistingSession={isExistingSession}
/>
```

`handleRun`, the `tuple`/`matchedSessionId`/`isExistingSession` derivations, the active-session
sync effect, and the `pendingDispatch` dispatch effect are **all unchanged**. The modal is a new
front-end for the same submit path. This is the critical constraint: do not reimplement or move
`handleRun` or the two effects.

> Closing UX: `handleRun` is async (it may `createSession` first). The modal calls `onSubmit()`
> then `onClose()` synchronously — that's fine, because `handleRun`'s session-resolution and the
> `pendingDispatch` handshake run independently of the modal being open. The run starts and streams
> into `ThesesPane` / `TranscriptPane` behind the closed modal, exactly as the header form does
> today. Do NOT `await` inside the dialog before closing.

---

## 7. Exact file create / modify list

**Create:**

- `examples/trading-desk/components/new-analysis-dialog.tsx` — the modal. Native `<dialog>`,
  controlled, owns validation + the "Portfolio (coming soon)" slot + the segmented option consts.
  File header comment + doc comment on the exported component (BP-007).

**Modify:**

- `examples/trading-desk/components/topbar.tsx` — remove the inline form (ticker/date inputs, both
  `Segmented` toggles, Run button, `handleSubmit`, `Play` import, the two option consts, the now-
  unused props); add the "New Analysis" button + `onNewAnalysis` prop. Update the file header
  comment to describe the slimmed chrome. Keep `CostPreset` / `DataSourceMode` type exports.
- `examples/trading-desk/components/theses/theses-pane.tsx` — remove `thesisForm` prop,
  `ThesisFormProps`, and the `ThesisInput` component; simplify `EmptySelection`.
- `examples/trading-desk/app/page.tsx` — add `newAnalysisOpen` state; rewire `TopBar` props; drop
  `thesisForm` from `ThesesPane`; mount `NewAnalysisDialog`. No change to `handleRun`, the tuple
  derivations, or the two dispatch effects.

**Tests:** the example's test suite is wiring-focused and offline. There is no existing component
test harness for `TopBar` / `ThesesPane` (they are UI). Do **not** invent a React Testing Library
setup for this feature — it's not in the project's test conventions for this example (the suite
mocks providers/generators and asserts flow wiring). Verify via `typecheck` + manual `pnpm dev`
(per `examples/trading-desk/CLAUDE.md` "Running and testing"). If the reviewer wants a guard, the
cheapest meaningful one is a typecheck-level assertion that `ThesesPaneProps` no longer contains
`thesisForm` — but that's implicit in the build passing.

**Changeset:** this is user-facing UI behavior in the example app. Per BP-022, add a
`.changeset/*.md` fragment describing the New Analysis modal. Scope it to
`@flow-state-dev/example-trading-desk`. (If the example is marked `private` and excluded from the
changeset/release flow, an empty changeset is acceptable — check `examples/trading-desk/package.json`
`"private"` and the changeset config before deciding.)

**Docs:** the example's `CLAUDE.md` describes layout/conventions, not the run UI, so no doc page is
strictly required. The general "document user-facing functionality" rule is satisfied by the
changeset for an example app (there is no `apps/docs` page describing the trading-desk run form
today). Do not add a docs page unless one already covers this surface.

---

## 8. Dependencies (what must exist first)

- **Nothing.** This feature stands alone on today's codebase. It does not depend on features 1, 3,
  4, 5, or 6, and none of them are required first.
- It is a **soft prerequisite** for feature 1 (Past Reports): making `ThesesPane` thesis-form-free
  (section 6.6) is what lets the Past Report read-only view reuse `ThesesPane`. If feature 1 ships
  first, it would have to do this `ThesesPane` change itself. Coordinate so the `ThesesPane`
  simplification happens exactly once.
- It is a **structural prerequisite** for feature 4 (portfolio-aware analysis): the
  "Portfolio (coming soon)" slot in the modal is where feature 4's account/holding selector lands.
  Feature 4 will (per the Understand findings) add fields to `analyzeInputSchema`,
  `sessionStateSchema`, `seedSession`, and a capability preset — all server-side. On the UI side it
  fills this slot and extends the `AnalyzeTuple`/`handleRun` payload. Design the slot so adding a
  selector is additive (a labelled region, not a hardcoded layout).

---

## 9. Real-portfolio considerations

This app's stated goal is to be trustworthy enough to help manage a real portfolio. For *this*
feature specifically:

- **Don't make the modal imply portfolio integration that isn't there yet.** The "Portfolio
  (coming soon)" slot must be visibly disabled/placeholder, not a dead control that looks live. A
  user must never think they've scoped a run to an account when no such wiring exists. Label it
  honestly ("coming soon" / "see feature 4").
- **`USER_ID` is hardcoded to `"devuser"`.** Every session/report is created under one synthetic
  user. The modal doesn't change this, but it does make creating runs easier, which makes the
  single-user collision more visible. Flag (don't fix here): real multi-user requires threading a
  real user id through `FlowProvider`. Out of scope for the modal.
- **Date semantics.** In fixture mode the `date` field is cosmetic — the loader ignores `args.date`
  and reads the pinned `2026-05-06` snapshot (see `examples/trading-desk/CLAUDE.md` "Fixture
  mode"). The modal should not pretend an arbitrary date pulls historical fixture data. Consider a
  small inline note on the date field in `fixture` mode ("fixture mode uses the pinned snapshot;
  date is recorded but not fetched") — optional, but it's the honest-tradeoff voice the project
  asks for. In `live` mode the date is passed through to providers. This is a real-money trust
  detail: a user analyzing "as of" a date should know whether the data actually reflects that date.
- **No silent data substitution.** Unchanged by this feature (BP-020 lives in the tools), but worth
  stating: the modal must not add any "fall back to fixture" affordance on the live path.
- **Re-run dedupe is correct and intentional.** Submitting the same four-field tuple resolves the
  *existing* session and re-dispatches `analyze` on it (overwriting that report). The modal's
  "Re-run analysis" label (when `isExistingSession`) makes this explicit so a user doesn't think
  they're creating a fresh independent record. For real-portfolio auditability, the user should
  understand a re-run replaces the prior analysis for that tuple rather than appending. The label +
  the modal's framing sentence (section 6.3) cover this.

---

## 10. What NOT to build (scope boundaries)

- **No App Router routes.** No `app/analyze/page.tsx`, no moving `FlowProvider` to `layout.tsx`. In-
  page `<dialog>` only.
- **No view switcher.** Theses | Portfolio | Past Reports navigation is features 1/3. Not here.
- **No flow / schema / server / capability changes.** Zero. If you find yourself editing
  `flow.ts`, `flow-schema.ts`, `state.ts`, `capability.ts`, or anything under `src/flows/`, stop —
  it's out of scope for this feature.
- **No portfolio logic.** The "Portfolio (coming soon)" slot is a static placeholder. No account
  list, no CSV, no holdings, no `mcp__claude_ai_Era` calls. That is features 3 and 4.
- **No reimplementation of `handleRun` or the dispatch effects.** Reuse the parent's handshake via
  props. Do not duplicate the `pendingDispatch` ordering or the active-session sync effect.
- **No client-side enforcement of the 20-char thesis gate.** Surface it as a hint; the server is
  authoritative.
- **No new state-management abstraction.** Field state stays in `TradingDeskApp` (it already lives
  there and feeds derivations). Don't introduce a context, reducer, or form library.
- **No date picker library / no new deps.** A plain `<input>` with format validation matches the
  current header input. (A native `<input type="date">` is acceptable if it renders consistently
  with the dark OKLCH theme — but the existing field is a text input formatted `YYYY-MM-DD`; match
  it unless you verify the native picker themes cleanly.)
- **No changes to `SettingsDialog`, `StatusBar`, `TranscriptPane`, or the memo renderers.**

---

## 11. Open questions

1. **Running affordance in the slimmed `TopBar`.** Should the header show *anything* while a run
   streams (a small "running…" pill / spinner next to "New Analysis"), or does the status bar
   (`StatusBar`, bottom) already cover that adequately? The status bar shows `state` +
   `eventCount`, so a header affordance may be redundant. Recommendation: rely on the status bar;
   keep the header button always-enabled and label-stable. Confirm with owner.
2. **Empty-selection helper text in `ThesesPane`.** With the thesis form gone, the empty state is
   just one line of helper text. Is that the right resting state for a brand-new session with no
   run yet, or should the empty state instead prompt "Click New Analysis to start"? Minor copy
   decision — recommend the latter (it points the user at the now-relocated entry point).
3. **`isRunning` semantics for the modal's submit button when the tuple maps to a *different*
   session than the one currently streaming.** `session` in `TradingDeskApp` is bound to
   `activeSessionId`, which tracks the matched tuple. If the user edits the tuple in the modal to a
   not-yet-run combination while another session streams, `session.isStreaming` reflects the
   *active* session, not the prospective one. The simplest correct behavior: the submit button's
   `isRunning` should reflect whether the *matched* session (the one the current tuple resolves to)
   is streaming — which is what `session.isStreaming` already gives once the sync effect rebinds.
   But there's a one-render window during editing where they can diverge. Recommend: accept the
   minor lag (it self-corrects on the next render) and do not add special handling. Flag for owner
   awareness.
4. **Should the date field default to `live` semantics differently?** Today the date defaults to
   `todayIsoDate()` and fixture mode ignores it. If a user opens the modal in fixture mode, "today"
   is misleading (fixture is always `2026-05-06`). Option: when `dataSource === "fixture"`, show
   the pinned-snapshot note (section 9) rather than changing the value. Recommend the note, not a
   value change (changing the value would break the tuple/title contract). Confirm copy.
