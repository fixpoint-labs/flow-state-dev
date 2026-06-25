/**
 * HTTP inbound transport adapter — the reference implementation of
 * `InboundTransportAdapter`.
 *
 * Owns the existing `/api/flows/*` route table. Action execution flows
 * through `host.dispatch`; session/state/resource/stream routes read from
 * `host.stores` and `host.registry` directly. The adapter does not
 * re-implement these route handlers — it delegates to `createFlowRouteHandlers`,
 * which already consumes the host. This keeps the refactor a true
 * abstraction shift (no duplicated route logic) rather than a rewrite.
 */
import type {
  InboundTransportAdapter,
  InboundTransportHost,
  TransportBindings,
  TransportRoute
} from "../types";
import type { ParsedFlowRoute } from "../../routes/parseFlowRoute";

/** Stable provenance identifier for the built-in HTTP transport. */
export const HTTP_TRANSPORT_SOURCE = "http";

export type CreateHttpTransportAdapterOptions = {
  /**
   * Catch-all handler invoked for every request that hits the transport's
   * routes. This is supplied by the host integrator (`createFlowApiRouter`)
   * because the canonical route table is shared across all transports;
   * the HTTP adapter is the one that exposes it as HTTP routes.
   */
  handle: (
    request: Request,
    context: { path?: string[] }
  ) => Promise<Response>;
  /**
   * Path prefix the adapter responds under. Defaults to the canonical
   * `/api/flows` mount point. The catch-all wildcard segment is appended
   * automatically.
   */
  basePath?: string;
};

/**
 * Construct the HTTP transport adapter. Accepts the catch-all handler from
 * the host integrator so the canonical route table (parsed by
 * `parseFlowRoute`) is reused without duplication.
 */
export function createHttpTransportAdapter(
  options: CreateHttpTransportAdapterOptions
): InboundTransportAdapter {
  const basePath = options.basePath ?? "/api/flows";

  return {
    source: HTTP_TRANSPORT_SOURCE,
    createBindings(_host: InboundTransportHost): TransportBindings {
      // Single catch-all route. The framework's outer dispatcher unpacks
      // the `path[]` segment array from `Request.url`; the catch-all path
      // pattern is informational here (the actual matcher lives in the
      // outer factory at `createFlowApiRouter`).
      const catchAll: TransportRoute = {
        method: "POST",
        path: `${basePath}/*`,
        handler: async (request, ctx) => {
          // Fan all methods into the same handler — the canonical route
          // table is method-aware internally via `parseFlowRoute`.
          const path = pathFromContextOrUrl(ctx.params, request, basePath);
          return options.handle(request, { path });
        }
      };

      return {
        routes: [catchAll]
      };
    }
  };
}

function pathFromContextOrUrl(
  params: Record<string, string>,
  request: Request,
  basePath: string
): string[] {
  // Next.js / framework adapters pass `path` as a `string[]` in ctx.params;
  // tests construct the host directly with a synthetic Request, so we also
  // derive `path` from the URL when the param is absent.
  const fromParam = params.path;
  if (Array.isArray(fromParam)) {
    return fromParam as string[];
  }
  if (typeof fromParam === "string" && fromParam.length > 0) {
    return fromParam.split("/").filter((s) => s.length > 0);
  }

  const url = new URL(request.url);
  const prefix = basePath.endsWith("/") ? basePath : `${basePath}/`;
  if (!url.pathname.startsWith(prefix)) return [];
  return url.pathname.slice(prefix.length).split("/").filter((s) => s.length > 0);
}

// Silence unused-symbol typecheck on optional re-import for tooling that
// strips unused type-only imports.
export type { ParsedFlowRoute };
