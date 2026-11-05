"use client";

/**
 * A harness mode's sessions, as one flat list.
 *
 * A mode has exactly one flow, so there is nothing to browse above its
 * sessions: `FlowNavigator` is built for many kinds and would draw the kind as a
 * row that opens closed. Here the sessions are the rail's content. Drawn from
 * the rows the frame's live read holds (`useSessionList`: it reads again on the
 * user's change notices, or on the client's fallback timer where there is no
 * push). A failed read says so with a retry, so it doesn't read as an empty list.
 *
 * Each row says what the navigator's rows say (the same label and turn state,
 * from the framework's helpers) plus the session's model, which a coding
 * session is born with.
 */
import { useEffect, useState } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { sessionAge, sessionLabel, sessionRowState } from "@flow-state-dev/react";

import type { ModelChoices } from "@/lib/harness-models";
import { cn } from "@/lib/utils";

/** The sessions the listing returns. */
export type SessionRows = readonly SessionSummary[];

/** The model a listed session was born with: a readonly state field the listing carries. */
function sessionModel(session: SessionSummary): string | undefined {
  const model = (session as { state?: { model?: unknown } }).state?.model;
  return typeof model === "string" ? model : undefined;
}

/** Now, a minute at a time: ages are drawn in minutes, never re-read. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export interface HarnessSessionListProps {
  /** The mode's sessions, newest first as the server returns them; `null` until the first read answers. */
  readonly rows: SessionRows | null;
  /** Why the last read failed, or `null`. */
  readonly error: string | null;
  readonly onRetry: () => void;
  /** The mode's session flow kind: the only kind listed. */
  readonly flowKind: string;
  /** The mode's models, for a model's name. */
  readonly models: ModelChoices;
  /** The open session, marked as current. */
  readonly selectedId: string | undefined;
  readonly onSelect: (sessionId: string) => void;
}

/** The mode's sessions as one flat list. */
export function HarnessSessionList({ rows, error, onRetry, flowKind, models, selectedId, onSelect }: HarnessSessionListProps) {
  const now = useMinuteClock();
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
            const state = sessionRowState(session);
            const modelId = sessionModel(session);
            const model = modelId === undefined ? undefined : (models.models.find((m) => m.id === modelId)?.label ?? modelId);
            return (
              <li key={session.id}>
                <button
                  type="button"
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-sm hover:bg-accent/60",
                    isSelected && "bg-accent text-accent-foreground",
                  )}
                  aria-current={isSelected ? "true" : undefined}
                  data-session-id={session.id}
                  title={session.id}
                  onClick={() => onSelect(session.id)}
                >
                  <span className="flex items-center gap-1.5">
                    {state !== null && (
                      <span
                        role="img"
                        aria-label={state.label}
                        title={state.label}
                        data-request-status={state.status}
                        data-needs-you={state.needsYou ? "" : undefined}
                        className={cn("shrink-0 text-xs", state.needsYou ? "text-orange-600" : "text-muted-foreground")}
                      >
                        {state.mark}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{sessionLabel(session)}</span>
                    {Number.isFinite(session.updatedAt) && (
                      <span className="shrink-0 text-[11px] text-muted-foreground" data-session-age="">
                        {sessionAge(session.updatedAt, now)}
                      </span>
                    )}
                  </span>
                  {model !== undefined && (
                    <span className="block truncate text-[11px] text-muted-foreground" data-session-model={modelId}>
                      {model}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
