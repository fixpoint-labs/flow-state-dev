/**
 * The Actions strip of an open Tasks-tab row (FIX-1629).
 *
 * The DevTool changes a task only through the flow's own actions. This strip
 * lists the ones that act on one task (see `lib/task-actions`), opens the
 * picked one's form with the row's `taskId` fixed, and dispatches it through
 * the panel's own action path, the one the action bar uses. There is no other
 * write here, and no record editor: what a row can do is what the flow exposes.
 *
 * The answer is read from the request the row dispatched, on its root trace
 * (`outcomeOf`). A refusal is shown as a refusal, in the tool's own words.
 */
import { useState } from "react";
import type { ActionInputSchema } from "@flow-state-dev/client";
import { Button } from "../ui/button";
import { SchemaForm } from "./schema-form";
import { buildInputFromForm, getDefaults } from "./action-bar";
import {
  outcomeOf,
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

type Sent =
  | { action: string; requestId: string }
  | { action: string; error: string };

export function TaskRowActions({ taskId, actions, schemas, run, requests }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

  if (actions.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-slate-500">
        This flow has no actions that take a taskId, so nothing here can change the task.{" "}
        <a
          className="text-sky-400 underline hover:text-sky-300"
          href={TASK_ACTIONS_DOCS_URL}
          target="_blank"
          rel="noreferrer"
        >
          Exposing task actions
        </a>
      </p>
    );
  }

  const schema = picked === null ? undefined : schemas?.[picked];
  const locked = { taskId };

  const pick = (action: string) => {
    setPicked((was) => (was === action ? null : action));
    setValues(getDefaults(schemas?.[action]));
    setSent(null);
  };

  const submit = async () => {
    if (picked === null || schema === undefined || sending) return;
    const input = { ...(buildInputFromForm(schema, values) as Record<string, unknown>), taskId };
    // The previous run's answer is not this one's: clear it before sending.
    setSent(null);
    setSending(true);
    try {
      const dispatched = await run(picked, input);
      if (dispatched === undefined) return;
      setSent(
        "requestId" in dispatched
          ? { action: picked, requestId: dispatched.requestId }
          : { action: picked, error: dispatched.error }
      );
    } catch (err) {
      setSent({ action: picked, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSending(false);
    }
  };

  const outcome: RowActionOutcome | null = sending
    ? { state: "pending" }
    : sent === null
      ? null
      : "error" in sent
        ? { state: "failed", message: sent.error }
        : outcomeOf(requests, sent.requestId);

  return (
    <div className="mt-2 min-w-0 space-y-2" role="group" aria-label="Actions">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">Actions</div>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            aria-pressed={picked === action}
            onClick={() => pick(action)}
            className={`max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              picked === action
                ? "border-sky-600 bg-sky-900/40 text-sky-200"
                : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700"
            }`}
          >
            {action}
          </button>
        ))}
      </div>
      {picked !== null && schema !== undefined && (
        <div className="min-w-0 rounded border border-slate-800 p-2">
          <SchemaForm
            schema={schema}
            values={values}
            onChange={setValues}
            onSubmit={() => void submit()}
            disabled={sending}
            locked={locked}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs"
              onClick={() => void submit()}
              disabled={sending}
            >
              Run
            </Button>
            {outcome !== null && (sending || sent?.action === picked) && <Outcome outcome={outcome} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Outcome({ outcome }: { outcome: RowActionOutcome }) {
  switch (outcome.state) {
    case "pending":
      return (
        <span data-outcome="pending" className="text-[11px] text-slate-400">
          Running…
        </span>
      );
    case "ok":
      return (
        <span data-outcome="ok" className="text-[11px] text-emerald-300">
          Done. The row updates when the task changes.
        </span>
      );
    case "refused":
      return (
        <span data-outcome="refused" className="min-w-0 text-[11px] text-amber-300 [overflow-wrap:anywhere]">
          Refused: {outcome.message}
        </span>
      );
    case "failed":
      return (
        <span data-outcome="failed" className="min-w-0 text-[11px] text-red-300 [overflow-wrap:anywhere]">
          Failed: {outcome.message}
        </span>
      );
    case "unknown":
      return (
        <span data-outcome="unknown" className="text-[11px] text-slate-400">
          Sent. The outcome isn't visible: this request left no trace (trace observability is off).
        </span>
      );
  }
}
