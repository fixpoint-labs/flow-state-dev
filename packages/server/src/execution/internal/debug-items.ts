/**
 * Block debug item emission: captures resolved block configuration for devtool inspection.
 *
 * Debug items are transient + trace-only — they stream to connected clients and appear in
 * the events log but are never persisted in the items record or sent to LLM context.
 * Emission is gated by the FSDEV_DEBUG_ITEMS env var (defaults to on in dev, off in production).
 */
import type { BlockDebugItem, BlockDebugPayload, ItemProvenance } from "@flow-state-dev/core/items";
import type { BlockDebugCapturePayload, BlockDefinition } from "@flow-state-dev/core/types";
import type { ExecutionMetadata } from "../types";
import { getResponseItems } from "./response";

/** Returns true when debug item emission is enabled for this process. */
export function isDebugItemsEnabled(): boolean {
  const explicit = process.env.FSDEV_DEBUG_ITEMS;
  if (explicit !== undefined) {
    return explicit === "true" || explicit === "1";
  }
  return process.env.NODE_ENV !== "production";
}

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
 * Build the debug payload for a non-generator block from its definition.
 * Generators fire the runtimeHook path instead (they have richer resolved data).
 */
export function buildStaticBlockDebugPayload(
  block: BlockDefinition
): BlockDebugPayload {
  const payload: BlockDebugPayload = {};
  const config = block.config as unknown as Record<string, unknown>;

  if (block.kind === "handler") {
    const inputTypeName = block.inputSchema?._def?.typeName;
    if (inputTypeName && inputTypeName !== "ZodAny") {
      payload.inputSchema = block.inputSchema!.description ?? inputTypeName;
    }
    const outputTypeName = block.outputSchema?._def?.typeName;
    if (outputTypeName && outputTypeName !== "ZodAny") {
      payload.outputSchema = block.outputSchema!.description ?? outputTypeName;
    }
  }

  if (block.kind === "router") {
    const routes = config.routes as Array<{ name?: string }> | undefined;
    if (routes) {
      payload.candidates = routes.map((r) => r.name ?? "unnamed");
    }
  }

  if (block.kind === "sequencer") {
    const stateSchema = config.stateSchema as { shape?: Record<string, unknown> } | undefined;
    if (stateSchema?.shape) {
      payload.stateKeys = Object.keys(stateSchema.shape);
    }
  }

  return payload;
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
    maxTokens: capture.maxTokens,
    search: capture.search || undefined,
  };
}

/**
 * Emit a block_debug item via the response emitter.
 * Callers must check isDebugItemsEnabled() before calling.
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

  const emitter = response as {
    emitItemAdded: (item: BlockDebugItem) => Promise<unknown>;
    emitItemDone: (item: BlockDebugItem) => Promise<unknown>;
  };

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

  await emitter.emitItemAdded(item);
  await emitter.emitItemDone(item);
}
