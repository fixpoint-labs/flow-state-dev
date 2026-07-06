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
import { streamHandle } from "hono/aws-lambda";
import { createServerApp, type ServerAppOptions } from "./app";
import type { FlowApiRouter, FlowState } from "@flow-state-dev/engine";

/**
 * Build an AWS Lambda streaming handler for `app` (a `FlowState` or a raw
 * `FlowApiRouter`). The returned handler is the Lambda export; configure the
 * function's Function URL with `invokeMode: RESPONSE_STREAM` so SSE streams.
 */
export function createLambdaHandler(
  app: FlowState | FlowApiRouter,
  options?: ServerAppOptions,
): ReturnType<typeof streamHandle> {
  return streamHandle(createServerApp(app, options).app);
}
