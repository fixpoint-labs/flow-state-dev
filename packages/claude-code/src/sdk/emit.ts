/**
 * Emission layer: drives `ctx.response.emit` from {@link TranslatedEvent}s.
 *
 * Each translated event becomes one or more canonical FSD item lifecycle
 * emissions, hand-built exactly like `generator.ts` does (base fields derived
 * from `_blockIdentity`, fresh `itemIndex` per item). The pure interpretation
 * lives in `translate.ts`; this module owns the side effects and the small
 * amount of cross-event streaming state (the open message/reasoning item being
 * accumulated via deltas).
 *
 * Visibility: conversational items carry `{ client: true, history: true }`.
 * Sub-agent activity surfaces as container open/close pairs, and the
 * sub-agent's own assistant/tool items nest inside it via `ownedBy` (keyed off
 * the message's `parent_tool_use_id`); tools surface as `tool_output` items
 * correlated by SDK tool-use id.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { TranslatedEvent } from "./types";

/** Provenance shape derived once per run and stamped on every emitted item. */
interface EmitProvenance {
  blockName: string;
  blockInstanceId: string;
  parentBlockInstanceId?: string;
  phase: "main" | "work";
}

/**
 * Streaming bookkeeping for the emit pass. Tracks the message/reasoning item
 * currently being accumulated via deltas (so a run of `message_delta`s coalesce
 * into one item), the open `tool_output` item ids keyed by SDK tool-use id, and
 * the open container item ids for sub-agents. Distinct from the translation
 * state — this is about emission, not interpretation.
 */
export interface EmitState {
  /** Item id + accumulated text of the in-progress streamed message, if any.
   *  `ownedBy` (when set) nests the item under a sub-agent container. */
  message: { id: string; contentIndex: number; text: string; ownedBy?: string } | null;
  /** Item id + accumulated text of the in-progress streamed reasoning, if any.
   *  `ownedBy` (when set) nests the item under a sub-agent container. */
  reasoning: { id: string; contentIndex: number; text: string; ownedBy?: string } | null;
  /** Open tool_output items keyed by SDK tool-use callId. */
  readonly openTools: Map<
    string,
    { id: string; name: string; arguments: string; ownedBy?: string }
  >;
  /**
   * Open sub-agent containers keyed by sub-agent callId. Carries the container
   * item id, the synthetic `provenance.blockInstanceId` stamped on the container
   * (the framework's ownership key — inner items set `ownedBy` to it, see
   * `docs/architecture/items.md` and react `useContainerItems`), and the fields
   * the close emission must preserve.
   */
  readonly openSubagents: Map<
    string,
    { itemId: string; instanceId: string; name: string; label: string; startedAt: number }
  >;
  /** Distinct SDK tool names observed, in first-seen order. */
  readonly toolsObserved: string[];
  /** Last completed assistant message text (whole or coalesced delta). */
  finalMessage: string | null;
}

/** Create a fresh {@link EmitState} for one run. */
export function createEmitState(): EmitState {
  return {
    message: null,
    reasoning: null,
    openTools: new Map<string, { id: string; name: string; arguments: string; ownedBy?: string }>(),
    openSubagents: new Map<
      string,
      { itemId: string; instanceId: string; name: string; label: string; startedAt: number }
    >(),
    toolsObserved: [],
    finalMessage: null,
  };
}

/** Derive the run-stable provenance from the block context identity. */
function deriveProvenance(ctx: BlockContext, blockName: string): EmitProvenance {
  const identity = (
    ctx as {
      _blockIdentity?: {
        blockName?: string;
        blockInstanceId?: string;
        parentBlockInstanceId?: string;
        phase?: "main" | "work";
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

/** Build the per-item base fields, reading a fresh `itemIndex` each call. */
function buildBase(ctx: BlockContext, provenance: EmitProvenance, kind: string) {
  return {
    id: mintId(kind),
    requestId: ctx.request.identity.id,
    itemIndex: ctx.response.getItemCount(),
    provenance,
    ts: Date.now(),
  };
}

const CONVERSATIONAL_VISIBILITY = { client: true, history: true } as const;

/**
 * Resolve the `ownedBy` value for an item produced inside a sub-agent.
 * `parentCallId` is the sub-agent's tool-use id (from the SDK message's
 * `parent_tool_use_id`); when a container is open for it, the item nests under
 * that container by carrying its `provenance.blockInstanceId` (the framework's
 * container-ownership key). Returns `undefined` for top-level items.
 */
function resolveOwnedBy(state: EmitState, parentCallId: string | undefined): string | undefined {
  if (parentCallId === undefined) return undefined;
  return state.openSubagents.get(parentCallId)?.instanceId;
}

/**
 * Apply one {@link TranslatedEvent} to the response stream, mutating `state`.
 * Returns nothing — the observable result is the emitted items and the updated
 * `state` (final message text, observed tools, open containers).
 */
export async function emitTranslatedEvent(
  event: TranslatedEvent,
  ctx: BlockContext,
  state: EmitState,
  blockName: string,
): Promise<void> {
  const provenance = deriveProvenance(ctx, blockName);
  switch (event.kind) {
    case "message_delta":
      return emitMessageDelta(event.text, ctx, state, provenance, event.parentCallId);
    case "message_complete":
      return emitMessageComplete(event.text, ctx, state, provenance, event.parentCallId);
    case "reasoning_delta":
      return emitReasoningDelta(event.text, ctx, state, provenance, event.parentCallId);
    case "reasoning_complete":
      return emitReasoningComplete(event.text, ctx, state, provenance, event.parentCallId);
    case "tool_call":
      return emitToolCall(event, ctx, state, provenance, blockName);
    case "tool_result":
      return emitToolResult(event, ctx, state, provenance, blockName);
    case "subagent_open":
      return emitSubagentOpen(event, ctx, state, provenance);
    case "subagent_close":
      return emitSubagentClose(event, ctx, state, blockName);
    case "status":
      ctx.emit.status(event.message);
      return;
    case "error":
      return emitError(event, ctx, provenance);
    case "result":
      // The result event mutates the handle, not the stream. Handled by the
      // agent block from the returned TranslatedEvent; nothing to emit here.
      return;
  }
}

/** Open (lazily) the streamed message item and push one text delta. */
async function emitMessageDelta(
  text: string,
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
  parentCallId: string | undefined,
): Promise<void> {
  if (state.message === null) {
    // A reasoning item streaming before the first text closes here.
    await closeStreamingReasoning(ctx, state, provenance.blockName);
    const ownedBy = resolveOwnedBy(state, parentCallId);
    const base = buildBase(ctx, provenance, "msg");
    const item = {
      ...base,
      type: "message" as const,
      role: "assistant" as const,
      status: "in_progress" as const,
      itemVisibility: CONVERSATIONAL_VISIBILITY,
      ...(ownedBy ? { ownedBy } : {}),
      content: [{ type: "output_text" as const, text: "" }],
    };
    await ctx.response.emit({ type: "item.added", item });
    await ctx.response.emit({
      type: "content.added",
      itemId: base.id,
      contentIndex: 0,
      content: { type: "output_text", text: "" },
    });
    state.message = { id: base.id, contentIndex: 0, text: "", ownedBy };
  }
  state.message.text += text;
  await ctx.response.emit({
    type: "content.delta",
    itemId: state.message.id,
    contentIndex: state.message.contentIndex,
    delta: text,
  });
}

/**
 * Close any open streaming message/reasoning items. In the partials-ON path the
 * whole `assistant` message is the turn's close boundary: text/thinking already
 * streamed as deltas (translate skips re-emitting them), so the agent loop calls
 * this once it has translated that whole message. Without it, a later turn's
 * deltas would append to the prior turn's still-open item and coalesce into one.
 */
export async function closeStreamingItems(
  ctx: BlockContext,
  state: EmitState,
  blockName: string,
): Promise<void> {
  await closeStreamingMessage(ctx, state, blockName);
  await closeStreamingReasoning(ctx, state, blockName);
}

/** Finalize the streamed message item (called at end of an assistant turn). */
async function closeStreamingMessage(
  ctx: BlockContext,
  state: EmitState,
  blockName: string,
): Promise<void> {
  if (state.message === null) return;
  const { id, contentIndex, text, ownedBy } = state.message;
  await ctx.response.emit({
    type: "content.done",
    itemId: id,
    contentIndex,
    content: { type: "output_text", text },
  });
  await ctx.response.emit({
    type: "item.done",
    item: {
      id,
      type: "message",
      role: "assistant",
      status: "completed",
      requestId: ctx.request.identity.id,
      itemIndex: ctx.response.getItemCount(),
      provenance: deriveProvenance(ctx, blockName),
      ts: Date.now(),
      itemVisibility: CONVERSATIONAL_VISIBILITY,
      ...(ownedBy ? { ownedBy } : {}),
      content: [{ type: "output_text", text }],
    },
  });
  state.finalMessage = text;
  state.message = null;
}

/**
 * Emit a complete message item in the whole-message (non-partial) path:
 * added(in_progress) → content.added → content.done → item.done(completed).
 */
async function emitMessageComplete(
  text: string,
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
  parentCallId: string | undefined,
): Promise<void> {
  const ownedBy = resolveOwnedBy(state, parentCallId);
  const base = buildBase(ctx, provenance, "msg");
  const inProgress = {
    ...base,
    type: "message" as const,
    role: "assistant" as const,
    status: "in_progress" as const,
    itemVisibility: CONVERSATIONAL_VISIBILITY,
    ...(ownedBy ? { ownedBy } : {}),
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
  state.finalMessage = text;
}

/** Open (lazily) the streamed reasoning item and push one text delta. */
async function emitReasoningDelta(
  text: string,
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
  parentCallId: string | undefined,
): Promise<void> {
  if (state.reasoning === null) {
    const ownedBy = resolveOwnedBy(state, parentCallId);
    const base = buildBase(ctx, provenance, "reasoning");
    const item = {
      ...base,
      type: "reasoning" as const,
      status: "in_progress" as const,
      itemVisibility: CONVERSATIONAL_VISIBILITY,
      ...(ownedBy ? { ownedBy } : {}),
      summary: [{ type: "reasoning_text" as const, text: "" }],
    };
    await ctx.response.emit({ type: "item.added", item });
    await ctx.response.emit({
      type: "content.added",
      itemId: base.id,
      contentIndex: 0,
      content: { type: "reasoning_text", text: "" },
    });
    state.reasoning = { id: base.id, contentIndex: 0, text: "", ownedBy };
  }
  state.reasoning.text += text;
  await ctx.response.emit({
    type: "content.delta",
    itemId: state.reasoning.id,
    contentIndex: state.reasoning.contentIndex,
    delta: text,
  });
}

/** Finalize the streamed reasoning item, if one is open. */
async function closeStreamingReasoning(
  ctx: BlockContext,
  state: EmitState,
  blockName: string,
): Promise<void> {
  if (state.reasoning === null) return;
  const { id, contentIndex, text, ownedBy } = state.reasoning;
  await ctx.response.emit({
    type: "content.done",
    itemId: id,
    contentIndex,
    content: { type: "reasoning_text", text },
  });
  await ctx.response.emit({
    type: "item.done",
    item: {
      id,
      type: "reasoning",
      status: "completed",
      requestId: ctx.request.identity.id,
      itemIndex: ctx.response.getItemCount(),
      provenance: deriveProvenance(ctx, blockName),
      ts: Date.now(),
      itemVisibility: CONVERSATIONAL_VISIBILITY,
      ...(ownedBy ? { ownedBy } : {}),
      summary: [{ type: "reasoning_text", text }],
    },
  });
  state.reasoning = null;
}

/** Emit a complete reasoning item in the whole-message path. */
async function emitReasoningComplete(
  text: string,
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
  parentCallId: string | undefined,
): Promise<void> {
  const ownedBy = resolveOwnedBy(state, parentCallId);
  const base = buildBase(ctx, provenance, "reasoning");
  const inProgress = {
    ...base,
    type: "reasoning" as const,
    status: "in_progress" as const,
    itemVisibility: CONVERSATIONAL_VISIBILITY,
    ...(ownedBy ? { ownedBy } : {}),
    summary: [{ type: "reasoning_text" as const, text: "" }],
  };
  await ctx.response.emit({ type: "item.added", item: inProgress });
  await ctx.response.emit({
    type: "content.added",
    itemId: base.id,
    contentIndex: 0,
    content: { type: "reasoning_text", text: "" },
  });
  await ctx.response.emit({
    type: "content.done",
    itemId: base.id,
    contentIndex: 0,
    content: { type: "reasoning_text", text },
  });
  await ctx.response.emit({
    type: "item.done",
    item: { ...inProgress, status: "completed", summary: [{ type: "reasoning_text", text }] },
  });
}

/** Open a `tool_output` item (in_progress) on a tool call. */
async function emitToolCall(
  event: Extract<TranslatedEvent, { kind: "tool_call" }>,
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
  blockName: string,
): Promise<void> {
  // A message streaming before a tool call closes here so order is correct.
  await closeStreamingMessage(ctx, state, provenance.blockName);
  await closeStreamingReasoning(ctx, state, provenance.blockName);
  if (!state.toolsObserved.includes(event.name)) state.toolsObserved.push(event.name);
  const ownedBy = resolveOwnedBy(state, event.parentCallId);
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
    ...(ownedBy ? { ownedBy } : {}),
  };
  await ctx.response.emit({ type: "item.added", item });
  state.openTools.set(event.callId, {
    id: base.id,
    name: event.name,
    arguments: event.arguments,
    ...(ownedBy ? { ownedBy } : {}),
  });
}

/** Complete the open `tool_output` item when its result arrives. */
async function emitToolResult(
  event: Extract<TranslatedEvent, { kind: "tool_result" }>,
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
  blockName: string,
): Promise<void> {
  const open = state.openTools.get(event.callId);
  // If we never saw the opening call (e.g. partial-message gaps), emit a
  // self-contained tool_output rather than dropping the result. Such an orphan
  // had no opening `item.added`, so emit one here before `item.done` (mirroring
  // `emitError`) — consumers that track items added-then-done won't reference a
  // non-existent item.
  const isOrphan = open === undefined;
  const id = open?.id ?? mintId("tool");
  const toolName = open?.name ?? blockName;
  const toolArgs = open?.arguments ?? "{}";
  const ownedBy = open?.ownedBy ?? resolveOwnedBy(state, event.parentCallId);
  const item = {
    id,
    type: "tool_output" as const,
    status: event.isError ? ("failed" as const) : ("completed" as const),
    requestId: ctx.request.identity.id,
    itemIndex: ctx.response.getItemCount(),
    provenance,
    ts: Date.now(),
    blockName: toolName,
    output: event.output,
    toolCall: {
      callId: event.callId,
      name: toolName,
      arguments: toolArgs,
      generatorBlock: blockName,
    },
    itemVisibility: CONVERSATIONAL_VISIBILITY,
    ...(ownedBy ? { ownedBy } : {}),
    ...(event.isError ? { error: { message: String(event.output) } } : {}),
  };
  if (isOrphan) {
    await ctx.response.emit({ type: "item.added", item });
  }
  await ctx.response.emit({ type: "item.done", item });
  state.openTools.delete(event.callId);
}

/** Open a container item for a spawned sub-agent. */
async function emitSubagentOpen(
  event: Extract<TranslatedEvent, { kind: "subagent_open" }>,
  ctx: BlockContext,
  state: EmitState,
  provenance: EmitProvenance,
): Promise<void> {
  await closeStreamingMessage(ctx, state, provenance.blockName);
  await closeStreamingReasoning(ctx, state, provenance.blockName);
  // Each sub-agent container needs a distinct `blockInstanceId` — the handler's
  // own id is shared across every sub-agent in the run, so two containers would
  // be indistinguishable and the framework's ownership filter (which keys off
  // `provenance.blockInstanceId`) could not separate their items. Stamp a
  // synthetic per-sub-agent id and make that the `ownedBy` value inner items use.
  const instanceId = `${provenance.blockInstanceId}:subagent:${event.callId}`;
  const base = buildBase(ctx, { ...provenance, blockInstanceId: instanceId }, "container");
  const label = `Sub-agent: ${event.name}`;
  const startedAt = Date.now();
  const item = {
    ...base,
    type: "container" as const,
    status: "in_progress" as const,
    blockName: event.name,
    label,
    startedAt,
  };
  await ctx.response.emit({ type: "item.added", item });
  state.openSubagents.set(event.callId, { itemId: base.id, instanceId, name: event.name, label, startedAt });
}

/** Close the container item for a sub-agent when it returns. */
async function emitSubagentClose(
  event: Extract<TranslatedEvent, { kind: "subagent_close" }>,
  ctx: BlockContext,
  state: EmitState,
  blockName: string,
): Promise<void> {
  const open = state.openSubagents.get(event.callId);
  if (open === undefined) return;
  await ctx.response.emit({
    type: "item.done",
    item: {
      id: open.itemId,
      type: "container",
      status: event.isError ? "failed" : "completed",
      requestId: ctx.request.identity.id,
      itemIndex: ctx.response.getItemCount(),
      provenance: { ...deriveProvenance(ctx, blockName), blockInstanceId: open.instanceId },
      ts: Date.now(),
      blockName: open.name,
      label: open.label,
      startedAt: open.startedAt,
      completedAt: Date.now(),
      ...(event.isError ? { error: { message: String(event.output) } } : {}),
    },
  });
  state.openSubagents.delete(event.callId);
}

/** Emit a terminal error item. */
async function emitError(
  event: Extract<TranslatedEvent, { kind: "error" }>,
  ctx: BlockContext,
  provenance: EmitProvenance,
): Promise<void> {
  const base = buildBase(ctx, provenance, "error");
  const item = {
    ...base,
    type: "error" as const,
    status: "failed" as const,
    message: event.message,
    ...(event.code ? { code: event.code } : {}),
  };
  await ctx.response.emit({ type: "item.added", item });
  await ctx.response.emit({ type: "item.done", item });
}

/**
 * Close any items still open at stream end: finalize a streaming message /
 * reasoning, mark open tools `incomplete`, and close open sub-agent containers
 * defensively. Called once by the agent block after the message loop.
 */
export async function finalizeOpenItems(
  ctx: BlockContext,
  state: EmitState,
  blockName: string,
): Promise<void> {
  await closeStreamingMessage(ctx, state, blockName);
  await closeStreamingReasoning(ctx, state, blockName);

  for (const [callId, open] of state.openTools) {
    await ctx.response.emit({
      type: "item.done",
      item: {
        id: open.id,
        type: "tool_output",
        status: "incomplete",
        requestId: ctx.request.identity.id,
        itemIndex: ctx.response.getItemCount(),
        provenance: deriveProvenance(ctx, blockName),
        ts: Date.now(),
        blockName: open.name,
        output: null,
        toolCall: {
          callId,
          name: open.name,
          arguments: open.arguments,
          generatorBlock: blockName,
        },
        itemVisibility: CONVERSATIONAL_VISIBILITY,
        ...(open.ownedBy ? { ownedBy: open.ownedBy } : {}),
      },
    });
  }
  state.openTools.clear();

  for (const [, open] of state.openSubagents) {
    await ctx.response.emit({
      type: "item.done",
      item: {
        id: open.itemId,
        type: "container",
        status: "incomplete",
        requestId: ctx.request.identity.id,
        itemIndex: ctx.response.getItemCount(),
        provenance: { ...deriveProvenance(ctx, blockName), blockInstanceId: open.instanceId },
        ts: Date.now(),
        blockName: open.name,
        label: open.label,
        startedAt: open.startedAt,
        completedAt: Date.now(),
      },
    });
  }
  state.openSubagents.clear();
}
