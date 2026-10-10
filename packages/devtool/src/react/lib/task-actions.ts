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
import type { ActionInputSchema, SessionRequestResult } from "@flow-state-dev/client";
import { isRequestOpen } from "./request-status";

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

/**
 * Eight of the task tools `taskToolActions` generates for a board, always
 * together. It also generates `answerTask`; these eight are enough to find a
 * board's family.
 */
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
 * which all eight `<tool>_<suffix>` above are actions. `taskToolActions` generates
 * them together, so a whole family is a board's tools even when this
 * session has no rows on that board (a sibling Workforce mailbox sharing the
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

/**
 * One request as the session's request list reports it: its status and the
 * action result the engine recorded for it.
 */
export type RequestOutcomeSource = {
  requestId: string;
  status: string;
  /**
   * The stored action result. Absent (or `null`) while the request runs or is
   * suspended, on an aborted or interrupted one, and on a finished request no
   * result was recorded for (an older server, or history from before an
   * upgrade).
   */
  result?: SessionRequestResult | null;
};

/**
 * What a row action came to, read from the request it dispatched.
 *
 * - `pending` — the request has not finished (or has not been listed yet).
 * - `ok` — the action returned something other than a refusal.
 * - `refused` — the action returned `{ ok: false }` (a guarded verb said no)
 *   or a declined task write (`{ outcome: "declined" }`), and wrote nothing.
 * - `failed` — the request ended in anything but `completed`, or the dispatch
 *   itself threw.
 * - `unknown` — the request completed, but no result was recorded for it
 *   (`not-reported`), or its return value could not be stored
 *   (`output-not-recorded`). Never read as success: a refusal can hide in
 *   either.
 */
export type RowActionOutcome =
  | { state: "pending" }
  | { state: "ok"; output: unknown }
  | { state: "refused"; message: string }
  | { state: "failed"; message: string }
  | { state: "unknown"; reason: "not-reported" | "output-not-recorded" };

/** What the row says for a finished request no result was recorded for. */
export const NO_RESULT_RECORDED = "No result recorded for this request.";

/**
 * Read a dispatched request's outcome off its entry in the session's request
 * list: the status the engine wrote, and the action result it wrote in the
 * same write.
 *
 * The status decides first. Until the request ends, a completion hook can
 * still fail it, so an answer is not read yet. A request that ended in
 * anything but `completed` reads as failed, with the recorded error, and names
 * the action's refusal when it had one. Only a completed request's output is
 * classified, and a completed request with no recorded result is never
 * guessed at.
 */
export function outcomeOf(
  requests: readonly RequestOutcomeSource[],
  requestId: string
): RowActionOutcome {
  const request = requests.find((candidate) => candidate.requestId === requestId);
  if (request === undefined || isRequestOpen(request.status)) return { state: "pending" };
  const result = request.result ?? undefined;
  if (request.status !== "completed") {
    const ended = `The request ended ${request.status}.`;
    // Aborted and interrupted requests carry no result by design.
    const expectsResult = request.status === "failed" || request.status === "incomplete";
    const message =
      result?.error?.message ?? (result === undefined && expectsResult ? `${ended} ${NO_RESULT_RECORDED}` : ended);
    const answer = result !== undefined && "output" in result ? classify(result.output) : undefined;
    return {
      state: "failed",
      message: answer?.state === "refused" ? `${message} (the action itself refused: ${answer.message})` : message,
    };
  }
  if (result === undefined) return { state: "unknown", reason: "not-reported" };
  if (result.outputNotRecorded === true) return { state: "unknown", reason: "output-not-recorded" };
  return classify(result.output);
}

/** What a completed action answered: a refusal, or success. */
function classify(value: unknown): RowActionOutcome {
  if (isRefusal(value)) return { state: "refused", message: refusalMessage(value.error) };
  if (isDeclined(value)) return { state: "refused", message: declinedMessage(value) };
  return { state: "ok", output: value };
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
