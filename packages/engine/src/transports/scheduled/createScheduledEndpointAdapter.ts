// FIX-2753.
/**
 * The scheduled endpoint: one of the router's built-in adapters, mounted on
 * every app beside the HTTP routes. It serves
 * `POST /api/flows/:flowKind/schedules/*scheduleId/dispatch` and
 * `GET /api/flows/:flowKind/schedules`. The engine's schedule tick sends the
 * fires; the endpoint handles auth, validation, firing each scheduled time at
 * most once (recorded in the host's store), overlap policy, and
 * `source: "scheduled"` provenance.
 *
 * Mounted always, not only when a flow declares schedules: a router's adapters
 * are fixed when it is built, and a flow registered later still needs its
 * route. A flow with no `schedules` answers both routes as an unknown flow.
 */
import { DISPATCH_BASE_PATH } from "../../execution/schedule-tick";
import { SCHEDULED_SOURCE as SCHEDULED_TRANSPORT_SOURCE } from "../../execution/transport-sources";
import type { InboundTransportAdapter, InboundTransportHost } from "../types";
import { handleDispatch, handleList } from "./routes";

/** The router's built-in scheduled adapter. */
export function createScheduledEndpointAdapter(): InboundTransportAdapter {
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
            path: `${DISPATCH_BASE_PATH}/:flowKind/schedules/*scheduleId/dispatch`,
            handler: (req, ctx) => handleDispatch(req, ctx, host)
          },
          {
            method: "GET",
            path: `${DISPATCH_BASE_PATH}/:flowKind/schedules`,
            handler: (req, ctx) => handleList(req, ctx, host)
          }
        ]
      };
    }
  };
}
