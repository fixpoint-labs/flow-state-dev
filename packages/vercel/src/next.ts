/**
 * Vercel-hosted Next.js composition for `createFlowState`.
 *
 * `createVercelNextHandler(flowstate)` mounts a `FlowState` onto a catch-all
 * route with Vercel's SSE header shaping (via `createVercelHandler`) and
 * resolves the router lazily on the first request. Use this on Vercel; use
 * `@flow-state-dev/next`'s `createNextHandler` on non-Vercel Next deployments.
 *
 * Note: the serverless background-work keep-alive (`after`) is wired at the
 * runtime level via `createFlowState({ onBackgroundWork })`, not here — the
 * router is built inside `createFlowState`, so a handler that wraps an
 * already-built router can't inject construction-time hooks.
 */
import type { FlowState } from "@flow-state-dev/engine";
import { createVercelHandler } from "./handler";

export function createVercelNextHandler(flowstate: FlowState): ReturnType<
  typeof createVercelHandler
> {
  return createVercelHandler(() => flowstate.getRouter());
}
