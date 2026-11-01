"use client";

/**
 * A coding harness mode's frame: a rail of that mode's own sessions beside a
 * stream slot.
 *
 * The rail is the mode's name with the way back to the picker, the model
 * picker and a **New session** button, and the mode's sessions as one flat
 * list (`HarnessSessionList`) over its one flow kind, so it lists that kind's
 * sessions and no other's, with no kind row to open first.
 * **New session** creates a session on that flow, born with the picked model
 * (the mode's default preselected), and opens it in the stream slot. A
 * session's model never changes; another model is another session. The open
 * session is named in the address (`?session=<id>`), so a reload comes back to
 * it, as long as it is one of this mode's sessions. Each mode's
 * own issue fills the slot (`stream`); until then a picked session shows a
 * placeholder.
 *
 * Nothing in here is harness-specific beyond the flow kind: a harness that
 * needs more than this has found a gap in its own package.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient, type Client } from "@flow-state-dev/client";
import { SESSION_ADDRESS_PARAM } from "@flow-state-dev/devtool/react";
import { Plus } from "lucide-react";

import { HarnessSessionList, type SessionRows } from "@/components/harness-session-list";
import { ModeRailHeader } from "@/components/mode-rail-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { ModelChoices } from "@/lib/harness-models";
import { KITCHEN_SINK_USER_ID } from "@/lib/kitchen-sink-principal";

/** The slice of the one client the frame reads and writes: the session listing, and a flow's session create. */
export type HarnessClient = Pick<Client, "flow"> & { readonly sessions: Pick<Client["sessions"], "list"> };

export interface HarnessFrameProps {
  /** The mode's name, at the top of the rail. */
  readonly label: string;
  /** The mode's session flow kind. The rail lists only its sessions. */
  readonly flowKind: string;
  /** The available mode's note, shown under the mode's name. No mode sets one today. */
  readonly note?: string;
  /** The models New session offers. With none, New session is off and the reason shows. */
  readonly models: ModelChoices;
  /**
   * The mode's session view for the picked session. `refreshSessions` reads the
   * rail again, for a session whose listing changed (it was titled).
   */
  readonly stream?: (sessionId: string, refreshSessions: () => void) => ReactNode;
  /** Where sessions are listed and created. Defaults to this app's server, as its user; stable. */
  readonly client?: HarnessClient;
}

/** A harness mode's rail and stream slot. */
export function HarnessFrame({ label, flowKind, note, models, stream, client: hostClient }: HarnessFrameProps) {
  const client = useMemo<HarnessClient>(
    () => hostClient ?? createClient({ userId: KITCHEN_SINK_USER_ID, baseUrl: "" }),
    [hostClient],
  );

  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<string | null>(models.defaultId ?? models.models[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The mode's sessions: the one read the list draws and the address's session
  // is checked against. `reads` is bumped to read again, by a session created
  // or a Retry.
  const [rows, setRows] = useState<SessionRows | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  // The session the address names, until the listing has said whether it is this mode's.
  const named = useRef<string | null>(null);

  const open = useCallback((sessionId: string) => {
    setSelected(sessionId);
    const url = new URL(window.location.href);
    url.searchParams.set(SESSION_ADDRESS_PARAM, sessionId);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  useEffect(() => {
    named.current = new URLSearchParams(window.location.search).get(SESSION_ADDRESS_PARAM);
  }, []);

  useEffect(() => {
    let current = true;
    client.sessions.list({ flowKind, userId: KITCHEN_SINK_USER_ID }).then(
      (listed) => {
        if (!current) return;
        setRows(listed);
        setListError(null);
      },
      (cause: unknown) => {
        if (current) setListError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      current = false;
    };
  }, [client, flowKind, reads]);

  // After mount, since the server draws no session: the one the address names,
  // when it is one of this mode's. Anything else leaves the picker. A failed
  // listing says so, so it doesn't read as a session that isn't there.
  useEffect(() => {
    const wanted = named.current;
    if (wanted === null) return;
    if (rows !== null) {
      named.current = null;
      if (rows.some((row) => row.id === wanted)) {
        setSelected((picked) => picked ?? wanted);
        setError(null);
      }
    } else if (listError !== null) {
      setError(`Session ${wanted} can't be reopened: ${listError}`);
    }
  }, [rows, listError]);

  const refreshSessions = useCallback(() => setReads((n) => n + 1), []);

  const handleNewSession = useCallback(async () => {
    if (picked === null) return;
    setCreating(true);
    setError(null);
    try {
      // Born with its model: the flow refuses a session that names none, and
      // no later write can change it.
      const created = await client.flow(flowKind).createSession({ state: { model: picked } });
      open(created.id);
      setReads((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }, [client, flowKind, open, picked]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background sm:flex-row" data-testid="harness-frame">
      <aside
        className="flex max-h-[40dvh] shrink-0 flex-col border-b sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r sm:bg-sidebar"
        data-testid="rail"
        aria-label={`${label} sessions`}
      >
        <ModeRailHeader label={label} />
        {note !== undefined && (
          <p className="break-words border-b px-3 py-2 text-xs" data-testid="mode-note">
            {note}
          </p>
        )}
        <div className="border-b p-2">
          {models.models.length > 0 && (
            <label className="mb-2 block text-xs text-muted-foreground">
              Model
              <select
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground"
                value={picked ?? ""}
                onChange={(event) => setPicked(event.target.value)}
                data-testid="model-picker"
              >
                {models.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id === models.defaultId ? `${model.label} (default)` : model.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {models.reason !== null && (
            <p className="mb-2 break-words text-xs text-muted-foreground" data-testid="model-list-reason">
              {models.reason}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => void handleNewSession()}
            disabled={creating || picked === null}
            data-testid="new-session"
          >
            <Plus className="h-4 w-4" />
            New session
          </Button>
          {error !== null && (
            <p className="mt-2 break-words text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <HarnessSessionList
            rows={rows}
            error={listError}
            onRetry={() => setReads((n) => n + 1)}
            flowKind={flowKind}
            selectedId={selected}
            onSelect={open}
          />
        </div>
        <div className="hidden items-center gap-1 border-t p-3 sm:flex">
          <ThemeToggle />
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="stream" data-session-id={selected}>
        {selected === undefined ? (
          <p className="m-auto px-4 text-center text-sm text-muted-foreground">
            Pick a session, or start one with New session.
          </p>
        ) : stream !== undefined ? (
          stream(selected, refreshSessions)
        ) : (
          <p className="m-auto px-4 text-center text-sm text-muted-foreground">This mode's session view is not built yet.</p>
        )}
      </main>
    </div>
  );
}
