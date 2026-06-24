/**
 * Runtime entry — re-exports the FlowState (and the BullMQ adapter) declared
 * once in `fsdev.config.ts`, so the Next.js route handlers, Bull Board, and the
 * `fsdev` CLI all run the exact same wiring.
 */
export { default as flowstate, bullmq } from "../fsdev.config";
export type { FlowState } from "@flow-state-dev/engine";
