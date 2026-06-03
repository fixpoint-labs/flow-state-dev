# Trading Desk v2 — Feature 02: Past Reports

> Self-contained implementation spec. A sub-agent in a fresh session should be
> able to execute this without reading the other v2 specs. Cross-feature notes
> are called out where they matter, but nothing here depends on another v2
> feature shipping first.

App root: `examples/trading-desk` (package `@flow-state-dev/example-trading-desk`).
All paths below are relative to that directory unless prefixed with `packages/`.

---

## 1. Problem & outcome

**Problem.** Every analysis run is already one durable server session
(`createFilesystemStores`, persisted to `.fsdev/data/`). The app already lists
those sessions (`useFlow().sessions`) and already resolves the *current input
tuple* to a session. But there is no surface to **see prior runs** and no way to
**re-open** one except by retyping its exact `{ticker, date, costPreset,
dataSource}` tuple into the header form so `findSessionForTuple` happens to
match. A user who ran `NVDA` last week and `AAPL` yesterday cannot get back to
either without remembering and re-entering the four fields.

**Outcome.** A "Past Reports" surface that:

1. Lists this user's completed (and in-progress) analyses as clickable rows,
   newest first, each showing ticker, date, the PM decision (action + rating +
   conviction), and when it ran.
2. Opening a row **re-renders the full stored thesis view** (the existing
   `ThesesPane` report) from persisted resource state and the persisted item
   log, with **zero model spend** — no re-run.
3. Lays a durable seam for later **outcome tracking**: at PM-commit time we
   snapshot the decision plus the entry context (price refs from the trader
   memo) so a future feature can score "was this call right?" against realized
   price.

**Non-goal for this feature:** scoring outcomes, charts, portfolio fit, the
New-Analysis modal. Those are separate v2 features (5, 6, 3/4). This feature
makes prior runs *findable and re-openable* and writes the *decision snapshot*
that outcome tracking will later consume.

---

## 2. What already works (do NOT rebuild)

Confirmed by reading the runtime, not assumed:

- **Persistence.** `lib/server.ts` wires `createFilesystemStores({ rootDir,
  developmentOnly: true })`. Sessions, requests (item logs), and resource state
  all persist to disk across restarts.
- **Per-user listing.** `createSessionClient().listSessions({ flowKind,
  userId })` → `GET /api/flows/sessions`, filtered by flowKind + userId. Already
  consumed by `useFlow()` → `flow.sessions: SessionSummary[]`.
  `SessionSummary = { id, flowKind, userId, title?, description?, tags?,
  metadata?: Record<string, unknown>, createdAt: number, updatedAt: number }`
  (`packages/client/src/types/index.ts:123`).
- **Re-open with no re-run.** `useSession(sessionId)` calls
  `getSessionState(sessionId, { includeItems: true })` + `loadSnapshot(...)`,
  hydrating the persisted item log and resource snapshots. `ThesesPane` then
  renders each memo from persisted `memos/**` resource state via
  `useResourceCollectionItem`. Selecting a prior id reconstitutes the full
  report from disk.
- **Title + tuple are already written at create time.** `app/page.tsx:handleRun`
  uses `sessionClient.createSession({ title: titleForTuple(tuple), metadata:
  tuple })`. So every keyed session carries
  `metadata = { ticker, date, costPreset, dataSource }` and a browsable title
  `"NVDA · 2026-05-06 · fast · fixture"`.

**Therefore: this feature requires NO new store adapter and NO new store
interface.** The only persistence change is *enriching what we write into
existing session metadata* (Section 4) so the list rows are rich without N
session loads.

---

## 3. Data model / schemas

Two new shapes. One rides on **session metadata** (the per-user reports index
row, written at PM-commit). One is a **new session-scoped resource** (the
durable decision snapshot for outcome tracking). Neither is a generator output,
so **BP-016 does not apply to either** — but the resource state schema follows
BP-023 (`.nullable().default(null)`) by convention.

### 3.1 Reports index row — lives in `session.metadata`

We do NOT introduce a separate "reports index" store. The index *is* the session
list; each row's display fields ride in the session's `metadata` bag, which
`listSessions` already returns. The four tuple keys are written at create time
(unchanged). At PM-commit we **merge in** a `decision` summary block.

`ctx.session.setMetadata({ metadata })` does a **shallow merge** into the
existing bag (`{ ...current.metadata, ...input.metadata }`, verified at
`createExecutionContext.ts:1662`). So adding `decision`/`reportStatus` keys
**preserves** `ticker/date/costPreset/dataSource` and `findSessionForTuple`'s
strict `===` keying keeps working. **Do not write the four tuple keys from the
PM commit** — only additive keys.

Define a typed view of the metadata bag (this is a TypeScript type + a zod parse
helper, not a wire schema):

```ts
// src/flows/trading-desk/report-index.ts
import { z } from "zod";

/** The decision summary merged into session metadata at PM-commit so the Past
 *  Reports list can render rich rows from `listSessions` alone — no per-session
 *  state load. Additive: the four tuple keys (ticker/date/costPreset/dataSource)
 *  written at session-create time are untouched. */
export const reportDecisionMetaSchema = z.object({
  finalRating: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
  decisionConfidence: z.number().min(0).max(1),
  // One-line PM TLDR for the list subtitle. Truncated to a sane length here.
  summary: z.string(),
  // ISO timestamp the decision committed (distinct from session.createdAt,
  // which is when the *tuple* was first created — a re-run reuses the session).
  decidedAt: z.string(),
});
export type ReportDecisionMeta = z.infer<typeof reportDecisionMetaSchema>;

/** Coarse lifecycle for a report row, so the list can badge in-progress /
 *  stopped runs distinctly from completed ones. */
export const reportStatusMetaSchema = z.enum([
  "complete",   // PM published
  "stopped",    // a guard tripped (unresolvable ticker / no data)
  "in-progress",// created/streaming, no terminal decision yet
]);
export type ReportStatusMeta = z.infer<typeof reportStatusMetaSchema>;
```

The full additive metadata patch written at PM-commit:

```ts
{
  decision: ReportDecisionMeta,   // reportDecisionMetaSchema
  reportStatus: "complete",       // reportStatusMetaSchema
}
```

Client-side, a `parseReportRow(summary: SessionSummary)` helper (Section 6.2)
safe-parses `summary.metadata` into a `ReportRow` for rendering, tolerating
**legacy rows** (sessions created before this feature) where `decision` is
absent — those render with the tuple + title only and a neutral "—" decision
chip.

### 3.2 Decision snapshot resource — for outcome tracking (the seam)

A new **session-scoped** resource that durably records the decision + entry
context at PM-commit. This is the explicit "store the decision + entry context"
seam the product calls for. It is *separate* from the memo (the memo is the
human-rendered thesis; this is the machine-scoreable record), and separate from
metadata (metadata is the cheap list row; this is the full snapshot).

```ts
// src/flows/trading-desk/decision-snapshot-resource.ts
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

/** Durable, machine-scoreable record of one analysis's terminal decision plus
 *  the entry context needed to later judge whether the call was right. Written
 *  once, at PM-commit. Session-scoped: one snapshot per report/session.
 *
 *  This is NOT a generator output — every field is computed deterministically
 *  in the PM commit handler from already-published memo state. BP-016 does not
 *  apply; BP-023 (.nullable().default(null)) is followed for the optional
 *  entry-context fields that depend on the trader memo existing. */
export const decisionSnapshotStateSchema = z.object({
  // Identity (echoed from session state for self-containment when scoring).
  ticker: z.string(),
  asOfDate: z.string(),
  // The decision.
  finalRating: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
  decisionConfidence: z.number().min(0).max(1),
  decisionSummary: z.string(),
  // Entry context (from the trader memo — nullable because a run can stop or
  // the trader memo can be flat/missing). These are what outcome tracking
  // scores against realized price later.
  direction: z.enum(["long", "short", "flat"]).nullable().default(null),
  entryPrice: z.number().nullable().default(null),   // see 4.3 note on sourcing
  stopPrice: z.number().nullable().default(null),
  targetPrice: z.number().nullable().default(null),
  sizePct: z.number().nullable().default(null),
  holdingPeriod: z
    .enum(["days", "weeks", "months", "quarters"])
    .nullable()
    .default(null),
  // Provenance.
  decidedAt: z.string(),       // ISO commit time
  // Outcome-tracking fields — NULL on write; a FUTURE feature fills these.
  // Declared now so the resource shape is forward-stable and the seam is real.
  outcomeRealizedPrice: z.number().nullable().default(null),
  outcomeAsOf: z.string().nullable().default(null),
  outcomeVerdict: z
    .enum(["correct", "incorrect", "inconclusive"])
    .nullable()
    .default(null),
});
export type DecisionSnapshotState = z.infer<typeof decisionSnapshotStateSchema>;

export const decisionSnapshotResource = defineResource({
  scope: "session",
  ref: "tradingDeskDecisionSnapshot",
  stateSchema: decisionSnapshotStateSchema,
  // No `default` — created explicitly by the PM commit. Read client-side via
  // useResource only after a report completes; absent on stopped/in-progress.
  writable: true,
  client: {
    // Expose the read-relevant fields so a future Summary/outcome surface can
    // read them via useResource without a debug endpoint.
    expose: [
      "ticker",
      "asOfDate",
      "finalRating",
      "decisionConfidence",
      "decisionSummary",
      "direction",
      "entryPrice",
      "stopPrice",
      "targetPrice",
      "sizePct",
      "holdingPeriod",
      "decidedAt",
      "outcomeRealizedPrice",
      "outcomeAsOf",
      "outcomeVerdict",
    ],
  },
});
```

> **Scope decision (deliberate).** Session-scope, not user-scope. One report =
> one session = one snapshot. Re-opening a report reads *that session's*
> snapshot. A user-scoped "portfolio of decisions" aggregate is a Portfolio
> feature concern (v2 feature 3/4), not Past Reports. Keeping the snapshot
> session-scoped means it hydrates for free when the report is re-opened and
> never needs cross-session aggregation here.

> **Why both metadata AND a resource?** Metadata is the *cheap list row* —
> returned by `listSessions` in one call, so the list renders without loading
> any session state. The resource is the *full scoreable snapshot* — too heavy
> and too detailed for a list row, and it carries forward-declared outcome
> fields a future writer mutates. The metadata `decision` block is a *projection*
> of the snapshot's headline fields.

---

## 4. Server / persistence changes

**No store-interface change. No new route. No new HTTP surface.** Everything
uses existing store methods through existing flow runtime ops:

| Need | Mechanism (already exists) |
| --- | --- |
| List per-user reports | `SessionStore.list({ flowKind, userId })` via `createSessionClient().listSessions` (already wired in `useFlow`) |
| Re-open a report's items | `getSessionState(id, { includeItems: true })` + `loadSnapshot` (already wired in `useSession`) |
| Write decision row to list | `ctx.session.setMetadata({ metadata })` — shallow-merges, non-CAS (`createExecutionContext.ts:1655`) |
| Write decision snapshot | new session-scoped resource `patchState` / `set` inside the PM commit handler |

The only server-touching code is **inside the flow** (Section 5) — a flow action
handler writing resource state + session metadata. Per the persistence finding,
resource writes only legitimately happen inside flow action handlers (BP-012),
never an ad-hoc API route. This feature respects that: the writes happen in the
existing `commitPortfolioManagerMemo` handler, which already runs at the terminal
step of the `analyze` pipeline.

### 4.1 Ownership note (real-money relevant, flagged not fixed here)

`handleGetSession` / `handleGetSessionState` do **not** enforce that the
requesting user owns the session — any `sessionId` is fetchable. `listSessions`
*is* user-filtered, so the list only shows the caller's own reports, but a
direct id fetch is unscoped. This feature does not add ownership checks (out of
scope, and `USER_ID` is hardcoded `"devuser"` today). It is recorded as an open
risk for the real-money path (Section 10).

### 4.2 Stopped/in-progress rows

A run can terminate without a PM decision (`stoppedReason` set by a guard) or be
re-opened mid-stream. The metadata `reportStatus` distinguishes these:

- The existing guards (`checkTickerResolvable`,
  `checkPhase1HasFundamentalsAndProfile`, `checkPhase1HasData`) already
  `patchState({ runComplete: true })` with a `stoppedReason`. **Add** to each
  guard's patch a `ctx.session.setMetadata({ metadata: { reportStatus:
  "stopped" } })` call so stopped runs badge correctly in the list. (Three
  one-line additions; see 5.3.)
- A session that exists but has neither completed nor stopped renders as
  `in-progress` — which is the **absence** of a `reportStatus` key, so legacy
  and brand-new sessions both fall through to `in-progress` cleanly. No write
  needed for this state.

### 4.3 `entryPrice` sourcing caveat

The trader memo carries `stopPrice` / `targetPrice` / `sizePct` (typed numeric
mirrors on `memoStateSchema`) but **not** an explicit entry/current price. The
current price lives only in the `get_price_history` tool output (an item-log
entry, not resource state). For this feature, **set `entryPrice: null`** in the
snapshot and leave a `// TODO(outcome-tracking)` comment. Sourcing a clean entry
price (a one-tap price-history resource at Phase 1) is a Summary-feature concern
(v2 feature 5) and explicitly out of scope here. The snapshot shape *reserves*
the field so adding it later is a writer change, not a schema migration.

---

## 5. Flow changes

All changes are in the trading-desk flow. They are **additive** to the existing
`analyze` pipeline. No new generator, no new block kind, no capability/preset
change. Conforms to BP-011 (no `block.run()` in handlers — we only add
`patchState`/`setMetadata`/resource writes inside existing handlers), BP-012
(state-only writes), BP-014 (no `return input`).

### 5.1 Register the new resource

`src/flows/trading-desk/flow.ts` — add the decision-snapshot resource to the
flow's `resources` map (same pattern as `valuationSpine`):

```ts
import { decisionSnapshotResource } from "./decision-snapshot-resource";
// ...
resources: {
  memos: memosCollection,
  p2Contributions: phase2Contributions,
  specialInstructions: specialInstructionsResource,
  valuationSpine: valuationSpineResource,
  decisionSnapshot: decisionSnapshotResource, // NEW
},
```

### 5.2 Write snapshot + metadata at PM-commit

`src/flows/trading-desk/phase-5/writer.ts` — extend
`commitPortfolioManagerMemo`. It already computes `finalRating` (post-clamp),
`decisionConfidence`, `decisionSummary`, and reads the trader memo. Add the
snapshot write and the metadata merge **after** `publishMemo`, alongside the
existing `runComplete` patch.

Add `decisionSnapshot` to the handler's `resources` and import the report-index
schema for the metadata projection:

```ts
import { decisionSnapshotResource } from "../decision-snapshot-resource";
import type { ReportDecisionMeta } from "../report-index";
// ...
resources: {
  ...memoResources,
  valuationSpine: valuationSpineResource,
  decisionSnapshot: decisionSnapshotResource, // NEW
},
```

After `publishMemo(...)` and before/with the existing
`ctx.session.patchState({ runComplete: true })`:

```ts
// Durable decision snapshot for outcome tracking. Entry context comes from
// the trader memo's typed numeric mirrors; entryPrice is reserved (null) until
// a price-history resource exists (see Summary feature).
const decidedAt = new Date().toISOString();
await ctx.resources.decisionSnapshot.set({
  ticker: ctx.session.state.ticker,
  asOfDate: ctx.session.state.date,
  finalRating, // post-clamp value computed above
  decisionConfidence: decision.decisionConfidence,
  decisionSummary: decision.decisionSummary,
  direction:
    traderDirection === "long" || traderDirection === "short" || traderDirection === "flat"
      ? traderDirection
      : null,
  entryPrice: null, // TODO(outcome-tracking): source from price-history resource
  stopPrice: (traderState as { stopPrice?: number | null } | undefined)?.stopPrice ?? null,
  targetPrice: (traderState as { targetPrice?: number | null } | undefined)?.targetPrice ?? null,
  sizePct: (traderState as { sizePct?: number | null } | undefined)?.sizePct ?? null,
  holdingPeriod:
    (traderState as { holdingPeriod?: DecisionSnapshotState["holdingPeriod"] } | undefined)
      ?.holdingPeriod ?? null,
  decidedAt,
  outcomeRealizedPrice: null,
  outcomeAsOf: null,
  outcomeVerdict: null,
});

// Enrich the session-metadata reports-index row so Past Reports renders rich
// rows from listSessions alone. Additive merge — tuple keys are preserved.
const decisionMeta: ReportDecisionMeta = {
  finalRating,
  decisionConfidence: decision.decisionConfidence,
  summary: decision.decisionSummary.slice(0, 160),
  decidedAt,
};
await ctx.session.setMetadata({
  metadata: { decision: decisionMeta, reportStatus: "complete" },
});
```

> Verify against the runtime: `ctx.resources.decisionSnapshot.set(...)` is the
> session-scoped resource write op; `traderState` is already read above for
> `agreesWithTrader`. If the resource handle exposes `patchState` rather than
> `set` for a no-default resource, use `patchState` with the full object (the
> first write on a defaultless resource initializes it). Check the resource
> handle surface in `@flow-state-dev/core` before finalizing the verb; both are
> last-write-wins, non-CAS, so either is safe here.

### 5.3 Badge stopped runs in metadata

`src/flows/trading-desk/flow.ts` — in each of the three stop guards
(`checkTickerResolvable`, `checkPhase1HasFundamentalsAndProfile`,
`checkPhase1HasData`), after the existing `patchState({ stoppedReason, ...,
runComplete: true })`, add:

```ts
await ctx.session.setMetadata({ metadata: { reportStatus: "stopped" } });
```

(These handlers already have `ctx.session`. This is a state-only side write,
BP-012-compatible; the guards are `.tap`-chained so no output contract changes.)

### 5.4 Client-data exposure — no change needed

The reports list does NOT read session client-data; it reads `listSessions`
metadata + (on open) the existing memo collection. No additions to
`flow.ts` `client.expose` are required for this feature. The decision-snapshot
resource exposes its own fields via its `client.expose` (Section 3.2) for the
future outcome surface, independent of session client-data.

---

## 6. UI changes

### 6.1 Routing decision: in-page view switcher (NOT new routes)

Per the Understand findings, `FlowProvider` is mounted only in `app/page.tsx`
(not `layout.tsx`), and `TradingDeskApp` owns all session-selection state. Two
options were considered:

- **(A) New App Router route `app/reports/page.tsx`.** Requires either moving
  `FlowProvider` into `layout.tsx` (touches the single mount point, affects
  every future route) or duplicating the provider per route. It also splits
  session-selection state across routes — opening a report from `/reports` would
  need to navigate to `/` and rehydrate selection, which is awkward because
  selection currently lives in component state, not the URL.
- **(B) In-page view switcher in `TradingDeskApp`.** A `view` state
  (`"desk" | "reports"`) branches the `main` content. Reuses the single
  `FlowProvider`, the existing `flow`/`session` hooks, and `selectSession`
  directly. Opening a report sets `view = "desk"` and selects the session — the
  existing `ThesesPane` renders it with no new wiring.

**Choose (B).** It is the smaller, lower-risk diff, keeps all session
orchestration in one place, and makes "open a past report" a single
`selectSession(id)` + `setView("desk")` call. New routes are deferred to
whichever v2 feature first genuinely needs URL-addressable deep links (none of
the v2 set requires it yet). This matches the existing single-route app
convention.

> Cross-feature note: the Portfolio feature (v2 feature 3) faces the same
> routing choice. If both land, a shared nav with `view` ∈
> `"desk" | "reports" | "portfolio"` is the natural extension of (B). Author the
> switcher so adding a third view is a one-line enum + one branch.

### 6.2 Component tree

```
app/page.tsx
  Page                         (FlowProvider — unchanged)
    TradingDeskApp             (+ `view` state: "desk" | "reports")
      TopBar                   (+ nav: "Desk" | "Past Reports" toggle; see 6.4)
      main
        view === "desk":
          ThesesPane           (unchanged — renders active session's report)
          TranscriptPane       (unchanged)
        view === "reports":
          PastReportsPane      (NEW — full-width, replaces the 2fr/1fr grid)
      StatusBar                (unchanged)
      SettingsDialog           (unchanged)
```

New files:

- `components/reports/past-reports-pane.tsx` — the list surface.
- `components/reports/report-row.tsx` — one row.
- `src/flows/trading-desk/report-index.ts` — `parseReportRow` + schemas (3.1).

`PastReportsPane` reads `flow.sessions` (already loaded), maps each
`SessionSummary` through `parseReportRow`, sorts by
`decision.decidedAt ?? createdAt` desc, and renders rows. Clicking a row calls a
prop `onOpenReport(id)` which the parent implements as
`flow.selectSession(id); setView("desk")`.

`parseReportRow(summary)` returns:

```ts
type ReportRow = {
  id: string;
  ticker: string;        // from metadata.ticker, fallback "—"
  asOfDate: string;      // from metadata.date
  costPreset: string;    // from metadata.costPreset
  dataSource: string;    // from metadata.dataSource
  title: string;         // summary.title ?? built from tuple
  status: ReportStatusMeta; // metadata.reportStatus ?? "in-progress"
  decision: ReportDecisionMeta | null; // safe-parsed; null on legacy/incomplete
  createdAt: number;
  sortKey: number;       // Date.parse(decision.decidedAt) || createdAt
};
```

Use `reportDecisionMetaSchema.safeParse(metadata.decision)` — never assume the
key exists (legacy rows, in-progress rows).

### 6.3 ASCII mockup — Past Reports list

```
┌──────────────────────────────────────────────────────────────────────┐
│ flow-state / examples/trading-desk      [ Desk ] [▸Past Reports ]  ☀  │  ← TopBar
├──────────────────────────────────────────────────────────────────────┤
│  Past Reports                                       12 reports · you   │
│  ───────────────────────────────────────────────────────────────────  │
│  ▸ NVDA   2026-05-06          Overweight · 0.72   ·  2h ago    full ●  │
│      "Data-center demand re-accelerates into H2; valuation supports…"  │
│  ───────────────────────────────────────────────────────────────────  │
│  ▸ AAPL   2026-05-06          Hold · 0.55         ·  yesterday  fast ○ │
│      "Services growth offsets hardware softness; fairly valued."       │
│  ───────────────────────────────────────────────────────────────────  │
│  ▸ TSLA   2026-05-06          stopped             ·  2d ago    live ●  │
│      Halted — unresolvable ticker in live mode.                        │
│  ───────────────────────────────────────────────────────────────────  │
│  ▸ AMD    2026-05-06          in-progress…        ·  just now   fast ○ │
│  ───────────────────────────────────────────────────────────────────  │
│  ▸ INTC   (legacy)            —                   ·  last week         │  ← pre-feature row: title/tuple only
└──────────────────────────────────────────────────────────────────────┘
```

Row anatomy (`report-row.tsx`):
- Left: ticker (mono, bold) + as-of date (faint).
- Center: decision chip. `complete` → `<finalRating> · <conviction.toFixed(2)>`,
  color-keyed to the 5-tier scale (reuse the OKLCH tokens / the tier coloring
  idiom from `pm-hero.tsx`). `stopped` → warn chip. `in-progress` → pulsing
  neutral chip. legacy/no-decision → `—`.
- Subtitle: `decision.summary` (complete) or `stoppedMessage`-style line
  (stopped) — for stopped rows the message isn't in metadata, so render a
  generic "Halted before a decision." line (the full reason lives in the
  session's stored state, shown on open).
- Right: relative time (`createdAt`/`decidedAt`) + `costPreset` + a
  `dataSource` dot (filled = live, hollow = fixture). Reuse the OKLCH `--c-*`
  tokens; no new chart/lib dependency.

Clicking anywhere on the row opens it. Keyboard: rows are `<button>`s for
focus/enter support.

### 6.4 TopBar nav

Add a minimal two-item nav between the brand mark and the analyze form. Keep it
controlled (parent owns `view`):

- Props add: `view: "desk" | "reports"`, `onViewChange(v)`.
- When `view === "reports"`, **hide the inline analyze form** (it's desk-only)
  and show only the brand + nav + theme toggle. (The 44px grid is unchanged; the
  form simply isn't rendered in reports view.)

> Cross-feature note: v2 feature 2 (New Analysis modal) will eventually remove
> the inline form from TopBar entirely and replace it with a "New Analysis"
> button. Author the nav so it coexists with either the inline form (today) or a
> button (later) — i.e. the nav is its own flex group, not interleaved with the
> form fields.

### 6.5 Re-open behavior (verify, don't assume)

When `onOpenReport(id)` fires `selectSession(id)` and switches to desk view,
`useSession(id)` rehydrates the stored report. Two known-but-untested edge cases
to handle in `ThesesPane` (already mostly handled — confirm during impl):

- **Auto-follow on a finished report.** `ThesesPane`'s auto-follow selects the
  last-published memo (`PUBLISH_ORDER` walk). For a finished report this lands
  on `portfolioManager` — the desired landing. The re-run detector
  (`isStreaming && items.length === 0`) is false for a stored report, so it
  won't clear selection. Expected to "just work"; verify the PM hero renders.
- **Tuple sync effect must not fight the open.** `TradingDeskApp`'s effect at
  `page.tsx:199` syncs `activeSessionId` to `findSessionForTuple(tuple)`. If the
  opened report's tuple differs from the header inputs, that effect would
  immediately re-select away from the opened report. **Fix:** when opening a
  report, also set the header inputs to the opened report's tuple (so
  `findSessionForTuple` matches the opened session and the sync effect is a
  no-op). `onOpenReport(id)` should: read the row's tuple, call
  `setTicker/setDate/setCostPreset/setDataSource` to that tuple, then
  `selectSession(id)`, then `setView("desk")`. This keeps the header, the
  resolve-or-create keying, and the opened report consistent.

> This tuple-sync interaction is the single most likely bug in this feature.
> The opened report and the header inputs MUST agree on the tuple or the effect
> snaps selection back. Test it (Section 8).

---

## 7. Exact file-create / modify list

**Create:**

1. `examples/trading-desk/src/flows/trading-desk/report-index.ts` —
   `reportDecisionMetaSchema`, `reportStatusMetaSchema`, `ReportRow` type,
   `parseReportRow(summary)`. Import-safe in the browser (zod + types only; no
   `@flow-state-dev/core` resource imports).
2. `examples/trading-desk/src/flows/trading-desk/decision-snapshot-resource.ts` —
   `decisionSnapshotStateSchema`, `decisionSnapshotResource`. (Server-side; pulls
   `defineResource`. Keep schema/types importable by the writer.)
3. `examples/trading-desk/components/reports/past-reports-pane.tsx` —
   `PastReportsPane({ sessions, onOpenReport })`.
4. `examples/trading-desk/components/reports/report-row.tsx` —
   `ReportRow({ row, onOpen })`.
5. `examples/trading-desk/test/past-reports.spec.ts` — unit tests (Section 8).

**Modify:**

6. `examples/trading-desk/src/flows/trading-desk/flow.ts` — register
   `decisionSnapshot` resource (5.1); add `setMetadata({ reportStatus:
   "stopped" })` to the three stop guards (5.3).
7. `examples/trading-desk/src/flows/trading-desk/phase-5/writer.ts` — extend
   `commitPortfolioManagerMemo`: add `decisionSnapshot` to resources, write the
   snapshot + merge the `decision`/`reportStatus: "complete"` metadata (5.2).
8. `examples/trading-desk/app/page.tsx` — add `view` state to `TradingDeskApp`;
   branch `main` on view; implement `onOpenReport` (sets tuple + selects +
   switches view per 6.5); pass `view`/`onViewChange` to `TopBar`.
9. `examples/trading-desk/components/topbar.tsx` — add `view`/`onViewChange`
   props, the two-item nav, and hide the analyze form in reports view (6.4).
10. `examples/trading-desk/CLAUDE.md` — document the new `report-index.ts`,
    `decision-snapshot-resource.ts`, and the metadata-as-reports-index pattern
    under "Layout" / a short "Past Reports" subsection. (BP: document changed
    user-facing functionality.)
11. `.changeset/*.md` — user-facing change (new Past Reports surface). Non-empty
    changeset describing the feature for `@flow-state-dev/example-trading-desk`.

> No `packages/*` files change. No store adapter. No route handler. No new HTTP
> endpoint. The example app already exposes everything needed.

---

## 8. Tests (verify intent — BP-005)

Add `test/past-reports.spec.ts`. The suite is offline (mirrors the existing
test posture — generators/providers mocked). Cover:

1. **`parseReportRow` — complete row.** Given a `SessionSummary` with
   `metadata = { ...tuple, decision: {finalRating, decisionConfidence, summary,
   decidedAt}, reportStatus: "complete" }`, returns a `ReportRow` with parsed
   decision, `status: "complete"`, and `sortKey === Date.parse(decidedAt)`.
2. **`parseReportRow` — legacy row.** `metadata = { ...tuple }` only (no
   `decision`/`reportStatus`) → `decision: null`, `status: "in-progress"`,
   `sortKey === createdAt`. (Encodes: legacy sessions stay listable, never
   crash the list.)
3. **`parseReportRow` — malformed decision.** `metadata.decision = { junk:
   true }` → `safeParse` fails → `decision: null` (does NOT throw). Encodes the
   robustness intent: bad metadata degrades to a tuple-only row.
4. **`parseReportRow` — stopped row.** `reportStatus: "stopped"` →
   `status: "stopped"`, decision may be null.
5. **PM commit writes snapshot + metadata.** Drive `commitPortfolioManagerMemo`
   via `runForTest` (or the existing phase-5 writer test harness) with a mock
   ctx exposing `decisionSnapshot.set` and `session.setMetadata` spies + a
   published trader memo. Assert: (a) `decisionSnapshot.set` called once with
   `finalRating` === post-clamp value, trader-sourced `stopPrice/targetPrice/
   sizePct`, `entryPrice: null`, null outcome fields; (b) `setMetadata` called
   with `{ metadata: { decision: {...}, reportStatus: "complete" } }` and the
   summary truncated to ≤160 chars; (c) the four tuple keys are NOT in the
   `setMetadata` payload (verifies we don't clobber the keying contract).
6. **Stop guard badges metadata.** Drive one stop guard (e.g.
   `checkTickerResolvable` with an unresolvable ticker) and assert
   `setMetadata({ metadata: { reportStatus: "stopped" } })` was called.
7. **Open-report tuple sync (component-level or logic-level).** Given a row with
   a tuple different from current header inputs, `onOpenReport` sets all four
   header fields to the row's tuple before `selectSession` — so
   `findSessionForTuple(sessions, newTuple)` resolves to the opened id (the
   sync effect becomes a no-op). This is the regression guard for 6.5.

Run: `pnpm --filter @flow-state-dev/example-trading-desk test`.
Typecheck: `pnpm --filter @flow-state-dev/example-trading-desk typecheck`.

---

## 9. Dependencies (what must exist first)

**None blocking.** This feature is buildable on today's `main`:

- Persistence spine (filesystem stores), `listSessions`, `getSessionState`
  rehydration, `setMetadata`, session-scoped resources — all exist and are
  verified.
- Does **not** depend on the Layer-2 identity reorg (per the v2 constraints
  finding, v2 features build on today's phase-segmented structure).
- Does **not** depend on the New-Analysis modal, Portfolio, Summary, or FIX-709.
  It coexists with them (cross-feature notes in 6.1/6.4).

Soft sequencing: if v2 feature 2 (New Analysis modal) lands first, the TopBar
nav (6.4) should be authored against the modal-button layout rather than the
inline form. Either order works; the nav is its own flex group.

---

## 10. Real-portfolio considerations

This app is meant to be trustworthy enough to help manage a real portfolio.
For Past Reports specifically:

1. **Dev-only persistence ceiling.** `createFilesystemStores({ developmentOnly:
   true })` does not survive an ephemeral/serverless filesystem (e.g. Vercel).
   Past Reports built on it is durable for `pnpm dev` but **will lose history on
   a redeploy in production**. For real use, swap the `lib/server.ts` `stores:`
   seam to `createSQLiteStores`/`createPgStores` (the `add-store-adapter` path).
   The reports index (metadata) and snapshot (resource) ride whatever store is
   wired — no code change beyond the seam. **Flag this prominently in the
   feature's user-facing docs/changeset.**
2. **No read authorization.** `getSessionState`/`getSession` accept any
   sessionId without an ownership check (4.1). With `USER_ID` hardcoded to
   `"devuser"` it's moot today, but any multi-user deploy must scope report
   reads to the authenticated user or one user can fetch another's analysis by
   id. Recorded as an open question; not fixed here.
3. **The decision snapshot is the audit record.** For a real portfolio, "what
   did we decide and on what basis" must be immutable and complete. The snapshot
   captures finalRating (post-clamp), conviction, summary, direction, and trade
   refs at commit time. The *entry price gap* (4.3) is the one weak point — an
   outcome-scoring feature cannot judge "was this right" without a recorded
   entry price. Reserve the field now; source it when the price-history resource
   lands. Do not ship outcome scoring against a null entry price.
4. **Re-opened reports must read as historical, not live.** A re-opened report
   renders from stored state with no streaming. Ensure the UI does not imply the
   numbers are current (e.g. the as-of date is prominent; no "live" affordances
   on a stored report). Stale prices presented as current is a real-money
   footgun.
5. **Truncated summary is display-only.** The 160-char metadata summary is for
   the list row; the full `decisionSummary` lives in the memo and the snapshot.
   Never treat the truncated row text as the decision of record.

---

## 11. What NOT to build (scope boundaries)

- **No new store adapter / store interface / HTTP route.** Reuse
  `listSessions` + `getSessionState` + `setMetadata` + a session-scoped
  resource. (Adding a store adapter for this is explicit over-scope.)
- **No outcome scoring.** Reserve the snapshot's `outcome*` fields; do not
  compute verdicts, do not fetch realized prices, do not render P&L. That is a
  future feature consuming this seam.
- **No charts, no Summary page, no portfolio fit.** Those are v2 features 5/3/4.
  The decision chip on a row is a text/color chip, not a chart.
- **No New-Analysis modal.** v2 feature 2. This feature only adds a nav + a list;
  it does not touch the run-dispatch handshake (`handleRun`/`pendingDispatch`).
- **No new App Router routes.** In-page view switcher only (6.1).
- **No deletion / rename / tagging UI** for reports. (`deleteSession` exists on
  the client but is out of scope here.)
- **No multi-user auth / ownership checks.** Recorded as risk; `USER_ID` stays
  `"devuser"`.
- **No `entryPrice` sourcing.** Field is reserved `null`; sourcing is the
  Summary feature's price-history resource.

---

## 12. Open questions

1. **Resource write verb.** Confirm whether the session-scoped
   `decisionSnapshot` handle (no `default`) takes `.set(fullObject)` or requires
   `.patchState(fullObject)` for its first write. Both are non-CAS LWW; pick the
   one the resource handle actually exposes (read the `@flow-state-dev/core`
   resource handle type before finalizing 5.2).
2. **Relative-time rendering.** Use a tiny inline formatter (`"2h ago"`) or pull
   nothing new — the example has no date lib. Recommend a ~15-line inline
   `relativeTime(ms)` helper in `report-index.ts`; confirm that's acceptable vs.
   showing the raw ISO date.
3. **In-progress rows on open.** Re-opening a session that is *currently
   streaming in another tab* — does `useSession` attach or show a stale
   snapshot? `autoResume` is off in this app. Likely fine (shows the snapshot at
   open), but confirm the re-open path doesn't accidentally re-dispatch. (It
   won't — opening only `selectSession`s; `sendAction` is only called from
   `handleRun`.)
4. **Sort tie-breaking.** When `decidedAt` is absent (in-progress/legacy),
   `sortKey` falls back to `createdAt`. Confirm desired ordering when completed
   and in-progress rows interleave (recommend: completed sort by `decidedAt`,
   in-progress by `createdAt`, all in one desc list — which the single `sortKey`
   already produces).
5. **Stopped-row subtitle.** The full `stoppedMessage` lives in session *state*,
   not metadata, so the list row can't show the specific reason without a state
   load. Acceptable to show a generic "Halted before a decision." on the row and
   the specific reason only on open? (Recommended — keeps the list a pure
   metadata read.)
