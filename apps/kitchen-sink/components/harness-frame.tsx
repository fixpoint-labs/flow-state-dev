"use client";

/**
 * A coding harness mode's frame: a rail of that mode's own sessions beside a
 * stream slot.
 *
 * The rail is the mode's name with the way back to the picker, a **New
 * session** button, and one `FlowNavigator` section over the mode's one flow
 * kind, so it lists that kind's sessions and no other's. **New session**
 * creates a session on that flow and opens it in the stream slot. Each mode's
 * own issue fills the slot (`stream`); until then a picked session shows a
 * placeholder.
 *
 * Nothing in here is harness-specific beyond the flow kind: a harness that
 * needs more than this has found a gap in its own package.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import {
  FlowNavigator,
  type FlowNavigatorLeaf,
  type FlowNavigatorLeafState,
  type FlowNavigatorSection,
} from "@flow-state-dev/react";
import { createClient, createSessionClient, type Client, type SessionClient } from "@flow-state-dev/client";
import { Plus } from "lucide-react";

import { ModeRailHeader } from "@/components/mode-rail-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { KITCHEN_SINK_USER_ID } from "@/lib/kitchen-sink-principal";

/** The rail's theme: the navigator's custom properties, set to this app's tokens. */
const RAIL_THEME = {
  "--fsd-nav-fg": "var(--color-foreground)",
  "--fsd-nav-muted-fg": "var(--color-muted-foreground)",
  "--fsd-nav-selected-bg": "var(--color-accent)",
  "--fsd-nav-selected-fg": "var(--color-accent-foreground)",
  "--fsd-nav-guide": "var(--color-border)",
} as CSSProperties;

/** The flow list the navigator reads. */
export type HarnessFlowSource = Pick<Client, "listFlows">;

/** Where the frame reads and creates sessions. */
export type HarnessSessionSource = Pick<SessionClient, "listSessions" | "createSession">;

export interface HarnessFrameProps {
  /** The mode's name, at the top of the rail. */
  readonly label: string;
  /** The mode's session flow kind. The rail lists only its sessions. */
  readonly flowKind: string;
  /** The mode's session view for the picked session. Filled by the mode's own issue. */
  readonly stream?: (sessionId: string) => ReactNode;
  /** The flow list the navigator reads. Defaults to this app's server; stable. */
  readonly flowSource?: HarnessFlowSource;
  /** Where sessions are listed and created. Defaults to this app's server; stable. */
  readonly sessionSource?: HarnessSessionSource;
}

/** A harness mode's rail and stream slot. */
export function HarnessFrame({ label, flowKind, stream, flowSource, sessionSource }: HarnessFrameProps) {
  const flows = useMemo(
    () => flowSource ?? createClient({ flowKind, userId: KITCHEN_SINK_USER_ID, baseUrl: "" }),
    [flowSource, flowKind],
  );
  const sessions = useMemo(() => sessionSource ?? createSessionClient({ baseUrl: "" }), [sessionSource]);
  const sections = useMemo<readonly FlowNavigatorSection[]>(() => [{ label: "Sessions", kinds: [flowKind] }], [flowKind]);

  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The open leaf's re-read, so a session just created shows in the list.
  const refreshLeaf = useRef<(() => void) | null>(null);

  const handleNewSession = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await sessions.createSession({ flowKind, userId: KITCHEN_SINK_USER_ID });
      setSelected(created.id);
      refreshLeaf.current?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }, [sessions, flowKind]);

  const handleSelect = useCallback((sessionId: string, _leaf: FlowNavigatorLeaf) => setSelected(sessionId), []);

  const slots = useMemo(
    () => ({
      leafDetail: (leaf: FlowNavigatorLeafState) => <LeafRefresh leaf={leaf} refreshRef={refreshLeaf} />,
    }),
    [],
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background sm:flex-row" data-testid="harness-frame">
      <aside
        className="flex max-h-[40dvh] shrink-0 flex-col border-b sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r sm:bg-muted/30"
        data-testid="rail"
        aria-label={`${label} sessions`}
      >
        <ModeRailHeader label={label} />
        <div className="border-b p-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => void handleNewSession()}
            disabled={creating}
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
        <div className="min-h-0 flex-1 overflow-y-auto py-1" style={RAIL_THEME}>
          <FlowNavigator
            sections={sections}
            client={flows}
            sessionClient={sessions}
            userId={KITCHEN_SINK_USER_ID}
            selectedSessionId={selected}
            onSelectSession={handleSelect}
            slots={slots}
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

/** Keeps a handle on the open leaf's re-read for as long as the leaf is open. Draws nothing. */
function LeafRefresh({
  leaf,
  refreshRef,
}: {
  leaf: FlowNavigatorLeafState;
  refreshRef: MutableRefObject<(() => void) | null>;
}) {
  const { refresh } = leaf;
  useEffect(() => {
    refreshRef.current = refresh;
    return () => {
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, [refresh, refreshRef]);
  return null;
}
