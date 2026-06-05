# Design: Portfolio Flow Separation (Spec 1 of 2)

**Date:** 2026-06-05
**Status:** Design, approved — ready for an implementation plan.
**Type:** Structural + scoping change to `labs/trading-desk`. Behavior-preserving for portfolio and analysis features; the change is *where* the portfolio domain lives and *how* its data is shared.
**Context:** The trading-desk runs one `trading-desk` flow that serves both the analysis pipeline and the portfolio system-of-record. Portfolio actions and the Portfolio view borrow report (analysis) sessions, and `portfolioQuotes`/`pdfImport` (session-scoped) attach to whatever report session is active. This splits the portfolio domain into its own flow.

**Companion follow-up:** Spec 2 — *Analysis-side resource regroup* (regroup the report flow's scattered resource files into a module). Independent; lands after this. Not designed here.

---

## 1. Goal

Give the portfolio domain its own flow (`trading-desk-portfolio`) with its own sessions and action surface, so it stops hijacking report sessions. The report flow consumes portfolio data through **user-scoped shared resources** — the framework's built-in cross-flow channel — not a client-side snapshot bridge. No portfolio or analysis behavior changes; this is a structural + scoping move.

---

## 2. The sharing mechanism (the crux)

A user-scoped resource with `flowIsolation: false` (the default) keys at bare `{userId}` and is **shared across every flow** for that user (`resolveUserStorageKey`, `packages/server/src/stores/scope-keys.ts`). That is the cross-flow channel: the portfolio flow writes the shared resource; the report flow declares the same resource and reads it (server-side at seed, and client-side for the account picker). No snapshot bridge, no two-provider React plumbing, no freezing a snapshot from a dispatch input.

The original trading-desk **opted accounts into isolation** (`flowIsolation: true` → `{userId}:trading-desk`). That was a reasonable single-flow default; for the split we flip it off.

**Caveat — FIX-735.** `effectiveScopeIsolation` is computed *per flow-scope*, not per resource: if *any* user-scoped resource on a flow is isolated, that flow's entire user record namespaces to `{userId}:{flowKind}`. So sharing requires **both** flows to have zero isolated user-scoped resources. We satisfy this by flipping `accounts` **and** `specialInstructions` to shared (the report flow's only other user-scoped resource). FIX-735 tracks the underlying framework bug (per-resource `flowIsolation: false` should carve out independently); we sidestep it here because our design wants *everything* shared — there is no mixed shared/isolated requirement in either flow.

---

## 3. The two flows

**`trading-desk-portfolio` (new) — the system of record + write surface.**
- Actions: `saveAccount`, `deleteAccount`, `importHoldings`, `deleteHolding`, `getQuotes`, `extractHoldingsFromPdf`.
- Resources: `accounts` (user-scoped, **shared**), `portfolioQuotes` (user-scoped, **shared** — see §5), `pdfImport` (session-scoped transient; no sharing needed).
- Owns the Portfolio view.
- Sessions are incidental interaction handles (§6); near-empty `sessionStateSchema`.

**`trading-desk` (existing) — analysis, now a consumer of shared portfolio data.**
- Keeps `analyze`/`setInstructions` and all analysis resources.
- **Declares the same shared `accounts` + `portfolioQuotes` resources, read-only.**
- Flips `specialInstructions` to shared (`flowIsolation: false`) so its effective user-scope isolation is false (FIX-735 caveat). Harmless — `specialInstructions` has no other consumer.
- At `seedSession`, reads accounts + quotes and computes the portfolio snapshot **server-side** (§9), freezing it onto session state for run-time auditability.
- Drops the 6 portfolio actions and the write-side resource ownership.

---

## 4. What moves vs stays

| Item | Disposition |
|------|-------------|
| `portfolio/` folder (schemas, csv, pdf, quotes, actions, extract-*) | **Moves** → `src/flows/trading-desk-portfolio/`, resources grouped into one `portfolio-resources.ts` (accounts + quotes + pdfImport) per the per-module convention |
| The 6 portfolio actions | **Move** to the portfolio flow |
| `accountsCollection`, `portfolioQuotesResource` definitions | **Move** to the portfolio flow; **imported + declared by both flows** (the shared contract) |
| `pdfImportResource` | Moves; stays session-scoped (portfolio flow only) |
| `build-portfolio-context.ts` (pure snapshot builder) | **Moves to the report flow's seed** — it now runs server-side from the shared read |
| `PortfolioContextInput` (snapshot shape) | **Stays** in the report flow's `flow-schema.ts` (it's the pipeline's input shape, now produced server-side) |
| `portfolio` + `selectedAccountIds` session-state fields | **Stay** in the report flow's `state.ts`. `portfolio` is now populated server-side at seed; `selectedAccountIds` stays a dispatch input (a per-run UI choice) |
| `specialInstructions` | Stays on the report flow; flag flipped to shared |

The shared resource definitions (`accountsCollection`, `portfolioQuotesResource`) are **pure leaf modules** (no flow runtime — BP-019), so the report flow importing them from the portfolio flow's resources module is acyclic and acceptable. The dependency direction is report → portfolio-flow *leaf*; the portfolio flow never imports the report flow.

---

## 5. Resource scoping changes

- `accounts`: `flowIsolation: true → false` (bare `{userId}`, shared).
- `portfolioQuotes`: **session-scoped → user-scoped, shared**. So the report flow can read the last-known quotes. Lifecycle: last-priced-per-user, overwritten on each `getQuotes`; the snapshot freezes a copy at seed anyway.
- `specialInstructions`: `flowIsolation: true → false` (required collateral, §2 caveat).
- `pdfImport`: unchanged (session-scoped).

Both flows' effective user-scope isolation is then `false` → both read/write bare `{userId}` → the shared resources resolve to the same records.

---

## 6. Sessions

The portfolio domain's data lives at user scope, **independent of any session**, so portfolio sessions are just interaction handles for the UI to bind reads/writes through. Sensible default: let the portfolio flow auto-create/bind a session for the Portfolio view; no deterministic singleton needed. Session-per-account conversation threading (a future idea) is a clean add the user-scoped model already supports with **zero data-model rework** — not built here. The portfolio `sessionStateSchema` is near-empty.

---

## 7. Server

`lib/server.ts` registers both flows: `registry.register(tradingDeskFlow); registry.register(portfolioFlow);`. The registry and `createFlowApiRouter` are already multi-flow; this is a one-line add.

---

## 8. Client

No bridge, no nested providers. Each view renders under its own flow's provider:
- **Portfolio view** → a `trading-desk-portfolio` `FlowProvider`; `PortfolioPane` already takes its `session` as a prop, so it just receives the portfolio session.
- **Desk / Reports views** → the existing `trading-desk` `FlowProvider`.
- The **new-analysis dialog** reads the shared `accounts` through the *report* session (the report flow declares the shared resource, so it's readable in that context) to render the account picker that sets `selectedAccountIds`.

Nothing crosses the client boundary, because the data is shared at the storage layer. The view switcher chooses which provider subtree renders.

---

## 9. The snapshot, computed server-side

`build-portfolio-context` (a pure function today, called client-side at dispatch) moves into the report flow's `seedSession`:
1. Read the shared `accounts` (+ `portfolioQuotes`) via the report flow's user-scoped read.
2. Compute per-holding `marketValue = quantity × last-known quote`, `totalNav`, `weightPct` — degrading any unpriced holding to `marketValue: null` (never fabricated, exactly as today).
3. Scope to `selectedAccountIds` (or all accounts when empty).
4. Freeze the result onto `state.portfolio` at seed (the `userThesis` precedent — the pipeline never recomputes).

The `analyze` action **drops `portfolio` from its dispatch input** (now read server-side) and keeps `selectedAccountIds`. Null path (no accounts) → portfolio-blind run, exactly as today.

**Quotes freshness:** last-known shared quotes (whatever the Portfolio view last priced). Matches today's behavior and degrades gracefully. A fresh-fetch-at-seed for the analyzed holdings is a documented future upgrade, not v1.

---

## 10. Data — clean break

Flipping `accounts`/`portfolioQuotes`/`specialInstructions` storage keys (and moving accounts to a different flow) orphans existing `{userId}:trading-desk` records. Accepted (the store is `developmentOnly: true` and doesn't survive a redeploy). Re-import via CSV/PDF takes seconds.

---

## 11. Best practice

Add to `docs/contributing/best-practices.md`: **user-scoped resources should default to shared (`flowIsolation` unset/false); isolate only for a deliberate privacy reason.** The original `accounts: flowIsolation: true` is the anti-pattern this corrects. (The framework already defaults to shared; this BP makes the intent explicit and warns against reflexive isolation.)

---

## 12. Verification

- `pnpm --filter @flow-state-dev/trading-desk typecheck` clean; the suite stays green.
- Portfolio-flow tests: the existing csv/pdf/quotes/action tests move with the code, repointed to the new flow (they mock providers, so they pass unchanged); add a portfolio-flow session-binding smoke.
- Report-flow tests: a **cross-flow sharing test** — accounts written through the portfolio flow are readable through the report flow at bare `{userId}`; a server-side snapshot test (seed reads shared accounts+quotes → frozen `state.portfolio`); an assertion the report flow no longer registers the 6 portfolio actions.
- The pure `build-portfolio-context` unit test moves unchanged.
- `fsdev run` (a portfolio-aware `full` run) + the app smoke (Portfolio view reads/writes against the portfolio flow; an analysis run sees the shared holdings) — the integration gate.

---

## 13. Non-goals

- **Spec 2** — analysis-side resource regroup (separate spec/PR).
- **Not fixing FIX-735** — we sidestep it (everything shared).
- No conversation threading / session-per-account (future).
- No fresh-quote-fetch at seed (future).
- No new portfolio features; no change to the analysis pipeline or the portfolio-aware sizing logic.
