/**
 * @flow-state-dev/node — Node HTTP host adapter for flow-state-dev.
 *
 * `serve(flowState)` stands up a long-lived `node:http` server for an FSD app:
 * the Node→Web request bridge (with unbuffered SSE), a `/healthz` endpoint, an
 * optional static asset directory, and graceful shutdown. The web-process
 * counterpart to `@flow-state-dev/vercel` (serverless) for self-hosting on
 * Railway, Render, Fly, a VPS, or anywhere a Node process can run.
 */
export { serve } from "./serve";
export type { ServeOptions, ServeHandle } from "./serve";
export {
  handleApiRequest,
  readRequestBody,
  type HandleApiRequestOptions,
} from "./bridge";
