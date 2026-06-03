/**
 * Portfolio resource collections (BP-019 leaf).
 *
 * Imports only `@flow-state-dev/core` + the pure `./portfolio-schema` leaf —
 * NEVER the action handlers — so the capability↔resource graph stays cycle-free.
 *
 * ONE collection: `accounts` (user-scoped + `flowIsolation: true`, exactly like
 * `specialInstructionsResource`). That keys its state under
 * `{userId}:trading-desk` via `resolveUserStorageKey`, so a user's portfolio
 * never bleeds into another flow that shares the same user identity, and it
 * persists across `pnpm dev` restarts on the already-wired filesystem store —
 * no new store adapter, no `StoreRegistry` change.
 *
 * Holdings are NOT a separate collection — each account record carries its
 * holdings inline (`accountStateSchema.holdings`). The per-account record is the
 * write unit (an import is one write to one account), which suits this small,
 * batch-written data.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { accountStateSchema } from "./portfolio-schema";

/** One resource per account, keyed `accountId` (`accounts/{accountId}`).
 *  Holdings ride along inside each account's state. */
export const accountsCollection = defineResourceCollection({
  pattern: "accounts/*",
  scope: "user",
  flowIsolation: true,
  stateSchema: accountStateSchema,
  // Ship full state to the client (small dataset) — the holdings/accounts
  // tables need every field. Same identity projection `memosCollection` uses.
  client: { state: { read: true } },
});

/** Shared registry for the portfolio action handlers. */
export const portfolioResources = {
  accounts: accountsCollection,
} as const;
