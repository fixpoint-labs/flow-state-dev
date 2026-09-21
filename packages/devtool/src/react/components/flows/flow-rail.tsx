/**
 * The developer tool's flow rail (FIX-1477 S7).
 *
 * The drill-down itself is `FlowNavigator`, shipped from
 * `@flow-state-dev/react`. What lives in this file is the tool's SKIN — a
 * handful of CSS custom properties — and the three affordances that are the
 * tool's own: copy a copy's id, refresh a list, and start a session.
 *
 * There is no grouping, no cardinality branch, no fetch-on-leaf-expand rule
 * and no read fence here, because a second copy of any of them is the defect
 * this change exists to remove. If something in this file starts to look like
 * navigation rather than skin, it belongs in the package instead.
 *
 * ## Why a toolbar mounts an effect
 *
 * The navigator reports a session PICK and nothing else: it keeps its own
 * expand state and publishes no event when a row opens. Two of this tool's
 * behaviours need that event — restoring the session last open under a copy,
 * and re-listing when a title arrives over SSE — so both ride `LeafSignals`,
 * which the leaf toolbar mounts and the navigator unmounts when the leaf
 * closes. That is a workaround for a missing callback, and it is written down
 * here rather than hidden so a third host does not have to rediscover it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Inbox,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  FlowNavigator,
  type FlowNavigatorLeaf,
  type FlowNavigatorLeafState,
  type FlowNavigatorRow,
  type FlowNavigatorSection,
} from "@flow-state-dev/react";
import { Button } from "../ui/button";
import { EmptyState } from "../shared/empty-state";
import { useDevTool } from "../../context/devtool-context";
import { useWorkspaceFence } from "../../hooks/use-workspace-fence";

/**
 * One section, covering every kind.
 *
 * The tool is pointed at whatever server is running, so it cannot name the
 * kinds — they are the inspected app's, not ours. A section with no `kinds` is
 * the navigator's "all of them", which is what keeps this from reading the
 * flow list itself purely to hand the kind names back.
 *
 * Module-level because the navigator groups on this array's identity.
 */
const SECTIONS: readonly FlowNavigatorSection[] = [{ label: "Flows" }];

/**
 * The tool's palette, as the properties the navigator reads.
 *
 * The package publishes no class name to override, which is the point: two
 * hosts that disagree about every colour still render one component.
 */
const THEME = {
  "--fsd-nav-fg": "rgb(226 232 240)",
  "--fsd-nav-bg": "transparent",
  "--fsd-nav-muted-fg": "rgb(100 116 139)",
  "--fsd-nav-selected-bg": "rgb(30 41 59)",
  "--fsd-nav-selected-fg": "rgb(226 232 240)",
  "--fsd-nav-font-size": "13px",
  "--fsd-nav-note-font-size": "10px",
  "--fsd-nav-section-font-size": "10px",
} as React.CSSProperties;

export type FlowRailProps = {
  /** Bumped by the panel when a session's metadata changed out of band. */
  sessionRefreshKey?: number;
  /** Also bring the open session current when the Sessions ⟳ is clicked. */
  onRefreshActiveSession?: () => void;
};

export function FlowRail({ sessionRefreshKey = 0, onRefreshActiveSession }: FlowRailProps) {
  const { client, sessionClient, config, activeSessionId, selectWorkspace } = useDevTool();

  // The navigator fences its reads on the client it read through, so a rebuilt
  // client discards the previous credential's rows. These come from the
  // provider's state and change only when the credentials do; an object
  // literal here would read as a rebuilt client on every render and never
  // settle.
  const handleSelect = useCallback(
    (sessionId: string, leaf: FlowNavigatorLeaf) => {
      // `leaf.address` is the EXACT flow id the row was listed under — an
      // instance id under a collection kind, the kind's own id under a
      // singleton. Moving both together is what stops one copy's session being
      // addressed to another.
      selectWorkspace(leaf.address, sessionId);
    },
    [selectWorkspace],
  );

  return (
    <div style={THEME} className="h-full">
      <FlowNavigator
        sections={SECTIONS}
        client={client}
        sessionClient={sessionClient}
        userId={config.userId}
        selectedSessionId={activeSessionId ?? undefined}
        onSelectSession={handleSelect}
        slots={{
          rowTrailing: (row) => <RowTrailing row={row} />,
          leafToolbar: (leaf) => (
            <LeafToolbar
              leaf={leaf}
              sessionRefreshKey={sessionRefreshKey}
              onRefreshActiveSession={onRefreshActiveSession}
            />
          ),
          emptySection: () => (
            <EmptyState
              icon={<Inbox className="h-6 w-6" />}
              message="No flows registered. Start a flow-state server to see flows here."
            />
          ),
        }}
      />
    </div>
  );
}

/**
 * What hangs off the end of a row.
 *
 * Only a collection member gets one. A singleton's row label IS its whole id,
 * so there is nothing a copy button could recover that is not already on
 * screen; an instance id is opaque, often long, and truncated to fit the rail,
 * and retyping what a truncation shows is how the wrong copy gets addressed.
 */
function RowTrailing({ row }: { row: FlowNavigatorRow }) {
  if (row.type !== "instance") return null;
  return <CopyInstanceId flowId={row.instance.id} />;
}

/** Copies the instance's full id. */
function CopyInstanceId({ flowId }: { flowId: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-5 w-5 p-0"
      title={`Copy instance ID: ${flowId}`}
      aria-label={`Copy instance ID ${flowId}`}
      onClick={() => {
        void navigator.clipboard?.writeText(flowId);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-400" />
      ) : (
        <Copy className="h-3 w-3 text-slate-500" />
      )}
    </Button>
  );
}

/**
 * The strip above an open leaf's sessions: refresh, and start one.
 *
 * The failed and empty states are the navigator's and are not repeated here —
 * it draws its own retry line and its own "no sessions yet", and a second copy
 * of either would disagree with the first the moment one of them changed.
 */
function LeafToolbar({
  leaf,
  sessionRefreshKey,
  onRefreshActiveSession,
}: {
  leaf: FlowNavigatorLeafState;
  sessionRefreshKey: number;
  onRefreshActiveSession?: () => void;
}) {
  const { sessionClient, config, selectWorkspace } = useDevTool();
  const [error, setError] = useState<string | null>(null);

  const address = leaf.address;
  const refresh = leaf.refresh;

  // Fences the create below. Keyed on the leaf's own address and the operator
  // identity, on top of the workspace token `useWorkspaceFence` always
  // supplies (which retires on any workspace transition, including a
  // credential change) — the same axes the fence this replaces used: the
  // client, the exact copy the request was addressed to, and who it was
  // addressed as. This component itself unmounts when the leaf collapses,
  // which retires the fence too.
  const fence = useWorkspaceFence([address, config.userId]);

  const handleCreate = useCallback(async () => {
    setError(null);
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    try {
      const detail = await sessionClient.createSession({
        flowKind: address,
        userId: config.userId,
      });
      // The operator may have collapsed this row, or opened another copy,
      // while the create was in flight. The session exists — it just isn't
      // this navigator row's to open, and handing its id back would select it
      // under whichever instance is now expanded.
      if (!stillCurrent()) return;
      // Open it under the copy it was created for, then re-list so the row it
      // was created as is there to be highlighted.
      selectWorkspace(address, detail.id);
      refresh();
    } catch (err) {
      if (!stillCurrent()) return;
      setError(err instanceof Error ? err.message : "Failed to create session");
    }
  }, [fence, sessionClient, config.userId, address, selectWorkspace, refresh]);

  return (
    <>
      <LeafSignals
        address={address}
        refresh={refresh}
        sessionRefreshKey={sessionRefreshKey}
      />
      <div className="flex items-center justify-end gap-1 py-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => {
            refresh();
            onRefreshActiveSession?.();
          }}
          title="Refresh sessions"
        >
          <RefreshCw
            className={`h-3 w-3 text-slate-500 ${leaf.isLoading ? "animate-spin" : ""}`}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => void handleCreate()}
          title="New session"
        >
          <Plus className="h-3 w-3 text-slate-500" />
        </Button>
      </div>
      {error !== null && (
        <p role="alert" className="py-1 text-[10px] text-red-400">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * The two things this tool needs from a leaf OPENING, which the navigator does
 * not report.
 *
 * Mounting is the event: the toolbar is rendered exactly while its leaf is
 * open, so this component's mount and unmount bracket the leaf's. Renders
 * nothing.
 */
function LeafSignals({
  address,
  refresh,
  sessionRefreshKey,
}: {
  address: string;
  refresh: () => void;
  sessionRefreshKey: number;
}) {
  const { activeSessionId, selectInstance } = useDevTool();

  // `refresh` is a fresh closure every render of the leaf's own hook, so it
  // cannot be a dependency of anything — an effect keyed on it would re-run
  // forever. Held here and read at the moment a signal actually arrives.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  // Read at mount only. Making it a dependency would re-run this on every
  // selection and re-open the hint over the operator's own pick.
  const hadSessionOpen = useRef(activeSessionId !== null);

  useEffect(() => {
    // Opening a row is not selecting it — several can be open at once now — so
    // this restores the last session under a copy ONLY when the workspace is
    // empty. Doing it unconditionally would yank the workspace out from under
    // an operator who was merely browsing.
    if (hadSessionOpen.current) return;
    selectInstance(address);
  }, [address, selectInstance]);

  const seen = useRef(sessionRefreshKey);
  useEffect(() => {
    if (seen.current === sessionRefreshKey) return;
    seen.current = sessionRefreshKey;
    refreshRef.current();
  }, [sessionRefreshKey]);

  return null;
}
