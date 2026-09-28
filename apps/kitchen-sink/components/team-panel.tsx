"use client";

/**
 * The shell's right panel: the organization's roster and the boards, whatever
 * mode the app is in.
 *
 * Layout only. The roster and the board lists are `@flow-state-dev/react`
 * components; this places them, themes them, and supplies the roster's
 * skipped-seat list, which the boot publishes and the roster cannot read for
 * itself.
 *
 * The roster reads through the assistant's session. Each board reads through
 * its own channel's session, whose flow declares it, so a board is drawn before
 * any assistant conversation exists and, when `live`, follows that channel's
 * stream: a case the channel files shows without a reload.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { ClientFetch } from "@flow-state-dev/client";
import { BoardList, Roster, type PanelRowSource } from "@flow-state-dev/react";
import { HIRED_ROSTER_RESOURCE } from "@flow-state-dev/workforce/browser";

import {
  ROSTER_BOOT_REPORT_REF,
  SHELL_BOARDS,
  problemsFromBootReport,
} from "@/lib/workforce-shell";

/** The panels' custom properties, set to this app's tokens. */
const PANEL_THEME = {
  "--fsd-panel-fg": "var(--color-foreground)",
  "--fsd-panel-muted-fg": "var(--color-muted-foreground)",
} as CSSProperties;

export interface TeamPanelProps {
  /**
   * The session the roster and the boot report read through. Its flow must
   * declare both; `undefined` while the session is still being created. The
   * boards do not wait for it.
   */
  sessionId: string | undefined;
  /** The host's resource client. Pass a stable one — the panels fence on it. */
  resourceClient: PanelRowSource;
  /**
   * The `fetch` `resourceClient` was built with, so a board's live stream goes
   * out the way its reads do. Stable, like the client.
   */
  fetcher: ClientFetch;
  /** Read each board again whenever its channel keeps a change to it. Off unless asked. */
  live?: boolean;
  /** Anything the host puts above the roster, such as build mode's artifacts. */
  top?: ReactNode;
}

export function TeamPanel({ sessionId, resourceClient, fetcher, live = false, top }: TeamPanelProps) {
  const report = useRosterBootReport(resourceClient, sessionId);
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-muted/30" style={PANEL_THEME}>
      {top}
      <section className="border-b px-2 py-3" data-testid="roster-panel">
        <h2 className="px-2 pb-1 text-sm font-semibold">Roster</h2>
        {report.error !== null && (
          <p className="px-2 pb-1 text-xs text-destructive" role="alert">
            {report.error}{" "}
            <button type="button" className="underline" onClick={report.retry}>
              Retry
            </button>
          </p>
        )}
        {sessionId === undefined ? (
          <p className="px-2 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <Roster
            sessionId={sessionId}
            collectionRef={HIRED_ROSTER_RESOURCE}
            resourceClient={resourceClient}
            problems={report.problems}
          />
        )}
      </section>
      {SHELL_BOARDS.map((board) => (
        <section key={board.ref} className="border-b px-2 py-3" data-testid={`board-${board.ref}`}>
          <h2 className="px-2 pb-1 text-sm font-semibold">
            {board.board}
            <span className="ml-1 font-normal text-muted-foreground">· {board.channelId}</span>
          </h2>
          <BoardList
            sessionId={board.channelId}
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

/** An empty board, in the desk's words. */
function noCasesYet() {
  return <p className="px-2 text-xs text-muted-foreground">No cases filed here yet.</p>;
}

/**
 * What the last boot could not bring back into this organization's roster.
 *
 * Read through the same client the roster reads through. A read that fails is
 * reported beside the roster with a retry, and not as a skipped seat: a roster
 * shown without its skipped seats looks complete when it is not, and one with
 * an invented skipped seat miscounts.
 */
function useRosterBootReport(
  source: PanelRowSource,
  sessionId: string | undefined,
): { problems: readonly string[]; error: string | null; retry: () => void } {
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setProblems([]);
    setError(null);
    if (sessionId === undefined) return;
    let current = true;
    source
      .listCollectionItems(sessionId, ROSTER_BOOT_REPORT_REF)
      .then((page) => {
        if (current) setProblems(problemsFromBootReport(page.items));
      })
      .catch((reason: unknown) => {
        if (!current) return;
        setError(
          `The list of seats the last start skipped could not be read: ${
            reason instanceof Error ? reason.message : String(reason)
          }`,
        );
      });
    return () => {
      current = false;
    };
  }, [source, sessionId, attempt]);
  return { problems, error, retry: () => setAttempt((n) => n + 1) };
}
