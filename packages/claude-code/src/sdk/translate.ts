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
import type { ObservedFileOpKind } from "./work-collections";

/** The SDK tool names that denote a sub-agent spawn (alias pair). */
const SUBAGENT_TOOL_NAMES = new Set(["Agent", "Task"]);

/**
 * THE VENDOR MAPPING. Every tool name this package understands lives in this
 * block and nowhere else — a second site that also knows what `Edit` means is
 * how the next harness rename breaks half the recording while the tests for the
 * other half stay green.
 *
 * The table starts at `Write` and `Edit` because those are the two a real run
 * has been observed using. A tool we do not list records nothing, which is the
 * designed outcome (§9) rather than a gap — add a name once a run is seen using
 * it, not because a type declaration mentions it.
 */
const FILE_MUTATION_TOOLS = new Map<string, ObservedFileOpKind>([
  ["Write", "created"],
  ["Edit", "edited"],
]);

/**
 * The kind a file tool's own structured output reports, when it reports one.
 *
 * The tool NAME is only a guess at the kind: `Write` to an existing path
 * overwrites it, which is an edit however the tool is spelled. Recording that as
 * `created` is the same family of error as everything else this record guards —
 * the record asserting something about the run that did not happen. The measured
 * `Write` output carries `type: "create" | "update"`; `Edit`'s carries no `type`
 * at all, which is why the call-time kind stays the fallback rather than the
 * exception.
 */
const FILE_OUTPUT_KINDS = new Map<string, ObservedFileOpKind>([
  ["create", "created"],
  ["update", "edited"],
]);

/**
 * The to-do surface, which is `TaskCreate`/`TaskUpdate` and NOT the `TodoWrite`
 * the vendor's own `sdk-tools.d.ts` still declares — the shipped binary does not
 * offer that tool at all. The two are not spellings of one thing: `TodoWrite`
 * took a whole-list snapshot with no ids, this one is per-item CRUD with ids, so
 * code written for either is silently inert against the other.
 */
const PLAN_CREATE_TOOL = "TaskCreate";
const PLAN_UPDATE_TOOL = "TaskUpdate";

/** Read a string field off an untyped tool input/output. `null` when absent. */
function readString(source: unknown, field: string): string | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read the created item's id off the structured create Output
 * (`{ task: { id } }`). Accepts a number as well as a string — the id is an
 * opaque handle we key on, so its wire type is the vendor's business.
 */
function readCreatedItemId(structured: unknown): string | null {
  if (typeof structured !== "object" || structured === null) return null;
  const task = (structured as { task?: unknown }).task;
  if (typeof task !== "object" || task === null) return null;
  const id = (task as { id?: unknown }).id;
  if (typeof id === "string" && id.length > 0) return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

/**
 * Flatten a tool result's `content` to a searchable string. It arrives as a
 * bare string on the shape measured, but the block type is `unknown` and an
 * array of text blocks is the other shape this content field takes, so both are
 * tolerated and anything else reads as empty.
 */
function resultProse(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part !== null ? readString(part, "text") : null))
      .filter((text): text is string => text !== null)
      .join(" ");
  }
  return "";
}

/**
 * Recover a created item's id from the result prose ("Task #5 created
 * successfully: …") when the structured Output is absent.
 *
 * **Scope of what was measured, because this fallback keeps being read as dead
 * code.** On `claude` 2.1.234 — the CLI version `@anthropic-ai/claude-agent-sdk@0.3.234`
 * pins — one probe run showed `tool_use_result.task.id` present on 2 of 2
 * `TaskCreate` calls. That is a single run on a single pinned version, not a
 * guarantee for every version or every call: the same probe is why we know this
 * vendor renamed its whole to-do surface between versions while its shipped type
 * declarations still described the old one. Keep the fallback.
 */
function recoverItemIdFromProse(content: unknown): string | null {
  const match = /task\s*#\s*([A-Za-z0-9_.-]+)/i.exec(resultProse(content));
  return match?.[1] ?? null;
}

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
  /** File mutations whose call was seen, awaiting the result that settles them. */
  readonly openFileOps: Map<string, { path: string; op: ObservedFileOpKind }>;
  /**
   * Plan creates whose call was seen. Nothing is emitted at call time because
   * the item has no id yet — the id only exists once the harness answers, and
   * inferring it from call order is exactly the mistake the ids being
   * non-positional makes possible.
   */
  readonly openPlanCreates: Map<string, { title: string | null }>;
  /** Plan updates whose call was seen, awaiting confirmation or rejection. */
  readonly openPlanUpdates: Map<
    string,
    { itemId: string; status: string | null; title: string | null }
  >;
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
    openFileOps: new Map<string, { path: string; op: ObservedFileOpKind }>(),
    openPlanCreates: new Map<string, { title: string | null }>(),
    openPlanUpdates: new Map<
      string,
      { itemId: string; status: string | null; title: string | null }
    >(),
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
 * Everything still in flight when the stream ended, as durable gaps.
 *
 * Called once after the message loop — on the success path AND the throw path,
 * because an aborted or max-turns run is exactly when this fires.
 *
 * **This closes an asymmetry, not a hypothetical.** A file mutation records a
 * `pending` row the instant its call is seen, so an interrupt leaves visible
 * evidence that a write was attempted. A plan CREATE cannot do that: the item
 * has no id until the harness answers, so there is nothing to key a row under.
 * Without this drain an interrupted create is indistinguishable from a run that
 * never planned — which is the same "empty means two different things" confusion
 * the plan half's whole INCONCLUSIVE arm exists to resolve, reappearing one
 * layer down.
 *
 * Open plan UPDATES and open file ops need nothing here: both already emitted a
 * `pending` observation at call time, and an unsettled attempt keeping its
 * attempted state is the designed record of an interrupted run.
 */
export function drainUnsettledObservations(state: TranslateState): TranslatedEvent[] {
  const events: TranslatedEvent[] = [];
  for (const [, create] of state.openPlanCreates) {
    events.push({
      kind: "work_gap_observed",
      reason:
        `a plan item was being created when the run ended, so it never got an id to be ` +
        `recorded under${create.title !== null ? ` ("${create.title}")` : ""}`,
    });
  }
  state.openPlanCreates.clear();
  return events;
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
        observeToolCall(block, state, events);
      }
    }
  }
  return events;
}

/**
 * A tool call the work recorder cares about: remember what settles it, and emit
 * the attempt. Recording at CALL time rather than at result time is what keeps a
 * killed run's record — a run that wrote files and was then cancelled is exactly
 * the one whose record matters most, and a result that never arrives would
 * otherwise erase it.
 *
 * A call whose input carries nothing to key on is **not** skipped silently: it
 * emits `work_gap_observed`, which becomes a durable row. That row is the whole
 * point — we recognised the tool and still recorded nothing, so without it a
 * later comparison of the run's tool activity against the file record cannot
 * tell "we could not key this" from "the record lost a write". Do not simplify
 * the gap emission away on the grounds that the run is unaffected; the run is
 * unaffected either way, and the reader is not.
 *
 * A tool we never claimed to record is different, and correctly stays silent.
 */
function observeToolCall(
  block: { id: string; name: string; input?: unknown },
  state: TranslateState,
  events: TranslatedEvent[],
): void {
  const fileOp = FILE_MUTATION_TOOLS.get(block.name);
  if (fileOp !== undefined) {
    const path = readString(block.input, "file_path");
    if (path === null) {
      events.push({
        kind: "work_gap_observed",
        reason: "a file mutation arrived with no path to record it under",
      });
      return;
    }
    state.openFileOps.set(block.id, { path, op: fileOp });
    events.push({ kind: "file_op_observed", path, op: fileOp, outcome: "pending" });
    return;
  }
  if (block.name === PLAN_CREATE_TOOL) {
    state.openPlanCreates.set(block.id, { title: readString(block.input, "subject") });
    return;
  }
  if (block.name === PLAN_UPDATE_TOOL) {
    const itemId = readString(block.input, "taskId");
    if (itemId === null) {
      events.push({
        kind: "work_gap_observed",
        reason: "a plan update arrived naming no item",
      });
      return;
    }
    // An update can re-word the item, not just move it. Dropping the new
    // wording leaves `observed-plan` holding the CREATE-time title forever
    // while claiming to be the run's current plan — the collection's own claim,
    // falsified by a stale field. Declared on `TaskUpdateInput` in the pinned
    // SDK's types; only the status path has been observed on a live run, which
    // is why both are read the same tolerant way and neither is required.
    state.openPlanUpdates.set(block.id, {
      itemId,
      status: readString(block.input, "status"),
      title: readString(block.input, "subject"),
    });
    // Attempted, not applied: the harness may still refuse the transition, and
    // writing the requested status now would be recording a move that never
    // happened.
    events.push({ kind: "plan_item_observed", itemId, outcome: "pending" });
  }
}

/**
 * Settle a recorder-relevant tool call from its result.
 *
 * `structured` is the message-level `tool_use_result` when it can be attributed
 * to THIS call — see {@link translateUser}. Everything here degrades rather than
 * throws: an unrecognised call id, an absent structured field, a create with no
 * recoverable id, all record nothing.
 */
function observeToolResult(
  callId: string,
  content: unknown,
  isError: boolean,
  structured: unknown,
  state: TranslateState,
  events: TranslatedEvent[],
): void {
  const fileOp = state.openFileOps.get(callId);
  if (fileOp !== undefined) {
    state.openFileOps.delete(callId);
    // Settle under the CALL-TIME path, not the harness's resolved one.
    //
    // Recording at call time fixes the row's key at call time, so settling
    // under a different path cannot update that row — it writes a SECOND one,
    // leaving a permanent `pending` row beside an `applied` one for a single
    // operation. A phantom unresolved mutation is worse than a slightly less
    // canonical key: it is indistinguishable from the record having lost a
    // write, which is the one confusion this whole feature exists to remove.
    //
    // The harness's own path still rides along so the recorder can compare the
    // two AFTER canonicalization — which is where that comparison belongs,
    // since `notes.txt` and `/work/notes.txt` are the same key and only the
    // recorder knows it. A real divergence becomes a gap, never a silent
    // mis-keying.
    const resolved = readString(structured, "filePath");
    // The harness knows whether the path already existed; the tool name does
    // not. Prefer what it reports, and fall back to the call-time kind when it
    // reports nothing — including on a failure, where there is no outcome to
    // read a kind from.
    const reportedKind = isError
      ? undefined
      : FILE_OUTPUT_KINDS.get(readString(structured, "type") ?? "");
    events.push({
      kind: "file_op_observed",
      path: fileOp.path,
      op: reportedKind ?? fileOp.op,
      outcome: isError ? "failed" : "applied",
      ...(resolved !== null && resolved !== fileOp.path ? { resolvedPath: resolved } : {}),
    });
    return;
  }

  const create = state.openPlanCreates.get(callId);
  if (create !== undefined) {
    state.openPlanCreates.delete(callId);
    if (isError) return; // a create that failed created nothing to record
    const itemId = readCreatedItemId(structured) ?? recoverItemIdFromProse(content);
    if (itemId === null) {
      // The harness DID create the item and we cannot address it. That is a
      // gap, not an absence: later updates naming it will also record nothing.
      events.push({
        kind: "work_gap_observed",
        reason: "a plan item was created and its id could not be read from the result",
      });
      return;
    }
    events.push({
      kind: "plan_item_observed",
      itemId,
      ...(create.title !== null ? { title: create.title } : {}),
      outcome: "applied",
    });
    return;
  }

  const update = state.openPlanUpdates.get(callId);
  if (update !== undefined) {
    state.openPlanUpdates.delete(callId);
    if (isError) {
      // A REJECTED transition. The status is deliberately omitted: writing the
      // status the run asked for would claim a move the harness refused, which
      // is the worst available outcome — worse than recording nothing.
      events.push({ kind: "plan_item_observed", itemId: update.itemId, outcome: "failed" });
      return;
    }
    // Both the new wording and the new status land only HERE, on a confirmed
    // update — the same rule for both, because a re-wording the harness refused
    // is as wrong to record as a transition it refused.
    events.push({
      kind: "plan_item_observed",
      itemId: update.itemId,
      ...(update.title !== null ? { title: update.title } : {}),
      ...(update.status !== null ? { status: update.status } : {}),
      outcome: "applied",
    });
  }
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
  const blocks = msg.message?.content ?? [];
  // `tool_use_result` sits on the MESSAGE, while results sit on its blocks, so
  // it can only be attributed when the message carries exactly one result. With
  // two, there is no way to tell which one it describes, and guessing would put
  // one tool's structured output onto another's record.
  const structured =
    blocks.filter((b) => b.type === "tool_result").length === 1 ? msg.tool_use_result : undefined;
  for (const block of blocks) {
    if (block.type !== "tool_result") continue;
    const callId = block.tool_use_id;
    const isError = block.is_error === true;
    if (state.openSubagents.has(callId)) {
      state.openSubagents.delete(callId);
      events.push({ kind: "subagent_close", callId, output: block.content, isError });
    } else {
      state.openTools.delete(callId);
      events.push({ kind: "tool_result", callId, output: block.content, isError, ...withParent });
      observeToolResult(callId, block.content, isError, structured, state, events);
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
  // Sub-agent inner content streams as partial deltas carrying the spawning
  // Task/Agent tool-use id, so the emitter can nest these under its container.
  const parentCallId = msg.parent_tool_use_id ?? undefined;
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    return [{ kind: "message_delta", text: delta.text, ...(parentCallId ? { parentCallId } : {}) }];
  }
  // Thinking deltas carry the token on `delta.thinking`, not `delta.text`.
  if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
    return [{ kind: "reasoning_delta", text: delta.thinking, ...(parentCallId ? { parentCallId } : {}) }];
  }
  return [];
}

/** `result` terminal message → an optional error notice plus a result event. */
function translateResult(msg: Extract<SdkMessageLike, { type: "result" }>): TranslatedEvent[] {
  const rawSubtype = msg.subtype;
  const subtype = normalizeSubtype(rawSubtype);
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
  // Any terminal subtype that is not "success" is an errored outcome — including
  // an unrecognized subtype (a future SDK failure mode), which `normalizeSubtype`
  // maps to `null`. Keying off the raw subtype here (and `subtype !== "success"`
  // in the agent's status check) prevents a failed run from reporting "completed".
  if (rawSubtype !== "success") {
    events.push({
      kind: "error",
      message: msg.result ?? errorsText ?? `Claude Code agent run failed (${rawSubtype ?? "unknown subtype"}).`,
      code: rawSubtype ?? "unknown",
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
