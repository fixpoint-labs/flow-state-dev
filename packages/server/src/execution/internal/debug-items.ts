/**
 * Block debug item emission: captures resolved block observability for devtool inspection.
 *
 * Debug items are transient + trace-only — they stream to connected clients and appear in
 * the events log but are never persisted in the items record or sent to LLM context.
 * Emission is gated by `isTraceObservabilityEnabled()` — the same gate used by
 * sequencer state snapshots, so a single env var (`FSDEV_TRACE_OBSERVABILITY`)
 * controls all trace observability output.
 *
 * Emission scope:
 *   - Generators: always emit when gate is on (model, prompt, tools).
 *   - Any block kind: emit when its `connectInput` connector transformed the
 *     raw input (payload carries `connectedInput`).
 *   - Non-generator blocks with no transforming connector: no emission.
 */
import type { BlockDebugItem, BlockDebugPayload, ItemProvenance } from "@flow-state-dev/core/items";
import type { BlockDebugCapturePayload, BlockDefinition } from "@flow-state-dev/core/types";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";
import type { ExecutionMetadata } from "../types";
import { getResponseItems } from "./response";

/**
 * @deprecated Use `isTraceObservabilityEnabled` directly. Retained for one
 * release cycle so existing call sites and tests don't break in lockstep.
 */
export const isDebugItemsEnabled = isTraceObservabilityEnabled;

function createDebugProvenance(
  metadata: ExecutionMetadata,
  blockName: string
): ItemProvenance {
  return {
    blockName,
    blockInstanceId: metadata.blockInstanceId!,
    parentBlockInstanceId: metadata.parentBlockInstanceId,
    phase: metadata.scope === "work" ? "work" : "main",
    stepIndex: metadata.stepIndex,
    workGroupId: metadata.workGroupId,
    attempt: metadata.attempt,
  };
}

/**
 * Convert a generator's runtime capture payload to the stored debug payload format.
 */
export function buildGeneratorDebugPayload(
  capture: BlockDebugCapturePayload
): BlockDebugPayload {
  return {
    model: capture.model,
    prompt: capture.prompt,
    tools: capture.tools.length > 0 ? capture.tools : undefined,
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

/**
 * Emit a block_debug item via the response emitter.
 *
 * Prefers `emitItemOneShot` when available — it streams item.added/item.done
 * to connected clients and persists to the events log, but does NOT add the
 * item to `response.getItems()`. Full prompts can be tens of kilobytes each
 * and a long request may capture many; keeping them out of the in-memory
 * items buffer avoids O(N × prompt-size) request-state bulk. The tradeoff
 * is loss of in-request replay from the response buffer, which is
 * acceptable for observability data that's durably persisted in the events
 * log anyway.
 *
 * Falls back to the standard emitItemAdded/emitItemDone pair for emitters
 * (e.g. test mocks) that haven't implemented the one-shot path.
 *
 * Callers must check `isTraceObservabilityEnabled()` before calling.
 */
export async function emitBlockDebugItem(
  response: unknown,
  block: BlockDefinition,
  metadata: ExecutionMetadata,
  payload: BlockDebugPayload
): Promise<void> {
  if (
    typeof response !== "object" ||
    response === null ||
    typeof (response as { emitItemAdded?: unknown }).emitItemAdded !== "function" ||
    typeof (response as { emitItemDone?: unknown }).emitItemDone !== "function"
  ) {
    return;
  }

  const itemIndex = getResponseItems(response).length;
  const item: BlockDebugItem = {
    id: `item_block_debug_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "block_debug",
    status: "completed",
    client: false,
    history: false,
    transient: true,
    requestId: metadata.requestId,
    itemIndex,
    provenance: createDebugProvenance(metadata, block.name),
    ts: Date.now(),
    blockName: block.name,
    blockKind: block.kind,
    blockInstanceId: metadata.blockInstanceId!,
    payload,
  };

  const oneShot = (response as { emitItemOneShot?: unknown }).emitItemOneShot;
  if (typeof oneShot === "function") {
    await (oneShot as (item: BlockDebugItem) => Promise<unknown>).call(response, item);
    return;
  }

  const emitter = response as {
    emitItemAdded: (item: BlockDebugItem) => Promise<unknown>;
    emitItemDone: (item: BlockDebugItem) => Promise<unknown>;
  };
  await emitter.emitItemAdded(item);
  await emitter.emitItemDone(item);
}
