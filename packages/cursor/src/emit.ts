/**
 * Emission: drives `ctx.response.emit` from {@link TranslatedEvent}s.
 *
 * Each translated event becomes canonical FSD item lifecycle emissions, with
 * base fields derived from `_blockIdentity` and a fresh `itemIndex` per item —
 * the shape `codex/emit.ts` established and the item contract in
 * `docs/architecture/items.md` describes.
 *
 * Thinner than the Claude Code emitter, and the reason is the wire rather than
 * a scope cut: a subagent's work arrives through the parent's own `task` tool
 * call rather than as a nested run, so there are no containers to nest.
 *
 * Text is the one thing that needs state. `run.stream()` delivers an answer, and
 * the thinking before it, as a run of small `assistant` / `thinking` messages,
 * a few tokens each. One item per message would draw one row per token, so
 * consecutive chunks of one kind stream into ONE open item as content deltas.
 * It closes when the kind changes, when a tool call, a note or an error comes
 * between, or when the run ends. The other correlation is the open/settle pair
 * for tool calls.
 */
import { itemScope, type BlockContext } from "@flow-state-dev/core/types";
import type { TranslatedEvent } from "./types";

/** Provenance derived once per run and stamped on every emitted item. */
interface EmitProvenance {
  blockName: string;
  blockInstanceId: string;
  parentBlockInstanceId?: string;
  phase: "main" | "sideChain";
}

/**
 * Emission bookkeeping for one run: the message or reasoning item still taking
 * chunks, the `tool_output` items opened by a call and awaiting their result,
 * and the run's last assistant text.
 *
 * An open tool keeps the `itemIndex` it was added with. `getItemCount()`
 * counts items by id, and settling an item the stream already has does not
 * grow it — so re-reading the count on completion would hand the settled item
 * the index the NEXT item is about to get, and two items would share one.
 *
 * Deliberately NOT tracking the distinct tool names a run used, as the Claude
 * Code emitter does. That sibling puts them on its handle, but nothing in this
 * repository reads the field, and nothing in the neutral contract does — a
 * manager settles a run on `status`, `outcome`, `sessionId`, `usage` and `cost`.
 * Accumulating it here to match the sibling would mean either a list nobody
 * reads, or inventing a consumer to justify writing it.
 */
export interface EmitState {
  /**
   * The message or reasoning item still taking chunks, or `null`. `item` is the
   * in-progress item as added, so closing it keeps every field it was born with.
   */
  openText: { kind: "message" | "reasoning"; item: Record<string, unknown> & { id: string }; text: string } | null;
  readonly openTools: Map<
    string,
    { id: string; itemIndex: number; name: string; arguments: string }
  >;
  /** The last completed assistant message, all its chunks — the run's `finalMessage`. */
  finalMessage: string | null;
}

/** Create a fresh {@link EmitState} for one run. */
export function createEmitState(): EmitState {
  return { openText: null, openTools: new Map(), finalMessage: null };
}

const CONVERSATIONAL_VISIBILITY = { client: true, history: true } as const;

/** Derive the run-stable provenance from the block context identity. */
function deriveProvenance(ctx: BlockContext, blockName: string): EmitProvenance {
  const identity = (
    ctx as {
      _blockIdentity?: {
        blockName?: string;
        blockInstanceId?: string;
        parentBlockInstanceId?: string;
        phase?: "main" | "sideChain";
      };
    }
  )._blockIdentity;
  return {
    blockName: identity?.blockName ?? blockName,
    blockInstanceId: identity?.blockInstanceId ?? blockName,
    parentBlockInstanceId: identity?.parentBlockInstanceId,
    phase: identity?.phase ?? "main",
  };
}

/** Mint a unique item id with a kind-specific prefix. */
function mintId(kind: string): string {
  return `item_${kind}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Per-item base fields, reading a fresh `itemIndex` each call.
 *
 * Every item this package creates goes through here, so the scope is stamped in
 * one place rather than remembered at six call sites. The scope is the task the
 * item belongs to (what puts it in a task's own item list) and the container
 * that owns it (what nests it inside that container), via {@link itemScope}.
 */
function buildBase(ctx: BlockContext, provenance: EmitProvenance, kind: string) {
  return {
    id: mintId(kind),
    requestId: ctx.request.identity.id,
    itemIndex: ctx.response.getItemCount(),
    provenance,
    ts: Date.now(),
    ...itemScope(ctx),
  };
}

/**
 * Apply one {@link TranslatedEvent} to the response stream, mutating `state`.
 *
 * The events that carry data to the HANDLE rather than to the stream —
 * `run_usage` and `model` — are no-ops here; the block reads them off the same
 * translated event.
 */
export async function emitTranslatedEvent(
  event: TranslatedEvent,
  ctx: BlockContext,
  state: EmitState,
  blockName: string,
): Promise<void> {
  const provenance = deriveProvenance(ctx, blockName);
  // Anything that is part of the stream but not text ends the text before it.
  // Facts about the run (usage, model, plan) are not in the stream's order.
  if (
    event.kind === "tool_call" ||
    event.kind === "tool_result" ||
    event.kind === "status" ||
    event.kind === "error"
  ) {
    await closeOpenText(ctx, state);
  }
  switch (event.kind) {
    case "message":
      return emitText(event.text, "message", ctx, state, provenance);
    case "reasoning":
      return emitText(event.text, "reasoning", ctx, state, provenance);
    case "tool_call":
      return emitToolCall(event, ctx, state, provenance, blockName);
    case "tool_result":
      return emitToolResult(event, ctx, state, provenance, blockName);
    case "status":
      ctx.emit.status(event.message);
      return;
    case "error":
      return emitError(event.message, event.code, ctx, provenance);
    // Facts about the RUN rather than the stream: the block reads them off the
    // same translated event.
    case "run_usage":
    case "model":
    case "plan_list":
      return;
  }
}

/** The item's body for `text`: a message's `content`, a reasoning item's `summary`. */
function textBody(kind: "message" | "reasoning", text: string) {
  return kind === "message"
    ? { role: "assistant" as const, content: [{ type: "output_text" as const, text }] }
    : { summary: [{ type: "reasoning_text" as const, text }] };
}

const partTypeOf = (kind: "message" | "reasoning") => (kind === "message" ? ("output_text" as const) : ("reasoning_text" as const));

/**
 * Stream one chunk of a message or reasoning item. The first chunk of a kind
 * opens the item (added(in_progress) → content.added); each chunk is a
 * content.delta. {@link closeOpenText} finishes it. A chunk of the other kind
 * closes the open item first.
 */
async function emitText(
  text: string,
  kind: "message" | "reasoning",
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
): Promise<void> {
  if (state.openText !== null && state.openText.kind !== kind) await closeOpenText(ctx, state);
  if (state.openText === null) {
    const base = buildBase(ctx, provenance, kind === "message" ? "msg" : "reason");
    const item = {
      ...base,
      type: kind,
      status: "in_progress" as const,
      itemVisibility: CONVERSATIONAL_VISIBILITY,
      ...textBody(kind, ""),
    };
    await ctx.response.emit({ type: "item.added", item });
    await ctx.response.emit({
      type: "content.added",
      itemId: base.id,
      contentIndex: 0,
      content: { type: partTypeOf(kind), text: "" },
    });
    state.openText = { kind, item, text: "" };
  }
  state.openText.text += text;
  await ctx.response.emit({
    type: "content.delta",
    itemId: state.openText.item.id,
    contentIndex: 0,
    delta: text,
  });
}

/**
 * Finish the message or reasoning item still taking chunks, if there is one:
 * content.done → item.done. A message that completed is the run's
 * `finalMessage`; one cut short (`incomplete`) is kept as far as it got and is
 * not.
 */
export async function closeOpenText(
  ctx: BlockContext,
  state: EmitState,
  status: "completed" | "incomplete" = "completed",
): Promise<void> {
  const open = state.openText;
  if (open === null) return;
  // Before the awaits, so a second close can't finish it twice.
  state.openText = null;
  await ctx.response.emit({
    type: "content.done",
    itemId: open.item.id,
    contentIndex: 0,
    content: { type: partTypeOf(open.kind), text: open.text },
  });
  await ctx.response.emit({
    type: "item.done",
    item: { ...open.item, status, ...textBody(open.kind, open.text) } as never,
  });
  if (open.kind === "message" && status === "completed") state.finalMessage = open.text;
}

/** Open a `tool_output` item on a tool call. */
async function emitToolCall(
  event: Extract<TranslatedEvent, { kind: "tool_call" }>,
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
  blockName: string,
): Promise<void> {
  const base = buildBase(ctx, provenance, "tool");
  const item = {
    ...base,
    type: "tool_output" as const,
    status: "in_progress" as const,
    blockName: event.name,
    output: null as unknown,
    toolCall: {
      callId: event.callId,
      name: event.name,
      arguments: event.arguments,
      generatorBlock: blockName,
    },
    itemVisibility: CONVERSATIONAL_VISIBILITY,
  };
  await ctx.response.emit({ type: "item.added", item });
  state.openTools.set(event.callId, {
    id: base.id,
    itemIndex: base.itemIndex,
    name: event.name,
    arguments: event.arguments,
  });
}

/**
 * Settle the open `tool_output` item when its result arrives.
 *
 * A result with no opening call still produces a complete item rather than
 * being dropped: it had no `item.added`, so one is emitted here first, or a
 * consumer tracking added-then-done would reference an item it never saw.
 */
async function emitToolResult(
  event: Extract<TranslatedEvent, { kind: "tool_result" }>,
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
  blockName: string,
): Promise<void> {
  const open = state.openTools.get(event.callId);
  const isOrphan = open === undefined;
  const item = {
    id: open?.id ?? mintId("tool"),
    type: "tool_output" as const,
    status: event.isError ? ("failed" as const) : ("completed" as const),
    requestId: ctx.request.identity.id,
    // The orphan is a NEW item and takes a fresh index; the settled one keeps its own.
    itemIndex: open?.itemIndex ?? ctx.response.getItemCount(),
    provenance,
    ts: Date.now(),
    ...itemScope(ctx),
    blockName: open?.name ?? event.name,
    output: event.output,
    toolCall: {
      callId: event.callId,
      name: open?.name ?? event.name,
      arguments: open?.arguments ?? event.arguments,
      generatorBlock: blockName,
    },
    itemVisibility: CONVERSATIONAL_VISIBILITY,
    ...(event.isError ? { error: { message: stringifyOutput(event.output) } } : {}),
  };
  if (isOrphan) await ctx.response.emit({ type: "item.added", item });
  await ctx.response.emit({ type: "item.done", item });
  state.openTools.delete(event.callId);
}

/** Emit a self-contained error item. */
async function emitError(
  message: string,
  code: string | undefined,
  ctx: BlockContext,
  provenance: EmitProvenance,
): Promise<void> {
  const base = buildBase(ctx, provenance, "error");
  const item = {
    ...base,
    type: "error" as const,
    status: "failed" as const,
    message,
    ...(code ? { code } : {}),
  };
  await ctx.response.emit({ type: "item.added", item });
  await ctx.response.emit({ type: "item.done", item });
}

/**
 * Close anything still open when the stream ends — a tool call whose result
 * never arrived because the turn failed, the deadline fired, or the CLI died.
 * Left open, it would render as a call still running long after the run ended.
 */
export async function finalizeOpenItems(
  ctx: BlockContext,
  state: EmitState,
  blockName: string,
): Promise<void> {
  const provenance = deriveProvenance(ctx, blockName);
  await closeOpenText(ctx, state, "incomplete");
  for (const [callId, open] of state.openTools) {
    await ctx.response.emit({
      type: "item.done",
      item: {
        id: open.id,
        type: "tool_output",
        status: "incomplete",
        requestId: ctx.request.identity.id,
        itemIndex: open.itemIndex,
        provenance,
        ts: Date.now(),
        ...itemScope(ctx),
        blockName: open.name,
        output: null,
        toolCall: {
          callId,
          name: open.name,
          arguments: open.arguments,
          generatorBlock: blockName,
        },
        itemVisibility: CONVERSATIONAL_VISIBILITY,
      },
    });
  }
  state.openTools.clear();
}

/** A tool result's payload as a message string, without throwing on a cycle. */
function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output) ?? String(output);
  } catch {
    return String(output);
  }
}
