/**
 * The pure interpretation layer: one Cursor wire message in, the framework's
 * vocabulary out. No side effects, no context, no vendor word past this
 * boundary — everything downstream reads {@link TranslatedEvent}.
 *
 * **Stateless on purpose.** Cursor's stream carries whole messages: a
 * `tool_call` repeats its `call_id`, `name` and `args` at every status, so
 * nothing here needs to remember the opening to interpret the closing. The one
 * piece of correlation that does exist — a `tool_output` item opened by a
 * running call and settled by its result — is keyed by the call's own id and
 * kept where the correlation actually matters, in the emitter's open-item map.
 *
 * **Nothing here decides how the run ended,** and that is the difference from
 * the Codex translator. Cursor reports its terminal result on `run.wait()`
 * rather than on the stream, so the outcome is read from one authoritative
 * place; a `status` message saying `FINISHED` is mirrored as a note and nothing
 * more. That removes the Codex translator's "an unrecognised terminal event must
 * fail" rule entirely — there is no terminal event on this wire to
 * misrecognise.
 *
 * So there is one drift rule, not two: an unrecognised message kind, or an
 * unrecognised content block, becomes a **status note**. The wire moves; a run
 * should degrade before it breaks (BP-030).
 */
import type {
  CursorContentBlock,
  CursorRunUsage,
  CursorSdkMessage,
  CursorWireUsage,
  TranslatedEvent,
} from "./types";

/**
 * Interpret one Cursor wire message.
 *
 * Returns zero or more translated events, in the order they should reach the
 * stream. Zero is a real answer: a `user` message is the prompt this block just
 * sent, echoed back, and re-emitting it would show the caller their own words as
 * if the agent had said them.
 */
export function translateCursorMessage(message: CursorSdkMessage): TranslatedEvent[] {
  switch (message.type) {
    case "system":
      return translateSystem(message as { subtype?: unknown; model?: { id?: unknown } });

    case "assistant":
      return translateAssistant(
        (message as { message?: { content?: unknown } }).message?.content,
      );

    // The prompt this block just sent, echoed back by the runtime.
    case "user":
      return [];

    case "thinking": {
      const text = readString((message as { text?: unknown }).text);
      return text === undefined || text === "" ? [] : [{ kind: "reasoning", text }];
    }

    case "tool_call":
      return translateToolCall(message as Record<string, unknown>);

    case "status":
      return translateStatus(message as { status?: unknown; message?: unknown });

    case "task": {
      const text = readString((message as { text?: unknown }).text);
      const status = readString((message as { status?: unknown }).status);
      return [
        {
          kind: "status",
          message: `Cursor task${status === undefined ? "" : ` (${status})`}${
            text === undefined || text === "" ? "" : `: ${text}`
          }.`,
        },
      ];
    }

    case "usage":
      return [{ kind: "run_usage", usage: normalizeUsage((message as { usage?: unknown }).usage) }];

    // The runtime naming the request it is serving. Carries nothing a reader of
    // the stream can act on.
    case "request":
      return [];

    default:
      return [
        { kind: "status", message: `Cursor emitted an unrecognised message: ${message.type}.` },
      ];
  }
}

/**
 * The init message. Its `model` is what the run ACTUALLY used, which is what the
 * cost estimate should be priced against — a host that left the selection to a
 * per-account default has no other source for it.
 */
function translateSystem(message: { subtype?: unknown; model?: { id?: unknown } }): TranslatedEvent[] {
  const events: TranslatedEvent[] = [{ kind: "status", message: "Cursor agent started." }];
  const model = readString(message.model?.id);
  if (model !== undefined && model !== "") events.push({ kind: "model", model });
  return events;
}

/**
 * An assistant message's content blocks.
 *
 * `tool_use` blocks are deliberately DROPPED rather than opened as tool calls:
 * the same call arrives as a `tool_call` message with a status of its own, and
 * opening it twice would put two items in the stream for one invocation — the
 * second of which never settles.
 */
function translateAssistant(content: unknown): TranslatedEvent[] {
  if (!Array.isArray(content)) {
    return [{ kind: "status", message: "Cursor emitted an assistant message with no content." }];
  }
  const events: TranslatedEvent[] = [];
  for (const block of content as CursorContentBlock[]) {
    if (block?.type === "text") {
      const text = readString((block as { text?: unknown }).text);
      if (text !== undefined && text !== "") events.push({ kind: "message", text });
    } else if (block?.type !== "tool_use") {
      events.push({
        kind: "status",
        message: `Cursor emitted an unrecognised content block: ${String(block?.type)}.`,
      });
    }
  }
  return events;
}

/**
 * One tool invocation, at one point in its life.
 *
 * `running` opens the item; `completed` and `error` settle it. An unrecognised
 * status settles it too rather than leaving it open — an item still spinning
 * long after the run ended is worse than one closed on a status we did not
 * recognise, and the emitter's end-of-run sweep is a backstop, not a plan.
 */
function translateToolCall(message: Record<string, unknown>): TranslatedEvent[] {
  const callId = readString(message.call_id) ?? "unknown";
  const name = readString(message.name) ?? "unknown";
  const args = safeStringify(message.args ?? {});
  if (message.status === "running") {
    return [{ kind: "tool_call", callId, name, arguments: args }];
  }
  return [
    {
      kind: "tool_result",
      callId,
      name,
      arguments: args,
      output: message.result ?? null,
      isError: message.status === "error",
    },
  ];
}

/**
 * A lifecycle status message.
 *
 * Mirrored as a note and nothing more, including the terminal ones. The run's
 * outcome comes from `run.wait()`, which is authoritative and arrives once; a
 * second source here would let a stream that ends early disagree with the SDK
 * about how the run finished.
 */
function translateStatus(message: { status?: unknown; message?: unknown }): TranslatedEvent[] {
  const status = readString(message.status) ?? "unknown";
  const detail = readString(message.message);
  return [
    {
      kind: "status",
      message: `Cursor run ${status.toLowerCase()}${detail === undefined || detail === "" ? "" : `: ${detail}`}.`,
    },
  ];
}

/** Cursor's token report, with every field a number. `reasoningTokens` is optional on the wire. */
export function normalizeUsage(usage: unknown): CursorRunUsage {
  const u = (usage === null || typeof usage !== "object" ? {} : usage) as Partial<CursorWireUsage>;
  return {
    inputTokens: readNumber(u.inputTokens),
    outputTokens: readNumber(u.outputTokens),
    cacheReadTokens: readNumber(u.cacheReadTokens),
    cacheWriteTokens: readNumber(u.cacheWriteTokens),
    totalTokens: readNumber(u.totalTokens),
    reasoningTokens: readNumber(u.reasoningTokens),
  };
}

/**
 * Field-wise sum of two token reports.
 *
 * One `send` can span several turns, and the runtime emits one `usage` message
 * per turn that reported any. Taking the last would under-report a multi-turn
 * run; summing is what the SDK's own cumulative figure does.
 */
export function addUsage(a: CursorRunUsage | null, b: CursorRunUsage): CursorRunUsage {
  if (a === null) return b;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
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

/** Tool arguments as JSON, without throwing on a cycle the vendor put there. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
}
