"use client";

/**
 * A harness mode's sessions, as one flat list.
 *
 * A mode has exactly one flow, so there is nothing to browse above its
 * sessions: `FlowNavigator` is built for many kinds and would draw the kind as a
 * row that opens closed. Here the sessions are the rail's content. Drawn from
 * the rows the frame read, so the frame reads the listing once. A failed read
 * says so with a retry, so it doesn't read as an empty list.
 */
import type { Client } from "@flow-state-dev/client";

import { cn } from "@/lib/utils";

/** The sessions the listing returns. */
export type SessionRows = Awaited<ReturnType<Client["sessions"]["list"]>>;

/** An engine-minted session id: its prefix, a timestamp, and a hex tail. */
const ENGINE_ID = /^([a-z]+)_\d{13}_([0-9a-f]{6,})$/;

/** A session's title, else its id shortened to its prefix and last six characters (`sess_…3df102`). */
function sessionLabel(session: SessionRows[number]): string {
  if (session.title != null && session.title.trim() !== "") return session.title;
  const match = ENGINE_ID.exec(session.id);
  return match === null ? session.id : `${match[1]}_…${match[2]!.slice(-6)}`;
}

export interface HarnessSessionListProps {
  /** The mode's sessions, newest first as the server returns them; `null` until the first read answers. */
  readonly rows: SessionRows | null;
  /** Why the last read failed, or `null`. */
  readonly error: string | null;
  readonly onRetry: () => void;
  /** The mode's session flow kind: the only kind listed. */
  readonly flowKind: string;
  /** The open session, marked as current. */
  readonly selectedId: string | undefined;
  readonly onSelect: (sessionId: string) => void;
}

/** The mode's sessions as one flat list. */
export function HarnessSessionList({ rows, error, onRetry, flowKind, selectedId, onSelect }: HarnessSessionListProps) {
  return (
    <div data-testid="session-list" data-flow-kind={flowKind}>
      <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">Sessions</p>
      {error !== null && (
        <p className="px-3 py-1 text-xs text-destructive" role="status">
          Couldn't load sessions: {error}{" "}
          <button type="button" className="underline" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {error === null && rows === null && <p className="px-3 py-1 text-xs text-muted-foreground">Loading sessions…</p>}
      {error === null && rows !== null && rows.length === 0 && (
        <p className="px-3 py-1 text-xs text-muted-foreground">No sessions yet</p>
      )}
      {rows !== null && rows.length > 0 && (
        <ul>
          {rows.map((session) => {
            const isSelected = session.id === selectedId;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  className={cn(
                    "block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent/60",
                    isSelected && "bg-accent text-accent-foreground",
                  )}
                  aria-current={isSelected ? "true" : undefined}
                  data-session-id={session.id}
                  title={session.id}
                  onClick={() => onSelect(session.id)}
                >
                  {sessionLabel(session)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
