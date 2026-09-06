/**
 * Emission: drives `ctx.response.emit` from {@link TranslatedEvent}s.
 *
 * Each translated event becomes canonical FSD item lifecycle emissions, with
 * base fields derived from `_blockIdentity` and a fresh `itemIndex` per item —
 * the shape `claude-code/sdk/emit.ts` established and the item contract in
 * `docs/architecture/items.md` describes.
 *
 * Thinner than the Claude Code emitter by three whole concerns, and the reason
 * is the wire rather than a scope cut: Codex streams WHOLE items, so there are
 * no content deltas to coalesce; it spawns no sub-agents, so there are no
 * containers to nest; and it reports no partial messages, so there is no open
 * streaming item to close at a turn boundary. What remains is the open/settle
 * pair for tool calls, which is the only correlation Codex's stream has.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { TranslatedEvent } from "./types";

/** Provenance derived once per run and stamped on every emitted item. */
interface EmitProvenance {
  blockName: string;
  blockInstanceId: string;
  parentBlockInstanceId?: string;
  phase: "main" | "sideChain";
}

/**
 * Where this run sits, as the runtime describes it on `ctx._blockIdentity`.
 *
 * Both fields go on **every** item, which is what every canonical emit site in
 * the framework does. They are not decoration: `taskId` is what puts an item in
 * a task's own item list, and `ownedBy` is what nests it inside an enclosing
 * container. A harness that drops them emits items a manager cannot attribute
 * to the task it dispatched — and running inside a manager's task scope is the
 * entire reason this package exists.
 *
 * Absent outside a task scope, and then the keys are omitted rather than set to
 * `undefined`, so a persisted item does not carry a key that means nothing.
 */
interface EmitScope {
  taskId?: string;
  ownedBy?: string;
}

/** Read the run's scope off the block identity. */
function deriveScope(ctx: BlockContext): EmitScope {
  const identity = (ctx as { _blockIdentity?: { taskId?: string; ownedBy?: string } })
    ._blockIdentity;
  return {
    ...(identity?.taskId !== undefined ? { taskId: identity.taskId } : {}),
    ...(identity?.ownedBy !== undefined ? { ownedBy: identity.ownedBy } : {}),
  };
}

/**
 * Emission bookkeeping for one run: the `tool_output` items opened by a call
 * and awaiting their result, and the run's last assistant text.
 *
 * Deliberately NOT tracking the distinct tool names a run used, as the Claude
 * Code emitter does. That sibling puts them on its handle, but nothing in this
 * repository reads the field, and nothing in the neutral contract does — a
 * manager settles a run on `status`, `outcome`, `sessionId`, `usage` and `cost`.
 * Accumulating it here to match the sibling would mean either a list nobody
 * reads, or inventing a consumer to justify writing it.
 */
export interface EmitState {
  readonly openTools: Map<string, { id: string; name: string; arguments: string }>;
  /** The last completed assistant message — the run's `finalMessage`. */
  finalMessage: string | null;
}

/** Create a fresh {@link EmitState} for one run. */
export function createEmitState(): EmitState {
  return { openTools: new Map(), finalMessage: null };
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
 * one place rather than remembered at six call sites.
 */
function buildBase(ctx: BlockContext, provenance: EmitProvenance, kind: string) {
  return {
    id: mintId(kind),
    requestId: ctx.request.identity.id,
    itemIndex: ctx.response.getItemCount(),
    provenance,
    ts: Date.now(),
    ...deriveScope(ctx),
  };
}

/**
 * Apply one {@link TranslatedEvent} to the response stream, mutating `state`.
 *
 * The events that carry data to the HANDLE rather than to the stream —
 * `thread_started`, `turn_completed`, `turn_failed` — are no-ops here; the
 * block reads them off the same translated event.
 */
export async function emitTranslatedEvent(
  event: TranslatedEvent,
  ctx: BlockContext,
  state: EmitState,
  blockName: string,
): Promise<void> {
  const provenance = deriveProvenance(ctx, blockName);
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
    case "thread_started":
    case "turn_completed":
    case "turn_failed":
      return;
  }
}

/**
 * Emit a complete message or reasoning item: added(in_progress) → content.added
 * → content.done → item.done(completed). Codex carries whole items, so there is
 * never a partially-accumulated one to reconcile with.
 */
async function emitText(
  text: string,
  kind: "message" | "reasoning",
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
): Promise<void> {
  const base = buildBase(ctx, provenance, kind === "message" ? "msg" : "reason");
  const inProgress = {
    ...base,
    type: kind,
    ...(kind === "message" ? { role: "assistant" as const } : {}),
    status: "in_progress" as const,
    itemVisibility: CONVERSATIONAL_VISIBILITY,
    content: [{ type: "output_text" as const, text: "" }],
  };
  await ctx.response.emit({ type: "item.added", item: inProgress });
  await ctx.response.emit({
    type: "content.added",
    itemId: base.id,
    contentIndex: 0,
    content: { type: "output_text", text: "" },
  });
  await ctx.response.emit({
    type: "content.done",
    itemId: base.id,
    contentIndex: 0,
    content: { type: "output_text", text },
  });
  await ctx.response.emit({
    type: "item.done",
    item: { ...inProgress, status: "completed", content: [{ type: "output_text", text }] },
  });
  if (kind === "message") state.finalMessage = text;
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
    itemIndex: ctx.response.getItemCount(),
    provenance,
    ts: Date.now(),
    ...deriveScope(ctx),
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
  for (const [callId, open] of state.openTools) {
    await ctx.response.emit({
      type: "item.done",
      item: {
        id: open.id,
        type: "tool_output",
        status: "incomplete",
        requestId: ctx.request.identity.id,
        itemIndex: ctx.response.getItemCount(),
        provenance,
        ts: Date.now(),
        ...deriveScope(ctx),
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
