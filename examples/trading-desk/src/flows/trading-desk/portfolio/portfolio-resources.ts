/**
 * Portfolio resource collections (BP-019 leaf).
 *
 * Imports only `@flow-state-dev/core` + the pure `./portfolio-schema` leaf —
 * NEVER the action handlers — so the capability↔resource graph stays cycle-free.
 *
 * Both collections are user-scoped + `flowIsolation: true`, exactly like
 * `specialInstructionsResource`. That keys their state under
 * `{userId}:trading-desk` via `resolveUserStorageKey`, so a user's portfolio
 * never bleeds into another flow that shares the same user identity, and it
 * persists across `pnpm dev` restarts on the already-wired filesystem store —
 * no new store adapter, no `StoreRegistry` change.
 *
 * Two collections, NOT one blob: per-holding keying (`{accountId}__{ticker}`)
 * gives last-write-wins isolation under the no-CAS filesystem store. A single
 * portfolio blob would re-serialize the whole map on every row write and clobber
 * concurrent imports — a real-money correctness property, not an optimization.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { accountStateSchema, holdingStateSchema } from "./portfolio-schema";

/** One resource per account, keyed `accountId` (`accounts/{accountId}`). */
export const accountsCollection = defineResourceCollection({
  pattern: "accounts/*",
  scope: "user",
  flowIsolation: true,
  stateSchema: accountStateSchema,
  // Ship full state to the client (small dataset) — the holdings/accounts
  // tables need every field. Same identity projection `memosCollection` uses.
  client: { state: { read: true } },
});

/** One resource per holding, keyed `{accountId}__{ticker}`
 *  (`holdings/{accountId}__{ticker}`). Filterable by account via a storage-key
 *  `topicPrefix` of `{accountId}__`. */
export const holdingsCollection = defineResourceCollection({
  pattern: "holdings/*",
  scope: "user",
  flowIsolation: true,
  stateSchema: holdingStateSchema,
  client: { state: { read: true } },
});

/** Shared registry for the portfolio action handlers. */
export const portfolioResources = {
  accounts: accountsCollection,
  holdings: holdingsCollection,
} as const;
