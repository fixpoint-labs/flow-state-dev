// FIX-2774.
/**
 * A conversation board's task, as a browser reads it: the one mapper from a
 * stored ledger entry to the fields a screen shows. The inbox view answers its
 * tasks through it, and Shift Manager's snapshot read delegates to it, so the
 * two never read an entry differently (the title falling back to the goal,
 * what counts as a hold, a run link with all three values or none).
 *
 * Browser-safe: it imports no server module, so `@flow-state-dev/workforce/browser`
 * exports it.
 */
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { taskHoldSchema, taskView, type TaskHold, type TaskViewInput } from "@flow-state-dev/orchestration/inbox";
import { taskSpendViewSchema, type TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";

const runLinkSchema = z.object({ sessionId: z.string(), requestId: z.string(), attempt: z.number() });

/** The fields of one board task a browser reads, with its board and the conversation that holds it. */
export const boardTaskSchema = z.object({
  /** The board's ref: `<sessionId>.tasks`, the conversation that holds it and the collection. */
  boardRef: z.string(),
  /** The conversation that holds the board. */
  ownerSessionId: z.string(),
  id: z.string(),
  /** Never absent: a task filed with none reads its goal here. */
  title: z.string(),
  goal: z.string().nullable(),
  context: z.string().nullable(),
  attachments: z.array(z.custom<FileContent>((value) => typeof value === "object" && value !== null)),
  status: z.string(),
  assignee: z.string().nullable(),
  priority: z.string().nullable(),
  labels: z.array(z.string()),
  deps: z.array(z.string()),
  /** The run the board linked to the task, or `null`. */
  run: runLinkSchema.nullable(),
  error: z.string().nullable(),
  holds: z.array(z.custom<TaskHold>((value) => typeof value === "object" && value !== null)),
  steers: z.array(z.object({ id: z.string(), answers: z.string().optional() })),
  spend: taskSpendViewSchema.nullable(),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable()
});

/** One board task, as {@link boardTaskOf} reads it. */
export type BoardTask = z.infer<typeof boardTaskSchema>;

/**
 * Whether a task is finished: completed or cancelled. An errored task is not;
 * it still needs someone. Shift Manager's DONE column is the same set.
 */
export function isFinished(status: string): boolean {
  return status === "completed" || status === "cancelled";
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const time = (value: unknown): number | null => (typeof value === "number" ? value : null);
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

// BP-030.
/** A task's run link: all three values, or none, so one stored before the link existed is no run. */
function runLinkOf(value: unknown): z.infer<typeof runLinkSchema> | null {
  const parsed = runLinkSchema.safeParse(value);
  return parsed.success ? { sessionId: parsed.data.sessionId, requestId: parsed.data.requestId, attempt: parsed.data.attempt } : null;
}

/** A task's holds, each read against the hold's own shape: one that doesn't parse is none. */
function holdsOf(value: unknown): TaskHold[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((hold) => {
    const parsed = taskHoldSchema.safeParse(hold);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A task's steers as the Inbox reads them: each one's id, and the question it answers. */
function steersOf(value: unknown): Array<{ id: string; answers?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((steer) => {
    const id = text(field(steer, "id"));
    const answers = text(field(steer, "answers"));
    return id === null ? [] : [{ id, ...(answers !== null ? { answers } : {}) }];
  });
}

/** A task's brief files: each a file part whose `data` is a stored file's reference. */
function filesOf(value: unknown): FileContent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): FileContent[] => {
    const file = entry as Partial<FileContent> | null;
    if (file?.type !== "file" || typeof file.mediaType !== "string" || typeof file.data !== "string") return [];
    if (parseBlobRef(file.data) === undefined) return [];
    return [{ type: "file", mediaType: file.mediaType, data: file.data, ...(typeof file.filename === "string" ? { filename: file.filename } : {}) }];
  });
}

/** A task's spend, folded by orchestration's task view; `null` when it has none. */
function spendOf(boardRef: string, data: unknown): TaskSpendView | null {
  const spend = field(data, "spend") as TaskViewInput["spend"];
  if (spend == null) return null;
  return taskView({ board: boardRef, id: text(field(data, "id")) ?? "", status: text(field(data, "status")) ?? "pending", spend }).spend;
}

/**
 * A stored task on board `boardRef`, held by conversation `ownerSessionId`.
 * `fallbackId` names it when the stored entry has no id (its key in the ledger).
 */
export function boardTaskOf(boardRef: string, ownerSessionId: string, fallbackId: string, stored: unknown): BoardTask {
  return {
    boardRef,
    ownerSessionId,
    id: text(field(stored, "id")) ?? fallbackId,
    title: text(field(stored, "title")) ?? text(field(stored, "goal")) ?? fallbackId,
    goal: text(field(stored, "goal")),
    context: text(field(stored, "context")),
    attachments: filesOf(field(stored, "attachments")),
    status: text(field(stored, "status")) ?? "pending",
    assignee: text(field(stored, "assignee")),
    priority: field(stored, "priority") == null ? null : String(field(stored, "priority")),
    labels: strings(field(stored, "labels")),
    deps: strings(field(stored, "deps")),
    run: runLinkOf(field(stored, "run")),
    error: field(stored, "error") == null ? null : String(field(stored, "error")),
    holds: holdsOf(field(stored, "holds")),
    steers: steersOf(field(stored, "steers")),
    spend: spendOf(boardRef, stored),
    createdAt: time(field(stored, "createdAt")),
    updatedAt: time(field(stored, "updatedAt")),
    startedAt: time(field(stored, "startedAt")),
    completedAt: time(field(stored, "completedAt"))
  };
}
