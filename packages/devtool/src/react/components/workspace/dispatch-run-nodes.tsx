/**
 * The dispatch runs a session started, as nodes in that session's own block
 * tree (FIX-1440).
 *
 * Reading one causal chain used to mean opening the run's session, reading it,
 * and coming back. These nodes put the run where it was triggered instead — one
 * row per run, naming a **separate session**, with the run's own block tree
 * pulled in beside it when the reader asks for it.
 *
 * ## Nothing loads until it is asked for, and that is a rule
 *
 * A node holds a session id and two labels, all of which the session listing
 * already returned. Its activity — every request the run has made and every
 * item those produced — is fetched on the first expand and not before.
 *
 * That default is load-bearing rather than tidy. A dispatcher draining fifty
 * rows leaves fifty runs here; loading them eagerly would pour fifty sessions'
 * items into one block tree and make the parent unreadable, which is the same
 * failure the flat session list existed to prevent, moved one surface over. Off
 * by default, the cost is paid by the reader who asked for it, one run at a
 * time.
 *
 * ## Expanding is not navigating
 *
 * The run opens **in place**. The workspace stays on the parent, the stream
 * stays connected, and nothing about the panel's session moves. Opening the run
 * as its own session is a separate, explicit affordance beside it — which is
 * the difference between showing a reader what happened and sending them
 * somewhere to find out.
 */
import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import type { ChildSessionSummary } from "@flow-state-dev/client";
import type { DevtoolItem } from "../../lib/item-types";
import { useDevTool } from "../../context/devtool-context";
import { describeReadError } from "../../lib/instance-ownership";
import { decodeDispatchRunEntry, dispatchRunOrigin } from "../../lib/dispatch-run-links";
import { shortSessionId } from "../../lib/utils";
import { TraceView } from "./trace-view";
import type { RequestGroup } from "./stream-view";
import { Button } from "../ui/button";

type Props = {
  /** The runs this session started, as the provenance listing returned them. */
  runs: readonly ChildSessionSummary[];
  /** Open one as its own session — the deliberate move, never the expand. */
  onOpen: (run: ChildSessionSummary) => void;
};

export function DispatchRunNodes({ runs, onOpen }: Props) {
  if (runs.length === 0) return null;

  return (
    <section data-dispatch-run-nodes className="border-t border-slate-800 p-2">
      <h3 className="px-1 pb-1 text-[10px] uppercase tracking-wide text-slate-500">
        Dispatched runs
      </h3>
      <ul className="flex flex-col gap-1">
        {runs.map((run) => (
          <li key={run.id}>
            <DispatchRunNode run={run} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One run: what it is, and — once asked — what it did.
 *
 * The collapsed row states the separateness rather than hiding it. A reader who
 * expands this is looking at another session's items inside this one, and a
 * view that let that pass for the parent's own work would be lying about where
 * the work ran.
 */
function DispatchRunNode({
  run,
  onOpen,
}: {
  run: ChildSessionSummary;
  onOpen: (run: ChildSessionSummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const activity = useDispatchRunActivity(run.id);
  const entry = decodeDispatchRunEntry(run.coordinate);

  const toggle = useCallback(() => {
    setExpanded((was) => {
      // The load rides the first expand and only the first: collapsing and
      // re-opening a run reads nothing, because the items are already held.
      if (!was) void activity.load();
      return !was;
    });
  }, [activity]);

  return (
    <div
      data-dispatch-run-node={run.id}
      data-expanded={expanded ? "true" : "false"}
      className="rounded border border-slate-800 bg-slate-900/40"
    >
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[11px] text-slate-300"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
          )}
          <span className="truncate">{entry?.action ?? shortSessionId(run.id)}</span>
          <span className="shrink-0 rounded bg-slate-800 px-1 text-[9px] uppercase tracking-wide text-slate-400">
            {dispatchRunOrigin(run.topic)}
          </span>
          <span className="shrink-0 text-[9px] text-slate-500">
            separate session · {shortSessionId(run.id)}
          </span>
          {activity.isLoading && (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-slate-500" aria-hidden />
          )}
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 shrink-0 p-0"
          title={`Open ${run.id} as its own session`}
          aria-label={`Open dispatch run ${run.id}`}
          onClick={() => onOpen(run)}
        >
          <ExternalLink className="h-3 w-3 text-slate-500" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-slate-800/70 pl-3">
          {activity.error !== null ? (
            <p role="alert" className="p-2 text-[10px] text-red-400">
              {activity.error}{" "}
              <button type="button" className="underline" onClick={() => void activity.load(true)}>
                Retry
              </button>
            </p>
          ) : activity.groups === undefined ? (
            <p className="p-2 text-[10px] text-slate-500">Loading this run&apos;s activity…</p>
          ) : activity.groups.length === 0 ? (
            <p className="p-2 text-[10px] text-slate-500">This run has not run anything yet.</p>
          ) : (
            <TraceView requestGroups={activity.groups} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One run's requests, with their items, fetched at most once.
 *
 * `load()` is idempotent on purpose — it is called from an expand, and an
 * operator opening and closing a node three times should cost one request, not
 * three. `load(true)` is the retry after a failure, which is the only case
 * where asking again can change the answer.
 *
 * Unfenced, and deliberately: a node is mounted only inside the session it
 * belongs to and unmounts with it, and it reads one immutable address — this
 * run's own id. There is no second read of the same data to race, and a
 * response that outlives the mount has nothing to write to.
 */
function useDispatchRunActivity(runId: string): {
  groups: RequestGroup[] | undefined;
  isLoading: boolean;
  error: string | null;
  load: (force?: boolean) => Promise<void>;
} {
  const { sessionClient } = useDevTool();
  const [groups, setGroups] = useState<RequestGroup[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      if (isLoading) return;
      if (groups !== undefined && !force) return;
      setIsLoading(true);
      setError(null);
      try {
        const requests = await sessionClient.listSessionRequests(runId, {
          includeItems: true,
        });
        setGroups(
          requests.map((request) => ({
            requestId: request.id,
            action: request.actionName,
            status: request.status,
            startedAt: request.startedAtMs ?? request.createdAt,
            duration:
              request.completedAtMs != null && request.startedAtMs != null
                ? request.completedAtMs - request.startedAtMs
                : undefined,
            items: (request.items ?? []) as DevtoolItem[],
            rawItems: (request.items ?? []) as DevtoolItem[],
          }))
        );
      } catch (err) {
        setError(describeReadError(err, "Failed to load this run's activity"));
      } finally {
        setIsLoading(false);
      }
    },
    [groups, isLoading, runId, sessionClient]
  );

  return { groups, isLoading, error, load };
}
