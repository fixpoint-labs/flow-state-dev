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
 * are offered only on that board's rows; so is any action whose name ends with
 * a listed board's suffix. The suffix rule mirrors
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

function takesTaskId(schema: ActionInputSchema | undefined): boolean {
  if (schema === undefined || schema.type !== "object") return false;
  const field = schema.fields.taskId;
  return field !== undefined && field.type === "string" && field.required;
}

/** The eight task tools `taskToolActions` generates for a board, always together. */
const TASK_TOOLS = [
  "addTask",
  "assignTask",
  "completeTask",
  "failTask",
  "blockTask",
  "cancelTask",
  "updateTask",
  "listTasks",
] as const;

/**
 * The board suffixes the flow's own action list names: every `<suffix>` for
 * which all eight `<tool>_<suffix>` are actions. `taskToolActions` generates
 * the eight together, so a whole family is a board's tools even when this
 * session has no rows on that board (a sibling Workforce channel sharing the
 * flow kind, or a board with no tasks yet). An app's own `cancelTask_now`
 * comes with no family, so it names no board.
 */
function generatedSuffixes(actions: readonly string[]): string[] {
  const names = new Set(actions);
  const prefix = `${TASK_TOOLS[0]}_`;
  return actions
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .filter((suffix) => TASK_TOOLS.every((tool) => names.has(`${tool}_${suffix}`)));
}

/**
 * The actions a row on `collectionId` offers, in the flow's order (BR-9,
 * BR-10).
 *
 * The boards an action can belong to are the ones the tab lists, plus every
 * board the flow's generated task tools name (see `generatedSuffixes`). An
 * action whose name ends with `_<suffix>` of one of them belongs to that board
 * alone; when several match (`cancelTask_feature_work` ends with `_work` too),
 * the longest wins. One whose name ends with no known board's suffix is
 * generic and offered on every board, whatever its name starts with: an app
 * may name its own action `cancelTask_now`.
 *
 * @param actions The flow's public action names.
 * @param schemas Their input schemas, as the flow list reports them.
 * @param collectionId The board the row is on.
 * @param boardIds Every board the tab lists for this flow, so an action
 *   suffixed for another board is told apart from a generic one.
 */
export function taskActionsFor(
  actions: readonly string[],
  schemas: Record<string, ActionInputSchema> | undefined,
  collectionId: string,
  boardIds: readonly string[]
): string[] {
  const own = taskToolSuffix(collectionId);
  const suffixes = [...new Set([...[collectionId, ...boardIds].map(taskToolSuffix), ...generatedSuffixes(actions)])];
  return actions.filter((name) => {
    if (!takesTaskId(schemas?.[name])) return false;
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
  id?: string;
  type?: string;
  status?: string;
  provenance?: { parentBlockInstanceId?: string };
  input?: { source?: BlockValueInternal<unknown> };
  output?: BlockValueInternal<unknown>;
  error?: { message?: string };
};

/**
 * Read a dispatched request's outcome off the action's own root `block_trace`.
 *
 * The dispatch response carries a request id and no output, and a refused
 * verb emits no change item, so the action's root trace is the one place the
 * tool's `{ ok, error }` can be read.
 *
 * It is not simply the last root trace. `runAction` runs the flow's and the
 * action's lifecycle hooks (`onStarted`, `onCompleted`, `onErrored`,
 * `onFinished`) as root blocks of the same request, before and after the
 * action, all under the same block instance id. Each hook receives
 * `{ requestId, actionName }` for this request, which the action's own input
 * cannot carry (the id is minted when the request starts), so a root whose
 * input is that is a hook. The action's trace is the last root that is not.
 * The raw log keeps several entries per trace (`in_progress`, then the one
 * with the result), so entries are merged by item id before they are read.
 *
 * An output held by reference (a `ref` to a step's trace, or a `structure` of
 * them) is resolved against the request's own items first. If any reference
 * in it, at any depth, has no target, the resolved value has a hole where the
 * refusal may have been, so it reads as `unknown` rather than being
 * classified. The request's own status is read before the action's answer:
 * while it runs, a hook can still fail it, so the answer waits; a request that
 * ended in anything but `completed` reads as failed, carrying the action's
 * refusal when it had one.
 */
export function outcomeOf(
  requests: readonly RequestOutcomeSource[],
  requestId: string
): RowActionOutcome {
  const request = requests.find((candidate) => candidate.requestId === requestId);
  if (request === undefined) return { state: "pending" };
  const lookup = buildItemLookup((request.rawItems ?? []) as readonly { id: string; type: string }[]);
  const roots = mergedRootTraces(request.rawItems ?? []);
  const isHook = (trace: TraceLike) => isHookInput(resolveInput(trace, lookup), requestId);
  const root = [...roots].reverse().find((trace) => !isHook(trace));

  // Order matters. A failed action is failed whatever happens after it. Then
  // the request's own verdict: until it ends, a hook can still fail it, so a
  // completed action is not yet an answer; once it has ended in anything but
  // `completed`, it failed (BR-15), even if the action itself answered.
  if (root?.status === "failed") {
    return { state: "failed", message: root.error?.message ?? "The action failed." };
  }
  if (request.status === "in_progress" || request.status === "suspended") return { state: "pending" };
  if (request.status !== "completed") {
    const failedHook = [...roots].reverse().find((trace) => trace.status === "failed");
    const message = failedHook?.error?.message ?? `The request ended ${request.status}.`;
    const answer = root?.status === "completed" ? classifyAnswer(root, lookup) : undefined;
    return {
      state: "failed",
      message: answer?.state === "refused" ? `${message} (the action itself refused: ${answer.message})` : message,
    };
  }
  if (root?.status !== "completed") return { state: "unknown", reason: "no-trace" };
  return classifyAnswer(root, lookup);
}

/** What a completed action root answered: a refusal, success, or a hole where the answer was. */
function classifyAnswer(root: TraceLike, lookup: ItemLookup): RowActionOutcome {
  if (root.output !== undefined && hasUnresolvedRef(root.output, lookup, 0)) {
    return { state: "unknown", reason: "not-retained" };
  }
  const value = resolveBlockValueInternal(root.output, lookup);
  if (isRefusal(value)) return { state: "refused", message: refusalMessage(value.error) };
  if (isDeclined(value)) return { state: "refused", message: declinedMessage(value) };
  return { state: "ok", output: value };
}

/** Every root `block_trace`, one per item id with its entries merged in log order. */
function mergedRootTraces(rawItems: readonly unknown[]): TraceLike[] {
  const byId = new Map<string | number, TraceLike>();
  rawItems.forEach((item, index) => {
    const trace = item as TraceLike;
    if (trace.type !== "block_trace") return;
    const key = trace.id ?? index;
    byId.set(key, { ...byId.get(key), ...trace });
  });
  return [...byId.values()].filter((trace) => trace.provenance?.parentBlockInstanceId === undefined);
}

function resolveInput(trace: TraceLike, lookup: ItemLookup): unknown {
  const source = trace.input?.source;
  return source === undefined ? undefined : resolveBlockValueInternal(source, lookup);
}

/** A request lifecycle hook's input: `{ requestId, actionName, … }` for this request. */
function isHookInput(input: unknown, requestId: string): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as { requestId?: unknown }).requestId === requestId &&
    typeof (input as { actionName?: unknown }).actionName === "string"
  );
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
