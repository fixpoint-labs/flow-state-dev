/**
 * Rendering seam for `fsdev chat`. `ChatRenderer` is what the loop drives with
 * engine stream events and turn lifecycle; `createPlainTextRenderer` is the v1
 * implementation over a writable stream. A future Ink renderer (FIX-217) is a
 * second implementation of this interface, not a rewrite.
 *
 * Plain-text behavior (§4.7): assistant message text streams verbatim from
 * `content.delta`; non-message items (tool calls, status) print one dim
 * one-liner; the user-message echo is suppressed; a turn ends with a newline,
 * and an aborted turn prints `(interrupted)`.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
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

/** A dim one-liner for a non-message item, or undefined to render nothing. */
function oneLiner(item: OutputItem): string | undefined {
  switch (item.type) {
    case "message":
    case "reasoning":
      // Assistant text streams via content.delta; user echo is suppressed;
      // reasoning is omitted from the v1 plain transcript.
      return undefined;
    case "tool_output":
      return `· tool call: ${item.toolCall?.name ?? item.blockName}`;
    case "status":
      return `· status: ${item.message}`;
    case "error":
      return `· error: ${item.message}`;
    default:
      return `· ${item.type}`;
  }
}

export function createPlainTextRenderer(out: NodeJS.WritableStream): ChatRenderer {
  // Item id → type, so a content.delta is streamed only when it belongs to a
  // message item (assistant text), not reasoning or other content-bearing items.
  const itemTypes = new Map<string, string>();
  // True when the last write left an unterminated streamed line; the next
  // structural write (one-liner, system line, turn end) closes it first.
  let midLine = false;

  const closeLine = (): void => {
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
          out.write(event.delta);
          midLine = true;
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
    },

    onSystem(line) {
      closeLine();
      out.write(`${line}\n`);
    },
  };
}
