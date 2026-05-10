/**
 * Scheduled actions transport adapter.
 *
 * Mounts a single dispatch endpoint and a listing endpoint per flow:
 *
 *   POST {basePath}/:flowKind/schedules/:scheduleId/dispatch
 *   GET  {basePath}/:flowKind/schedules
 *
 * The adapter never runs a scheduler — hosts wire up Vercel Cron, Cloud
 * Scheduler, EventBridge, GitHub Actions, or `node-cron` themselves and
 * point them at the dispatch endpoint. The framework owns the dispatch
 * contract, two-phase auth (gateway → schedule.principal), idempotency
 * dedupe, overlap policy, and provenance stamping (`source: 'scheduled'`,
 * `metadata.scheduleId`, `metadata.origin`).
 *
 * Static schedules are validated at flow registration time (via
 * `validateSchedulesConfig` in `@flow-state-dev/core`); dynamic schedules
 * returned by `flow.schedules.resolve` are validated at dispatch time and
 * surface as `400 invalid_schedule` on malformed data.
 */
import type {
  InboundTransportAdapter,
  InboundTransportHost
} from "@flow-state-dev/server";
import { handleDispatch, handleList } from "./routes";
import {
  createIdempotencyCache,
  type CreateIdempotencyCacheOptions
} from "./idempotency";

/**
 * Stable `InboundSource` identifier stamped onto every scheduled request.
 * Surfaces as `RequestRecord.source` and is the value DevTool renders.
 */
export const SCHEDULED_TRANSPORT_SOURCE = "scheduled" as const;
export type ScheduledTransportSource = typeof SCHEDULED_TRANSPORT_SOURCE;

export interface CreateScheduledTransportAdapterOptions {
  /**
   * Base path for scheduled routes. Default `"/api/flows"`. Trailing
   * slashes are stripped; a leading slash is enforced.
   */
  basePath?: string;
  /**
   * Idempotency window, in milliseconds, for the
   * `(scheduleId, nominalFireTime)` dedupe key. Set to `0` to disable.
   * Default: 60_000 (1 minute).
   *
   * Backed by a per-process LRU. Multi-process deploys rely on the host
   * scheduler's idempotency for cross-process guarantees.
   */
  idempotencyWindowMs?: number;
  /** Test seam for the idempotency cache (clock injection, etc.). */
  idempotencyOptions?: CreateIdempotencyCacheOptions;
}

/**
 * Build an `InboundTransportAdapter` that mounts the scheduled-dispatch
 * routes. Pass to `createFlowApiRouter({ adapters: [...] })`.
 */
export function createScheduledTransportAdapter(
  options: CreateScheduledTransportAdapterOptions = {}
): InboundTransportAdapter {
  const basePath = normalizeBasePath(options.basePath ?? "/api/flows");
  const idempotency = createIdempotencyCache(
    options.idempotencyWindowMs ?? 60_000,
    options.idempotencyOptions
  );

  return {
    source: SCHEDULED_TRANSPORT_SOURCE,
    createBindings(host: InboundTransportHost) {
      return {
        routes: [
          {
            // path-to-regexp v8 multi-segment wildcard: `*scheduleId`
            // captures segments between `schedules/` and `/dispatch`.
            // Joined with `/` by the router's stringifyParams. This lets
            // ids like `u_1/weekly-digest` round-trip through the URL.
            method: "POST",
            path: `${basePath}/:flowKind/schedules/*scheduleId/dispatch`,
            handler: (req, ctx) => handleDispatch(req, ctx, host, idempotency)
          },
          {
            method: "GET",
            path: `${basePath}/:flowKind/schedules`,
            handler: (req, ctx) => handleList(req, ctx, host)
          }
        ]
      };
    }
  };
}

function normalizeBasePath(basePath: string): string {
  let normalized = basePath.trim();
  if (normalized.length === 0) return "";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
