/**
 * Scheduled-actions transport adapter. Mounts
 * `POST /api/flows/:flowKind/schedules/:scheduleId/dispatch` and
 * `GET /api/flows/:flowKind/schedules` per flow. Hosts run the actual
 * scheduler; the adapter handles auth, validation, firing each scheduled
 * time at most once (recorded in the host's store), overlap policy, and
 * `source: "scheduled"` provenance.
 */
import type {
  InboundTransportAdapter,
  InboundTransportHost
} from "@flow-state-dev/engine";
import { handleDispatch, handleList } from "./routes";

export const SCHEDULED_TRANSPORT_SOURCE = "scheduled" as const;

export interface CreateScheduledTransportAdapterOptions {
  /**
   * Base path for scheduled routes. Default `"/api/flows"`. Trailing
   * slashes are stripped; a leading slash is enforced.
   */
  basePath?: string;
}

/**
 * Build an `InboundTransportAdapter` that mounts the scheduled-dispatch
 * routes. Pass to `createFlowApiRouter({ adapters: [...] })`.
 */
export function createScheduledTransportAdapter(
  options: CreateScheduledTransportAdapterOptions = {}
): InboundTransportAdapter {
  const basePath = normalizeBasePath(options.basePath ?? "/api/flows");

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
            handler: (req, ctx) => handleDispatch(req, ctx, host)
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
