// FIX-2848.
/**
 * The conversation model: a session's items and its turns as the lines a
 * conversation screen draws.
 *
 *     const lines = conversationLines(items, turns); // turns: { id, status, retryable }[]
 *     <ItemsRenderer lines={lines} />
 *
 * Every line kind is decided here, once: what the user said, what the agent
 * said (still being written, or cut off when its turn failed or was stopped;
 * a reply that ended saying nothing is no line),
 * one turn's steps (its tool calls and the thinking between them), a failed
 * turn (with Retry when the engine runs it again), a stopped turn (after its
 * last line), a suspension (with its answer), and any `data` item. A renderer
 * decides how a kind looks, never whether an item is one. Given the registry
 * in use (`renderers`), a `data` item it has no renderer for (or turns off)
 * is a record, not a line: no renderer, no line, so a board's change record
 * never takes Retry off the failed turn before it.
 *
 * A tool call that wrote a line is that line, not a step: a `data` item keyed
 * by the logical id of the tool call it was written in (`key` is
 * `${requestId}:${path}`, its provenance's id without the attempt, whose last
 * path segment is `tool[name][callId]`) stands for that call, and the call's
 * `tool_output` draws no step. A data item that carries no such key leaves the
 * call a step.
 *
 * Before any of that, the filters `ItemsRenderer` always applied: a keyed
 * snapshot shows its latest version only, sub-agent and trace items stay out
 * unless asked for, and items a container with its own renderer owns are left
 * to it. Pure: testable without a React tree.
 */
import type {
  ContainerItem,
  DataItem,
  ErrorItem,
  MessageItem,
  OutputItem,
  ReasoningItem,
  SuspensionItem,
  SuspensionResumeItem,
  ToolOutputItem
} from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { blockPathTool, extendBlockPath, parseBlockInstanceId } from "@flow-state-dev/contracts/block-instance-id";
import type { RendererRegistry } from "../registry/block-renderers";

/**
 * What an agent does between the things it says: a tool call, or the thinking
 * that goes with one. A run of these in one turn is one `steps` line.
 */
export type ActivityItem = ToolOutputItem | ReasoningItem;

/**
 * One turn of the conversation, as the model reads it: its request id, its
 * status, and whether the engine runs it again for the caller (core's
 * `SessionTurn.retryable`, which the engine sets with the retry route's own rule).
 */
export type LineTurn = {
  readonly id: string;
  readonly status: string;
  readonly retryable?: boolean;
};

/**
 * One line of a conversation screen. Every line names the turn (`requestId`)
 * it belongs to and has an `id` that stays the same as it changes, for a key.
 */
export type ItemLine =
  /** What the user said. */
  | { kind: "user"; id: string; requestId: string; item: MessageItem }
  /** What the agent said: `streaming` while it is still being written, `incomplete` when its turn failed or was stopped first. */
  | { kind: "assistant"; id: string; requestId: string; item: MessageItem; streaming?: true; incomplete?: true }
  /** One turn's tool calls and the thinking between them, one after another. `ended` once its turn is over: a call still running there never finished. */
  | { kind: "steps"; id: string; requestId: string; items: ActivityItem[]; ended?: true }
  /** A turn that failed, from its `error` item. `retryable` when Retry is offered: it is the newest turn that drew a line, and one the engine runs again. */
  | { kind: "failed"; id: string; requestId: string; item: ErrorItem; retryable: boolean }
  /** A turn that was stopped (it ended `aborted`), after its last line. */
  | { kind: "stopped"; id: string; requestId: string }
  /** A turn that waits on the user, with how it was answered once it was. */
  | { kind: "suspension"; id: string; requestId: string; item: SuspensionItem; resolution?: SuspensionStatus }
  /** A `data` item, drawn by the renderer registered for its `dataType`. */
  | { kind: "data"; id: string; requestId: string; item: DataItem }
  /** Any other item (a status, a container, a source), drawn by the registry. */
  | { kind: "item"; id: string; requestId: string; item: OutputItem };

/** How {@link conversationLines} filters before it reads lines. */
export type ConversationLinesOptions = {
  /** The registry in use: items a container with a registered renderer owns are left to that renderer, and a `data` item with no renderer here is no line. */
  renderers?: RendererRegistry;
  /** Default `true`: a keyed `data` item shows only its latest snapshot, at that snapshot's place. */
  deduplicateByKey?: boolean;
  /** Default `false`: items with `history: false` (a sub-agent's) and trace items stay out. */
  showSubAgents?: boolean;
};

/** Statuses after which a turn writes nothing more. */
const ENDED = new Set(["completed", "incomplete", "failed", "aborted"]);
/** A turn whose run died and waits to run again: nothing writes its reply until then, so the reply isn't streaming. */
const INTERRUPTED = "interrupted";
/** Statuses of a turn that didn't finish what it was writing. */
const CUT_OFF = new Set(["failed", "aborted"]);

/** Item types that draw nothing: a record for the log or the model, never a line. */
const NO_LINE = new Set(["state_change", "resource_change", "suspension_resume", "continuation"]);

// Mirrors `@flow-state-dev/contracts/items/resolve-visibility` — inlined
// because this package may only import types from core.
const TRACE_TYPES = new Set(["block_trace", "router_decision", "state_snapshot"]);
const CONVERSATIONAL_TYPES = new Set(["message", "reasoning", "tool_output"]);

/**
 * Item types that a container renderer manages internally: plan state
 * snapshots and tool call outputs. These are suppressed from the main
 * stream when owned by a container with a registered renderer.
 */
const CONTAINER_MANAGED_TYPES = new Set(["data", "tool_output"]);

/**
 * For data items with a stable `key`, keep only the latest snapshot per key.
 * Items without a key are always included.
 */
function deduplicateKeyedItems(items: readonly OutputItem[]): OutputItem[] {
  const keyOf = (item: OutputItem): string | undefined => {
    if (item.type !== "data") return undefined;
    const k = (item as DataItem).key;
    // Scope deduplication to the request: same key in different requests
    // are independent items (each request's plan is preserved).
    return k === undefined ? undefined : `${item.requestId}:${k}`;
  };
  const latestIndex = new Map<string, number>();
  items.forEach((item, i) => {
    const k = keyOf(item);
    if (k !== undefined) latestIndex.set(k, i);
  });
  return items.filter((item, i) => {
    const k = keyOf(item);
    return k === undefined || latestIndex.get(k) === i;
  });
}

/**
 * The blockInstanceIds whose owning container has a registered renderer.
 * Items with `ownedBy` in this set are left to the container renderer.
 */
function suppressedOwnersOf(items: readonly OutputItem[], containerRenderers: Record<string, unknown> | undefined): Set<string> | null {
  if (containerRenderers === undefined) return null;
  const suppressed = new Set<string>();
  for (const item of items) {
    if (item.type !== "container") continue;
    const component = (item as ContainerItem).component;
    if (component === undefined) continue;
    const renderer = containerRenderers[component];
    if (renderer !== undefined && renderer !== false) suppressed.add((item as ContainerItem).provenance.blockInstanceId);
  }
  return suppressed.size > 0 ? suppressed : null;
}

/** The shown items: deduplicated, sub-agent and trace items out, container-owned ones left to their container. */
function shownItems(items: readonly OutputItem[], options: ConversationLinesOptions): OutputItem[] {
  const { deduplicateByKey = true, showSubAgents = false, renderers } = options;
  const deduplicated = deduplicateByKey ? deduplicateKeyedItems(items) : [...items];
  const visible = showSubAgents
    ? deduplicated
    : deduplicated.filter((item) => {
        if (TRACE_TYPES.has(item.type)) return false;
        if (!CONVERSATIONAL_TYPES.has(item.type)) return true;
        return item.itemVisibility?.history !== false;
      });
  const suppressed = suppressedOwnersOf(visible, renderers?.container);
  if (suppressed === null) return visible;
  return visible.filter((item) => {
    const ownedBy = (item as OutputItem & { ownedBy?: string }).ownedBy;
    return ownedBy === undefined || !suppressed.has(ownedBy) || !CONTAINER_MANAGED_TYPES.has(item.type);
  });
}

/**
 * The logical ids of the tool calls the shown data items were written in:
 * a data item stands for a call when its `key` is that call's logical id
 * and `renderers` draws it.
 */
function callsThatWroteLines(items: readonly OutputItem[], renderers: RendererRegistry | undefined): (call: ToolOutputItem) => boolean {
  const written = new Set<string>();
  for (const item of items) {
    // Only a line that is drawn stands for its call; a call whose line nothing draws stays a step.
    if (item.type !== "data" || !drawsData(item as DataItem, renderers)) continue;
    const { key, provenance } = item as DataItem;
    const parsed = key === undefined ? undefined : parseBlockInstanceId(provenance.blockInstanceId);
    if (parsed !== undefined && `${parsed.requestId}:${parsed.path}` === key) written.add(key);
  }
  if (written.size === 0) return () => false;
  return (call) => {
    const generator = parseBlockInstanceId(call.provenance.blockInstanceId);
    if (generator === undefined || call.toolCall === undefined) return false;
    // The call's own path, as the tool executor builds it: under its generator, by tool name and the model step's index before the call id.
    const { name, callId, stepNumber } = call.toolCall;
    const segment = blockPathTool(name, stepNumber === undefined ? callId : `${stepNumber}:${callId}`);
    return written.has(`${generator.requestId}:${extendBlockPath(generator.path, segment)}`);
  };
}

/** Whether `renderers` draws `item`: always with no registry given, else only through a renderer registered for its `dataType`. */
function drawsData(item: DataItem, renderers: RendererRegistry | undefined): boolean {
  if (renderers === undefined) return true;
  const renderer = renderers.data?.[item.dataType];
  return renderer !== undefined && renderer !== false;
}

/** Whether a message says anything: a text part with words, or any part that isn't text. */
function saysSomething(item: MessageItem): boolean {
  return item.content.some((part) => {
    const text = (part as { text?: unknown }).text;
    return typeof text === "string" ? text.trim() !== "" : true;
  });
}

/**
 * A conversation's items and turns as the lines a screen draws. `turns` is
 * optional: with none, no line is stopped, no failed line offers Retry, and a
 * message still being written reads as streaming. See the file's header.
 *
 * @param items The session's items, in the order they were written.
 * @param turns The session's turns, any order: each one's id, status and `retryable`.
 * @param options The filters, and the registry whose container renderers own their items.
 */
export function conversationLines(
  items: readonly OutputItem[],
  turns: readonly LineTurn[] = [],
  options: ConversationLinesOptions = {}
): ItemLine[] {
  const turnOf = new Map(turns.map((turn) => [turn.id, turn]));
  const ended = (requestId: string) => ENDED.has(turnOf.get(requestId)?.status ?? "");
  // A turn that failed or was stopped: its reply, if never finished, was cut off.
  const cutOff = new Set([
    ...turns.filter((turn) => CUT_OFF.has(turn.status)).map((turn) => turn.id),
    ...items.filter((item) => item.type === "error").map((item) => item.requestId)
  ]);
  // How each suspension was answered, from its resume record, which draws nothing itself.
  const answered = new Map<string, SuspensionStatus>();
  for (const item of items) {
    if (item.type === "suspension_resume") answered.set((item as SuspensionResumeItem).suspensionId, (item as SuspensionResumeItem).resolution);
  }

  const shown = shownItems(items, options);
  const wroteLine = callsThatWroteLines(shown, options.renderers);
  const lines: ItemLine[] = [];
  /** Where each stopped turn's line goes: after its last line. */
  const stoppedAt = new Map<string, number>();
  for (const item of shown) {
    if (NO_LINE.has(item.type)) continue;
    const at = lines.length;
    const last = lines[at - 1];
    const { requestId } = item;
    if (item.type === "tool_output" || item.type === "reasoning") {
      if (item.type === "tool_output" && wroteLine(item as ToolOutputItem)) continue;
      if (last?.kind === "steps" && last.requestId === requestId) {
        lines[at - 1] = { ...last, items: [...last.items, item as ActivityItem] };
      } else {
        lines.push({ kind: "steps", id: item.id, requestId, items: [item as ActivityItem], ...(ended(requestId) ? { ended: true as const } : {}) });
      }
    } else if (item.type === "message" && (item as MessageItem).role === "user") {
      lines.push({ kind: "user", id: item.id, requestId, item: item as MessageItem });
    } else if (item.type === "message" && (item as MessageItem).role === "assistant") {
      // A reply that ended saying nothing is no line; one still being written is, before its first word.
      if (item.status !== "in_progress" && !saysSomething(item as MessageItem)) continue;
      const unfinished = item.status !== "completed";
      lines.push({
        kind: "assistant",
        id: item.id,
        requestId,
        item: item as MessageItem,
        ...(unfinished && cutOff.has(requestId) ? { incomplete: true as const } : item.status === "in_progress" && !ended(requestId) && turnOf.get(requestId)?.status !== INTERRUPTED ? { streaming: true as const } : {})
      });
    } else if (item.type === "error") {
      lines.push({ kind: "failed", id: item.id, requestId, item: item as ErrorItem, retryable: false });
    } else if (item.type === "suspension") {
      const resolution = answered.get((item as SuspensionItem).suspensionId);
      lines.push({ kind: "suspension", id: item.id, requestId, item: item as SuspensionItem, ...(resolution === undefined ? {} : { resolution }) });
    } else if (item.type === "data") {
      if (!drawsData(item as DataItem, options.renderers)) continue;
      lines.push({ kind: "data", id: item.id, requestId, item: item as DataItem });
    } else {
      lines.push({ kind: "item", id: item.id, requestId, item });
    }
    if (turnOf.get(requestId)?.status === "aborted") stoppedAt.set(requestId, lines.length);
  }

  // Retry is offered on the newest turn that drew a line only, and only when the engine runs it again.
  const newest = lines[lines.length - 1]?.requestId;
  const marked = lines.map((line) =>
    line.kind === "failed" && line.requestId === newest && turnOf.get(line.requestId)?.retryable === true ? { ...line, retryable: true } : line
  );
  // From the end, so each place is still where it was counted.
  for (const [requestId, at] of [...stoppedAt].sort((a, b) => b[1] - a[1])) {
    marked.splice(at, 0, { kind: "stopped", id: `stopped:${requestId}`, requestId });
  }
  return marked;
}
