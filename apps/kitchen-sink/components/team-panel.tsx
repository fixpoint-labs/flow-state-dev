"use client";

/**
 * The right-hand panel: the person's workers, and the mailbox's boards.
 *
 * The workers are the person's roster: the specialists the app's files
 * declare, which everyone has, and any worker the person hired or forked,
 * each with the flow it runs on. "Talk" opens the person's conversation with
 * that worker, or starts one, through Workforce's client.
 *
 * Each board reads through its own mailbox's session.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { ClientFetch } from "@flow-state-dev/client";
import { BoardList, type PanelRowSource } from "@flow-state-dev/react";
import type { RosterEntry, WorkforceClient } from "@flow-state-dev/workforce/browser";

import { SHELL_BOARDS } from "@/lib/workforce-shell";

const PANEL_THEME = {
  "--fsd-panel-fg": "var(--color-foreground)",
  "--fsd-panel-muted-fg": "var(--color-muted-foreground)",
} as CSSProperties;

export interface TeamPanelProps {
  /** The person's workforce client. Pass a stable one: the roster is read again only when it changes. */
  workforce: WorkforceClient;
  /** Open the person's conversation with a worker. */
  onTalk: (worker: RosterEntry) => Promise<void>;
  /** The host's resource client. Pass a stable one — the panels fence on it. */
  resourceClient: PanelRowSource;
  /**
   * The `fetch` `resourceClient` was built with, so a board's live stream goes
   * out the way its reads do. Stable, like the client.
   */
  fetcher: ClientFetch;
  /** Read each board again whenever its mailbox keeps a change to it. Off unless asked. */
  live?: boolean;
  /** Anything the host puts above the roster, such as build mode's artifacts. */
  top?: ReactNode;
}

export function TeamPanel({ workforce, onTalk, resourceClient, fetcher, live = false, top }: TeamPanelProps) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-muted/30" style={PANEL_THEME}>
      {top}
      <section className="border-b px-2 py-3" data-testid="roster-panel">
        <h2 className="px-2 pb-1 text-sm font-semibold">Workers</h2>
        <WorkerRoster workforce={workforce} onTalk={onTalk} />
      </section>
      {SHELL_BOARDS.map((board) => (
        <section key={board.ref} className="border-b px-2 py-3" data-testid={`board-${board.ref}`}>
          <h2 className="px-2 pb-1 text-sm font-semibold">
            {board.board}
            <span className="ml-1 font-normal text-muted-foreground">· {board.mailboxId}</span>
          </h2>
          <BoardList
            sessionId={board.mailboxId}
            boardRef={board.ref}
            resourceClient={resourceClient}
            fetcher={fetcher}
            live={live}
            slots={{ empty: noCasesYet }}
          />
        </section>
      ))}
    </div>
  );
}

function noCasesYet() {
  return <p className="px-2 text-xs text-muted-foreground">No cases filed here yet.</p>;
}

/** The person's roster, each worker with its flow, what it handles, and "Talk". */
function WorkerRoster({ workforce, onTalk }: { workforce: WorkforceClient; onTalk: (worker: RosterEntry) => Promise<void> }) {
  const roster = useRoster(workforce);
  const [talkError, setTalkError] = useState<{ id: string; message: string } | null>(null);
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
              className="underline"
              data-testid="roster-talk"
              onClick={() => {
                setTalkError(null);
                onTalk(worker).catch((cause: unknown) =>
                  setTalkError({ id: worker.id, message: cause instanceof Error ? cause.message : String(cause) }),
                );
              }}
            >
              Talk
            </button>
          </div>
          {worker.description !== null && <p className="text-muted-foreground">{worker.description}</p>}
          {talkError?.id === worker.id && (
            <p role="alert" className="text-destructive" data-testid="roster-talk-error">
              Could not open a conversation: {talkError.message}
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
