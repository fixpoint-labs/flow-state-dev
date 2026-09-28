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
import { buildItemLookup, type ItemLookup } from "@flow-state-dev/core/items";
import type { BlockValueInternal } from "@flow-state-dev/core/items/internal";
import { resolveBlockValueInternal } from "@flow-state-dev/core/items/internal";

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
 * A task tool (`<tool>_<suffix>`) is this board's only when its suffix IS this
 * board's, compared whole: `cancelTask_feature_work` also ends with `_work`,
 * and is not the `work` board's. Any other action is generic unless its name
 * ends with a listed board's suffix; then it belongs to the board whose suffix
 * is the longest match.
 *
 * @param actions The flow's public action names.
 * @param schemas Their input schemas, as the flow list reports them.
 * @param collectionId The board the row is on.
 * @param boardIds Every board the tab lists for this flow, so an app action
 *   suffixed for another board is told apart from a generic one.
 */
export function taskActionsFor(
  actions: readonly string[],
  schemas: Record<string, ActionInputSchema> | undefined,
  collectionId: string,
  boardIds: readonly string[]
): string[] {
  const own = taskToolSuffix(collectionId);
  const suffixes = [...new Set([collectionId, ...boardIds].map(taskToolSuffix))];
  return actions.filter((name) => {
    if (!takesTaskId(schemas?.[name])) return false;
    // A task tool names its board whole, listed or not (a board with no tasks
    // yet is not listed, and its tools are still never generic).
    const tool = TASK_TOOLS.find((candidate) => name.startsWith(`${candidate}_`));
    if (tool !== undefined) return name.slice(tool.length + 1) === own;
    const owner = suffixes
      .filter((suffix) => name.endsWith(`_${suffix}`))
      .reduce<string | undefined>((best, suffix) => (best === undefined || suffix.length > best.length ? suffix : best), undefined);
    return owner === undefined || owner === own;
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
 * - `refused` — the root block returned `{ ok: false }` (a guarded verb said
 *   no) or a declined task write (`{ outcome: "declined" }`), and wrote
 *   nothing.
 * - `failed` — the request failed, or the dispatch itself threw.
 * - `unknown` — the result cannot be told: the request finished with no root
 *   trace to read (`no-trace`, trace observability off), or part of the root's
 *   output is a reference whose target was not retained (`not-retained`).
 *   Never read as success: a refusal can hide in either.
 */
export type RowActionOutcome =
  | { state: "pending" }
  | { state: "ok"; output: unknown }
  | { state: "refused"; message: string }
  | { state: "failed"; message: string }
  | { state: "unknown"; reason: "no-trace" | "not-retained" };

type TraceLike = {
  type?: string;
  status?: string;
  provenance?: { parentBlockInstanceId?: string };
  output?: BlockValueInternal<unknown>;
  error?: { message?: string };
};

/**
 * Read a dispatched request's outcome off its root `block_trace`.
 *
 * The dispatch response carries a request id and no output, and a refused
 * verb emits no change item, so the root trace is the one place the tool's
 * `{ ok, error }` can be read. An output held by reference (a `ref` to a
 * step's trace, or a `structure` of them) is resolved against the request's
 * own items first. If any reference in it, at any depth, has no target, the
 * resolved value has a hole where the refusal may have been, so it reads as
 * `unknown` rather than being classified.
 */
export function outcomeOf(
  requests: readonly RequestOutcomeSource[],
  requestId: string
): RowActionOutcome {
  const request = requests.find((candidate) => candidate.requestId === requestId);
  if (request === undefined) return { state: "pending" };
  // The last root trace: the raw log keeps the root's `in_progress` entry
  // ahead of the one that carries its result.
  const root = [...(request.rawItems ?? [])].reverse().find((item): item is TraceLike => {
    const trace = item as TraceLike;
    return trace.type === "block_trace" && trace.provenance?.parentBlockInstanceId === undefined;
  });

  if (root?.status === "failed") {
    return { state: "failed", message: root.error?.message ?? "The action failed." };
  }
  if (root?.status === "completed") {
    const lookup = buildItemLookup((request.rawItems ?? []) as readonly { id: string; type: string }[]);
    if (root.output !== undefined && hasUnresolvedRef(root.output, lookup, 0)) {
      return { state: "unknown", reason: "not-retained" };
    }
    const value = resolveBlockValueInternal(root.output, lookup);
    if (isRefusal(value)) return { state: "refused", message: refusalMessage(value.error) };
    if (isDeclined(value)) return { state: "refused", message: declinedMessage(value) };
    return { state: "ok", output: value };
  }
  if (request.status === "completed") return { state: "unknown", reason: "no-trace" };
  if (request.status === "in_progress" || request.status === "suspended") return { state: "pending" };
  // failed, aborted, interrupted, incomplete: it ended without a result.
  return { state: "failed", message: `The request ended ${request.status}.` };
}

/**
 * Does any `ref` in `value`, at any depth, fail to reach content? Walks the
 * same hops `resolveBlockValueInternal` takes, which resolves a miss to
 * `undefined` in place and so cannot say one happened.
 */
function hasUnresolvedRef(value: BlockValueInternal<unknown>, lookup: ItemLookup, refHops: number): boolean {
  if (value.kind === "inline") return false;
  if (value.kind === "ref") {
    if (refHops > 1) return true;
    const target = lookup(value.sourceItemId);
    if (target?.type === "message") return false;
    if (target?.type !== "block_trace") return true;
    const output = (target as { output?: BlockValueInternal<unknown> }).output;
    return output === undefined || hasUnresolvedRef(output, lookup, refHops + 1);
  }
  const entries = value.shape.container === "array" ? value.shape.entries : Object.values(value.shape.entries);
  return entries.some((entry) => hasUnresolvedRef(entry, lookup, 0));
}

/** `{ ok: false }` is a refusal whatever its `error` holds, or without one. */
function isRefusal(value: unknown): value is { ok: false; error?: unknown } {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}

function refusalMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  if (error === undefined || error === null || error === "") return "The action refused, without a reason.";
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * A task write the ledger declined (`TaskWriteOutcome`'s `declined` arm), as an
 * app action that returns the write's outcome (an `answer`) reports it. It
 * wrote nothing, so it reads as a refusal, with or without its reason.
 */
function isDeclined(value: unknown): value is { outcome: "declined"; reason?: unknown; status?: unknown } {
  return typeof value === "object" && value !== null && (value as { outcome?: unknown }).outcome === "declined";
}

function declinedMessage(value: { reason?: unknown; status?: unknown }): string {
  const reason = typeof value.reason === "string" ? ` (${value.reason})` : "";
  const status = typeof value.status === "string" ? `the task is ${value.status}` : "the write did not land";
  return `Declined${reason}: ${status}.`;
}
