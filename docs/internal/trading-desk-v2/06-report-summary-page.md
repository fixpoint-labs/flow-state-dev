# Trading Desk v2 — Feature 06: Per-Report Summary Page

**Status:** Spec (ready to execute)
**Owner area:** `examples/trading-desk` (example app only — not framework source)
**Author note:** This is a self-contained spec. A fresh-session executor should be able to build this without reading the other v2 specs. Cross-feature touch points are called out explicitly where they exist.

---

## 1. Problem & Outcome

### Problem

Today a finished report is rendered exclusively as the `ThesesPane`: a phase-grouped sidebar (~20 analyst memos) plus a one-memo-at-a-time doc area. To understand "what does the whole desk think, and should I act?", an investor must click through every memo. There is no single screen that answers:

- What is each analyst's one-line TLDR and stance?
- What is the final PM decision, and how confident is it?
- What are the key numbers (valuation, technicals, sizing, scenarios)?
- Where do the analysts converge vs. diverge?

### Outcome

Add a **Summary** view to each report. It aggregates **already-stored report state** (zero re-run, zero model spend) into a single scrollable page that reads cleanly for a real investor about to act. It is reachable by an in-report **Theses | Summary** toggle (not a separate route).

The Summary shows, top to bottom:

1. **Decision header** — PM final rating (5-tier), model-implied rating + band, confidence, agree/differ-with-trader, the trade in one line (direction / size / stop / target / horizon).
2. **Conviction strip** — every analyst's stance as a small convergence/divergence visual + research-manager stance + trader direction + PM rating. (This is also where the FIX-709 investor-lens signal renders **if that feature shipped** — see §9.)
3. **Analyst TLDR grid** — one row per analyst: glyph, role, headline (TLDR), stance chip, data-quality chip, two key metrics.
4. **Charts** (inline SVG, no library):
   - Factor/metric bars (from valuation spine).
   - Scenario probability strip (from scenario forecaster).
   - Price history with entry/stop/target overlay (gated on a small new persisted resource — see §4).
   - Portfolio weight before/after — **rendered only if Feature 04 shipped** (see §9); otherwise omitted entirely, not stubbed.
5. **Risk & dependencies** — critical risks (Phase 4) + key dependencies (PM).

The page must degrade gracefully: any memo can be missing, skeletal (`dataQuality: "unavailable"`), or `error`. Charts never render against missing data — they show a one-line "not available for this run" note instead.

### Non-negotiables

- **No re-run.** Every value comes from persisted resource state hydrated by `useSession` selection. The only new flow work is one optional Phase-1 tap that persists a price-history slice as a resource (§4), and that is itself optional/feature-flagged behind a fixture-safe fallback.
- **Trustworthy framing.** This is positioned for real-money decisions. The existing non-dismissable `StatusBar` disclaimer ("Research / demo only. Not financial advice. No execution.") stays visible on the Summary view. No number is invented client-side; every figure traces to a named stored field.

---

## 2. What already exists (ground truth — verified against source)

All read from `useSession(sessionId)` after the session is selected. `useSession` hydrates the full persisted item log and resource snapshots via `getSessionState({ includeItems: true })`, so a stored report reconstitutes from disk with zero model spend.

### 2.1 Memo collection — the primary source

`memosCollection` (`src/flows/trading-desk/resources.ts`): `defineResourceCollection({ pattern: "memos/**", scope: "session", stateSchema: memoStateSchema, client: { state: { read: true } } })`. **No projection is declared**, so the *entire* `memoStateSchema` ships to the client as each item's `clientData`. The Summary reads every field directly.

Read the whole collection in one pass with:

```ts
const { items } = useResourceCollectionList(session, "memos", { limit: 50 });
// items: CollectionItemHandle[] — each has { topic, clientData }
// topic is the bare collection key, e.g. "p1/fundamentals", "p5/portfolio-manager"
```

**Verified:** server `STATE_LIST_DEFAULT_LIMIT = 50`, `STATE_LIST_MAX_LIMIT = 200` (`packages/server/src/routes/resource-routes.ts`). There are ~20 memos, so a single `limit: 50` page returns all of them — no pagination loop needed. `item.clientData` is the projected/full memo state; cast it to `MemoState` (the collection ships full state, so the cast is sound; treat fields as nullable).

Per-memo fields the Summary uses (all on `memoStateSchema`, all nullable until published):

| Source memo (topic) | Fields used |
|---|---|
| `p1/*` (9 analysts) | `headline` (TLDR), `rating` (`constructive`/`neutral`/`cautious` — stance), `metrics` (`Record<string,string>`), `dataQuality` (`full`/`partial`/`unavailable`), `label`, `status` |
| `p2/research-manager` | `stance` (`bullish`/`bearish`/`neutral`), `conviction` (0–1), `keyRisks`, `keyOpportunities`, `unresolvedDisagreements`, `headline` |
| `p3/trader` | `direction` (`long`/`short`/`flat`), `sizePct`, `stopPrice`, `targetPrice`, `holdingPeriod`, `invalidationCriteria`, `headline` |
| `p4/risk-assessment` | `criticalRisks[]` (`{description, raisedBy, severity}`), `confidenceCalibration`, `recommendedAdjustments`, `headline` |
| `p5/scenario-forecaster` | `scenarios[]` (`{name, probability, trigger, triggerSource, expectedOutcome, tradeBehavior}`), `distribution`, `probabilitySum`, `horizon`, `evidenceBasis` |
| `p5/portfolio-manager` | `finalRating` (`Sell`/`Underweight`/`Hold`/`Overweight`/`Buy`), `decisionSummary`, `decisionConfidence` (0–1), `agreesWithTrader`, `acceptedAdjustments`, `keyDependencies`, `primaryScenario`, `modelImpliedRating`, `ratingBand` (`{floor, ceiling}`), `ratingClamped`, `absoluteRating`, `relativeRating` |
| `p6/thesis-alignment` | `alignment`, `alignmentConfidence` — **thesis-fit vs. the user's thesis, NOT portfolio-fit.** Optional surface; label it "Thesis alignment", never "portfolio fit". |

### 2.2 Valuation spine — separate session resource

`valuationSpineResource` (`src/flows/trading-desk/valuation-spine-resource.ts`): `defineResource({ scope: "session", ref: "valuationSpine", ... })`. Read with:

```ts
const { clientData } = useResource(session, "valuationSpine");
const spine = clientData as ValuationSpineState | null; // null until computed / on failure
```

Numeric fields good for charts (all typed numbers, not display strings):

- `setupScore`: `{ value, quality, factor, momentum }` (each `number | null`, ~0–100 scale) → **factor bar group**.
- `fairValue`: `{ fairValue, marginOfSafety, justifiedPE }` → fair-value marker on the price chart.
- `expectedReturn`: `{ expectedReturn, hurdle, excessReturn }` → a small "expected vs. hurdle" pair.
- `envelope`: `{ implied, floor, ceiling, absoluteRating, relativeRating }` → already mirrored onto the PM memo (`modelImpliedRating` / `ratingBand`); prefer the PM memo fields for the decision header, use the spine for chart numerics.

### 2.3 Price history — the one gap

`get_price_history` (`src/flows/trading-desk/phase-1/tools/get_price_history.ts`) returns `priceHistorySchema` = `{ source, ticker, range, bars: {date,open,high,low,close,volume}[] }`. **This is a tool output, persisted as a `tool_output` item in the request item log, NOT as resource state.** It is not in the clean memo/resource surface the rest of the Summary reads.

Two ways to get bars for the price chart (pick one — §4 recommends the resource):

- **(Preferred) Persist a price-history slice as a new session resource** via one Phase-1 tap (§4). Clean read via `useResource(session, "priceHistory")`. Survives the no-re-run constraint cleanly.
- **(Avoid) Dig bars out of `session.items`** by filtering `tool_output` items for the technical analyst's `get_price_history` call. This couples the Summary to item-log internals and item shape; do not do this.

If neither the resource nor extractable bars are present, the price chart degrades to its "not available" note. Entry/stop/target lines come from the trader memo regardless and can render as a standalone "trade levels" mini-panel without the series.

---

## 3. Data model / schemas

This feature is **read-mostly**. It introduces exactly one new persisted shape (the price-history slice, §4) and one new derived **client-side** aggregate type (`ReportSummary`) that lives in the UI layer.

### 3.1 Client-side aggregate (UI only — not persisted, not a generator output)

Lives in a new file `components/summary/aggregate.ts`. It is a plain TS type + a pure builder function. **BP-016 does NOT apply** — this is not a generator output and never reaches an LLM. No zod needed; it is derived from already-validated resource state.

```ts
// components/summary/aggregate.ts
import type { MemoState } from "@/src/flows/trading-desk/resources";
import type { ValuationSpineState } from "@/src/flows/trading-desk/valuation-spine-resource";
import {
  ALL_MEMO_KEYS, AGENTS, PHASE_1_MEMO_KEYS,
  type AgentName, type AnyMemoShortName,
} from "@/src/flows/trading-desk/agents";

/** One analyst's TLDR line for the Summary grid. */
export type AnalystTldr = {
  shortName: AnyMemoShortName;
  agent: AgentName;
  role: string;                 // AGENTS[agent].role
  hue: number;                  // AGENTS[agent].hue (for the badge accent)
  headline: string | null;      // memo.headline — the TLDR
  stance: "constructive" | "neutral" | "cautious" | null; // memo.rating
  dataQuality: "full" | "partial" | "unavailable" | null;
  topMetrics: Array<{ key: string; value: string }>; // first 2 entries of memo.metrics
  status: MemoState["status"];
};

/** The PM decision block. */
export type DecisionSummary = {
  finalRating: MemoState["finalRating"];          // 5-tier
  modelImpliedRating: MemoState["modelImpliedRating"];
  ratingBand: MemoState["ratingBand"];            // {floor, ceiling}
  ratingClamped: boolean | null;
  decisionSummary: string | null;
  decisionConfidence: number | null;
  agreesWithTrader: boolean | null;
  primaryScenario: string | null;
} | null;

/** The trade levels (from the trader memo). */
export type TradeLevels = {
  direction: "long" | "short" | "flat" | null;
  sizePct: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  holdingPeriod: MemoState["holdingPeriod"];
  invalidationCriteria: string[] | null;
} | null;

/** One node in the convergence strip: stance mapped to a -1..+1 axis. */
export type ConvictionNode = {
  agent: AgentName;
  role: string;
  hue: number;
  /** -1 (bearish/cautious/short/Sell) .. +1 (bullish/constructive/long/Buy). null if no stance. */
  axis: number | null;
  raw: string | null;           // the original label, shown on hover/title
};

export type ReportSummary = {
  ticker: string;
  date: string;
  analysts: AnalystTldr[];      // ordered by PHASE_1 publish order
  decision: DecisionSummary;
  trade: TradeLevels;
  conviction: ConvictionNode[]; // analysts + RM + trader + PM in pipeline order
  rmStance: { stance: "bullish" | "bearish" | "neutral" | null; conviction: number | null };
  criticalRisks: Array<{ description: string; severity: "high" | "medium" | "low"; raisedBy: string }>;
  keyDependencies: string[];
  scenarios: Array<{ name: string; probability: number; isPrimary: boolean }>;
  distribution: string | null;
  thesisAlignment: { alignment: string | null; confidence: number | null }; // labeled "Thesis alignment", NOT portfolio fit
};
```

`buildReportSummary(memosByKey, spine)` is a pure function: it takes a `Map<AnyMemoShortName, MemoState | null>` (keyed by short name) + the spine, and returns `ReportSummary`. It does all null-handling once so the components stay dumb. Stance→axis mapping:

```
constructive | bullish | long | Buy        → +1
Overweight                                  → +0.5
neutral | flat | Hold | Equal Weight        →  0
Underweight                                 → -0.5
cautious | bearish | short | Sell           → -1
(null/unknown)                              →  null  (rendered as a hollow node)
```

### 3.2 New persisted shape — price-history slice (only if §4 is built)

`src/flows/trading-desk/price-history-resource.ts` (new). Modeled on `valuation-spine-resource.ts`. This is written by a **plain handler tap**, never by a generator, so BP-016 does not apply. Keep it small (a thinned daily close series + a window label) so the client bundle stays lean:

```ts
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

export const priceHistorySliceSchema = z.object({
  ticker: z.string(),
  range: z.string(),
  source: z.string(),                 // provenance tag echoed from the tool ("fixture"|"finnhub"|"yahoo"|"unavailable")
  bars: z.array(z.object({ date: z.string(), close: z.number() })),
});

export type PriceHistorySlice = z.infer<typeof priceHistorySliceSchema>;

export const priceHistoryResource = defineResource({
  scope: "session",
  ref: "priceHistory",
  stateSchema: priceHistorySliceSchema.nullable(),
  default: null,
  writable: true,
});
```

Only `date` + `close` are persisted (the overlay needs a line, not candles). If a future candlestick view is wanted, widen the schema then — not now (YAGNI).

---

## 4. Server / persistence changes

**Past Reports already works with zero new persistence** (per the persistence Understand findings). The Summary view consumes the *same* hydrated session — so for the **memo / spine / scenario** parts of the Summary, there is **no server change at all**. The store interface methods already in play (`ResourceStateStore.get/getByPrefix`, `RequestStore.list({withItems})`, `SessionStore.getSessionState`) are exercised by `useSession`/`useResourceCollectionList`/`useResource` as they exist today.

The **only** server-touching change is the optional price-history resource (§3.2), which is needed for the price chart's series. It rides the existing filesystem `ResourceStateStore` (last-write-wins per key, no CAS, exactly like `valuationSpine`). No new store, no new route, no `StoreRegistry` change — the `StoreRegistry` is a fixed 11-store set and domain data must be a scope-keyed resource, which this is.

### 4.1 Price-history tap (flow change)

Add a Phase-1-terminal tap that persists the slice, modeled on `computeAndStoreSpine` (which already reads the warm `getOrFetch` cache / `loadFixture` with no extra network call and no `block.run()`):

```ts
// src/flows/trading-desk/store-price-history.ts  (new)
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getOrFetch } from "./lib/cache";
import { loadFixture } from "./lib/fixtures";
import { priceHistoryResource, type PriceHistorySlice } from "./price-history-resource";
import { sessionStateSchema } from "./state";

export const storePriceHistory = handler({
  name: "store-price-history",
  inputSchema: z.unknown(),
  outputSchema: z.void(),               // .tap(): no output, no `return input` (BP-012/BP-014)
  sessionStateSchema,
  resources: { priceHistory: priceHistoryResource },
  execute: async (_input, ctx) => {
    const { ticker, date, dataSource } = ctx.session.state;
    const args = { ticker, date };
    let payload: { source?: string; range?: string; bars?: Array<{ date: string; close: number }> } | null = null;
    try {
      payload = dataSource === "fixture"
        ? (loadFixture("get_price_history", args) as never)
        : await getOrFetch("get_price_history", args, async () => {
            throw new Error("cache miss — expected warm cache after Phase 1");
          });
    } catch {
      payload = null;
    }
    if (payload === null || payload.bars === undefined) return; // leave resource null → chart degrades
    const slice: PriceHistorySlice = {
      ticker,
      range: payload.range ?? "",
      source: payload.source ?? "unavailable",
      bars: payload.bars.map((b) => ({ date: b.date, close: b.close })),
    };
    await ctx.resources.priceHistory.patchState(slice);
  },
});
```

Wire it as a `.tap()` right after the spine tap in `analyzePipeline` (`flow.ts`), and register `priceHistory` in `defineFlow({ resources })`:

```ts
// flow.ts — in analyzePipeline, after `.tap(computeAndStoreSpine)`:
  .tap(storePriceHistory)
// flow.ts — in defineFlow resources:
  priceHistory: priceHistoryResource,
```

**BP-019:** the resource is defined in its own leaf file (`price-history-resource.ts`) that imports only core+zod; the tap imports the ref from there. No cycle.

`storePriceHistory` is **NOT** added to `client.expose` — `expose` is for session-state fields. The resource is read client-side via `useResource(session, "priceHistory")`, which works because the resource declares `client`-readability by default for `defineResource` (same as `valuationSpine`, which the app already reads via `useResource`). If a typecheck/runtime check shows `valuationSpine` needs an explicit `client: { state: { read: true } }`, mirror whatever `valuationSpineResource` does — they must match. (Verify against `valuation-spine-resource.ts` at build time; it currently relies on the `defineResource` default and the app reads it fine.)

---

## 5. Flow changes — summary

| Change | File | BP conformance |
|---|---|---|
| New `priceHistoryResource` (session-scoped, nullable, writable) | `price-history-resource.ts` (new) | BP-019 (leaf module), BP-023 (state schema uses `.nullable()`) |
| New `storePriceHistory` tap (plain handler, reads warm cache) | `store-price-history.ts` (new) | BP-011 (no block.run), BP-012/014 (`.tap`, no output, no return input) |
| `.tap(storePriceHistory)` after the spine tap; register `priceHistory` in flow resources | `flow.ts` | — |

**No new generator. No new generator output schema. BP-016 is not in scope for this feature** (the only schema added is a handler-written resource state, where `.nullable()`/`.default()` are correct per BP-023). The strict-output walker test does not need a new case.

If the executor decides to skip the price *series* entirely (ship trade-levels-only on the price panel for v1), then **drop §4 wholesale** — the Summary then has zero flow/server changes and is a pure UI feature. That is a legitimate v1 scope cut (see §10).

---

## 6. UI changes

### 6.1 View switch (in-report, not a route)

Per the routing Understand findings: there is no routing scaffold, and `FlowProvider` is mounted only in `page.tsx`. Adding an App-Router route would force a second `FlowProvider` mount or moving the provider into `layout.tsx`. For a single in-report toggle that consumes the *same already-bound session*, an **in-`ThesesPane` tab** is the minimal, correct choice — it reuses the exact `{ session, memoStatus }` props the pane already receives and needs no new provider, no new route, no session re-selection.

Add a 2-tab switch at the top of the `ThesesPane` doc area: **Theses** (current behavior) | **Summary** (new). The sidebar (`MemoSidebar`) stays mounted in both tabs; selecting a sidebar entry switches back to Theses. Default tab when a report is complete (`runComplete` / not streaming and items present): **Summary**. Default while streaming: **Theses** (the live memo-follow experience). This keeps the live run unchanged and makes the finished report open on the at-a-glance view.

`ThesesPane` gains one piece of local state:

```ts
const [tab, setTab] = useState<"theses" | "summary">("theses");
// derive initial/auto tab from session:
//   not streaming && items.length > 0 → prefer "summary" on first settle
// (use a ref-guarded effect mirroring the existing userSelectedRef pattern so a
//  manual tab choice is not overridden by the auto-rule — same idiom as the
//  auto-follow selection already in this file.)
```

The Summary tab renders `<ReportSummary session={session} memoStatus={memoStatus} />`. The Theses tab renders the existing sidebar+doc area unchanged.

> **Cross-feature note:** Features 01 (Past Reports) and 02 (New Analysis modal) introduce a top-level view switcher / nav in `TradingDeskApp`. This feature deliberately stays *inside* the report (the `ThesesPane`) so it composes cleanly regardless of how the outer shell evolves — the Summary is a property of a report, not a peer of Past Reports. If 01/02 land first and add a `TradingDeskApp`-level view enum, leave this tab where it is; it is orthogonal.

### 6.2 Component tree

New directory `components/summary/`:

```
components/summary/
  aggregate.ts                 buildReportSummary() + ReportSummary types (§3.1)
  report-summary.tsx           <ReportSummary> — top-level: reads hooks, builds aggregate, lays out sections
  decision-header.tsx          <DecisionHeader> — PM 5-tier rating bar (reuse PmHero idiom), model-implied band, confidence, trade one-liner
  conviction-strip.tsx         <ConvictionStrip> — convergence/divergence dots on a -1..+1 axis
  analyst-tldr-grid.tsx        <AnalystTldrGrid> — one row per analyst (badge, headline, stance chip, dq chip, 2 metrics)
  charts/
    bar-group.tsx              <BarGroup> — generic horizontal labeled bars (factor scores, etc.) — inline SVG
    scenario-strip.tsx         <ScenarioStrip> — probability strip (lift-and-restyle of PmHero L122-168)
    price-overlay.tsx          <PriceOverlay> — line chart + entry/stop/target/fair-value horizontal lines — inline SVG
  risk-panel.tsx               <RiskPanel> — critical risks + key dependencies
  chart-empty.tsx              <ChartEmpty label="..."> — the "not available for this run" note
```

`<ReportSummary>` reads:

```ts
const { items } = useResourceCollectionList(session, "memos", { limit: 50 });
const { clientData: spineRaw } = useResource(session, "valuationSpine");
const { clientData: priceRaw } = useResource(session, "priceHistory"); // null if §4 not built → price chart degrades
```

Then builds `Map<AnyMemoShortName, MemoState | null>` by mapping each `item.topic` (bare collection key like `p1/fundamentals`) back to its short name via a reverse lookup over `ALL_MEMO_KEYS` (each entry's `collectionKey` matches `item.topic`). Pass the map + spine into `buildReportSummary`. Memoize with `useMemo` keyed on `items`/`spineRaw` (BP-010: derived state via `useMemo`, not `useEffect`).

### 6.3 Charting approach — inline SVG (decision locked)

No chart library is installed and one must not be added (confirmed: `package.json` deps are `ai, next, react, streamdown, lucide-react, trading-signals, yahoo-finance2`; `packages/ui` has `motion` but no charting lib). The four charts are static, single-series shapes rendered from resolved data. Per the Understand recommendation:

- **Use hand-rolled inline SVG**, matching the existing idiom (PmHero's 5-tier rating bar `L177-199` and scenario probability strip `L122-168` are already inline flex/SVG-style bars with no library).
- Use the OKLCH `--c-*` design tokens (`--c-accent`, `--c-surface`, `--c-surface-2`, `--c-fg`, `--c-fg-faint`, `--c-fg-muted`, `--c-border`, `--c-warn`, `--c-live`, `--c-pulse`) so charts are visually consistent and theme-aware (light/dark flip via `data-theme`).
- Inline SVG server-renders cleanly under Next 16 RSC and adds zero bundle weight. recharts (~95KB + d3, client-island-only under RSC) is explicitly rejected. If rich interactivity is ever needed, revisit visx — not now.

`<PriceOverlay>` math (keep it a pure function, no ResizeObserver): map `close` values to a fixed viewBox (e.g. `0 0 600 160`), `x = i/(n-1)*600`, `y = (1 - (close-min)/(max-min)) * 160`. Draw the close line as a `<polyline>`. Draw `stopPrice` / `targetPrice` / `fairValue.fairValue` / latest-close as horizontal `<line>`s with right-edge labels, each clamped into the same min/max domain (lines outside the price domain widen the domain so they stay visible). If `bars.length < 2`, render `<ChartEmpty label="Price history unavailable for this run" />` plus a standalone trade-levels list (direction/size/stop/target) so the panel still earns its space.

### 6.4 ASCII mockups

**Summary tab — full layout**

```
┌─ ThesesPane ───────────────────────────────────────────────────────────────┐
│ ┌ sidebar ─┐  ┌─ doc area ──────────────────────────────────────────────┐ │
│ │ P6 …     │  │  [ Theses ] [ Summary ◄ ]                                │ │
│ │ P5 …     │  │ ┌─ Decision ─────────────────────────────────────────┐  │ │
│ │ P4 …     │  │ │ NVDA · 2026-05-06                    confidence 0.78│  │ │
│ │ P3 …     │  │ │ Sell  Underwt  Hold  [Overweight]  Buy   ← final     │  │ │
│ │ P2 …     │  │ │ model-implied: Overweight   band: Hold–Buy  (not    │  │ │
│ │ P1 …     │  │ │   clamped)                                          │  │ │
│ │          │  │ │ LONG · 1.8% NAV · stop 118 · target 165 · months    │  │ │
│ │          │  │ │ ✓ agrees with trader                                │  │ │
│ │          │  │ └────────────────────────────────────────────────────┘  │ │
│ │          │  │ ┌─ Conviction (convergence ↔ divergence) ────────────┐  │ │
│ │          │  │ │ bearish ─────────────────●─────●──●●──●●──●──► bull │  │ │
│ │          │  │ │         (each dot = one analyst/RM/trader/PM)       │  │ │
│ │          │  │ └────────────────────────────────────────────────────┘  │ │
│ │          │  │ ┌─ Analyst TLDRs ────────────────────────────────────┐  │ │
│ │          │  │ │ Fn Fundamentals  "Margins inflecting…"  ▲constr  full│ │ │
│ │          │  │ │ Tc Technical     "Above 50/200DMA…"     ●neutral part│ │ │
│ │          │  │ │ Nw News          "No catalysts near…"   ▼caution full│ │ │
│ │          │  │ │ … (9 rows)                                          │  │ │
│ │          │  │ └────────────────────────────────────────────────────┘  │ │
│ │          │  │ ┌ Factor scores ─┐ ┌ Scenarios ─────────────────────┐  │ │
│ │          │  │ │ value    ▓▓▓▓░  │ │ ▓▓▓▓▓ base 55% │ ▓▓ bull 25% …│  │ │
│ │          │  │ │ quality  ▓▓▓░░  │ └────────────────────────────────┘  │ │
│ │          │  │ │ factor   ▓▓▓▓▓  │                                      │ │
│ │          │  │ │ momentum ▓▓░░░  │                                      │ │
│ │          │  │ └────────────────┘                                      │ │
│ │          │  │ ┌─ Price & levels ───────────────────────────────────┐  │ │
│ │          │  │ │   ╱╲    ╱╲                          ── target 165   │  │ │
│ │          │  │ │  ╱  ╲╱╲╱  ╲___                      ── fair 152     │  │ │
│ │          │  │ │ ╱            ╲                       ── close 141    │  │ │
│ │          │  │ │                                     ── stop 118     │  │ │
│ │          │  │ └────────────────────────────────────────────────────┘  │ │
│ │          │  │ ┌─ Risks & dependencies ─────────────────────────────┐  │ │
│ │          │  │ │ ▲ HIGH  Customer concentration (aggressive)         │  │ │
│ │          │  │ │ ● MED   Multiple compression (conservative)         │  │ │
│ │          │  │ │ depends on: data-center demand holding through H2   │  │ │
│ │          │  │ └────────────────────────────────────────────────────┘  │ │
│ │          │  │  (Thesis alignment: partially-aligned · 0.62)  ← if any │ │
│ │          │  └─────────────────────────────────────────────────────────┘ │
│ └──────────┘                                                              │
└──────────────────────────────────────────────────────────────────────────┘
   StatusBar disclaimer ("Research / demo only. …") stays visible below.
```

**Conviction node mapping (one dot per participant)**

```
order: Fn Sn Nw Tc Cp Mk Ma Qt Dx | RM | Trader | PM
axis:  each mapped to -1..+1 by §3.1 rule; hollow dot when stance is null.
hue:   AGENTS[agent].hue gives the dot color (per-agent accent).
A tight cluster = convergence; a spread = divergence. Label the two ends.
```

### 6.4.1 Empty / partial states (must handle)

| Condition | Behavior |
|---|---|
| PM memo not published | DecisionHeader shows "Decision pending" with whatever phases did publish; no fabricated rating. |
| An analyst memo `error`/`unavailable` | Its TLDR row shows the role + a muted "no usable data" line + the dq chip; its conviction dot is hollow. |
| `valuationSpine` null | Factor bar group → `<ChartEmpty label="Valuation spine not computed for this run" />`. |
| `priceHistory` null / <2 bars | Price panel → trade-levels list only + `<ChartEmpty>` for the series. |
| `scenarios` null/empty | Scenario strip → `<ChartEmpty label="No scenario forecast for this run" />`. |
| Run `stoppedReason !== null` (ticker unresolvable / no data) | Summary shows a single banner echoing `stoppedMessage`; no charts. (Read `stoppedReason`/`stoppedMessage` via `useClientData` — both are already in `client.expose`.) |

---

## 7. Exact file create / modify list

**Create:**

- `examples/trading-desk/components/summary/aggregate.ts` — `ReportSummary` types + `buildReportSummary()` (pure).
- `examples/trading-desk/components/summary/report-summary.tsx` — `<ReportSummary>` top-level.
- `examples/trading-desk/components/summary/decision-header.tsx`
- `examples/trading-desk/components/summary/conviction-strip.tsx`
- `examples/trading-desk/components/summary/analyst-tldr-grid.tsx`
- `examples/trading-desk/components/summary/risk-panel.tsx`
- `examples/trading-desk/components/summary/chart-empty.tsx`
- `examples/trading-desk/components/summary/charts/bar-group.tsx`
- `examples/trading-desk/components/summary/charts/scenario-strip.tsx`
- `examples/trading-desk/components/summary/charts/price-overlay.tsx`
- `examples/trading-desk/test/report-summary-aggregate.spec.ts` — unit tests for `buildReportSummary` (stance→axis mapping, null/partial memo handling, ordering). Pure function → fast, offline, matches the suite's "verify wiring, not LLM" stance.

**Create only if §4 (price series) is built:**

- `examples/trading-desk/src/flows/trading-desk/price-history-resource.ts`
- `examples/trading-desk/src/flows/trading-desk/store-price-history.ts`
- `examples/trading-desk/test/store-price-history.spec.ts` — verifies the tap patches the resource from a fixture payload and leaves it null on cache miss (mirrors a `compute-spine` test if one exists).

**Modify:**

- `examples/trading-desk/components/theses/theses-pane.tsx` — add the `tab` state, the Theses|Summary switch UI, and the auto-tab effect; render `<ReportSummary>` in the Summary tab. (Sidebar selection sets `tab = "theses"`.)
- `examples/trading-desk/src/flows/trading-desk/flow.ts` — **only if §4 built:** import + `.tap(storePriceHistory)` after `.tap(computeAndStoreSpine)`, and add `priceHistory: priceHistoryResource` to `defineFlow({ resources })`.
- `examples/trading-desk/CLAUDE.md` — add a short "Summary view" note under the layout/conventions section (per "document user-facing functionality" rule).
- `.changeset/*.md` — a user-facing changeset for the example (BP-022). The example app does publish a changeset for user-visible changes; if the example is marked private/no-publish in the repo's changeset config, ship an empty changeset instead.

**Do NOT modify:**

- `app/page.tsx` (no provider/route change — the tab lives in `ThesesPane`).
- `resources.ts` `memoStateSchema` (the Summary reads existing fields; it adds none).
- Any generator or its output schema (no BP-016 surface added).
- `test/output-schemas-strict.spec.ts` (no new generator output).

---

## 8. Dependencies — what must exist first

- **Nothing blocks the read-only core.** The memo collection, valuation spine, scenario forecaster, and PM decision fields all exist in stored state today. The Summary's decision header, conviction strip, analyst TLDR grid, factor bars, scenario strip, and risk panel are buildable against `main` right now.
- **Price *series* chart** depends on §4 (the new `priceHistory` resource + tap). If §4 is cut, the price panel degrades to trade-levels-only — still shippable.
- **Portfolio weight before/after chart** depends on **Feature 04 (portfolio-aware analysis)** AND **Feature 03 (portfolio holdings data)** existing. Neither exists today (grep confirms no portfolio state anywhere). **Do not build this chart in this feature.** §9 specifies the seam so it slots in later.
- **FIX-709 investor-lens conviction signal** (Feature 06's sibling) is optional: if it ships, its lens stances feed extra nodes into the conviction strip (§9). If absent, the strip renders the analyst/RM/trader/PM nodes only. **No hard dependency.**
- Build order within this feature: `aggregate.ts` (+ its test) first → leaf components → `report-summary.tsx` → wire the tab in `theses-pane.tsx`. Then (optional) §4 flow/resource work.

---

## 9. Real-portfolio considerations

This page is explicitly positioned for someone about to act with real money. Hold these lines:

1. **No invented numbers.** Every figure traces to a named stored field (table in §2.1). The aggregate builder must not compute returns, P&L, or position sizing from thin air. `sizePct` is "% of NAV" *as the trader proposed it* — label it exactly that, not a dollar amount (there is no account value in scope without Feature 04).
2. **Provenance is visible.** Surface each analyst's `dataQuality` chip and the price-history `source` tag. A `dataQuality: "unavailable"` analyst, or a `source: "unavailable"` price slice, must read as "missing signal", never as a real value. This mirrors BP-020 (live mode never silently substitutes fixture data) at the UI layer.
3. **Rating provenance + clamping.** Show `modelImpliedRating` and `ratingBand` next to the PM `finalRating`, and flag `ratingClamped` when true ("PM rating clamped to model band"). An investor should see when the human-style decision was pulled toward the quantitative envelope.
4. **Thesis-fit ≠ portfolio-fit.** Phase 6 `alignment` audits the *user's thesis* against the pipeline. Label it "Thesis alignment" only. Do **not** present it as "portfolio fit" — conflating them would mislead the exact decision this page supports.
5. **Portfolio-fit is genuinely absent.** There is no current-weight, no account, no holdings in state today. Promising a "portfolio weight before/after" chart now would require fabricating positions. Omit it until Features 03/04 land. When they do, the seam is: read the portfolio resource (Feature 03) + the PM's `portfolioAction`/`targetWeightPct`/`account` verdict (Feature 04's new `portfolioDecisionOutputSchema` fields) and render a before/after bar in `charts/`. Add a `portfolioFit` block to `ReportSummary` only then.
6. **Disclaimer persists.** The non-dismissable `StatusBar` disclaimer stays on screen in the Summary view. Do not hide chrome to make the page look more "product-like".
7. **Stale-run honesty.** If `stoppedReason !== null`, the Summary shows the stop banner and no charts — never a half-built decision that looks complete.

---

## 10. What NOT to build (scope boundaries)

- **No chart library.** Inline SVG only. Do not add recharts/visx/chart.js/d3/nivo to `package.json`.
- **No new route / no App-Router page.** The Summary is an in-`ThesesPane` tab. Do not add `app/summary/` or move `FlowProvider` into `layout.tsx`.
- **No portfolio-weight chart, no portfolio-fit verdict, no holdings read.** That is Features 03/04. Leave the seam (§9.5), build nothing.
- **No new generator, no LLM call, no re-run path.** The Summary aggregates stored state. No "regenerate summary" button.
- **No `memoStateSchema` changes.** Read existing fields; add none.
- **No item-log scraping for the price series.** Use the §4 resource or degrade. Do not filter `session.items` for `tool_output` bars.
- **No candlestick/OHLC chart.** Persist and render `close`-only (§3.2). Volume, open/high/low are out of scope.
- **No interactivity** (tooltips, zoom, pan, crosshair). Static figures. If a reviewer wants interactivity later, that is a separate change (and visx, not recharts).
- **No multi-report comparison.** One report's Summary only. Cross-report views belong to Past Reports (Feature 01).
- **No PDF/print/export.** Out of scope.

---

## 11. Open questions

1. **Default tab on a finished report — Summary or Theses?** This spec defaults finished reports to **Summary** and live/streaming runs to **Theses**. If the owner prefers the report to always open on Theses (Summary strictly opt-in), flip the auto-rule — it is one ref-guarded effect. Worth a quick confirm since it changes the first impression of every finished report.
2. **Ship the price *series* now, or trade-levels-only for v1?** §4 (the price-history resource + tap) is the only flow/server work in the whole feature. Cutting it makes the Summary a pure UI add with zero flow risk, at the cost of the price line (levels still render). Recommend: **ship §4** — the price-with-entry-context chart is the single most decision-relevant visual for someone about to act, and the tap is cheap (reads the warm cache, no extra network). But it is a clean cut if flow changes are unwanted this pass.
3. **Conviction-strip node weighting.** Should the PM/trader/RM nodes be visually heavier (larger dots) than the nine analyst nodes, to signal that synthesis carries more weight than a single analyst? Or all-equal to honestly show the raw spread? Leaning all-equal (honest), with the PM node outlined to mark "the decision", but this is a design call.
4. **Does `priceHistoryResource` need an explicit `client: { state: { read: true } }`?** `valuationSpineResource` reads client-side via `useResource` today without one, so the `defineResource` default appears client-readable. The executor should confirm against the running app and mirror whatever `valuationSpine` does — they must match. (Low risk, build-time verifiable.)
5. **Fixture coverage for the price slice.** The `get_price_history` fixture exists for NVDA (`fixtures/NVDA/2026-05-06/`). Confirm its `bars` are populated so the price chart renders in the default fixture demo. If thin, the chart degrades gracefully but the flagship demo loses its best visual.
