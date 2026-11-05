"use client";

/**
 * The right-hand panel: the user's workers.
 *
 * The workers are the user's roster: the coordinator and the specialists the
 * app's files declare, which everyone has, and any worker the user hired or
 * forked, each with the flow it runs on. "Talk" opens the user's
 * conversation with that worker, or starts one, through Workforce's client.
 * Opening one may create a session, so every "Talk" is held until it settles:
 * a slow create can't be clicked into two.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useSubmit } from "@flow-state-dev/react";
import type { RosterEntry, WorkforceClient } from "@flow-state-dev/workforce/browser";

export interface TeamPanelProps {
  /** The user's workforce client. Pass a stable one: the roster is read again only when it changes. */
  workforce: WorkforceClient;
  /** Open the user's conversation with a worker. */
  onTalk: (worker: RosterEntry) => Promise<void>;
  /** Anything the host puts above the roster, such as build mode's artifacts. */
  top?: ReactNode;
}

export function TeamPanel({ workforce, onTalk, top }: TeamPanelProps) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-muted/30">
      {top}
      <section className="border-b px-2 py-3" data-testid="roster-panel">
        <h2 className="px-2 pb-1 text-sm font-semibold">Workers</h2>
        <WorkerRoster workforce={workforce} onTalk={onTalk} />
      </section>
    </div>
  );
}

/** The user's roster, each worker with its flow, what it handles, and "Talk". */
function WorkerRoster({ workforce, onTalk }: { workforce: WorkforceClient; onTalk: (worker: RosterEntry) => Promise<void> }) {
  const roster = useRoster(workforce);
  // The worker last clicked: the one "Opening…" and a refusal belong to.
  const [clicked, setClicked] = useState<string | null>(null);
  const talk = useSubmit(onTalk);
  if (roster.error !== null) {
    return (
      <p className="px-2 pb-1 text-xs text-destructive" role="alert">
        The roster could not be read: {roster.error}{" "}
        <button type="button" className="underline" onClick={roster.retry}>
          Retry
        </button>
      </p>
    );
  }
  if (roster.workers === undefined) return <p className="px-2 text-xs text-muted-foreground">Loading…</p>;
  return (
    <ul className="space-y-2 px-2 text-xs" data-testid="roster">
      {roster.workers.map((worker) => (
        <li key={worker.id} data-testid="roster-worker" data-worker-id={worker.id}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{worker.id}</span>
            <span className="text-muted-foreground">{worker.flow}</span>
            <button
              type="button"
              className="underline disabled:opacity-50"
              data-testid="roster-talk"
              disabled={talk.busy}
              aria-busy={talk.busy && clicked === worker.id}
              onClick={() => {
                setClicked(worker.id);
                void talk.submit(undefined, worker);
              }}
            >
              {talk.busy && clicked === worker.id ? "Opening…" : "Talk"}
            </button>
          </div>
          {worker.description !== null && <p className="text-muted-foreground">{worker.description}</p>}
          {talk.error !== undefined && clicked === worker.id && (
            <p role="alert" className="text-destructive" data-testid="roster-talk-error">
              Could not open a conversation: {talk.error}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function useRoster(workforce: WorkforceClient): {
  workers: readonly RosterEntry[] | undefined;
  error: string | null;
  retry: () => void;
} {
  const [workers, setWorkers] = useState<readonly RosterEntry[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError(null);
    let current = true;
    workforce
      .roster()
      .then((entries) => {
        if (current) setWorkers(entries);
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
    };
  }, [workforce, attempt]);
  return { workers, error, retry: () => setAttempt((n) => n + 1) };
}
