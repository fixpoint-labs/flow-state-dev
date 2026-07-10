/**
 * Rendering seam for `fsdev chat`. `ChatRenderer` is what the loop drives with
 * engine stream events and turn lifecycle; `createPlainTextRenderer` is the v1
 * implementation over a writable stream. A future Ink renderer (FIX-217) is a
 * second implementation of this interface, not a rewrite.
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
}

/** A dim one-liner for a curated, non-blank item, or undefined to render nothing. */
function oneLiner(item: OutputItem): string | undefined {
  switch (item.type) {
    case "tool_output":
      return `· tool call: ${item.toolCall?.name ?? item.blockName}`;
    case "status":
      return item.message.length > 0 ? `· status: ${item.message}` : undefined;
    case "error":
      return item.message.length > 0 ? `· error: ${item.message}` : undefined;
    default:
      // Reasoning, traces, sources, invalidations, the user-message echo — kept
      // out of the v1 plain transcript.
      return undefined;
  }
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
  // Item id → type, so a content.delta is streamed only when it belongs to a
  // message item (assistant text), not reasoning or other content-bearing items.
  const itemTypes = new Map<string, string>();
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
          itemTypes.set(item.id, item.type);

          if (item.type === "status" && item.transient === true) {
            // The single-slot in-flight ping (FIX-478): redraw in place, never
            // accumulate as a printed line, and skip entirely outside a TTY.
            if (isTTY) {
              clearLiveStatus();
              if (item.message.length > 0) {
                out.write(item.message);
                liveStatusWidth = item.message.length;
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
          // Stream only assistant message text; reasoning/other content is quiet.
          if (itemTypes.get(event.itemId) !== "message") return;
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
      itemTypes.clear();
      streamedItems.clear();
    },

    onSystem(line) {
      closeLine();
      out.write(`${line}\n`);
    },
  };
}
