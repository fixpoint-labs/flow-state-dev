/**
 * Shared `tool_output` envelope emit machinery. Used by both the AI SDK
 * tool-loop wrapper inside `compileToolsWithExecute` and the public
 * `BlockDefinition.asTool()` method so the two origins produce identical
 * items with identical lifecycle (`item.added` → `item.updated` → `item.done`).
 *
 * Callers handle scope wrapping, retry, timeout, and observer hooks; this
 * helper handles only the item envelope.
 */
import type { BlockContext, BlockDefinition } from "../../types/block";
import type { AgentType, ModelIdentity } from "../../items/types";
import { sanitizeToolName } from "../../helpers/tool-name";
import { getEmitterItemCount } from "./utils";
import { toError } from "./utils";

/**
 * Attribution fields stamped on the emitted `tool_output` item. The AI SDK
 * tool-loop path populates these from the parent generator and supplies the
 * model-provided `callId`; the `.asTool()` path synthesizes a `callId` and
 * forwards opts-supplied attribution.
 */
export type EmitToolOutputAttribution = {
  /** Stable tool-call identifier — model-provided in the AI-SDK path; synthesized in `.asTool`. */
  callId: string;
  /** Name of the block that initiated the call (parent generator or wrapping block). */
  generatorBlock: string;
  agentType?: AgentType;
  agentName?: string;
  /**
   * Resolved identity of the generator model that invoked this tool. Stamped
   * on the emitted `tool_output` item so consumers can attribute tool
   * results back to the model that issued the call. Only set by the AI SDK
   * tool-loop path; the `.asTool()` path leaves it absent.
   */
  model?: ModelIdentity;
  /**
   * Cache-hit attribution (FIX-610). When set, the emitted `tool_output`
   * item carries `cached: true` plus the supplied `cacheAgeMs` and (when
   * the hit crossed a task boundary inside a Task Board run) a
   * `sourceTask` pointer back to the originating task. Absent for normal
   * uncached calls.
   */
  cached?: {
    ageMs: number;
    sourceTask?: { collectionId: string; taskId: string };
  };
};

/**
 * Wraps the inner block invocation with the `tool_output` item lifecycle.
 * Emits `item.added` before calling `runInner`, then `item.updated` +
 * `item.done` after the inner call resolves (or fails). Returns the inner
 * call's output. Rethrows the original error after marking the item failed.
 *
 * `runInner` receives the outer `ctx` (not a scoped derivative — callers
 * that need a scope are responsible for deriving one themselves) and the
 * emitted item's id, so the caller can stash it as a
 * `_blockOutputHint = { kind: "ref", sourceItemId }` on whatever ctx the
 * inner block will see. That keeps the inner block's own block_trace
 * pointing at the tool_output as a ref rather than producing a duplicate
 * inline output.
 */
export async function emitToolOutputAround(
  block: BlockDefinition<any, any>,
  ctx: BlockContext,
  args: unknown,
  attribution: EmitToolOutputAttribution,
  runInner: (outerCtx: BlockContext, toolOutputId: string) => Promise<unknown>,
): Promise<unknown> {
  const parentIdentity = ctx._blockIdentity;
  const blockName = block.name;
  const itemId = `item_tool_output_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const item: any = {
    id: itemId,
    type: "tool_output" as const,
    status: "in_progress" as const,
    requestId: ctx.request.identity.id,
    itemIndex: getEmitterItemCount(ctx.response),
    provenance: {
      blockName: parentIdentity?.blockName ?? blockName,
      blockInstanceId: parentIdentity?.blockInstanceId ?? blockName,
      parentBlockInstanceId: parentIdentity?.parentBlockInstanceId,
      phase: parentIdentity?.phase ?? "main",
    },
    ts: Date.now(),
    ownedBy: parentIdentity?.ownedBy,
    ...(attribution.agentType !== undefined ? { agentType: attribution.agentType } : {}),
    ...(attribution.agentName !== undefined ? { agentName: attribution.agentName } : {}),
    ...(attribution.model !== undefined ? { model: attribution.model } : {}),
    ...(attribution.cached !== undefined
      ? {
          cached: true,
          cacheAgeMs: attribution.cached.ageMs,
          ...(attribution.cached.sourceTask !== undefined
            ? { sourceTask: attribution.cached.sourceTask }
            : {}),
        }
      : {}),
    blockName,
    output: undefined,
    toolCall: {
      callId: attribution.callId,
      name: blockName,
      alias: sanitizeToolName(blockName),
      arguments: typeof args === "string" ? args : JSON.stringify(args),
      generatorBlock: attribution.generatorBlock,
    },
  };

  await ctx.response.emit({ type: "item.added", item });

  try {
    const output = await runInner(ctx, itemId);
    item.status = "completed";
    item.output = output;
    await ctx.response.emit({
      type: "item.updated",
      id: itemId,
      patch: { status: "completed", output },
    });
    await ctx.response.emit({ type: "item.done", item });
    return output;
  } catch (error) {
    const err = toError(error) as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
    item.status = "failed";
    item.output = undefined;
    item.error = {
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    };
    await ctx.response.emit({
      type: "item.updated",
      id: itemId,
      patch: { status: "failed", output: undefined, error: item.error },
    });
    await ctx.response.emit({ type: "item.done", item });
    throw err;
  }
}
