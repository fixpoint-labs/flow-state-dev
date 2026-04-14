/**
 * Catch-all route adapter for framework-owned `/api/flows/[...path]` endpoints.
 */
import type {
  Middleware,
  ModelResolver,
  SpeechResolver,
  TranscriptionResolver
} from "@flow-state-dev/core/types";
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
  speechResolver?: SpeechResolver;
  transcriptionResolver?: TranscriptionResolver;
  maxResponseBufferSize?: number;
  maxConcurrentStreams?: number;
  staleStreamTtlMs?: number;
  middleware?: Middleware[];
  onError?: (error: Error, context: { method: string; path: string }) => void;
  /**
   * Whether to detect interrupted requests from previous runs on startup.
   * Disable on serverless platforms where background queries on init can
   * exhaust the Postgres pool before actual requests are served.
   * Default: true.
   */
  detectInterruptedOnStartup?: boolean;
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
  PATCH: (req: Request, ctx: NextRouteContext) => Promise<Response>;
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
    PATCH: async (req, ctx) =>
      handlers.handle(req, { path: ctx.params.path }),
    DELETE: async (req, ctx) =>
      handlers.handle(req, { path: ctx.params.path })
  };
}
