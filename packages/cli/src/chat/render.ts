/**
 * Rendering seam for `fsdev chat` and `fsdev run --format text`. `ChatRenderer`
 * is what the chat loop drives with engine stream events and turn lifecycle;
 * `createPlainTextRenderer` is the v1 implementation over a writable stream.
 * A future Ink renderer (FIX-217) is a second implementation of this interface,
 * not a rewrite.
 *
 * `fsdev run --format text` drives the same renderer, differing only by options
 * (`transientStatus: "lines"`).
 *
 * Plain-text behavior (§4.7): assistant message text is shown — streamed from
 * `content.delta` when the model streams, or printed once from the final
 * `item.done` when it doesn't (e.g. a non-streaming provider). Tool calls,
 * errors, and *persistent* status items print one dim one-liner each.
 *
 * Status items are split by `item.transient` (FIX-478's single-slot in-flight
 * indicator vs. a durable confirmation — see `createEmitStatus` in the engine):
 * a **transient** status (the default for `ctx.emit.status`, and for every
 * block's declarative `activeStatusMessage`) is an ephemeral "what's running
 * right now" ping — in a TTY it overwrites a single live status line instead of
 * accumulating as printed lines, and it is silent outside a TTY (no piped/script
 * audience for a human progress indicator). A **non-transient** status (e.g. the
 * engine's "Request was stopped." on abort) is a real, durable event and always
 * prints as its own line. A blank message never renders anything, transient or
 * not. Everything else (reasoning, traces, the user-message echo) is suppressed;
 * an aborted turn prints `(interrupted)`.
 */
import type { Content, OutputItem } from "@flow-state-dev/core/items";
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import type { FlowActionTarget } from "./targets";

export interface ChatRenderer {
  /** Consume one engine stream event (same type `fsdev run` maps). */
  onEvent(event: RequestStreamEventWithId): void;
  /** A turn is starting against `target`. */
  onTurnStart(target: FlowActionTarget): void;
  /** A turn settled. */
  onTurnEnd(result: { success: boolean; durationMs: number; aborted: boolean }): void;
  /** A harness/system line (hints, errors, built-in output). */
  onSystem(line: string): void;
}

export interface CreatePlainTextRendererOptions {
  /**
   * Enables the live-updating in-flight status line. Off by default (piped/test
   * output has no cursor to redraw and no human watching it).
   */
  isTTY?: boolean;
  /**
   * How a transient status ping renders.
   *
   * - `"live"` (default) — the single-slot indicator described above: redraw in
   *   place in a TTY, silent outside one. This is `fsdev chat`'s behavior.
   * - `"lines"` — every ping prints its own one-liner, TTY or not. `fsdev run
   *   --format text` uses this: its audience is an outer harness reading a piped
   *   log, where there is no cursor to redraw and a silent run looks hung.
   */
  transientStatus?: "live" | "lines";
}

/** Longest curated progress line rendered before truncation. */
const PROGRESS_LINE_LIMIT = 240;

/**
 * Collapses a curated progress summary (status, error, tool failure, run
 * verdict) to one physical line of bounded length, marking any truncation.
 * Assistant prose and system lines never pass through here.
 *
 * Slices before normalising so a large payload — a multiline script echoed back
 * in an error message — is never copied whole just to render a short prefix.
 * The full text stays in `--capture`.
 */
export function compactProgressText(text: string): string {
  const window = text.slice(0, PROGRESS_LINE_LIMIT * 2 + 1);
  const collapsed = window.replace(/\s+/g, " ").trim();
  if (text.length <= window.length && collapsed.length <= PROGRESS_LINE_LIMIT) return collapsed;
  return `${collapsed.slice(0, PROGRESS_LINE_LIMIT).trimEnd()}… (truncated)`;
}

/** A dim one-liner for a curated, non-blank item, or undefined to render nothing. */
function oneLiner(item: OutputItem): string | undefined {
  switch (item.type) {
    case "tool_output":
      return `· tool call: ${item.toolCall?.name ?? item.blockName}`;
    case "status":
      return item.message.length > 0 ? `· status: ${compactProgressText(item.message)}` : undefined;
    case "error":
      return item.message.length > 0 ? `· error: ${compactProgressText(item.message)}` : undefined;
    default:
      // Reasoning, traces, sources, the user-message echo — out of the transcript.
      return undefined;
  }
}

/**
 * A one-liner for a tool that settled in failure, or undefined when it
 * succeeded. `status` and `error` are independent signals — a denied call can
 * be `status: "failed"` with the refusal only in `output` — so either marks
 * failure. A `"SUSPENSION"` code is a suspended tool re-entering its gate, not
 * a failure. `output` is never printed; the fallback stays generic.
 */
function toolFailureLine(item: Extract<OutputItem, { type: "tool_output" }>): string | undefined {
  const error = item.error;
  if (error?.code === "SUSPENSION") return undefined;
  if (error === undefined && item.status !== "failed") return undefined;
  const name = item.toolCall?.name ?? item.blockName;
  return error !== undefined && error.message.length > 0
    ? `· tool failed: ${name} — ${compactProgressText(error.message)}`
    : `· tool failed: ${name}`;
}

/** Flatten a message item's content parts to plain text. */
function messageText(content: Content[]): string {
  return content
    .map((part) => (typeof part === "string" ? part : ((part as { text?: string }).text ?? "")))
    .join("");
}

export function createPlainTextRenderer(
  out: NodeJS.WritableStream,
  options: CreatePlainTextRendererOptions = {},
): ChatRenderer {
  const isTTY = options.isTTY === true;
  const transientStatus = options.transientStatus ?? "live";
  // Ids of assistant message items. Type alone is not enough — the user echo is
  // also type "message", and its deltas would print the prompt back.
  const assistantMessageItems = new Set<string>();
  // Item ids that streamed at least one delta — so item.done doesn't re-print
  // text the deltas already showed.
  const streamedItems = new Set<string>();
  // True when the last write left an unterminated streamed line; the next
  // structural write (one-liner, system line, turn end) closes it first.
  let midLine = false;
  // Character width of the live status line currently drawn (0 = none showing).
  let liveStatusWidth = 0;

  const clearLiveStatus = (): void => {
    if (liveStatusWidth === 0) return;
    out.write(`\r${" ".repeat(liveStatusWidth)}\r`);
    liveStatusWidth = 0;
  };

  const closeLine = (): void => {
    clearLiveStatus();
    if (midLine) {
      out.write("\n");
      midLine = false;
    }
  };

  return {
    onEvent(event) {
      switch (event.type) {
        case "item.added": {
          const item = event.item;
          if (item.type === "message" && item.role === "assistant") {
            assistantMessageItems.add(item.id);
          }

          if (item.type === "status" && item.transient === true && transientStatus === "live") {
            // Single-slot in-flight ping (FIX-478): redraw in place, TTY only.
            // Under `"lines"` this branch is skipped and the ping falls through
            // to the one-liner path below.
            if (isTTY) {
              clearLiveStatus();
              if (item.message.length > 0) {
                // Compacted so the redraw width matches what was written.
                const ping = compactProgressText(item.message);
                out.write(ping);
                liveStatusWidth = ping.length;
              }
            }
            return;
          }

          const line = oneLiner(item);
          if (line !== undefined) {
            closeLine();
            out.write(`${line}\n`);
          }
          return;
        }
        case "content.delta": {
          // Stream only assistant message text; reasoning, the user echo, and
          // other content-bearing items stay quiet.
          if (!assistantMessageItems.has(event.itemId)) return;
          if (event.delta.length === 0) return;
          clearLiveStatus();
          streamedItems.add(event.itemId);
          out.write(event.delta);
          midLine = true;
          return;
        }
        case "item.done": {
          // Non-streaming providers deliver the assistant text only here; print it
          // when the deltas didn't already.
          const item = event.item;
          if (item.type === "message" && item.role === "assistant" && !streamedItems.has(item.id)) {
            const text = messageText(item.content);
            if (text.length > 0) {
              closeLine();
              out.write(`${text}\n`);
            }
          }
          // The start printed on item.added; success adds nothing, failure adds
          // its own distinct line.
          if (item.type === "tool_output") {
            const failure = toolFailureLine(item);
            if (failure !== undefined) {
              closeLine();
              out.write(`${failure}\n`);
            }
          }
          return;
        }
        default:
          return;
      }
    },

    onTurnStart() {
      // No banner in v1 plain text — the assistant response starts streaming.
    },

    onTurnEnd(result) {
      closeLine();
      if (result.aborted) out.write("(interrupted)\n");
      assistantMessageItems.clear();
      streamedItems.clear();
    },

    onSystem(line) {
      closeLine();
      out.write(`${line}\n`);
    },
  };
}
