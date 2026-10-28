/**
 * The Actions strip of an open Tasks-tab row (FIX-1629).
 *
 * The DevTool changes a task only through the flow's own actions. This strip
 * lists the ones that act on one task (see `lib/task-actions`), opens the
 * picked one's form with the row's id fixed (in `id` or `taskId`, the field
 * the action names its task in), and dispatches it through
 * the panel's own action path, the one the action bar uses. There is no other
 * write here, and no record editor: what a row can do is what the flow exposes.
 *
 * The answer is read from what the engine recorded for the request the row
 * dispatched: its status and action result on the session's request list
 * (`outcomeOf`). A refusal is shown as a refusal, in the tool's own words.
 *
 * There is no client-side lock: a second submit while the first is in flight
 * is sent, and each gets its own answer, newest first. Two submits on one task
 * may race, and the server says which one lost.
 */
import { useRef, useState } from "react";
import type { ActionInputSchema } from "@flow-state-dev/client";
import { Button } from "../ui/button";
import { SchemaForm } from "./schema-form";
import { buildInputFromForm, getDefaults } from "./action-bar";
import {
  NO_RESULT_RECORDED,
  outcomeOf,
  taskIdField,
  type RequestOutcomeSource,
  type RowActionOutcome,
} from "../../lib/task-actions";

/**
 * What the panel dispatched: the request it started, or why it could not.
 * `undefined` when the dispatch was dropped (the workspace moved under it).
 */
export type RowDispatch = { requestId: string } | { error: string } | undefined;

/** Where to read how to give a flow task actions. */
export const TASK_ACTIONS_DOCS_URL =
  "https://flow-state.dev/docs/orchestration/task-board#changing-tasks-from-outside-a-run";

type Props = {
  taskId: string;
  /** The qualifying actions for this row's board, already filtered. */
  actions: readonly string[];
  schemas?: Record<string, ActionInputSchema>;
  run: (action: string, input: unknown) => Promise<RowDispatch>;
  requests: readonly RequestOutcomeSource[];
};

/** One submit from this row: in flight, or what its dispatch answered. */
type Submission = {
  key: number;
  action: string;
  sent: "sending" | { requestId: string } | { error: string };
};

export function TaskRowActions({ taskId, actions, schemas, run, requests }: Props) {
  const [pickedState, setPicked] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const nextKey = useRef(0);

  if (actions.length === 0) {
    return (
      <p className="mt-2 font-fs-mono text-[11px] text-fs-ink4">
        This flow has no actions that take a task id, so nothing here can change the task.{" "}
        <a
          className="text-fs-blue underline underline-offset-2 hover:text-fs-ink"
          href={TASK_ACTIONS_DOCS_URL}
          target="_blank"
          rel="noreferrer"
        >
          Exposing task actions
        </a>
      </p>
    );
  }

  // Only an action this row still offers counts as picked: one that has since
  // moved to another board must not keep a form up that would send this row's
  // id to that board's ledger.
  const picked = pickedState !== null && actions.includes(pickedState) ? pickedState : null;
  const schema = picked === null ? undefined : schemas?.[picked];
  // The field the picked action names its task in (`id` or `taskId`).
  const idField = (picked === null ? undefined : taskIdField(picked, schema, true)) ?? "taskId";
  const locked = { [idField]: taskId };

  const pick = (action: string) => {
    setPicked((was) => (was === action ? null : action));
    setValues(getDefaults(schemas?.[action]));
  };

  const submit = async () => {
    if (picked === null || schema === undefined) return;
    const action = picked;
    const input = { ...(buildInputFromForm(schema, values) as Record<string, unknown>), [idField]: taskId };
    const key = nextKey.current++;
    setSubmissions((prev) => [{ key, action, sent: "sending" }, ...prev]);
    let sent: Submission["sent"] | undefined;
    try {
      sent = await run(action, input);
    } catch (err) {
      sent = { error: err instanceof Error ? err.message : String(err) };
    }
    const settled = sent;
    setSubmissions((prev) =>
      settled === undefined
        ? prev.filter((submission) => submission.key !== key)
        : prev.map((submission) => (submission.key === key ? { ...submission, sent: settled } : submission))
    );
  };

  const outcomeOfSubmission = ({ sent }: Submission): RowActionOutcome =>
    sent === "sending"
      ? { state: "pending" }
      : "error" in sent
        ? { state: "failed", message: sent.error }
        : outcomeOf(requests, sent.requestId);

  return (
    <div className="mt-2 min-w-0 space-y-2" role="group" aria-label="Actions">
      <div className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">Actions</div>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            aria-pressed={picked === action}
            onClick={() => pick(action)}
            className={`max-w-full truncate border px-2 py-0.5 font-fs-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-fs-blue/40 ${
              picked === action
                ? "border-fs-ink bg-fs-ink text-fs-paper"
                : "border-fs-ink/30 text-fs-ink2 hover:border-fs-ink hover:text-fs-ink"
            }`}
          >
            {action}
          </button>
        ))}
      </div>
      {picked !== null && schema !== undefined && (
        <div className="min-w-0 border border-fs-ink/20 bg-fs-inspector p-2.5">
          <SchemaForm
            schema={schema}
            values={values}
            onChange={setValues}
            onSubmit={() => void submit()}
            locked={locked}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" className="h-7 px-3" onClick={() => void submit()}>
              Run
            </Button>
          </div>
        </div>
      )}
      {submissions.length > 0 && (
        <ul className="min-w-0 space-y-1">
          {submissions.map((submission) => (
            <li key={submission.key} data-submission={submission.action} className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-fs-mono text-[10.5px] text-fs-ink4">{submission.action}</span>
              <Outcome outcome={outcomeOfSubmission(submission)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Outcome({ outcome }: { outcome: RowActionOutcome }) {
  switch (outcome.state) {
    case "pending":
      return (
        <span data-outcome="pending" className="font-fs-mono text-[11px] text-fs-blue">
          Running…
        </span>
      );
    case "ok":
      return (
        <span data-outcome="ok" className="min-w-0 font-fs-mono text-[11px] text-fs-green [overflow-wrap:anywhere]">
          {outcome.output === undefined ? "Done." : `Done: ${describeOutput(outcome.output)}`}
        </span>
      );
    case "refused":
      return (
        <span data-outcome="refused" className="min-w-0 font-fs-mono text-[11px] text-fs-red [overflow-wrap:anywhere]">
          Refused: {outcome.message}
        </span>
      );
    case "failed":
      return (
        <span data-outcome="failed" className="min-w-0 font-fs-mono text-[11px] text-fs-red [overflow-wrap:anywhere]">
          Failed: {outcome.message}
        </span>
      );
    case "unknown":
      return (
        <span data-outcome="unknown" className="font-fs-mono text-[11px] text-fs-ink3">
          {outcome.reason === "not-reported"
            ? NO_RESULT_RECORDED
            : "Finished, but its return value couldn't be recorded."}
        </span>
      );
  }
}

/** An action's return value as one line of text. */
function describeOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output) ?? String(output);
  } catch {
    return String(output);
  }
}
