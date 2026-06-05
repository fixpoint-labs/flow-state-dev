# Portfolio Flow Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the portfolio system-of-record into its own `trading-desk-portfolio` flow; the report flow consumes portfolio data through user-scoped shared resources (no client bridge).

**Architecture:** Incremental and app-stays-working at every commit. First flip the resource scopes to shared and move snapshot computation server-side (still one flow) — that's the real behavioral change, fully testable in isolation. Then split the flow (move the portfolio module, register both flows, report flow imports the shared resource leaves). Then the cross-flow test, the two-provider client, docs. Spec: [`trading-desk-portfolio-flow-separation.md`](./trading-desk-portfolio-flow-separation.md) (FIX-736).

**Tech Stack:** TypeScript, `@flow-state-dev/core` resource/flow API, `@flow-state-dev/react` FlowProvider, Next.js app, pnpm, vitest, `fsdev run`.

---

## Conventions

- Paths under `labs/trading-desk/` (abbrev `~/`); flow code under `~/src/flows/`.
- `TC` = `pnpm --filter @flow-state-dev/trading-desk typecheck`; `TEST` = `pnpm --filter @flow-state-dev/trading-desk test`.
- **Run tasks in order, one commit each — they share `flow.ts`/`state.ts`/`seedSession`.** The app must stay working at every commit.
- New behavior (server-side seed snapshot, cross-flow read) gets genuine tests; moved code keeps its existing tests (repointed). A `flowIsolation` / scope change that alters a prompt, schema, or runtime output beyond the documented scoping is a bug.

---

## File structure

```
~/src/flows/trading-desk/                  (report flow — analysis, now a CONSUMER of shared portfolio data)
  flow.ts            drop the 6 portfolio actions + pdfImport; KEEP declaring accounts + portfolioQuotes (read); specialInstructions shared
  flow-schema.ts     analyzeInputSchema drops `portfolio` (keeps selectedAccountIds)
  orchestration/guards.ts   seedSession computes the snapshot server-side from the shared read
  special-instructions-resource.ts   flowIsolation true→false
~/src/flows/trading-desk-portfolio/        (NEW flow — system of record + write surface)
  flow.ts            defineFlow: 6 actions + accounts/portfolioQuotes/pdfImport resources + near-empty state
  state.ts           near-empty sessionStateSchema
  portfolio-resources.ts   GROUPED: accountsCollection (shared) + portfolioQuotesResource (user-shared) + pdfImportResource (session)
  (everything moved from ~/src/flows/trading-desk/portfolio/: schema, csv, pdf, actions, get-quotes, extract-*)
~/lib/server.ts      register both flows
~/app/page.tsx       Portfolio view under a trading-desk-portfolio FlowProvider; remove client snapshot build
~/src/flows/trading-desk/build-portfolio-context.ts   MOVES here (report side); called by seedSession
```

---

## Task 0: Baseline

- [ ] Run `TC && TEST` → clean + green. Note the count. Confirm branch `feat/trading-desk-portfolio-flow` (off latest `main`). No commit.

---

## Task 1: Flip resource scopes to shared (still one flow)

Makes all three user-scoped resources resolve to bare `{userId}`. Still one flow, so no behavior change beyond storage keys (clean break, §10) + `portfolioQuotes` becoming per-user instead of per-session.

**Files:** `~/src/flows/trading-desk/portfolio/portfolio-resources.ts`, `~/src/flows/trading-desk/portfolio/portfolio-quotes-resource.ts`, `~/src/flows/trading-desk/special-instructions-resource.ts`.

- [ ] **Step 1: `accounts` → shared.** In `portfolio-resources.ts`, change `flowIsolation: true` to `flowIsolation: false` on `accountsCollection`. Update the file-header comment (drop the "`{userId}:trading-desk`" claim → "bare `{userId}`, shared across flows").

- [ ] **Step 2: `portfolioQuotes` → user-scoped shared.** In `portfolio-quotes-resource.ts`, change `scope: "session"` to `scope: "user"` and add `flowIsolation: false`. Update the doc comment (it's now a per-user last-known cache, readable cross-flow by the report flow). Keep `stateSchema`, `default: null`, `writable: true`, `client: { exclude: [] }`.

- [ ] **Step 3: `specialInstructions` → shared.** In `special-instructions-resource.ts`, change `flowIsolation: true` to `flowIsolation: false`. Update the comment (bare `{userId}`; required so the report flow's effective user-scope isolation is false — FIX-735).

- [ ] **Step 4: Verify + commit.** `TC` clean; `TEST` green (tests mock providers + don't assert storage keys). If a test asserts session-scoped quotes or the `:trading-desk` key, repoint it to the new scope.
```bash
git add -A && git commit -m "refactor(trading-desk): make accounts/portfolioQuotes/specialInstructions user-scoped shared (flowIsolation off)"
```

---

## Task 2: Compute the snapshot server-side at seed; drop `portfolio` from the dispatch input

The behavioral core. `seedSession` reads the shared accounts + quotes and computes the snapshot, instead of receiving it as dispatch input.

**Files:** `~/src/flows/trading-desk/orchestration/guards.ts`, `~/src/flows/trading-desk/flow-schema.ts`, `~/src/flows/trading-desk/portfolio/build-portfolio-context.ts` (stays for now), `~/app/page.tsx`, tests.

- [ ] **Step 1: Write the failing test** — `~/test/seed-portfolio-snapshot.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import flow from "../src/flows/trading-desk/flow";

describe("seedSession portfolio snapshot (server-side)", () => {
  it("computes state.portfolio from the user's accounts + quotes, scoped by selectedAccountIds", async () => {
    const t = testFlow(flow, { userId: "u1" });
    // Seed a user-scoped account + a quote via the portfolio actions.
    await t.sendAction("saveAccount", {
      accountId: null, name: "Taxable", type: "taxable", cashBalance: 1000,
      holdings: [{ ticker: "NVDA", quantity: 10, costBasis: 100 }],
    });
    await t.sendAction("getQuotes", { tickers: ["NVDA"], dataSource: "fixture" });
    // Run analyze WITHOUT passing a portfolio snapshot.
    await t.sendAction("analyze", { ticker: "NVDA", date: "2026-05-06", costPreset: "fast", dataSource: "fixture", selectedAccountIds: [] });
    const state = await t.getState();
    expect(state.portfolio).not.toBeNull();
    expect(state.portfolio.holdings.map((h) => h.ticker)).toContain("NVDA");
    expect(state.portfolio.accounts).toHaveLength(1);
  });
});
```

> Adapt the harness call shape to this repo's `testFlow`/`testBlock` contract (see `docs/architecture/testing.md` and a sibling `~/test/*.spec.ts`). The assertion — *seed populates `state.portfolio` from stored accounts, no dispatch input* — is the intent.

- [ ] **Step 2: Run it → FAIL** (`seedSession` still reads `input.portfolio`, which no longer exists / is undefined). `pnpm --filter @flow-state-dev/trading-desk test seed-portfolio-snapshot`.

- [ ] **Step 3: Make `seedSession` compute the snapshot.** In `guards.ts`, add `resources` + the read/compute. Import `accountsCollection` + `portfolioQuotesResource` from `../portfolio/...` and `buildPortfolioContext` from `../portfolio/build-portfolio-context`:

```ts
export const seedSession = handler({
  name: "seed-session",
  inputSchema: analyzeInputSchema,
  outputSchema: analyzeInputSchema,
  sessionStateSchema,
  resources: { accounts: accountsCollection, portfolioQuotes: portfolioQuotesResource },
  execute: async (input, ctx) => {
    // ...existing thesis-freeze block unchanged...

    // Portfolio snapshot, computed server-side from the shared user-scoped
    // accounts + last-known quotes (replaces the client-built dispatch input).
    const refs = await ctx.resources.accounts.list();
    const allAccounts = refs.map((r) => r.state); // ResourceRef.state is a sync getter
    const scoped = input.selectedAccountIds.length
      ? allAccounts.filter((a) => input.selectedAccountIds.includes(a.accountId))
      : allAccounts;
    const q = ctx.resources.portfolioQuotes.state; // confirm single-resource read accessor (.state vs .getState())
    const portfolio = buildPortfolioContext(scoped, q?.quotes ?? [], q?.fetchedAt ?? null);

    await ctx.session.patchState({
      // ...existing fields unchanged...
      portfolio,                       // was: input.portfolio
      selectedAccountIds: input.selectedAccountIds,
    });
    return input;
  },
});
```

- [ ] **Step 4: Drop `portfolio` from `analyzeInputSchema`.** In `flow-schema.ts`, delete the `portfolio: portfolioContextInput.nullable().default(null)` field (KEEP `selectedAccountIds` and the exported `portfolioContextInput`/`PortfolioContextInput` — the snapshot shape is still the state-field type seedSession produces).

- [ ] **Step 5: Stop the client passing `portfolio`.** In `app/page.tsx`: remove `portfolio: portfolioSnapshot` from the `sendAction("analyze", {...})` payload (~line 287/338); delete the now-unused client snapshot build (`accountsList`/`quotesClientData`/`portfolioSnapshot` `useMemo` + the `buildPortfolioContext` import, ~lines 116–140) and the `portfolio` field from the local dispatch type (~line 177). Leave `selectedAccountIds: []`.

- [ ] **Step 6: Run the test → PASS.** Then `TC` + `TEST`. Fix the existing client-snapshot test (`~/test/*portfolio-context*` or similar) — it now asserts a server-side path; repoint or remove the client-dispatch assertion. The pure `build-portfolio-context` unit test stays green unchanged.

- [ ] **Step 7: Commit** `refactor(trading-desk): compute the portfolio snapshot server-side at seed; drop portfolio from the analyze input`.

---

## Task 3: Split — create the `trading-desk-portfolio` flow, move the module, register both

The big structural move. Atomic (the report flow's imports must repoint in the same commit).

**Files:** create `~/src/flows/trading-desk-portfolio/**`; modify `~/src/flows/trading-desk/flow.ts`, `~/lib/server.ts`; move `~/src/flows/trading-desk/portfolio/**` and move `build-portfolio-context.ts` to the report flow root.

- [ ] **Step 1: Move + group the portfolio module.** `git mv` the contents of `~/src/flows/trading-desk/portfolio/` to `~/src/flows/trading-desk-portfolio/`. Group the three resource defs into one `~/src/flows/trading-desk-portfolio/portfolio-resources.ts` (export `accountsCollection`, `portfolioQuotesResource`, `pdfImportResource` + the `portfolioResources` map) — fold `portfolio-quotes-resource.ts` + `portfolio-pdf-resource.ts` into it; keep the pure leaves (`portfolio-schema.ts`, `portfolio-csv.ts`, `portfolio-pdf.ts`, `extract-pdf-text.server.ts`) as their own files. Repoint all intra-module imports.

- [ ] **Step 2: Move `build-portfolio-context.ts` to the report flow.** `git mv ~/src/flows/trading-desk/portfolio/build-portfolio-context.ts ~/src/flows/trading-desk/build-portfolio-context.ts`. It imports `PortfolioContextInput` from `./flow-schema` (now sibling) and `AccountState` from `../trading-desk-portfolio/portfolio-resources` (or the portfolio-schema leaf) — a report→portfolio leaf import (acyclic, §4). Repoint `guards.ts`'s import accordingly.

- [ ] **Step 3: Create the portfolio flow.** `~/src/flows/trading-desk-portfolio/state.ts` — a near-empty `sessionStateSchema` (`z.object({})` or a minimal UI field). `~/src/flows/trading-desk-portfolio/flow.ts`:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { saveAccount, deleteAccount, importHoldings, deleteHolding } from "./portfolio-actions";
import { getQuotes } from "./get-quotes";
import { extractHoldingsFromPdf } from "./extract-holdings-action";
import { accountsCollection, portfolioQuotesResource, pdfImportResource } from "./portfolio-resources";
import { sessionStateSchema } from "./state";

const portfolioFlow = defineFlow({
  kind: "trading-desk-portfolio",
  requireUser: true,
  actions: {
    saveAccount: { block: saveAccount },
    deleteAccount: { block: deleteAccount },
    importHoldings: { block: importHoldings },
    deleteHolding: { block: deleteHolding },
    getQuotes: { block: getQuotes },
    extractHoldingsFromPdf: { block: extractHoldingsFromPdf },
  },
  session: { stateSchema: sessionStateSchema },
  resources: {
    accounts: accountsCollection,            // user-scoped shared
    portfolioQuotes: portfolioQuotesResource, // user-scoped shared
    pdfImport: pdfImportResource,            // session-scoped transient
  },
});
export default portfolioFlow({ id: "default" });
```

- [ ] **Step 4: Slim the report flow + repoint its portfolio imports.** In `~/src/flows/trading-desk/flow.ts`: remove the 6 portfolio action imports + entries and the `pdfImport` resource; change the `accounts`/`portfolioQuotes` imports to come from `../trading-desk-portfolio/portfolio-resources`; KEEP declaring `accounts` + `portfolioQuotes` in `resources` (read-only, for the seed snapshot) and `specialInstructions`. **Also repoint `orchestration/guards.ts`** — its `seedSession` (Task 2) imports `accountsCollection`/`portfolioQuotesResource` from the now-moved module; point them at `../../trading-desk-portfolio/portfolio-resources` (and `build-portfolio-context` at `../build-portfolio-context`, Step 2). `git grep -n 'from ".*portfolio'` across `~/src/flows/trading-desk/` to catch every stale import.

- [ ] **Step 5: Register both flows.** In `~/lib/server.ts`: `import portfolioFlow from "@/src/flows/trading-desk-portfolio/flow";` then `registry.register(tradingDeskFlow); registry.register(portfolioFlow);`.

- [ ] **Step 6: Move + repoint the portfolio tests.** `git mv` the portfolio action/csv/pdf/quotes specs alongside or repoint their imports to `~/src/flows/trading-desk-portfolio/`. They mock providers, so they pass unchanged once imports resolve.

- [ ] **Step 7: Verify + commit.** `TC` clean; `TEST` green.
```bash
git add -A && git commit -m "refactor(trading-desk): split the portfolio domain into the trading-desk-portfolio flow"
```

---

## Task 4: Cross-flow sharing test (new-behavior guard)

- [ ] **Step 1: Write the test** — `~/test/portfolio-cross-flow-sharing.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import reportFlow from "../src/flows/trading-desk/flow";
import portfolioFlow from "../src/flows/trading-desk-portfolio/flow";

describe("portfolio user-scoped sharing", () => {
  it("an account written via the portfolio flow is readable via the report flow (bare {userId})", async () => {
    const userId = "shared-user";
    const p = testFlow(portfolioFlow, { userId });
    await p.sendAction("saveAccount", {
      accountId: null, name: "IRA", type: "IRA", cashBalance: 500, holdings: [],
    });
    // The report flow, same userId, reads the shared accounts collection at seed.
    const r = testFlow(reportFlow, { userId });
    await r.sendAction("analyze", { ticker: "NVDA", date: "2026-05-06", costPreset: "fast", dataSource: "fixture", selectedAccountIds: [] });
    const state = await r.getState();
    expect(state.portfolio?.accounts.some((a) => a.label === "IRA")).toBe(true);
  });
});
```

> Adapt to the repo's `testFlow` contract. The assertion — *portfolio-written data is visible to the report flow at bare `{userId}`* — is the bridge this whole change rests on.

- [ ] **Step 2: Run → PASS** (both flows are effective-isolation-false → bare `{userId}`). If it fails, an isolated user-scoped resource is forcing a namespaced key on one flow — re-check Task 1's three flips. `TEST` green. Commit `test(trading-desk): cross-flow portfolio sharing via bare {userId}`.

---

## Task 5: Two-provider client

**Files:** `~/app/page.tsx` (+ a small provider split component if cleaner).

- [ ] **Step 1: Host the Portfolio view under the portfolio flow.** The desk/reports shell stays under the existing `<FlowProvider flowKind="trading-desk">`. Render the Portfolio view inside a sibling/nested `<FlowProvider flowKind="trading-desk-portfolio" userId={USER_ID} baseUrl="">` whose child binds a portfolio session via `useFlow`/`useSession` and passes it as the `session` prop to `<PortfolioPane session={portfolioSession} ... />` (PortfolioPane is already session-prop-driven — `components/portfolio/portfolio-pane.tsx:66`). The portfolio provider can `useFlow({ autoCreateSession: true, autoSelectSession: true })` (sessions are incidental, §6).

- [ ] **Step 2: Verify + commit.** `TC` clean; `TEST` green. Manual/`fsdev` smoke deferred to Task 7. Commit `refactor(trading-desk): render the Portfolio view under its own flow provider`.

---

## Task 6: Best practice + docs + changeset

**Files:** `docs/contributing/best-practices.md`, `~/CLAUDE.md`, `~/README.md` (if it describes portfolio scoping), `.changeset/*.md`.

- [ ] **Step 1: Best practice.** Add a BP to `best-practices.md`: *user-scoped resources default to shared (`flowIsolation` unset/false); isolate only for a deliberate privacy reason — reflexive `flowIsolation: true` blocks legitimate cross-flow reads (see FIX-735).*

- [ ] **Step 2: Docs.** Update `~/CLAUDE.md`'s Portfolio section — it's now its own `trading-desk-portfolio` flow, resources user-scoped shared, the report flow reads them at seed (no client bridge). Update the file-tree block (the `portfolio/` folder moved). Fix `~/README.md` if it states portfolio scoping.

- [ ] **Step 3: Changeset.** Empty-frontmatter private-example changeset noting the split.

- [ ] **Step 4: Commit** `docs(trading-desk): document the portfolio flow split + shared-by-default best practice`.

---

## Task 7: Whole-graph + integration gate

- [ ] **Step 1:** root `pnpm typecheck` → 45/45 + package-boundary validation. `TEST` green.
- [ ] **Step 2: App smoke** (`pnpm --filter @flow-state-dev/trading-desk dev`): the Portfolio view reads/writes (save an account, import, prices) against the portfolio flow; start an analysis and confirm it sees the shared holdings (the PM portfolio-fit block renders). A portfolio-aware `fsdev run` `full` completes.
- [ ] **Step 3:** Final commit if any doc fixes; otherwise the branch is ready for PR.

---

## Self-Review (before the PR)

- [ ] **Spec coverage:** scope flips (T1), server-side seed snapshot + dropped input (T2), flow split + register + group (T3), cross-flow test (T4), two-provider client (T5), best-practice + docs (T6), gate (T7). Every spec §2–§12 item has a task.
- [ ] **Behavior:** the snapshot is computed from the same data, just server-side; `analyze` drops only the `portfolio` input; no prompt/pipeline change. Clean break on data is the only data effect.
- [ ] **No fabricated APIs:** `ctx.resources.accounts.list()` + `ref.state` (sync) confirmed; the single-resource quotes read accessor is the one item to confirm against the handle type at T2.
- [ ] **Gates:** root typecheck 45/45; trading-desk suite green; app smoke + `fsdev run` pass.

## After: PR + Linear

One PR (`feat/trading-desk-portfolio-flow` → `main`) resolving FIX-736; reference the attached spec doc. Spec 2 (analysis-side resource regroup) stays a separate follow-up.
