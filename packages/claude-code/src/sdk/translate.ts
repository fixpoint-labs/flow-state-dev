/**
 * Pure translation layer: SDK message → canonical `TranslatedEvent[]`.
 *
 * This module is deliberately free of `ctx`, the SDK, and any I/O. It owns the
 * stateful bookkeeping needed to interpret a stream of {@link SdkMessageLike}
 * messages — open tool/sub-agent ids, the last assistant text — but mutates
 * only the {@link TranslateState} passed in, and returns the events a message
 * implies. `emit.ts` turns those events into item emissions; keeping the two
 * apart makes the interpretation fully unit-testable with scripted messages.
 *
 * Two input shapes are handled:
 * - whole-message: `assistant`/`user` messages carry complete content blocks.
 * - partial: `stream_event` messages carry `content_block_delta` tokens (only
 *   present when `includePartialMessages` is on).
 */
import type { SdkMessageLike, SdkResultSubtype, TranslatedEvent } from "./types";

/** The SDK tool names that denote a sub-agent spawn (alias pair). */
const SUBAGENT_TOOL_NAMES = new Set(["Agent", "Task"]);

/**
 * Mutable bookkeeping carried across a single run's messages. Created once per
 * run via {@link createTranslateState} and threaded through every
 * {@link translateSdkMessage} call.
 */
export interface TranslateState {
  /** Tool-use ids currently open (emitted `tool_call`, awaiting result). */
  readonly openTools: Set<string>;
  /** Sub-agent tool-use ids currently open (`Agent`/`Task`). */
  readonly openSubagents: Set<string>;
  /**
   * Whether the SDK is emitting partial-message deltas (`includePartialMessages`).
   * When true, text/thinking already stream as deltas, so the subsequent whole
   * `assistant` message must NOT re-emit them — it only closes the open items.
   */
  readonly partialMessages: boolean;
}

/** Options controlling how messages are interpreted across a run. */
export interface TranslateStateOptions {
  /** Mirrors the SDK's `includePartialMessages`. Default `true`. */
  partialMessages?: boolean;
}

/** Create a fresh, empty {@link TranslateState} for one run. */
export function createTranslateState(options: TranslateStateOptions = {}): TranslateState {
  return {
    openTools: new Set<string>(),
    openSubagents: new Set<string>(),
    partialMessages: options.partialMessages ?? true,
  };
}

/** Normalize the SDK's terminal subtype string to a known value or `null`. */
function normalizeSubtype(raw: string | undefined): SdkResultSubtype | null {
  switch (raw) {
    case "success":
    case "error_max_turns":
    case "error_max_budget_usd":
    case "error_during_execution":
    case "error_max_structured_output_retries":
      return raw;
    default:
      return null;
  }
}

/** Serialize a tool input to a stable JSON argument string (never throws). */
function stringifyArgs(input: unknown): string {
  if (input === undefined) return "{}";
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
}

/**
 * Translate one SDK message into zero or more {@link TranslatedEvent}s,
 * mutating `state` to track open tools and sub-agents. Pure aside from that
 * mutation: no `ctx`, no SDK, no I/O.
 */
export function translateSdkMessage(
  msg: SdkMessageLike,
  state: TranslateState,
): TranslatedEvent[] {
  switch (msg.type) {
    case "system":
      return translateSystem(msg);
    case "assistant":
      return translateAssistant(msg, state);
    case "user":
      return translateUser(msg, state);
    case "stream_event":
      return translateStreamEvent(msg);
    case "result":
      return translateResult(msg);
    default:
      return [];
  }
}

/** `system` init/compact_boundary → a transient status notice. */
function translateSystem(msg: Extract<SdkMessageLike, { type: "system" }>): TranslatedEvent[] {
  if (msg.subtype === "init") {
    return [{ kind: "status", message: "Claude Code agent session started." }];
  }
  if (msg.subtype === "compact_boundary") {
    return [{ kind: "status", message: "Claude Code agent compacted its context." }];
  }
  return [];
}

/**
 * `assistant` whole-message → per-block message/reasoning/tool_call events.
 * Each content block becomes its own event so multiple blocks in one message
 * map to distinct items downstream.
 *
 * When `state.partialMessages` is on, the text/thinking content already streamed
 * as `stream_event` deltas; re-emitting `message_complete`/`reasoning_complete`
 * here would double the items. So in that mode this skips text/thinking blocks
 * and emits only `tool_use`/sub-agent events — the open streaming items are
 * closed downstream (in `emit.ts`) by the tool/sub-agent boundary or run end.
 *
 * `parent_tool_use_id`, when set, is the sub-agent container this turn ran
 * inside; it is threaded onto the events so `emit.ts` can nest them.
 */
function translateAssistant(
  msg: Extract<SdkMessageLike, { type: "assistant" }>,
  state: TranslateState,
): TranslatedEvent[] {
  const events: TranslatedEvent[] = [];
  const parentCallId = msg.parent_tool_use_id ?? undefined;
  const withParent = parentCallId ? { parentCallId } : {};
  for (const block of msg.message?.content ?? []) {
    if (block.type === "text") {
      if (state.partialMessages) continue;
      events.push({ kind: "message_complete", text: block.text, ...withParent });
    } else if (block.type === "thinking") {
      if (state.partialMessages) continue;
      events.push({ kind: "reasoning_complete", text: block.thinking, ...withParent });
    } else if (block.type === "tool_use") {
      if (SUBAGENT_TOOL_NAMES.has(block.name)) {
        state.openSubagents.add(block.id);
        events.push({ kind: "subagent_open", callId: block.id, name: block.name });
      } else {
        state.openTools.add(block.id);
        events.push({
          kind: "tool_call",
          callId: block.id,
          name: block.name,
          arguments: stringifyArgs(block.input),
          ...withParent,
        });
      }
    }
  }
  return events;
}

/**
 * `user` tool_result content → tool_result/subagent_close events, correlated
 * by tool_use id to the open tool or sub-agent that produced it.
 */
function translateUser(
  msg: Extract<SdkMessageLike, { type: "user" }>,
  state: TranslateState,
): TranslatedEvent[] {
  const events: TranslatedEvent[] = [];
  const parentCallId = msg.parent_tool_use_id ?? undefined;
  const withParent = parentCallId ? { parentCallId } : {};
  for (const block of msg.message?.content ?? []) {
    if (block.type !== "tool_result") continue;
    const callId = block.tool_use_id;
    const isError = block.is_error === true;
    if (state.openSubagents.has(callId)) {
      state.openSubagents.delete(callId);
      events.push({ kind: "subagent_close", callId, output: block.content, isError });
    } else {
      state.openTools.delete(callId);
      events.push({ kind: "tool_result", callId, output: block.content, isError, ...withParent });
    }
  }
  return events;
}

/**
 * `stream_event` partial deltas → message/reasoning delta events. Only
 * `content_block_delta` with a text/thinking delta carries renderable text;
 * `input_json_delta` (streamed tool arguments) is intentionally ignored — the
 * whole `tool_use` block in the eventual `assistant` message is authoritative.
 */
function translateStreamEvent(
  msg: Extract<SdkMessageLike, { type: "stream_event" }>,
): TranslatedEvent[] {
  const event = msg.event;
  if (event?.type !== "content_block_delta" || event.delta === undefined) return [];
  const delta = event.delta;
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    return [{ kind: "message_delta", text: delta.text }];
  }
  // Thinking deltas carry the token on `delta.thinking`, not `delta.text`.
  if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
    return [{ kind: "reasoning_delta", text: delta.thinking }];
  }
  return [];
}

/** `result` terminal message → an optional error notice plus a result event. */
function translateResult(msg: Extract<SdkMessageLike, { type: "result" }>): TranslatedEvent[] {
  const subtype = normalizeSubtype(msg.subtype);
  const usage =
    msg.usage && (msg.usage.input_tokens !== undefined || msg.usage.output_tokens !== undefined)
      ? {
          inputTokens: msg.usage.input_tokens ?? 0,
          outputTokens: msg.usage.output_tokens ?? 0,
        }
      : null;
  const costUsd = typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null;

  // Success results carry `result`; error-subtype results carry `errors[]` and
  // have no `result`. Coalesce to the best detail available, else a generic.
  const errorsText =
    msg.errors && msg.errors.length > 0 ? msg.errors.join("; ") : undefined;

  const events: TranslatedEvent[] = [];
  if (subtype !== null && subtype !== "success") {
    events.push({
      kind: "error",
      message: msg.result ?? errorsText ?? `Claude Code agent run failed (${subtype}).`,
      code: subtype,
    });
  }
  events.push({
    kind: "result",
    subtype,
    finalMessage:
      typeof msg.result === "string" ? msg.result : (errorsText ?? null),
    sessionId: msg.session_id ?? null,
    usage,
    costUsd,
  });
  return events;
}
