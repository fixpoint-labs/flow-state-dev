# Trading Desk v2 — Feature 04: Portfolio Section (CSV import across accounts)

> Self-contained implementation spec. A sub-agent in a fresh session must be able to
> execute this without reading the other v2 specs. Paths are absolute or relative to
> `labs/trading-desk/`. Read the cited best-practices before coding:
> `docs/contributing/best-practices.md` (BP-007, BP-011, BP-012, BP-014, BP-016, BP-019).

---

## 1. Problem & outcome

The trading-desk app analyzes single tickers but has **no concept of what the user
actually owns**. The PM and trader prompts hard-code "you do not have portfolio
context — no account value, no existing positions, no risk budget." To become an app
that can help manage a **real** portfolio, the app needs durable, multi-account
holdings data.

**This feature builds the portfolio spine.** It does NOT build portfolio-aware
analysis (Feature 04b/«portfolio-aware analysis»), the Summary page (Feature 05),
or the conviction signal (FIX-709). It builds:

1. A durable **data model** for accounts and per-account holdings, keyed by
   `(accountId, ticker)`, supporting fractional quantity and average cost basis,
   designed so tax-lots / realized-P/L / dividends can be added later without a
   schema rewrite.
2. **CSV import (upload or paste) into a chosen target account**, with a documented
   canonical format, tolerant column-mapping for real brokerage exports, defined
   merge semantics, duplicate handling, and per-row validation + error reporting.
3. A new top-level **Portfolio section** in the UI: per-account holdings table
   (quantity / cost / current value / weight) plus portfolio totals, current price
   and unrealized P/L sourced from the existing price tool.

**Outcome:** the user can paste a Fidelity/Schwab/Vanguard export, pick "My Roth IRA",
import, and see NVDA in two different accounts as two distinct holdings with correct
cost basis, live value, weight, and unrealized P/L — persisted across server restarts.

**Definition of done**
- Accounts + holdings persist to the filesystem store and survive `pnpm dev` restart.
- The same ticker in two accounts renders as two rows keyed `(accountId, ticker)`.
- A canonical-format CSV imports with zero errors; a messy real-world CSV imports the
  valid rows and reports the bad ones with row numbers + reasons.
- `pnpm --filter @flow-state-dev/trading-desk typecheck` and `test` pass; a new
  parser test + a strict-output guard pass.

---

## 2. Real-money data model (the rigorous part)

> This is the load-bearing section. Everything keys off `(accountId, ticker)`.

### 2.1 Storage strategy — two user-scoped resource collections

Durable app data in this framework MUST be expressed as scope-keyed resources — the
`StoreRegistry` is a fixed set of 11 stores; you **cannot** add a "portfolio table".
Model portfolio as **two user-scoped, flow-isolated resource collections** (path A
from the persistence Understand). User-scope + `flowIsolation: true` keys storage
under `{userId}:trading-desk` via `resolveUserStorageKey`, exactly like
`specialInstructionsResource`. Filesystem `ContentStore` + `ResourceStateStore` are
last-write-wins **per key** (no CAS) — per-holding keying avoids whole-map clobber,
which is why we use a collection (one resource per holding) rather than one giant
singleton blob.

Two collections, NOT one:

- **`accounts`** — collection `pattern: "accounts/*"`, one resource per account,
  key = `accountId`.
- **`holdings`** — collection `pattern: "holdings/*"`, one resource per holding,
  key = `{accountId}__{ticker}` (the composite key; see §2.4 for why `__`).

Cash balance lives **on the account resource**, not as a holding (it is per-account,
not per-ticker).

> Why two collections and not `accounts` with embedded holdings: per-holding keying
> gives last-write-wins isolation (importing into account A never clobbers a
> concurrent edit to account B's holdings) and lets the holdings table paginate /
> list by `topicPrefix: "{accountId}__"`. A single blob would re-serialize the whole
> portfolio on every row write and lose per-row write isolation.

### 2.2 Account schema

`accountStateSchema` is **resource state, not a generator output** — so `.default()`,
`.nullable()` are fine here (BP-016 does NOT apply; it only constrains generator
output schemas). Follow the resource-state convention of `.nullable().default(...)`.

```ts
// src/flows/trading-desk/portfolio/portfolio-schema.ts  (framework-import-free leaf)
import { z } from "zod";

export const accountTypeSchema = z.enum(["taxable", "IRA", "Roth", "401k"]);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const accountStateSchema = z.object({
  /** Stable id. Generated client-side (crypto.randomUUID) or slugified name.
   *  This is also the collection key suffix (accounts/{accountId}). */
  accountId: z.string(),
  name: z.string().min(1).max(80),
  type: accountTypeSchema,
  /** ISO 4217. Single-currency per account in v1; multi-currency is a future seam. */
  currency: z.string().length(3).default("USD"),
  /** Settled cash, account's currency. Fractional allowed. */
  cashBalance: z.number().default(0),
  /** Creation/update audit. Plain ISO strings. */
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AccountState = z.infer<typeof accountStateSchema>;
```

### 2.3 Holding schema (the (accountId, ticker) unit)

```ts
export const holdingStateSchema = z.object({
  /** Composite identity. BOTH stored explicitly so the row is self-describing
   *  without parsing the storage key. */
  accountId: z.string(),
  ticker: z.string(),               // normalized upper-case, see §3.3
  /** Fractional shares supported (e.g. 0.4213 of BRK.A). */
  quantity: z.number(),
  /** Average cost per share in the account's currency. Designed as avg-cost in
   *  v1; tax-lots are a FUTURE seam (see §2.5) — adding `lots[]` later does not
   *  break this field, it becomes the derived average. */
  costBasis: z.number().nullable().default(null),
  /** Optional acquisition date (earliest lot date once lots exist). */
  acquiredDate: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HoldingState = z.infer<typeof holdingStateSchema>;
```

**Derived, NOT stored** (computed at read time in the UI or a read handler):
`currentPrice`, `marketValue = quantity * currentPrice`,
`unrealizedPL = (currentPrice - costBasis) * quantity`,
`weight = marketValue / portfolioTotalValue`. These depend on a live quote and on the
whole-portfolio total, so storing them would immediately go stale. Compute on read.

### 2.4 Composite key encoding

Collection keys are path segments; `ticker` can contain `.` (BRK.B) and accountIds
are UUIDs. Use `{accountId}__{ticker}` (double-underscore separator) as the holdings
key. Tickers are normalized to `[A-Z0-9.\-]` (see §3.3), accountIds are UUID/slug, so
`__` cannot collide. Provide two pure helpers in the schema leaf:

```ts
export function holdingKey(accountId: string, ticker: string): string {
  return `${accountId}__${ticker}`;
}
export function parseHoldingKey(key: string): { accountId: string; ticker: string } {
  const i = key.indexOf("__");
  return { accountId: key.slice(0, i), ticker: key.slice(i + 2) };
}
```

> Holdings list filtering: `useResourceCollectionList(session, "holdings",
> { topicPrefix: "{accountId}__" })` returns one account's holdings. The collection's
> `topicPrefix` filter matches storage-key prefix (verified in
> `useResourceCollection.list` → server list endpoint).

### 2.5 Future seams (design-for, don't build)

- **Tax-lots**: add `lots: z.array(lotSchema)` to `holdingStateSchema` later;
  `costBasis` becomes the derived average over lots; `acquiredDate` becomes
  `min(lot.date)`. No rename needed — the v1 avg-cost fields are forward-compatible.
- **Realized P/L + dividends**: a future `accountLedgerSchema` collection
  `pattern: "ledger/*"` keyed by event id. Do NOT add it now; just leave the comment.
- **Current price as a stored snapshot**: v1 computes price on read from
  `get_price_history`. A future "refresh quotes" action could persist a
  `quotes/*` snapshot. Out of scope.

### 2.6 Current-price / unrealized-P/L source

There is **no standalone quote tool**. The canonical current-price source is the
**last bar `close` of `get_price_history`** (`priceHistorySchema.bars[last].close`),
which already exists in both fixture and live modes
(`phase-1/tools/get_price_history.ts`). v1 wiring:

- The price tool is a flow tool, not a public HTTP endpoint. To get prices into the
  Portfolio UI **without a model run**, add a tiny **read-only flow action**
  `getQuotes` (§5.3) that takes `{ tickers, dataSource }`, calls `get_price_history`
  per ticker via a sequencer (NOT inside a handler — BP-011), and returns
  `{ ticker, price, asOf }[]`. The UI calls it through `session.sendAction` and
  caches results. In v1, default `dataSource: "fixture"` so it works offline; live
  mode requires provider keys.

> Simpler v1 fallback if `getQuotes` proves heavy: render the table with
> `currentPrice = null` → value/weight/P-L show "—" until a price is available, and
> ship `getQuotes` as a follow-up. The table MUST degrade gracefully on null price
> regardless (real portfolios will hold tickers with no fixture).

---

## 3. CSV import: canonical format, tolerant mapping, merge semantics

### 3.1 Canonical documented format

Ship `labs/trading-desk/docs/portfolio-csv-format.md` documenting the canonical
header row (case-insensitive, order-independent):

```
ticker,quantity,costBasis,acquiredDate
NVDA,12.5,118.40,2024-03-15
AAPL,40,176.10,2023-11-02
```

- `ticker` (required), `quantity` (required, fractional ok),
- `costBasis` (optional — average cost per share; blank → `null`),
- `acquiredDate` (optional ISO `YYYY-MM-DD`; blank → `null`).

A canonical-format file imports with zero column-mapping needed.

### 3.2 Tolerant column-mapping (real brokerage reality)

Brokerage exports differ. The parser normalizes headers (lower-case, strip
non-alphanumerics) and maps via a synonym table. Build this as a **pure,
framework-import-free** function in the schema leaf so it runs identically in a
browser preview and in the server action and is unit-testable:

```ts
// portfolio-csv.ts  (pure, no @flow-state-dev/core import — browser-safe)
const COLUMN_SYNONYMS: Record<keyof CanonicalRow, string[]> = {
  ticker:      ["ticker", "symbol", "sym", "security", "securityid"],
  quantity:    ["quantity", "qty", "shares", "sharesheld", "units"],
  costBasis:   ["costbasis", "avgcost", "averagecost", "costpershare",
                "unitcost", "purchaseprice", "price"],
  acquiredDate:["acquireddate", "dateacquired", "purchasedate", "opendate", "date"],
};
```

> `price` is intentionally LAST in the costBasis synonym list — many exports use
> `price` for *current* price, not cost. Document that ambiguity in the format doc
> and let an explicit `costBasis`/`avgCost` column win. If only `price` is present,
> map it to costBasis and flag a per-import **warning** (not a row error).

The parser returns:

```ts
export type ParsedCsv = {
  rows: CanonicalRow[];          // validated, normalized, ready to upsert
  errors: RowError[];            // { rowNumber, raw, reason } per bad row
  warnings: string[];            // import-level notes (e.g. "mapped 'price' → costBasis")
  mapping: Record<string, string>; // resolved header → canonical field (for UI display)
};
export type RowError = { rowNumber: number; raw: string; reason: string };
```

### 3.3 Per-row validation rules

- Ticker: trim, upper-case, must match `/^[A-Z0-9.\-]{1,12}$/`. Else row error
  `"invalid ticker"`.
- Quantity: parse number (strip thousands separators, allow leading `$`-free
  decimals). Must be finite and `!= 0`. `0` or unparseable → row error.
- CostBasis: optional; if present must parse to a finite `>= 0` number (strip `$`,
  commas). Unparseable non-empty → row error `"invalid cost basis"`.
- AcquiredDate: optional; if present must parse to ISO `YYYY-MM-DD`. Unparseable →
  **warning** + store `null` (don't reject the whole holding for a bad date).
- Duplicate ticker within one CSV: **merge** quantities and recompute a
  quantity-weighted average cost across the duplicate rows, emit a warning
  `"merged N duplicate rows for TICKER"`. (A brokerage export with one row per lot
  is the common case — this is the avg-cost collapse.)

The parser is **deterministic and side-effect-free**. It does NOT touch resources.
The server action consumes its output.

### 3.4 Merge / update semantics into the target account

The import action takes a `mode`:

- **`upsert`** (default): for each parsed row, `holdings.upsert(holdingKey(acct,tk), …)`.
  Existing holding for that `(account, ticker)` → its quantity/costBasis/acquiredDate
  are **replaced** by the import row (the import is the new source of truth for that
  ticker). Tickers in the account but NOT in the CSV are left untouched.
- **`replace-account`**: delete every existing holding under
  `topicPrefix: "{accountId}__"`, then create the parsed rows. Use when the CSV is a
  full account snapshot. The action lists existing holdings, deletes them, then
  upserts — all inside the action handler (handlers may call resource ref methods;
  that is NOT calling a block, so BP-011 is satisfied).

The action returns an **import report** `{ imported, updated, deleted, errors[],
warnings[] }` so the UI can show "imported 18, updated 3, 2 rows skipped".

> Cash balance: the canonical CSV does not carry cash. The import modal has a
> separate optional "set cash balance for this account" number input that patches
> `account.cashBalance`. Keep cash out of the row parser.

---

## 4. Persistence / store changes

**No store changes.** Reuse the already-wired `createFilesystemStores` in
`lib/server.ts`. Both new collections are user-scoped + `flowIsolation: true`, so
their state lands in the existing `ContentStore` / `ResourceStateStore` under
`{userId}:trading-desk` via `resolveUserStorageKey`. They persist across `pnpm dev`
restarts today.

Store interface methods exercised (transitively, via resource refs — you do not call
these directly): `ResourceStateStore.get/set/getByPrefix/deleteAll`. Collection
mutations go through `ctx.resources.<name>.create/upsert/get/getOptional/list/delete`
(see `ResourceCollectionRef` in
`packages/core/src/types/resource-collection.ts:134`).

**Production caveat (document, don't fix):** the filesystem store is
`developmentOnly: true` and will not survive an ephemeral serverless filesystem.
`USER_ID` is hardcoded `"devuser"` in `app/page.tsx`. Real multi-user portfolios need
a real store adapter at the `lib/server.ts` seam and a real user id threaded through
`FlowProvider`. Out of scope for this feature; note it in §10.

---

## 5. Flow changes

### 5.1 Resource definitions (BP-019: leaf module, framework imports only)

Create `src/flows/trading-desk/portfolio/portfolio-resources.ts` (imports only
`@flow-state-dev/core` + zod + the pure `./portfolio-schema` leaf — NEVER imports the
action handlers, to keep the capability↔resource graph cycle-free per BP-019):

```ts
import { defineResourceCollection } from "@flow-state-dev/core";
import { accountStateSchema, holdingStateSchema } from "./portfolio-schema";

export const accountsCollection = defineResourceCollection({
  pattern: "accounts/*",
  scope: "user",
  flowIsolation: true,
  stateSchema: accountStateSchema,
  client: { state: { read: true } },   // ship full state to client (small, like memos)
});

export const holdingsCollection = defineResourceCollection({
  pattern: "holdings/*",
  scope: "user",
  flowIsolation: true,
  stateSchema: holdingStateSchema,
  client: { state: { read: true } },
});
```

> `client: { state: { read: true } }` is the same identity projection `memosCollection`
> uses — the holdings table needs every field, the dataset is small.

### 5.2 Write actions (handlers; BP-011/012/014)

Add to `flow.ts` `actions`. Each is a **single handler** (no block composition needed
because none calls another block — they only touch resource refs, which is allowed in
a handler). All are state-mutation-only → use the handler pattern with a small
**report output** where the UI needs feedback (BP-014: return the *report*, a real
transformation, not the input).

Handlers live in `src/flows/trading-desk/portfolio/portfolio-actions.ts`:

| Action            | Input schema                                                                 | Output            | Behavior |
|-------------------|------------------------------------------------------------------------------|-------------------|----------|
| `saveAccount`     | `accountStateSchema.partial({ createdAt, updatedAt })` + `accountId?`         | `{ accountId }`   | `accounts.upsert(accountId, …)`. Generates `accountId` (uuid) + timestamps if absent. |
| `deleteAccount`   | `{ accountId }`                                                               | `void` (`.tap`-style, BP-012) | delete account + all `holdings` with `topicPrefix:"{accountId}__"`. |
| `importHoldings`  | `{ accountId, csvText, mode: "upsert"\|"replace-account", cashBalance?: number }` | `ImportReport` | parse `csvText` via the pure parser, apply merge semantics (§3.4), patch cash if provided, return report. |
| `deleteHolding`   | `{ accountId, ticker }`                                                       | `void`            | `holdings.delete(holdingKey(...))`. |

`ImportReport` (handler output, NOT a generator output → no BP-016 constraint, but
keep it a fixed-shape object):

```ts
export const importReportSchema = z.object({
  imported: z.number(),
  updated: z.number(),
  deleted: z.number(),
  errors: z.array(z.object({ rowNumber: z.number(), raw: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
});
```

Register the resources on the flow:

```ts
// flow.ts → defineFlow({ resources: { … existing …,
//   accounts: accountsCollection, holdings: holdingsCollection } })
```

And the actions:

```ts
// flow.ts → actions: { … analyze, setInstructions …,
//   saveAccount: { block: saveAccount },
//   deleteAccount: { block: deleteAccount },
//   importHoldings: { block: importHoldings },
//   deleteHolding: { block: deleteHolding },
//   getQuotes: { block: getQuotesPipeline },  // §5.3
// }
```

> **No generator output schemas are added by this feature.** The CSV parser is
> deterministic TS, not an LLM. Therefore BP-016 has no surface here EXCEPT the guard
> test below. Add the two new resource-state schemas to
> `test/output-schemas-strict.spec.ts`? **No** — they are resource STATE, not
> generator outputs; do NOT add them (adding them would wrongly assert state schemas
> are strict-compatible, and they use `.default()` which strict mode rejects). Instead
> add a dedicated parser unit test (§8).

### 5.3 `getQuotes` read action (BP-011-safe price fetch)

`get_price_history` is a tool handler. A handler must not call a block, so do **not**
`get_price_history.run()` inside a handler. Compose a **sequencer** that maps each
requested ticker through the tool and aggregates:

```ts
// portfolio/get-quotes.ts
// getQuotesPipeline = sequencer({ inputSchema: { tickers, dataSource } })
//   .map(... seed ticker/dataSource into a shape the tool accepts ...)
//   .step(get_price_history)  // per-ticker; iterate via a fan-out helper
//   ... aggregate last-close per ticker ...
// outputSchema: z.object({ quotes: z.array(z.object({ ticker, price: z.number().nullable(), asOf: z.string() })) })
```

Practically: the cleanest v1 is a single handler that **reads from the same warm
`getOrFetch` cache / `loadFixture`** the way `compute-spine.ts` does (it calls
`loadFixture`/`getOrFetch` directly, NOT the tool block — see
`src/flows/trading-desk/compute-spine.ts:46`). That is BP-011-safe because it calls
provider functions, not a block. **Prefer this pattern** — model `getQuotes` on
`compute-spine.ts`: a handler that loops tickers, calls
`loadFixture("get_price_history", { ticker, date })` (fixture) or `getOrFetch` (live),
and returns `{ ticker, price: lastClose, asOf }[]`. No sequencer, no block.run, no
BP-011 risk.

```ts
export const getQuotes = handler({
  name: "get-quotes",
  inputSchema: z.object({
    tickers: z.array(z.string()),
    dataSource: z.enum(["fixture", "live"]).default("fixture"),
  }),
  outputSchema: z.object({
    quotes: z.array(z.object({
      ticker: z.string(), price: z.number().nullable(), asOf: z.string().nullable(),
    })),
  }),
  execute: async (input) => { /* loop loadFixture/getOrFetch, take bars.at(-1).close */ },
});
```

> This is the one place a price comes from. The PM/trader prompt disclaimers
> ("no portfolio context") are NOT touched by this feature — that is portfolio-aware
> analysis (a separate v2 feature). This feature only surfaces holdings in the UI.

---

## 6. UI changes

### 6.1 Navigation: in-page view switcher (NOT new routes)

There is no routing scaffold and `FlowProvider` is mounted only in `app/page.tsx`.
Adding `app/portfolio/page.tsx` would need its own `FlowProvider` wrap or moving the
provider to `layout.tsx` (touches the single mount point and the `userId`/`baseUrl`
contract). **Lowest-friction, matches the single-route reality: add an in-page view
switcher** in `TradingDeskApp`.

Add a `view` state: `"analysis" | "portfolio"` (Past Reports is Feature 01; leave a
seam for it). Render a small nav in `TopBar` (two/three pill links) that sets `view`.
The main grid branches on `view`:

```
TradingDeskApp (44px TopBar / 1fr main / 28px StatusBar)
  TopBar
    [brand] [Analysis | Portfolio]  ← new nav pills (controlled, like Segmented)
    (analyze form shows only when view==="analysis")
  main:
    view==="analysis"  → <ThesesPane/> + <TranscriptPane/>   (unchanged)
    view==="portfolio" → <PortfolioPane/>                     (new, full-width)
  StatusBar (portfolio view: show account count + total value instead of run state)
```

`TopBar` is fully controlled via props — add `view` + `onViewChange` props and a
`PortfolioNav` segment; gate the existing analyze `<form>` behind `view === "analysis"`.
Keep `TopBar` stateless.

> The portfolio view reads user-scoped resources, which `useResource`/
> `useResourceCollectionList` project from a **session snapshot**. Reuse the existing
> `readSessionId = flow.activeSessionId ?? flow.sessions[0]?.id` fallback (already in
> `page.tsx` for the settings dialog). If the user has zero sessions, the portfolio
> resources still resolve because they are **user-scoped** — but the hooks need *a*
> bound session to read the snapshot. **Edge case:** brand-new user with no sessions
> has no snapshot to read from. Handle by: if `readSessionId === undefined`, create a
> lightweight session on first Portfolio open (or show an empty-state CTA "Run an
> analysis first, or add an account"). Document this in Open Questions.

### 6.2 Component tree (new files under `components/portfolio/`)

```
PortfolioPane                       components/portfolio/portfolio-pane.tsx
  ├─ PortfolioToolbar               (Add account · Import CSV buttons + total banner)
  ├─ AccountSection (× N accounts)  components/portfolio/account-section.tsx
  │    ├─ AccountHeader             (name · type chip · cash · account value)
  │    └─ HoldingsTable             components/portfolio/holdings-table.tsx
  │         └─ HoldingRow (× M)     (ticker · qty · avgCost · price · value · weight · uPL)
  ├─ PortfolioTotals               (sum across accounts: total value, total uPL)
  ├─ AddAccountDialog              components/portfolio/add-account-dialog.tsx  (native <dialog>, mirror SettingsDialog)
  └─ ImportCsvDialog               components/portfolio/import-csv-dialog.tsx
```

### 6.3 Data hooks

- Accounts: `useResourceCollectionList(session, "accounts")` → one `AccountSection` per item.
- Holdings per account: `useResourceCollectionList(session, "holdings",
  { topicPrefix: "{accountId}__" })`.
- Prices: on mount / refresh, gather the union of tickers across all holdings, call
  `session.sendAction("getQuotes", { tickers, dataSource })`, store in a
  `Map<ticker, price>` in `PortfolioPane` state. Recompute value/weight/uPL in
  `useMemo` (BP-010: derived state via `useMemo`, not `useEffect`).
- Mutations: `session.sendAction("saveAccount" | "importHoldings" | "deleteHolding" |
  "deleteAccount", …)` then `refetch()` the affected collection.

> Action-dispatch handshake: unlike `analyze`, these actions don't need the
> resolve-or-create + `pendingDispatch` dance — they target user-scoped resources, not
> a per-tuple session. Dispatch directly on the bound `readSession`:
> `await readSession.sendAction("importHoldings", …)`. Just ensure `readSession` is
> bound (a session exists). No tuple matching involved.

### 6.4 Holdings table ASCII mockup

```
┌─ My Roth IRA  (Roth · USD)              cash $4,210.00   value $38,940 ─┐
│ Ticker  Qty       Avg Cost   Price     Value      Weight   Unrl P/L     │
│ NVDA    12.5      $118.40    $171.30   $2,141.25   34.2%   +$660.75 ▲   │
│ AAPL    40.0      $176.10    $172.05   $6,882.00   18.1%   −$162.00 ▼   │
│ BRK.B   3.4213    $402.10    $—        $—          —       —            │  ← null price degrades gracefully
│ ...                                                                     │
└────────────────────────────────────────────────────────────────────────┘
        Portfolio total   value $112,300   unrealized P/L  +$3,420 ▲
```

NVDA appears again under a *different* AccountSection ("My Taxable") as a distinct row
with its own cost basis — proving the `(accountId, ticker)` keying.

### 6.5 Import CSV dialog ASCII mockup

```
┌─ Import holdings ──────────────────────────────────────────┐
│ Target account:  [ My Roth IRA          ▾ ]                │
│ Mode:            (•) Upsert   ( ) Replace account          │
│ Cash balance:    [ 4210.00 ] (optional)                    │
│                                                            │
│ Paste CSV  or  [ Choose file ]                             │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ symbol,shares,avgcost                                  │ │
│ │ NVDA,12.5,118.40                                       │ │
│ │ ...                                                    │ │
│ └────────────────────────────────────────────────────────┘ │
│ Detected columns: symbol→ticker, shares→quantity,         │  ← live mapping preview (pure parser, no server)
│                   avgcost→costBasis                       │
│ Preview: 18 valid · 2 errors · 1 warning                  │
│   ⚠ row 4: invalid quantity ("N/A")                       │
│   ⚠ row 9: invalid ticker ("")                            │
│                              [ Cancel ]  [ Import 18 ]     │
└────────────────────────────────────────────────────────────┘
```

The **preview runs the pure parser client-side** (no server round-trip) so the user
sees mapping + errors before committing. On Import, the action re-parses server-side
(don't trust client) and returns the authoritative report.

### 6.6 Design system

Reuse OKLCH `--c-*` tokens and existing idioms (`Segmented` for mode toggle, native
`<dialog>` modeled on `SettingsDialog`, `cn()` from `lib/utils`). No charting library.
Weight bars (if desired) are inline flex/SVG like `PmHero`'s rating bar — no new deps.

---

## 7. Exact file create / modify list

**Create**
- `src/flows/trading-desk/portfolio/portfolio-schema.ts` — pure, browser-safe:
  account/holding/account-type schemas, `holdingKey`/`parseHoldingKey`, `CanonicalRow`.
- `src/flows/trading-desk/portfolio/portfolio-csv.ts` — pure CSV parser
  (synonym mapping, validation, dedupe-merge), `ParsedCsv`/`RowError` types.
- `src/flows/trading-desk/portfolio/portfolio-resources.ts` — `accountsCollection`,
  `holdingsCollection` (BP-019 leaf).
- `src/flows/trading-desk/portfolio/portfolio-actions.ts` — `saveAccount`,
  `deleteAccount`, `importHoldings`, `deleteHolding` handlers + `importReportSchema`.
- `src/flows/trading-desk/portfolio/get-quotes.ts` — `getQuotes` read handler
  (modeled on `compute-spine.ts`).
- `components/portfolio/portfolio-pane.tsx`
- `components/portfolio/account-section.tsx`
- `components/portfolio/holdings-table.tsx`
- `components/portfolio/add-account-dialog.tsx`
- `components/portfolio/import-csv-dialog.tsx`
- `components/portfolio/portfolio-format.ts` — pure number/currency formatters
  (or reuse an existing `lib/format` if one exists client-side).
- `docs/portfolio-csv-format.md` — canonical format + mapping doc.
- `test/portfolio-csv.spec.ts` — parser unit tests (canonical, messy, dedupe, errors).
- `test/portfolio-actions.spec.ts` — action wiring via `runForTest` (upsert vs
  replace-account, cross-account keying, import report).

**Modify**
- `src/flows/trading-desk/flow.ts` — register `accounts`/`holdings` resources;
  add `saveAccount`/`deleteAccount`/`importHoldings`/`deleteHolding`/`getQuotes`
  actions.
- `app/page.tsx` — add `view` state + branch `main` on `analysis`/`portfolio`; pass
  `view`/`onViewChange` to `TopBar`; mount `<PortfolioPane/>`.
- `components/topbar.tsx` — add nav pills (`Analysis | Portfolio`), gate analyze
  `<form>` behind `view === "analysis"`.
- `components/status-bar.tsx` — optional: portfolio-view summary (account count /
  total value) instead of run state.
- `labs/trading-desk/CLAUDE.md` — document the `portfolio/` folder.
- `.changeset/*.md` — user-facing change (BP-022). Update any relevant
  `apps/docs` page only if portfolio is a documented user concept (likely an internal
  example — confirm; an empty changeset is acceptable if internal-only).

---

## 8. Tests

- `test/portfolio-csv.spec.ts` (pure, offline):
  - canonical CSV → 0 errors, correct rows;
  - messy headers (`Symbol`, `Shares Held`, `Avg Cost`) → correct mapping;
  - `price`-only header → mapped to costBasis **with** a warning;
  - bad quantity / empty ticker → row errors with correct `rowNumber`;
  - duplicate ticker rows → merged with quantity-weighted avg cost + warning;
  - bad date → warning + `null`, holding still imported.
- `test/portfolio-actions.spec.ts` (`runForTest` from `@flow-state-dev/testing`,
  mock resource ctx):
  - `importHoldings` upsert vs replace-account semantics;
  - same ticker into two accounts → two distinct holding keys;
  - import report counts (`imported`/`updated`/`deleted`).
- Do **not** add the resource-state schemas to `output-schemas-strict.spec.ts` — they
  are resource state, not generator outputs (they use `.default()`; strict mode would
  fail them, correctly, because they shouldn't be strict).
- `pnpm --filter @flow-state-dev/trading-desk typecheck` and `test` green.

---

## 9. Dependencies (what must exist first)

- **None blocking.** This is the spine; Features 04b (portfolio-aware analysis) and 05
  (Summary page) depend on THIS. Build on today's phase-segmented structure — do NOT
  gate on the Layer-2 reorg (per the v2 binding-constraints Understand).
- Reuses existing, already-shipped surfaces: `createFilesystemStores` (lib/server.ts),
  `defineResourceCollection`, `get_price_history` tool, `loadFixture`/`getOrFetch`
  (`lib/cache.ts`, `lib/fixtures.ts`), `useResourceCollectionList`/`useResource`
  (already exported from `@flow-state-dev/react`).
- No new npm dependencies. CSV parsing is hand-rolled (the format is simple; a parser
  lib is overkill and the synonym mapping is bespoke).

---

## 10. Real-portfolio considerations

1. **Dev-only persistence ceiling.** `createFilesystemStores({ developmentOnly: true })`
   won't survive a serverless/ephemeral filesystem. A real portfolio needs a durable
   adapter (`@flow-state-dev/store-sqlite` / `store-postgres`) swapped at the
   `lib/server.ts` `stores:` seam. Document loudly; do not silently ship dev storage
   as "your portfolio is safe."
2. **Single synthetic user.** `USER_ID = "devuser"` is hardcoded. All portfolios land
   under one user until a real auth identity is threaded through `FlowProvider`. Per-
   user isolation is correct in the data model (user-scope + flowIsolation) but moot
   until a real `userId` exists.
3. **No server-side authorization** on resource/session routes — anyone can read any
   session/resource by id. A real money app must scope reads to the authenticated user.
4. **Price freshness & provenance.** Fixture prices are pinned to `2026-05-06`; live
   prices need keys. Unrealized P/L computed from a stale/fixture price is decorative,
   not real. Surface the price `asOf` and a "fixture"/"live" provenance chip so the
   user never mistakes a pinned snapshot for a real-time quote (BP-020 spirit).
5. **Avg-cost vs tax-lots.** v1 collapses lots to average cost, which is wrong for tax
   purposes (wash sales, specific-lot selection, holding-period). The schema is
   forward-compatible (§2.5) but the UI must not imply tax accuracy. Label it "average
   cost (informational)".
6. **Cash + currency.** Single-currency-per-account; no FX. A taxable account holding a
   foreign ADR with a non-USD cost basis is not modeled. Document the limitation.
7. **No transactional integrity across the two collections.** `replace-account`
   deletes-then-creates without a transaction; a crash mid-import leaves a partially
   imported account. Last-write-wins per key means no rollback. For a real app, an
   import should be atomic or idempotent-retryable. Note as a known gap.
8. **Numeric precision.** Money math in JS floats accumulates error. For a real app,
   store integer cents / use a decimal library. v1 uses `number`; document that totals
   are display approximations.

---

## 11. What NOT to build (scope boundaries)

- ❌ Portfolio-aware ANALYSIS (fit / initiate-add-trim-exit-hold sizing, target weight,
  rewriting PM/trader prompts). That is a separate v2 feature; this spec must NOT touch
  `capability.ts`, `portfolio-manager.ts`, `trader.ts`, or the PM/trader prompt
  disclaimers.
- ❌ Tax-lots, realized P/L, dividends, ledger/transactions. Design-for only (§2.5).
- ❌ A new store adapter / DB. Reuse the filesystem store.
- ❌ Real auth / multi-user. Keep `devuser`.
- ❌ Real-time / streaming quotes, a quotes refresh cron, or a persisted quote
   snapshot. v1 fetches on demand via `getQuotes`.
- ❌ New App Router routes / moving `FlowProvider` to `layout.tsx`. Use the in-page
   view switcher.
- ❌ Charting library. Inline SVG / flex bars only if a weight viz is wanted.
- ❌ Past Reports list (Feature 01) and the New-Analysis modal (Feature 02). Leave a
   `view` enum seam but don't build them here.

---

## 12. Open questions

1. **Empty-state session binding.** User-scoped resources need a bound session snapshot
   to read via the hooks. A brand-new user with zero sessions has no snapshot. Options:
   (a) auto-create a hidden "portfolio" session on first Portfolio open; (b) show an
   empty-state CTA until the first analysis creates a session; (c) add a dedicated
   server read endpoint for user-scoped resources that doesn't require a session.
   Recommend (a) for simplicity, but confirm with owner — it mints a junk session.
2. **`getQuotes` vs null-price-first.** Ship `getQuotes` in this feature, or ship the
   table with null prices and add `getQuotes` as a fast-follow? The table must degrade
   on null price regardless; question is only whether live value/uPL lands in v1.
3. **Account id source.** `crypto.randomUUID()` (opaque, collision-free) vs slugified
   name (human-readable keys, but rename/collision headaches). Recommend UUID with the
   name as a display field.
4. **`price` column ambiguity.** Confirm the heuristic: explicit `costBasis`/`avgCost`
   wins; bare `price` → costBasis + warning. Is that the right default, or should bare
   `price` be ignored (safer — never guess cost from a current-price column)?
5. **Changeset / docs surface.** Is the trading-desk example user-facing enough to
   warrant an `apps/docs` page, or is an internal-only empty changeset correct? (Likely
   internal example → empty changeset, but confirm per BP-022.)
6. **`replace-account` confirmation UX.** Deleting all holdings is destructive. Should
   the import dialog require a typed confirmation for `replace-account` mode?
```
