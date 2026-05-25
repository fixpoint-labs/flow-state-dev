/**
 * @flow-state-dev/next — platform-agnostic Next.js App Router adapter.
 *
 * Exposes `createNextHandler(flowstate)`, which mounts a `FlowState` onto a
 * catch-all route with no Vercel-specific behavior. For Vercel-hosted Next
 * apps, use `@flow-state-dev/vercel/next` instead, which adds SSE shaping and
 * `waitUntil` background work.
 */
export { createNextHandler } from "./createNextHandler";
