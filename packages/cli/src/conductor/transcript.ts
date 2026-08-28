/**
 * Curate the engine stream into a transcript the board can paint.
 *
 * Same events `fsdev chat` reads. Transient status is the live line — what
 * is happening now. A new status commits the previous one, so a long drain
 * keeps a log instead of a single overwritten slot. `content.delta` appends
 * to the live line so a generator in this process reads as a stream. Durable
 * items (errors, tools, finished messages, resource changes) become activity
 * lines. A coding tool is named with the file or command it touched. While
 * that call is still open, it stays on the live line so the board reads as
 * working. A Write or Edit that carries the new text also prints a compact
 * hunk — the changed span, not the whole file. A plan tool prints the
 * checklist. A Read prints the first lines of the file. A Bash, Grep, or
 * Glob result prints the last lines of its output when the item settles
 * (`item.updated` or `item.done`). `status` remains the board authority;
 * `diffBoard` turns a poll that actually moved into the same log. A running
 * row's `run.requestId` is also tailed through the request store, so a
 * detached coding run writes here as it runs. Each followed request has
 * its own machine; the renderer keeps the selected row's lines.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import { fileFromToolLine, pushActivity, type PlanItem, type StatusRow, type ViewState } from "./types";

export interface TranscriptPatch {
  /** Lines that just became history. */
  lines: string[];
  /** In-flight line. `null` means nothing is streaming. */
  live: string | null;
  /**
   * Checklist from a plan tool in this patch. Absent means keep the
   * last pinned plan; present replaces it. A Read or Bash never sets this.
   */
  plan?: PlanItem[];
}

/**
 * Fold a patch into the view. New history goes through `pushActivity`.
 * Pass `requestId` for a followed child so the live slot and the lines
 * stay with that request. Omit it for an operator action — tagging those
 * with the parent request would hide them when a child row is selected.
 */
export function applyTranscriptPatch(
  state: ViewState,
  patch: TranscriptPatch,
  at: number = Date.now(),
  requestId?: string,
): ViewState {
  let next = state;
  for (const text of patch.lines) {
    next = pushActivity(next, text, at, requestId);
    if (requestId === undefined) continue;
    const file = fileFromToolLine(text);
    if (file === undefined) continue;
    const prior = next.childFiles[requestId] ?? [];
    const files = prior.filter((path) => path !== file);
    files.push(file);
    next = { ...next, childFiles: { ...next.childFiles, [requestId]: files } };
  }
  if (requestId !== undefined) {
    const childLive = { ...next.childLive };
    if (patch.live === null) delete childLive[requestId];
    else childLive[requestId] = patch.live;
    const childPlan =
      patch.plan === undefined
        ? next.childPlan
        : { ...next.childPlan, [requestId]: patch.plan };
    return { ...next, childLive, childPlan };
  }
  return { ...next, live: patch.live };
}


export function createStreamTranscript(): {
  apply: (event: RequestStreamEventWithId) => TranscriptPatch;
  flush: () => TranscriptPatch;
} {
  const itemTypes = new Map<string, string>();
  const items = new Map<string, OutputItem>();
  const streamed = new Set<string>();
  const logged = new Set<string>();
  const settled = new Set<string>();
  const planEntries: Array<{ key: string; mark: PlanItem["mark"]; text: string }> = [];
  let live: string | null = null;
  let liveKind: "status" | "message" | "tool" | null = null;

  const snapshot = (lines: string[]): TranscriptPatch => ({ lines, live });

  const commitLive = (): string[] => {
    if (live === null) return [];
    if (liveKind === "tool") {
      live = null;
      liveKind = null;
      return [];
    }
    const lines = [live];
    live = null;
    liveKind = null;
    return lines;
  };

  const holdToolLive = (item: OutputItem): void => {
    live = formatToolLine(item);
    liveKind = "tool";
  };

  const applyToolSettled = (item: OutputItem): TranscriptPatch => {
    const prior = commitLive();
    const failed = item.status === "failed" || item.status === "incomplete";
    if (settled.has(item.id) && !failed) return snapshot(prior);
    if (logged.has(item.id) && !failed) {
      settled.add(item.id);
      const plan = applyPlanTool(item, planEntries, "settled");
      const next = snapshot([...prior, ...formatToolResult(item)]);
      return plan === undefined ? next : { ...next, plan };
    }
    logged.add(item.id);
    settled.add(item.id);
    if (failed) {
      const plan = applyPlanTool(item, planEntries, "failed");
      const next = snapshot([
        ...prior,
        formatToolLine(item, item.status === "incomplete" ? "incomplete" : "failed"),
        ...formatToolResult(item),
      ]);
      return plan === undefined ? next : { ...next, plan };
    }
    const formatted = formatToolLines(item);
    const plan = applyPlanTool(item, planEntries, "settled") ?? formatted.plan;
    const next = snapshot([...prior, ...formatted.lines, ...formatToolResult(item)]);
    return plan === undefined ? next : { ...next, plan };
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
            if (liveKind === "tool") commitLive();
            live = line;
            liveKind = "status";
            return snapshot(prior);
          }
          if (item.type === "error" && item.message.length > 0) {
            return snapshot([...commitLive(), `error · ${item.message}`]);
          }
          if (item.type === "tool_output") {
            items.set(item.id, item);
            logged.add(item.id);
            const formatted = formatToolLines(item);
            const prior = commitLive();
            if (item.status === "in_progress") holdToolLive(item);
            else settled.add(item.id);
            const phase =
              item.status === "failed" || item.status === "incomplete"
                ? "failed"
                : item.status === "in_progress"
                  ? "open"
                  : "settled";
            const plan = applyPlanTool(item, planEntries, phase) ?? formatted.plan;
            const next = snapshot([...prior, ...formatted.lines]);
            return plan === undefined ? next : { ...next, plan };
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
        case "item.updated": {
          const itemId = updatedItemId(event);
          const patch = updatedPatch(event);
          if (itemId === undefined || patch === undefined) return snapshot([]);
          const existing = items.get(itemId);
          if (existing === undefined) return snapshot([]);
          const merged = { ...existing, ...patch } as OutputItem;
          items.set(itemId, merged);
          if (merged.type !== "tool_output") return snapshot([]);
          if (merged.status === "in_progress") return snapshot([]);
          return applyToolSettled(merged);
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
            items.set(item.id, item);
            return applyToolSettled(item);
          }
          if (item.type === "container") {
            const failed = item.status === "failed" || item.status === "incomplete";
            if (logged.has(item.id) && !failed) return snapshot([]);
            logged.add(item.id);
            return snapshot([
              ...commitLive(),
              formatContainerLine(
                item,
                failed ? (item.status === "incomplete" ? "incomplete" : "failed") : undefined,
              ),
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

function updatedItemId(event: RequestStreamEventWithId): string | undefined {
  if (event.type === "item.updated" && typeof event.itemId === "string" && event.itemId !== "") {
    return event.itemId;
  }
  const id = (event as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

function updatedPatch(event: RequestStreamEventWithId): Record<string, unknown> | undefined {
  const patch = (event as { patch?: unknown }).patch;
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return undefined;
  return patch as Record<string, unknown>;
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
  "subject",
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
      const text = value.trim().replace(/\s+/g, " ");
      // Paths stay whole so the file list and /find keep the filename.
      // The renderer elides the prefix when a line will not fit.
      if (key === "file_path" || key === "path") return text;
      return text.length <= 72 ? text : `${text.slice(0, 71)}…`;
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

/** Tool name plus a compact hunk or checklist when the call already carried them. */
function formatToolLines(item: OutputItem): { lines: string[]; plan?: PlanItem[] } {
  const args = item.type === "tool_output" ? parseToolArgs(item.toolCall?.arguments) : {};
  const plan = readPlan(args);
  return {
    lines: [formatToolLine(item), ...toolHunk(args), ...plan.lines],
    plan: plan.items,
  };
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

/**
 * Compact checklist from a plan tool. Presenter only — it does not invent
 * a second work record. No checklist in the call, no lines.
 */
function readPlan(args: Record<string, unknown>): { lines: string[]; items?: PlanItem[] } {
  const todos = args.todos;
  if (!Array.isArray(todos) || todos.length === 0) return { lines: [] };
  const items: PlanItem[] = [];
  const lines: string[] = [];
  for (const todo of todos) {
    if (todo === null || typeof todo !== "object" || Array.isArray(todo)) continue;
    const content = (todo as { content?: unknown }).content;
    if (typeof content !== "string" || content.trim() === "") continue;
    const status = (todo as { status?: unknown }).status;
    const mark: PlanItem["mark"] =
      status === "completed" ? "x" : status === "in_progress" ? "·" : " ";
    const body = content.trim().replace(/\s+/g, " ");
    const clipped = body.length <= HUNK_LINE ? body : `${body.slice(0, HUNK_LINE - 1)}…`;
    items.push({ mark, text: clipped });
    lines.push(`  [${mark}] ${clipped}`);
  }
  if (items.length === 0) return { lines: [] };
  if (lines.length <= HUNK_MAX) return { lines, items };
  return {
    lines: [...lines.slice(0, HUNK_MAX), `  … ${lines.length - HUNK_MAX} more`],
    items,
  };
}

type PlanEntry = { key: string; mark: PlanItem["mark"]; text: string };
type PlanPhase = "open" | "settled" | "failed";

function planSnapshot(entries: readonly PlanEntry[]): PlanItem[] | undefined {
  if (entries.length === 0) return undefined;
  return entries.map(({ mark, text }) => ({ mark, text }));
}

function clipPlanText(text: string): string {
  const body = text.trim().replace(/\s+/g, " ");
  return body.length <= HUNK_LINE ? body : `${body.slice(0, HUNK_LINE - 1)}…`;
}

function planMark(status: string | undefined): PlanItem["mark"] | undefined {
  if (status === "completed") return "x";
  if (status === "in_progress") return "·";
  if (status === "pending") return " ";
  return undefined;
}

function recoverTaskId(output: unknown): string | undefined {
  if (typeof output === "string") {
    const match = /task\s*#\s*([A-Za-z0-9_.-]+)/i.exec(output);
    return match?.[1];
  }
  if (output === null || typeof output !== "object" || Array.isArray(output)) return undefined;
  const task = (output as { task?: unknown }).task;
  if (task === null || typeof task !== "object" || Array.isArray(task)) return undefined;
  const id = (task as { id?: unknown }).id;
  if (typeof id === "string" && id !== "") return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return undefined;
}

/**
 * Pin the selected row's checklist from the coding run's own plan tools.
 * `TodoWrite` replaces the list. `TaskCreate` / `TaskUpdate` are per-item
 * — the Claude Agent SDK surface — so a create appends and an update
 * moves one row. A failed create is dropped.
 */
function applyPlanTool(
  item: OutputItem,
  entries: PlanEntry[],
  phase: PlanPhase,
): PlanItem[] | undefined {
  const name = toolName(item);
  const args = item.type === "tool_output" ? parseToolArgs(item.toolCall?.arguments) : {};
  if (name === "TodoWrite") {
    if (phase === "failed") return undefined;
    const parsed = readPlan(args);
    if (parsed.items === undefined) return undefined;
    entries.length = 0;
    for (const next of parsed.items) {
      entries.push({ key: `todo:${next.text}`, mark: next.mark, text: next.text });
    }
    return planSnapshot(entries);
  }
  if (name === "TaskCreate") {
    const callId =
      item.type === "tool_output" && item.toolCall?.callId !== undefined && item.toolCall.callId !== ""
        ? item.toolCall.callId
        : item.id;
    const subject = stringArg(args, ["subject", "description"]);
    if (phase === "failed") {
      const at = entries.findIndex((entry) => entry.key === callId);
      if (at >= 0) entries.splice(at, 1);
      return planSnapshot(entries) ?? [];
    }
    if (subject !== undefined) {
      const existing = entries.find((entry) => entry.key === callId);
      if (existing === undefined) entries.push({ key: callId, mark: " ", text: clipPlanText(subject) });
      else existing.text = clipPlanText(subject);
    }
    if (phase === "settled") {
      const id = recoverTaskId(item.type === "tool_output" ? item.output : undefined);
      if (id !== undefined) {
        const existing = entries.find((entry) => entry.key === callId);
        if (existing !== undefined) existing.key = id;
      }
    }
    return planSnapshot(entries);
  }
  if (name === "TaskUpdate") {
    if (phase !== "settled") return undefined;
    const taskId = stringArg(args, ["taskId"]);
    if (taskId === undefined) return undefined;
    const mark = planMark(stringArg(args, ["status"]));
    const subject = stringArg(args, ["subject"]);
    const existing = entries.find((entry) => entry.key === taskId);
    if (existing !== undefined) {
      if (mark !== undefined) existing.mark = mark;
      if (subject !== undefined) existing.text = clipPlanText(subject);
    } else {
      entries.push({
        key: taskId,
        mark: mark ?? " ",
        text: subject !== undefined ? clipPlanText(subject) : taskId,
      });
    }
    return planSnapshot(entries);
  }
  return undefined;
}

const COMMAND_OUT_OK = 6;
const COMMAND_OUT_FAIL = 12;

function toolName(item: OutputItem): string {
  return item.type === "tool_output" ? (item.toolCall?.name ?? item.blockName) : "";
}

function isCommandTool(item: OutputItem, args: Record<string, unknown>): boolean {
  if (toolName(item) === "Bash") return true;
  return typeof args.command === "string" && args.command.trim() !== "";
}

function isSearchTool(item: OutputItem): boolean {
  const name = toolName(item);
  return name === "Grep" || name === "Glob" || name === "LS";
}

function isReadTool(item: OutputItem): boolean {
  return toolName(item) === "Read";
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
    if (typeof record.content === "string") return record.content;
    if (typeof record.text === "string") return record.text;
  }
  const err = item.error?.message;
  return typeof err === "string" ? err : "";
}

function indentResultLines(text: string): string[] {
  return splitLines(text).map((line) => {
    const body = line.length <= HUNK_LINE ? line : `${line.slice(0, HUNK_LINE - 1)}…`;
    return `  ${body}`;
  });
}

function resultCap(item: OutputItem): number {
  return item.status === "failed" || item.status === "incomplete"
    ? COMMAND_OUT_FAIL
    : COMMAND_OUT_OK;
}

/** Last lines of a Bash / Grep / Glob result. Write and Edit stay silent here. */
function formatCommandOutput(item: OutputItem): string[] {
  if (item.type !== "tool_output") return [];
  const args = parseToolArgs(item.toolCall?.arguments);
  if (!isCommandTool(item, args) && !isSearchTool(item)) return [];
  const text = commandOutputText(item);
  if (text.trim() === "") return [];
  const lines = indentResultLines(text);
  const max = resultCap(item);
  if (lines.length <= max) return lines;
  return [`  … ${lines.length - max} above`, ...lines.slice(-max)];
}

/** First lines of a Read. The start of the file is the peek; the end is not. */
function formatReadPeek(item: OutputItem): string[] {
  if (item.type !== "tool_output" || !isReadTool(item)) return [];
  const text = commandOutputText(item);
  if (text.trim() === "") return [];
  const lines = indentResultLines(text);
  const max = resultCap(item);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `  … ${lines.length - max} more`];
}

/** Result lines for a settled tool — command tail, search tail, or Read peek. */
function formatToolResult(item: OutputItem): string[] {
  if (isReadTool(item)) return formatReadPeek(item);
  return formatCommandOutput(item);
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
