/**
 * Catch-all route adapter for framework-owned `/api/flows/[...path]` endpoints.
 */
import type { ModelResolver } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../stores/types";
import type { FlowRegistry } from "../registry/flow-registry";
import {
  createFlowRouteHandlers,
  NOOP_INTERNAL_ROUTE_SEAMS,
  type InternalRouteSeams
} from "./http-handlers";

/**
 * Public router adapter options.
 */
export type CreateFlowApiRouterOptions = {
  registry: FlowRegistry;
  stores?: Partial<StoreRegistry>;
  modelResolver?: ModelResolver;
  maxResponseBufferSize?: number;
  maxConcurrentStreams?: number;
  staleStreamTtlMs?: number;
  onError?: (error: Error, context: { method: string; path: string }) => void;
};

type CreateInternalFlowApiRouterOptions = CreateFlowApiRouterOptions & {
  internalSeams?: InternalRouteSeams;
};

type NextRouteContext = {
  params: {
    path?: string[];
  };
};

/**
 * Creates a catch-all route adapter with default no-op internal seam behavior.
 */
export function createFlowApiRouter(options: CreateFlowApiRouterOptions): {
  GET: (req: Request, ctx: NextRouteContext) => Promise<Response>;
  POST: (req: Request, ctx: NextRouteContext) => Promise<Response>;
  DELETE: (req: Request, ctx: NextRouteContext) => Promise<Response>;
} {
  const internalOptions: CreateInternalFlowApiRouterOptions = {
    ...options,
    internalSeams: NOOP_INTERNAL_ROUTE_SEAMS
  };
  const handlers = createFlowRouteHandlers(internalOptions);

  return {
    GET: async (req, ctx) =>
      handlers.handle(req, { path: ctx.params.path }),
    POST: async (req, ctx) =>
      handlers.handle(req, { path: ctx.params.path }),
    DELETE: async (req, ctx) =>
      handlers.handle(req, { path: ctx.params.path })
  };
}
