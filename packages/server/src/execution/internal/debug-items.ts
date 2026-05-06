/**
 * Block debug payload builders for devtool inspection.
 *
 * Debug items are transient + trace-only — they stream to connected clients
 * and appear in the events log but are never persisted in the items record
 * or sent to LLM context. Emission is gated by `isTraceObservabilityEnabled()`
 * — the same gate used by sequencer state snapshots, so a single env var
 * (`FSDEV_TRACE_OBSERVABILITY`) controls all trace observability output.
 *
 * Emission scope:
 *   - Generators: always emit when gate is on (model, prompt, tools).
 *   - Any block kind: emit when its `connectInput` connector transformed the
 *     raw input (payload carries `connectedInput`).
 *   - Non-generator blocks with no transforming connector: no emission.
 *
 * The actual `block_debug` item construction and emission lives in the
 * per-context `ctx.emit.trace.blockDebug` impl in
 * `packages/server/src/context/createExecutionContext.ts`. This file now
 * only owns the payload-shape helpers used to build the input to that impl.
 */
import type { BlockDebugPayload } from "@flow-state-dev/core/items";
import type { BlockDebugCapturePayload } from "@flow-state-dev/core/types";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";

/**
 * @deprecated Use `isTraceObservabilityEnabled` directly. Retained for one
 * release cycle so existing call sites and tests don't break in lockstep.
 */
export const isDebugItemsEnabled = isTraceObservabilityEnabled;

/**
 * Convert a generator's runtime capture payload to the stored debug payload format.
 * Empty `tools`/`user`/`history` arrays are omitted so the persisted item only
 * carries fields that have meaningful content for the devtool to render.
 */
export function buildGeneratorDebugPayload(
  capture: BlockDebugCapturePayload
): BlockDebugPayload {
  return {
    model: capture.model,
    prompt: capture.prompt,
    tools: capture.tools.length > 0 ? capture.tools : undefined,
    user: capture.user.length > 0 ? capture.user : undefined,
    history: capture.history.length > 0 ? capture.history : undefined,
  };
}

/**
 * Build a debug payload carrying only the connector-transformed input. Used
 * for any block kind whose `connectInput` rewrote the raw input.
 */
export function buildConnectedInputDebugPayload(
  connectedInput: unknown
): BlockDebugPayload {
  return { connectedInput };
}

