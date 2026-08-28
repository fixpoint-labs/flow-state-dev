/**
 * Curate the engine stream into a transcript the board can paint.
 *
 * Same events `fsdev chat` reads. Transient status is the live line — what
 * is happening now. A new status commits the previous one, so a long drain
 * keeps a log instead of a single overwritten slot. `content.delta` appends
 * to the live line so a generator in this process reads as a stream. Durable
 * items (errors, tools, finished messages, resource changes) become activity
 * lines. `status` remains the board authority; `diffBoard` turns a poll that
 * actually moved into the same log. A running row's `run.requestId` is also
 * tailed through the request store, so a detached coding run writes here
 * as it runs.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import { pushActivity, type StatusRow, type ViewState } from "./types";

export interface TranscriptPatch {
  /** Lines that just became history. */
  lines: string[];
  /** In-flight line. `null` means nothing is streaming. */
  live: string | null;
}

/** Fold a patch into the view. New history goes through `pushActivity`. */
export function applyTranscriptPatch(
  state: ViewState,
  patch: TranscriptPatch,
  at: number = Date.now(),
): ViewState {
  let next = state;
  for (const text of patch.lines) next = pushActivity(next, text, at);
  return { ...next, live: patch.live };
}

export function createStreamTranscript(): {
  apply: (event: RequestStreamEventWithId) => TranscriptPatch;
  flush: () => TranscriptPatch;
} {
  const itemTypes = new Map<string, string>();
  const streamed = new Set<string>();
  let live: string | null = null;
  let liveKind: "status" | "message" | null = null;

  const snapshot = (lines: string[]): TranscriptPatch => ({ lines, live });

  const commitLive = (): string[] => {
    if (live === null) return [];
    const lines = [live];
    live = null;
    liveKind = null;
    return lines;
  };

  return {
    apply(event: RequestStreamEventWithId): TranscriptPatch {
      switch (event.type) {
        case "item.added": {
          const item = event.item;
          itemTypes.set(item.id, item.type);
          if (item.type === "status") {
            if (item.message.length === 0) return snapshot([]);
            const line = `status · ${item.message}`;
            if (item.transient === false) {
              return snapshot([line]);
            }
            const prior = liveKind === "status" ? commitLive() : [];
            live = line;
            liveKind = "status";
            return snapshot(prior);
          }
          if (item.type === "error" && item.message.length > 0) {
            return snapshot([...commitLive(), `error · ${item.message}`]);
          }
          if (item.type === "tool_output") {
            return snapshot([
              ...commitLive(),
              `tool · ${item.toolCall?.name ?? item.blockName}`,
            ]);
          }
          return snapshot([]);
        }
        case "content.delta": {
          if (itemTypes.get(event.itemId) !== "message") return snapshot([]);
          if (event.delta.length === 0) return snapshot([]);
          streamed.add(event.itemId);
          if (liveKind !== "message") {
            const prior = commitLive();
            live = `message · ${event.delta}`;
            liveKind = "message";
            return snapshot(prior);
          }
          live = `${live ?? "message · "}${event.delta}`;
          return snapshot([]);
        }
        case "item.done": {
          const item = event.item;
          if (item.type === "message" && item.role === "assistant") {
            if (streamed.has(item.id)) {
              return snapshot(commitLive());
            }
            const text = messageText(item);
            if (text.length === 0) return snapshot([]);
            return snapshot([...commitLive(), `message · ${text}`]);
          }
          return snapshot([]);
        }
        case "resource.changed": {
          const path = event.resourcePath;
          if (path === undefined || path === "") return snapshot([]);
          return snapshot([...commitLive(), `resource · ${event.changeType} ${path}`]);
        }
        case "request.failed": {
          const message = (event as { error?: { message?: string } }).error?.message;
          return snapshot([
            ...commitLive(),
            message !== undefined && message !== ""
              ? `request failed · ${message}`
              : "request failed",
          ]);
        }
        default:
          return snapshot([]);
      }
    },
    flush(): TranscriptPatch {
      return { lines: commitLive(), live: null };
    },
  };
}

function messageText(item: OutputItem): string {
  if (item.type !== "message") return "";
  const parts = item.content ?? [];
  let text = "";
  for (const part of parts) {
    if (part.type === "output_text" && typeof part.text === "string") text += part.text;
  }
  return text.trim();
}

/**
 * What changed on the board between two `status` reads.
 *
 * A poll that moved nothing is silent. A new question, a status flip, or a
 * new run outcome is not — those are the only facts a detached run can
 * report through `status`.
 */
export function diffBoard(prev: StatusRow[], next: StatusRow[]): string[] {
  const prevByKey = new Map(prev.map((row) => [rowKey(row), row]));
  const lines: string[] = [];
  for (const row of next) {
    const key = rowKey(row);
    const label = row.issue ?? row.taskId;
    const before = prevByKey.get(key);
    if (before === undefined) {
      lines.push(`${label} · ${row.status}`);
      for (const question of row.questions) {
        lines.push(`${label} · asked ${question.text}`);
      }
      continue;
    }
    if (before.status !== row.status) {
      lines.push(`${label} · ${before.status} → ${row.status}`);
    }
    for (const question of row.questions) {
      if (!before.questions.some((q) => q.question === question.question)) {
        lines.push(`${label} · asked ${question.text}`);
      }
    }
    const outcome = row.run?.outcome ?? null;
    const priorOutcome = before.run?.outcome ?? null;
    if (outcome !== null && outcome !== priorOutcome) {
      const reason = row.run?.reason;
      lines.push(
        reason !== null && reason !== undefined && reason !== ""
          ? `${label} · run ${outcome} · ${reason}`
          : `${label} · run ${outcome}`,
      );
    }
    const finalMessage = row.run?.finalMessage;
    if (
      finalMessage !== null &&
      finalMessage !== undefined &&
      finalMessage !== "" &&
      finalMessage !== before.run?.finalMessage
    ) {
      lines.push(`${label} · ${finalMessage}`);
    }
  }
  return lines;
}

function rowKey(row: StatusRow): string {
  return row.taskId;
}
