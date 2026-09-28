/**
 * Which of the viewed flow's actions a Tasks-tab row offers (FIX-1629).
 *
 * The DevTool changes a task only through the flow's own actions, so a row
 * offers exactly what the flow exposes. The signal is the input: an action
 * whose input requires a string `taskId` acts on one task. That covers the
 * framework's task tools and an app's own actions (an `answer` for a parked
 * row) alike.
 *
 * A board's task tools carry the board in their name, `<tool>_<suffix>`, and
 * are offered only on that board's rows. The suffix rule mirrors
 * `taskToolSuffix` in `@flow-state-dev/orchestration` rather than importing it:
 * the DevTool depends on client, core and react only, as it mirrors the other
 * wire shapes it reads (see `task-collection-state`).
 */
import type { ActionInputSchema } from "@flow-state-dev/client";

/**
 * A board's qualifier in an action name: every character outside
 * `[a-zA-Z0-9_-]` becomes `_`. Mirrors orchestration's `taskToolSuffix`.
 */
export function taskToolSuffix(collectionId: string): string {
  return collectionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** The eight task tools, whose suffixed names always belong to one board. */
const TASK_TOOLS = [
  "addTask",
  "assignTask",
  "completeTask",
  "failTask",
  "blockTask",
  "cancelTask",
  "updateTask",
  "listTasks",
];

function takesTaskId(schema: ActionInputSchema | undefined): boolean {
  if (schema === undefined || schema.type !== "object") return false;
  const field = schema.fields.taskId;
  return field !== undefined && field.type === "string" && field.required;
}

/**
 * The actions a row on `collectionId` offers, in the flow's order.
 *
 * @param actions The flow's public action names.
 * @param schemas Their input schemas, as the flow list reports them.
 * @param collectionId The board the row is on.
 * @param boardIds Every board the tab lists for this flow. An action whose
 *   name ends with another listed board's suffix is that board's, so it is
 *   told apart from a generic one.
 */
export function taskActionsFor(
  actions: readonly string[],
  schemas: Record<string, ActionInputSchema> | undefined,
  collectionId: string,
  boardIds: readonly string[]
): string[] {
  const own = `_${taskToolSuffix(collectionId)}`;
  const others = boardIds.filter((id) => id !== collectionId).map((id) => `_${taskToolSuffix(id)}`);
  return actions.filter((name) => {
    if (!takesTaskId(schemas?.[name])) return false;
    if (name.endsWith(own)) return true;
    if (others.some((suffix) => name.endsWith(suffix))) return false;
    // A task tool for a board the tab does not list (one with no tasks yet)
    // is still that board's, never a generic action.
    if (TASK_TOOLS.some((tool) => name.startsWith(`${tool}_`))) return false;
    return true;
  });
}

/** One request as the panel's request groups carry it: enough to read its outcome. */
export type RequestOutcomeSource = {
  requestId: string;
  status: string;
  /** The request's raw item log, traces included. */
  rawItems?: readonly unknown[];
};

/**
 * What a row action came to, read from the request it dispatched.
 *
 * - `pending` — the request has not finished (or has not been listed yet).
 * - `ok` — the root block returned something other than a refusal.
 * - `refused` — the root block returned `{ ok: false, error }`: a guarded verb
 *   said no, and wrote nothing.
 * - `failed` — the request failed, or the dispatch itself threw.
 * - `unknown` — the request finished with no root trace to read (trace
 *   observability off), so the result cannot be told.
 */
export type RowActionOutcome =
  | { state: "pending" }
  | { state: "ok"; output: unknown }
  | { state: "refused"; message: string }
  | { state: "failed"; message: string }
  | { state: "unknown" };

type TraceLike = {
  type?: string;
  status?: string;
  provenance?: { parentBlockInstanceId?: string };
  output?: { kind?: string; value?: unknown };
  error?: { message?: string };
};

/**
 * Read a dispatched request's outcome off its root `block_trace`.
 *
 * The dispatch response carries a request id and no output, and a refused
 * verb emits no change item, so the root trace is the one place the tool's
 * `{ ok, error }` can be read. Only an inline output is read: a task tool's
 * result is a plain value, never a ref.
 */
export function outcomeOf(
  requests: readonly RequestOutcomeSource[],
  requestId: string
): RowActionOutcome {
  const request = requests.find((candidate) => candidate.requestId === requestId);
  if (request === undefined) return { state: "pending" };
  const root = (request.rawItems ?? []).find((item): item is TraceLike => {
    const trace = item as TraceLike;
    return trace.type === "block_trace" && trace.provenance?.parentBlockInstanceId === undefined;
  });

  if (root?.status === "failed") {
    return { state: "failed", message: root.error?.message ?? "The action failed." };
  }
  if (root?.status === "completed") {
    const value = root.output?.kind === "inline" ? root.output.value : undefined;
    if (isRefusal(value)) return { state: "refused", message: value.error };
    return { state: "ok", output: value };
  }
  if (request.status === "completed") return { state: "unknown" };
  if (request.status === "in_progress" || request.status === "suspended") return { state: "pending" };
  // failed, aborted, interrupted, incomplete: it ended without a result.
  return { state: "failed", message: `The request ended ${request.status}.` };
}

function isRefusal(value: unknown): value is { ok: false; error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === "string"
  );
}
