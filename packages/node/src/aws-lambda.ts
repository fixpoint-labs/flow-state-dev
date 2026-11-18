/**
 * AWS Lambda entry point for an FSD app, built on the same portable Hono app as
 * `serve()`.
 *
 * Wraps `createServerApp(...).app` with Hono's `streamHandle`, which adapts the
 * app to Lambda's response-streaming runtime (`awslambda.streamifyResponse`) so
 * SSE responses stream incrementally rather than buffering to the 6 MB limit.
 * Deploy behind a Lambda Function URL with `invokeMode: RESPONSE_STREAM`.
 *
 * @example
 * ```ts
 * // handler.ts
 * import { createLambdaHandler } from "@flow-state-dev/node/aws-lambda";
 * import { flowState } from "./flow-state";
 * export const handler = createLambdaHandler(flowState);
 * ```
 */
import { Hono } from "hono";
import { createNetworkAuthGuard, isFlowState, type FlowApiRouter } from "@flow-state-dev/engine/host";
import { streamHandle } from "hono/aws-lambda";
import { createServerApp, type ServerAppOptions } from "./app";
import type { FlowState } from "@flow-state-dev/engine";

/** Lambda hosting options. */
export interface LambdaHandlerOptions extends ServerAppOptions {
  /** Explicitly permit flows that trust a caller-supplied userId. */
  allowUnauthenticated?: boolean;
}

/**
 * Build an AWS Lambda streaming handler for `app` (a `FlowState` or a raw
 * `FlowApiRouter`). The returned handler is the Lambda export; configure the
 * function's Function URL with `invokeMode: RESPONSE_STREAM` so SSE streams.
 */
export function createLambdaHandler(
  app: FlowState | FlowApiRouter,
  options?: LambdaHandlerOptions,
): ReturnType<typeof streamHandle> {
  const guard = createNetworkAuthGuard(options?.allowUnauthenticated);
  // Build the app first so its init-failure handler is attached before the
  // shared router promise can reject.
  const server = createServerApp(app, options).app;
  const routerPromise: Promise<FlowApiRouter> = isFlowState(app) ? app.getRouter() : Promise.resolve(app);
  const guarded = new Hono();
  guarded.onError((_err, c) => c.json({ error: "Internal server error" }, 500));
  guarded.all("*", async (c) => {
    let router: FlowApiRouter;
    try {
      router = await routerPromise;
    } catch {
      // Store init failed. The app already records it and reports it as JSON,
      // including `/healthz`.
      return server.fetch(c.req.raw);
    }
    const refused = await guard(router);
    return refused ?? server.fetch(c.req.raw);
  });
  return streamHandle(guarded);
}
