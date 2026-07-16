/**
 * @flow-state-dev/node — Node HTTP host adapter for flow-state-dev.
 *
 * `serve(flowState)` stands up a long-lived server (via `@hono/node-server`) for
 * an FSD app: a `/healthz` endpoint, the engine router with unbuffered SSE, an
 * optional static asset directory, and graceful shutdown. The web-process
 * counterpart to `@flow-state-dev/vercel` (serverless) for self-hosting on
 * Railway, Render, Fly, a VPS, or anywhere a Node process can run.
 *
 * `createServerApp(flowState)` (also at the `./app` subpath) returns the portable
 * Hono app under `serve()` — wrap its `app.fetch` for a serverless target such as
 * AWS Lambda (see the `./aws-lambda` subpath).
 */
export { serve } from "./serve";
export type { ServeOptions, ServeHandle } from "./serve";
export { createServerApp } from "./app";
export type { ServerApp, ServerAppOptions } from "./app";
export { isLoopbackHost, assertNetworkBindIsAuthenticated } from "./bind-guard";
export type { NetworkBindGuardOptions } from "./bind-guard";
