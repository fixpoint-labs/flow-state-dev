/**
 * @flow-state-dev/vercel — Vercel deployment adapter for flow-state-dev.
 *
 * Provides `createVercelHandler` to wrap a flow-state-dev router into
 * Next.js App Router handlers with Vercel-specific SSE shaping, heartbeats,
 * and runtime configuration. One import + one route file to deploy any
 * FSD app to Vercel.
 */
export { createVercelHandler, createVercelBareHandler } from "./handler";
export type {
  FlowApiRouter,
  NextAppRouteHandler,
  NextBareRouteHandler,
  VercelHandlerInput,
  VercelHandlerOptions
} from "./types";
