/**
 * User-scoped shared resource holding the most-recent `getQuotes` result so the
 * Portfolio UI can read fetched prices via `useResource`.
 *
 * Why a resource and not the action's return value: in this runtime
 * `session.sendAction(...)` resolves to a request-status envelope, NOT the
 * handler's output (verified against `ExecuteActionResponse` in
 * `@flow-state-dev/client`). The idiomatic way an action surfaces a value to the
 * client is to write it to a resource and have the client re-read the snapshot
 * (`session.refresh()` → `useResource`). `getQuotes` writes here; the Portfolio
 * pane refreshes after dispatch and reads it.
 *
 * Scoped to `user` with `flowIsolation: false` (keys at bare `{userId}`). This
 * makes it a per-user last-known-quotes cache readable cross-flow, so the report
 * flow can read the latest prices at seed without a separate fetch. The previous
 * session scope was a transient-only cache; the user scope persists across
 * sessions while still being refreshed on every `getQuotes` call.
 *
 * `price` is nullable per quote: a missing/unavailable price stays null so the
 * UI renders "—", never a fabricated number (BP-020 spirit). `asOf` carries the
 * price's own date so the UI can label staleness.
 *
 * Leaf file (BP-019): imports only core + zod.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

export const portfolioQuotesStateSchema = z.object({
  /** Data source the quotes were fetched under, echoed for provenance. */
  dataSource: z.enum(["fixture", "live"]),
  /** When the fetch ran (ISO). Distinct from each quote's own `asOf`. */
  fetchedAt: z.string(),
  quotes: z.array(
    z.object({
      ticker: z.string(),
      price: z.number().nullable(),
      asOf: z.string().nullable(),
    }),
  ),
});

export type PortfolioQuotesState = z.infer<typeof portfolioQuotesStateSchema>;

export const portfolioQuotesResource = defineResource({
  scope: "user",
  flowIsolation: false,
  ref: "portfolioQuotes",
  stateSchema: portfolioQuotesStateSchema.nullable(),
  default: null,
  writable: true,
  // A single resource only surfaces in the client snapshot when it declares a
  // client PROJECTION (`hasClientProjection`: expose/exclude/data) — an empty
  // `client: {}` would never reach the client (prices would stay blank).
  // `exclude: []` = identity-expose the full state, type-safe on a nullable.
  client: { exclude: [] },
});
