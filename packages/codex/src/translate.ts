/**
 * The pure interpretation layer: one Codex wire event in, the framework's
 * vocabulary out. No side effects, no context, no vendor word past this
 * boundary — everything downstream reads {@link TranslatedEvent}.
 *
 * **Stateless on purpose.** Codex's wire carries whole items: `item.started`
 * and `item.completed` each repeat the item in full, so nothing here needs to
 * remember the opening to interpret the closing. The one piece of correlation
 * that does exist — a `tool_output` item opened by a call and settled by its
 * result — is keyed by the item's own id and kept where the correlation
 * actually matters, in the emitter's open-item map.
 *
 * Two drift rules, and the difference between them is the point (BP-030):
 *
 * - An unrecognised item kind, or an unrecognised top-level event, becomes a
 *   **status note**. The wire is experimental; a run should degrade before it
 *   breaks.
 * - An unrecognised member of the `turn.*` lifecycle becomes a **terminal
 *   failure**. `outcome: null` is what a manager reads as "no terminal result
 *   arrived" (LAB-154 settles runs on that field), so a future `turn.cancelled`
 *   degrading to a note would report `null` for a run that demonstrably ended.
 *   The same hazard the Claude Code adapter guards for an unrecognised result
 *   subtype, in Codex's shape. If a later event in the same stream turns out to
 *   be a real terminal one, it wins — the block keeps the last terminal signal.
 */
import type { CodexRunUsage, CodexThreadEvent, CodexThreadItem, TranslatedEvent } from "./types";

/** Every wire event this version knows how to interpret, by `type`. */
const KNOWN_EVENTS = new Set([
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.updated",
  "item.completed",
  "error",
]);

/**
 * Interpret one Codex wire event.
 *
 * Returns zero or more translated events, in the order they should reach the
 * stream. Zero is a real answer: `item.updated` carries nothing the
 * started/completed pair does not already say.
 */
export function translateCodexEvent(event: CodexThreadEvent): TranslatedEvent[] {
  switch (event.type) {
    case "thread.started": {
      const id = (event as { thread_id?: unknown }).thread_id;
      return typeof id === "string" && id !== ""
        ? [{ kind: "thread_started", threadId: id }]
        : [{ kind: "status", message: "Codex started a thread but named no id." }];
    }

    case "turn.started":
      return [{ kind: "status", message: "Codex turn started." }];

    case "turn.completed":
      return [{ kind: "turn_completed", usage: normalizeUsage((event as { usage?: unknown }).usage) }];

    case "turn.failed":
      return [
        {
          kind: "turn_failed",
          message:
            readString((event as { error?: { message?: unknown } }).error?.message) ??
            "Codex reported a failed turn with no message.",
        },
      ];

    case "item.started":
      return translateItem((event as { item?: CodexThreadItem }).item, "started");

    case "item.completed":
      return translateItem((event as { item?: CodexThreadItem }).item, "completed");

    // The whole record of an item is its start and its completion. An update in
    // between repeats the same item with a partial `aggregated_output`, and
    // re-emitting it would duplicate the tool call in the stream.
    case "item.updated":
      return [];

    // The stream's own fatal error. Surfaced as an error item; the run settles
    // on whatever terminal turn event does or does not follow, exactly as a
    // mid-turn `error` item does.
    case "error":
      return [
        {
          kind: "error",
          message:
            readString((event as { message?: unknown }).message) ??
            "Codex reported an error with no message.",
        },
      ];

    default:
      return translateUnknownEvent(event.type);
  }
}

/**
 * An event type this version does not know.
 *
 * A `turn.*` that is not `turn.started` ended the turn — see the module note
 * for why that is a failure rather than a note. Everything else degrades.
 */
function translateUnknownEvent(type: string): TranslatedEvent[] {
  if (KNOWN_EVENTS.has(type)) return [];
  if (type.startsWith("turn.")) {
    const message = `Codex reported an unrecognised terminal turn event: ${type}.`;
    return [
      { kind: "status", message },
      { kind: "turn_failed", message },
    ];
  }
  return [{ kind: "status", message: `Codex emitted an unrecognised event: ${type}.` }];
}

/** Interpret one thread item at one point in its life. */
function translateItem(
  item: CodexThreadItem | undefined,
  phase: "started" | "completed",
): TranslatedEvent[] {
  if (item === undefined || typeof item.type !== "string") {
    return [{ kind: "status", message: "Codex emitted an item with no kind." }];
  }
  const callId = typeof item.id === "string" ? item.id : "unknown";

  switch (item.type) {
    // Text and reasoning arrive whole and only matter once they are complete.
    case "agent_message":
      return phase === "completed"
        ? [{ kind: "message", text: readString((item as { text?: unknown }).text) ?? "" }]
        : [];
    case "reasoning":
      return phase === "completed"
        ? [{ kind: "reasoning", text: readString((item as { text?: unknown }).text) ?? "" }]
        : [];

    case "command_execution": {
      const command = readString((item as { command?: unknown }).command) ?? "";
      const args = JSON.stringify({ command });
      if (phase === "started") {
        return [{ kind: "tool_call", callId, name: "command_execution", arguments: args }];
      }
      const exitCode = (item as { exit_code?: unknown }).exit_code;
      return [
        {
          kind: "tool_result",
          callId,
          name: "command_execution",
          arguments: args,
          output: readString((item as { aggregated_output?: unknown }).aggregated_output) ?? "",
          // A non-zero exit is a failure even when the wire's `status` says the
          // execution completed: `completed` describes the SPAWN, not the command.
          isError:
            (item as { status?: unknown }).status === "failed" ||
            (typeof exitCode === "number" && exitCode !== 0),
        },
      ];
    }

    case "mcp_tool_call": {
      const server = readString((item as { server?: unknown }).server) ?? "unknown";
      const tool = readString((item as { tool?: unknown }).tool) ?? "unknown";
      const name = `mcp:${server}/${tool}`;
      const args = JSON.stringify((item as { arguments?: unknown }).arguments ?? {});
      if (phase === "started") return [{ kind: "tool_call", callId, name, arguments: args }];
      const error = (item as { error?: unknown }).error;
      return [
        {
          kind: "tool_result",
          callId,
          name,
          arguments: args,
          output: error ?? (item as { result?: unknown }).result ?? null,
          isError: error !== undefined || (item as { status?: unknown }).status === "failed",
        },
      ];
    }

    // The remaining kinds are emitted once, already settled — the SDK produces
    // no `item.started` for them — so each opens and closes in one step.
    case "file_change":
      return settledPair(callId, "file_change", {
        changes: (item as { changes?: unknown }).changes ?? [],
        status: (item as { status?: unknown }).status,
      }).map(withError((item as { status?: unknown }).status === "failed"));

    case "web_search":
      return settledPair(callId, "web_search", {
        query: readString((item as { query?: unknown }).query) ?? "",
      });

    case "todo_list":
      return settledPair(callId, "todo_list", {
        items: (item as { items?: unknown }).items ?? [],
      });

    case "error":
      return phase === "completed" || phase === "started"
        ? [
            {
              kind: "error",
              message:
                readString((item as { message?: unknown }).message) ??
                "Codex reported an error item with no message.",
            },
          ]
        : [];

    default:
      return [
        {
          kind: "status",
          message: `Codex emitted an unrecognised item kind: ${item.type}.`,
        },
      ];
  }
}

/**
 * A tool item that arrives already settled: the opening call and its result,
 * carrying the same payload, so the stream shows one complete `tool_output`
 * rather than a result with no call.
 */
function settledPair(callId: string, name: string, payload: unknown): TranslatedEvent[] {
  const args = JSON.stringify(payload);
  return [
    { kind: "tool_call", callId, name, arguments: args },
    { kind: "tool_result", callId, name, arguments: args, output: payload, isError: false },
  ];
}

/** Mark a settled pair's result an error. */
function withError(isError: boolean) {
  return (event: TranslatedEvent): TranslatedEvent =>
    event.kind === "tool_result" ? { ...event, isError } : event;
}

/** Codex's snake_case usage, in the framework's spelling. `null` when absent. */
function normalizeUsage(usage: unknown): CodexRunUsage | null {
  if (usage === null || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  return {
    inputTokens: readNumber(u.input_tokens),
    cachedInputTokens: readNumber(u.cached_input_tokens),
    cacheWriteInputTokens: readNumber(u.cache_write_input_tokens),
    outputTokens: readNumber(u.output_tokens),
    reasoningOutputTokens: readNumber(u.reasoning_output_tokens),
  };
}

/** A number the wire actually carried, or 0 — never `NaN` into the cost math. */
function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A string the wire actually carried, or `undefined`. */
function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
