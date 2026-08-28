/**
 * Curate the engine stream into a transcript the board can paint.
 *
 * Same events `fsdev chat` reads. Transient status is the live line — what
 * is happening now. A new status commits the previous one, so a long drain
 * keeps a log instead of a single overwritten slot. `content.delta` appends
 * to the live line so a generator in this process reads as a stream. Durable
 * items (errors, tools, finished messages, resource changes) become activity
 * lines. A coding tool is named with the file or command it touched. A Write
 * or Edit that carries the new text also prints a compact hunk — the changed
 * span, not the whole file. A Bash result prints the last lines of its
 * output when it settles. `status` remains the board authority; `diffBoard`
 * turns a poll that actually moved into the same log. A running row's
 * `run.requestId` is also tailed through the request store, so a detached
 * coding run writes here as it runs.
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
  const logged = new Set<string>();
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
            logged.add(item.id);
            return snapshot([...commitLive(), ...formatToolLines(item)]);
          }
          if (item.type === "container") {
            logged.add(item.id);
            return snapshot([...commitLive(), formatContainerLine(item)]);
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
          if (item.type === "tool_output") {
            const failed = item.status === "failed" || item.status === "incomplete";
            if (logged.has(item.id) && !failed) {
              return snapshot([...commitLive(), ...formatCommandOutput(item)]);
            }
            logged.add(item.id);
            if (failed) {
              return snapshot([
                ...commitLive(),
                formatToolLine(item, item.status),
                ...formatCommandOutput(item),
              ]);
            }
            return snapshot([
              ...commitLive(),
              ...formatToolLines(item),
              ...formatCommandOutput(item),
            ]);
          }
          if (item.type === "container") {
            const failed = item.status === "failed" || item.status === "incomplete";
            if (logged.has(item.id) && !failed) return snapshot([]);
            logged.add(item.id);
            return snapshot([
              ...commitLive(),
              formatContainerLine(item, failed ? item.status : undefined),
            ]);
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

const TOOL_SUBJECT_KEYS = [
  "file_path",
  "path",
  "command",
  "pattern",
  "glob",
  "description",
  "url",
  "query",
] as const;

function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function toolSubject(args: Record<string, unknown>): string | undefined {
  for (const key of TOOL_SUBJECT_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim().replace(/\s+/g, " ").slice(0, 72);
    }
  }
  return undefined;
}

function formatToolLine(item: OutputItem, settled?: "failed" | "incomplete"): string {
  const name =
    item.type === "tool_output" ? (item.toolCall?.name ?? item.blockName) : "tool";
  const args = item.type === "tool_output" ? parseToolArgs(item.toolCall?.arguments) : {};
  const subject = toolSubject(args);
  const base = subject !== undefined ? `tool · ${name} ${subject}` : `tool · ${name}`;
  if (settled === "failed") return `${base} · failed`;
  if (settled === "incomplete") return `${base} · stopped`;
  return base;
}

/** Tool name plus a compact hunk when the call carried the new file text. */
function formatToolLines(item: OutputItem): string[] {
  const args = item.type === "tool_output" ? parseToolArgs(item.toolCall?.arguments) : {};
  return [formatToolLine(item), ...toolHunk(args)];
}

const HUNK_MAX = 10;
const HUNK_LINE = 72;

function stringArg(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (trimmed === "") return [];
  return trimmed.split("\n");
}

function clipHunkLine(mark: "+" | "-", text: string): string {
  const body = text.length <= HUNK_LINE ? text : `${text.slice(0, HUNK_LINE - 1)}…`;
  return `${mark} ${body}`;
}

function capHunk(lines: string[]): string[] {
  if (lines.length <= HUNK_MAX) return lines;
  return [...lines.slice(0, HUNK_MAX), `… ${lines.length - HUNK_MAX} more`];
}

/**
 * Compact hunk from the args a Write or Edit already sent. Presenter only —
 * it does not read the checkout. An Edit shows the changed span; a Write
 * shows the new file as additions. No contents, no hunk.
 */
function toolHunk(args: Record<string, unknown>): string[] {
  const after = stringArg(args, ["new_string", "contents", "content"]);
  if (after === undefined) return [];
  const before = stringArg(args, ["old_string"]);
  const added = splitLines(after);
  if (before === undefined) {
    return capHunk(added.map((line) => clipHunkLine("+", line)));
  }
  const removed = splitLines(before);
  let start = 0;
  const shared = Math.min(removed.length, added.length);
  while (start < shared && removed[start] === added[start]) start += 1;
  let removedEnd = removed.length;
  let addedEnd = added.length;
  while (
    removedEnd > start &&
    addedEnd > start &&
    removed[removedEnd - 1] === added[addedEnd - 1]
  ) {
    removedEnd -= 1;
    addedEnd -= 1;
  }
  const hunk = [
    ...removed.slice(start, removedEnd).map((line) => clipHunkLine("-", line)),
    ...added.slice(start, addedEnd).map((line) => clipHunkLine("+", line)),
  ];
  return capHunk(hunk);
}

const COMMAND_OUT_OK = 6;
const COMMAND_OUT_FAIL = 12;

function isCommandTool(item: OutputItem, args: Record<string, unknown>): boolean {
  const name =
    item.type === "tool_output" ? (item.toolCall?.name ?? item.blockName) : "";
  if (name === "Bash") return true;
  return typeof args.command === "string" && args.command.trim() !== "";
}

function commandOutputText(item: OutputItem): string {
  if (item.type !== "tool_output") return "";
  const raw = item.output;
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.stdout === "string") parts.push(record.stdout);
    if (typeof record.stderr === "string") parts.push(record.stderr);
    if (parts.length > 0) {
      return parts.map((part) => part.replace(/\n+$/, "")).filter((part) => part !== "").join("\n");
    }
  }
  const err = item.error?.message;
  return typeof err === "string" ? err : "";
}

/** Last lines of a Bash result. Write/Edit/Read stay silent here. */
function formatCommandOutput(item: OutputItem): string[] {
  if (item.type !== "tool_output") return [];
  const args = parseToolArgs(item.toolCall?.arguments);
  if (!isCommandTool(item, args)) return [];
  const text = commandOutputText(item);
  if (text.trim() === "") return [];
  const failed = item.status === "failed" || item.status === "incomplete";
  const max = failed ? COMMAND_OUT_FAIL : COMMAND_OUT_OK;
  const lines = splitLines(text).map((line) => {
    const body = line.length <= HUNK_LINE ? line : `${line.slice(0, HUNK_LINE - 1)}…`;
    return `  ${body}`;
  });
  if (lines.length <= max) return lines;
  return [`  … ${lines.length - max} above`, ...lines.slice(-max)];
}

function formatContainerLine(item: OutputItem, settled?: "failed" | "incomplete"): string {
  const label =
    item.type === "container" ? (item.label ?? item.blockName) : "sub-agent";
  const base = `sub · ${label}`;
  if (settled === "failed") return `${base} · failed`;
  if (settled === "incomplete") return `${base} · stopped`;
  return base;
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
