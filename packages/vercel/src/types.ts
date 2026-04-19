/**
 * Type definitions for the Vercel deployment adapter.
 *
 * Provides the configuration surface for `createVercelHandler` and the internal
 * router type that the adapter wraps.
 */

/**
 * The router shape returned by `createFlowApiRouter` from `@flow-state-dev/server`.
 * Each method handles a Next.js catch-all route segment.
 */
export type FlowApiRouter = {
  GET: (req: Request, ctx: { params: { path?: string[] } }) => Promise<Response>;
  POST: (req: Request, ctx: { params: { path?: string[] } }) => Promise<Response>;
  PATCH: (req: Request, ctx: { params: { path?: string[] } }) => Promise<Response>;
  DELETE: (req: Request, ctx: { params: { path?: string[] } }) => Promise<Response>;
};

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
   * Interval in milliseconds between SSE heartbeat comments.
   * Heartbeats prevent intermediate proxies from closing idle connections.
   * Default: 15000 (15 seconds).
   */
  heartbeatMs?: number;

  /**
   * Callback invoked when a client disconnects and the request signal aborts.
   * Useful for logging or cleanup.
   */
  onAbort?: (req: Request) => void;

  /**
   * Vercel `waitUntil` function for keeping the serverless function alive
   * after the response has been sent. Pass this when background `.work()`
   * tasks need to outlive the response stream.
   *
   * Typically obtained from `@vercel/functions` or Next.js `after()`.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
};
