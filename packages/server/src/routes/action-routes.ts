/**
 * Action execution route handler.
 */
import type {
  Middleware,
  ModelResolver,
  SpeechResolver
} from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import {
  canRegisterStream,
  cleanupStaleStreams,
  registerStream,
  removeStream
} from "../streaming/active-streams";
import { createLiveRequestStream } from "../streaming/live-stream";
import { runAction } from "../execution/runAction";
import { generateId } from "../utils/generate-id";
import {
  asObject,
  getString,
  jsonResponse,
  parseJsonBody,
  SSE_HEADERS
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import type { InternalRouteSeams, RequestContext } from "./http-handlers";

type ActionRunInput = {
  flowKind: string;
  actionName: string;
  input: unknown;
  userId: string;
  sessionId?: string;
  requestId: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
};

type ActionRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  modelResolver?: ModelResolver;
  speechResolver?: SpeechResolver;
  middleware?: Middleware[];
  maxResponseBufferSize?: number;
  onBackgroundWork?: (promise: Promise<unknown>) => void;
  seams: InternalRouteSeams;
  bootstrapMetadata: Record<string, unknown>;
  requestContext: RequestContext;
};

export async function handleExecuteAction(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "execute_action" }>,
  ctx: ActionRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) {
    return jsonResponse(404, {
      error: `Unknown flow "${route.flowKind}"`
    });
  }

  const body = await parseJsonBody(request);
  const userId = getString(body.userId);
  if (userId === undefined) {
    return jsonResponse(400, {
      error: "Action request requires non-empty userId"
    });
  }

  const sessionId = route.sessionId ?? getString(body.sessionId);
  const metadata = asObject(body.metadata);
  const actionInput: ActionRunInput = {
    flowKind: flow.kind,
    actionName: route.actionName,
    input: body.input,
    userId,
    sessionId,
    requestId: getString(body.requestId) ?? generateId("req"),
    projectId: getString(body.projectId),
    metadata: {
      ...ctx.bootstrapMetadata,
      ...(metadata ?? {})
    },
    signal: request.signal
  };

  const actionOverrides =
    (await ctx.seams.enrichActionRunInput?.(actionInput, {
      ...ctx.requestContext,
      body
    })) ?? {};

  const resolvedActionInput: ActionRunInput = {
    ...actionInput,
    ...actionOverrides,
    metadata: {
      ...(actionInput.metadata ?? {}),
      ...(actionOverrides.metadata ?? {})
    }
  };

  const liveStream = createLiveRequestStream({
    requestId: resolvedActionInput.requestId,
    maxBufferSize: ctx.maxResponseBufferSize
  });

  if (!canRegisterStream()) {
    return jsonResponse(503, {
      error: "Server is at active stream capacity. Retry shortly."
    });
  }

  registerStream(resolvedActionInput.requestId, liveStream);

  const runPromise = runAction({
    flow,
    actionName: resolvedActionInput.actionName as keyof typeof flow.actions & string,
    input: resolvedActionInput.input,
    userId: resolvedActionInput.userId,
    sessionId: resolvedActionInput.sessionId,
    requestId: resolvedActionInput.requestId,
    projectId: resolvedActionInput.projectId,
    metadata: resolvedActionInput.metadata,
    signal: resolvedActionInput.signal,
    modelResolver: ctx.modelResolver,
    speechResolver: ctx.speechResolver,
    middleware: ctx.middleware,
    stores: ctx.stores,
    responseEmitter: liveStream.emitter
  }).finally(() => {
    liveStream.close();
    removeStream(resolvedActionInput.requestId);
    // Safety net: deregister if runAction didn't (e.g., truly catastrophic failure)
    ctx.stores.activeRequests.deregister(resolvedActionInput.requestId).catch(() => {});
  });

  // Notify the platform that background work must complete. On serverless
  // platforms this is critical: without it the function instance is killed
  // after the 202 response is sent, before runAction persists anything.
  if (ctx.onBackgroundWork !== undefined) {
    ctx.onBackgroundWork(runPromise);
  }

  // Inline streaming: when the client sends Accept: text/event-stream, return
  // the SSE stream directly from the POST response. This keeps the action
  // execution and stream delivery on the same function instance.
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return new Response(liveStream.readable, {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        "x-request-id": resolvedActionInput.requestId,
        "x-session-id": resolvedActionInput.sessionId ?? ""
      }
    });
  }

  return jsonResponse(202, {
    status: "in_progress",
    request: {
      id: resolvedActionInput.requestId,
      flowKind: flow.kind,
      actionName: resolvedActionInput.actionName,
      status: "in_progress"
    },
    session:
      resolvedActionInput.sessionId === undefined
        ? undefined
        : {
            id: resolvedActionInput.sessionId
          }
  });
}
