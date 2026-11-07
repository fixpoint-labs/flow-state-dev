/**
 * Type definitions for the Vercel deployment adapter.
 *
 * Provides the configuration surface for `createVercelHandler` and the internal
 * router type that the adapter wraps.
 */

import type { FlowApiRouter } from "@flow-state-dev/engine";

/** The router `createFlowApiRouter` returns: engine's own type, re-exported. */
export type { FlowApiRouter };

/**
 * Accepted input for `createVercelHandler`. Either a pre-built router or a
 * factory function that lazily creates one (useful when store initialization
 * is async, e.g. Postgres pool creation).
 */
export type VercelHandlerInput =
  | FlowApiRouter
  | (() => FlowApiRouter | Promise<FlowApiRouter>);

/**
 * Configuration options for `createVercelHandler`.
 */
export type VercelHandlerOptions = {
  /**
   * Callback invoked when a client disconnects and the request signal aborts.
   * Useful for logging or cleanup.
   */
  onAbort?: (req: Request) => void;

  /**
   * Vercel `waitUntil` function for keeping the serverless function alive
   * after the response has been sent. Pass this when background `.sideChain()`
   * tasks need to outlive the response stream.
   *
   * Typically obtained from `@vercel/functions` or Next.js `after()`.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
};
