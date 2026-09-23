"use client";

/**
 * The shell's right panel: the organization's roster and the boards, whatever
 * mode the app is in.
 *
 * Layout only. The roster and the board columns are `@flow-state-dev/react`
 * components; this places them, themes them, and supplies the roster's
 * skipped-seat list, which the boot publishes and the roster cannot read for
 * itself.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { BoardColumns, Roster, type PanelRowSource } from "@flow-state-dev/react";

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
   * The session every read goes through. Its flow must declare the roster, the
   * boot report and the boards; `undefined` while the session is still being
   * created.
   */
  sessionId: string | undefined;
  /** The host's resource client. Pass a stable one — the panels fence on it. */
  resourceClient: PanelRowSource;
  /** Anything the host puts above the roster, such as build mode's artifacts. */
  top?: ReactNode;
}

export function TeamPanel({ sessionId, resourceClient, top }: TeamPanelProps) {
  const rosterProblems = useRosterBootProblems(resourceClient, sessionId);
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-muted/30" style={PANEL_THEME}>
      {top}
      <section className="border-b px-2 py-3" data-testid="roster-panel">
        <h2 className="px-2 pb-1 text-sm font-semibold">Roster</h2>
        {sessionId === undefined ? (
          <p className="px-2 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <Roster sessionId={sessionId} resourceClient={resourceClient} problems={rosterProblems} />
        )}
      </section>
      {SHELL_BOARDS.map((board) => (
        <section key={board.ref} className="border-b px-2 py-3" data-testid={`board-${board.ref}`}>
          <h2 className="px-2 pb-1 text-sm font-semibold">
            {board.board}
            <span className="ml-1 font-normal text-muted-foreground">· {board.channelId}</span>
          </h2>
          {sessionId === undefined ? (
            <p className="px-2 text-xs text-muted-foreground">Loading…</p>
          ) : (
            <BoardColumns sessionId={sessionId} boardRef={board.ref} resourceClient={resourceClient} />
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * What the last boot could not bring back into this organization's roster.
 *
 * Read through the same client the roster reads through. A read that fails is
 * shown as a problem of its own, because a roster shown without its skipped
 * seats looks complete when it is not.
 */
function useRosterBootProblems(
  source: PanelRowSource,
  sessionId: string | undefined,
): readonly string[] {
  const [problems, setProblems] = useState<readonly string[]>([]);
  useEffect(() => {
    setProblems([]);
    if (sessionId === undefined) return;
    let current = true;
    source
      .listCollectionItems(sessionId, ROSTER_BOOT_REPORT_REF)
      .then((page) => {
        if (current) setProblems(problemsFromBootReport(page.items));
      })
      .catch((error: unknown) => {
        if (!current) return;
        setProblems([
          `The boot report could not be read: ${error instanceof Error ? error.message : String(error)}`,
        ]);
      });
    return () => {
      current = false;
    };
  }, [source, sessionId]);
  return problems;
}
