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
 * it, as long as it is one of this mode's sessions. The list is live
 * (`useSessionList`): a session created here, in another tab or by a script
 * joins it, and each row's turn state moves as the turn does. Each mode's
 * own issue fills the slot (`stream`); until then a picked session shows a
 * placeholder.
 *
 * Nothing in here is harness-specific beyond the flow kind: a harness that
 * needs more than this has found a gap in its own package.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient, type Client } from "@flow-state-dev/client";
import { useSessionList, type SessionListClient } from "@flow-state-dev/react";
import { SESSION_ADDRESS_PARAM } from "@flow-state-dev/devtool/react";
import { Plus } from "lucide-react";

import { HarnessSessionList } from "@/components/harness-session-list";
import { ModeRailHeader } from "@/components/mode-rail-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { ModelChoices } from "@/lib/harness-models";
import { KITCHEN_SINK_USER_ID } from "@/lib/kitchen-sink-principal";
import { BASE_PATH } from "@/lib/base-path";

/**
 * The slice of the one client the frame reads and writes: the session listing,
 * `subscribe` to keep it live, and a flow's session create.
 */
export type HarnessClient = Pick<Client, "flow"> & SessionListClient;

export interface HarnessFrameProps {
  /** The mode's name, at the top of the rail. */
  readonly label: string;
  /** The mode's session flow kind. The rail lists only its sessions. */
  readonly flowKind: string;
  /** The available mode's note, shown under the mode's name. No mode sets one today. */
  readonly note?: string;
  /** The models New session offers. With none, New session is off and the reason shows. */
  readonly models: ModelChoices;
  /** The mode's session view for the picked session. */
  readonly stream?: (sessionId: string) => ReactNode;
  /** Where sessions are listed and created. Defaults to this app's server, as its user; stable. */
  readonly client?: HarnessClient;
}

/** A harness mode's rail and stream slot. */
export function HarnessFrame({ label, flowKind, note, models, stream, client: hostClient }: HarnessFrameProps) {
  const client = useMemo<HarnessClient>(
    () => hostClient ?? createClient({ userId: KITCHEN_SINK_USER_ID, baseUrl: BASE_PATH }),
    [hostClient],
  );

  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<string | null>(models.defaultId ?? models.models[0]?.id ?? null);
  // The pick, checked against the list it is offered from: one the list no
  // longer holds falls back to the default, so New session never sends an id
  // the picker doesn't show.
  const chosen = models.models.some((model) => model.id === picked) ? picked : (models.defaultId ?? models.models[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The mode's sessions: the one read the list draws and the address's session
  // is checked against, live on the user's change notices.
  const list = useSessionList({ flowKind, client });
  const listError = list.error;
  // `null` until a read answers with rows: still loading, or failed.
  const rows = (list.isLoading || listError !== null) && list.sessions.length === 0 ? null : list.sessions;
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

  const handleNewSession = useCallback(async () => {
    if (chosen === null) return;
    setCreating(true);
    setError(null);
    try {
      // Born with its model: the flow refuses a session that names none, and
      // no later write can change it.
      const created = await client.flow(flowKind).createSession({ state: { model: chosen } });
      // The rail hears the new session on the user's topic.
      open(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }, [client, flowKind, open, chosen]);

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
                value={chosen ?? ""}
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
            disabled={creating || chosen === null}
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
            onRetry={list.refresh}
            flowKind={flowKind}
            models={models}
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
          stream(selected)
        ) : (
          <p className="m-auto px-4 text-center text-sm text-muted-foreground">This mode's session view is not built yet.</p>
        )}
      </main>
    </div>
  );
}
