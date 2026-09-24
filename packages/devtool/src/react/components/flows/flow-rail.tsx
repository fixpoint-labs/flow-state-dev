/**
 * The developer tool's flow rail (FIX-1477 S7).
 *
 * The drill-down itself is `FlowNavigator`, shipped from
 * `@flow-state-dev/react`. What lives in this file is the tool's SKIN — a
 * handful of CSS custom properties — and the affordances that are the tool's
 * own: copy a copy's id, refresh a list, start a session, and read a dispatch
 * run's provenance.
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
  ArrowUpRight,
  Check,
  CircleAlert,
  Copy,
  Inbox,
  Plus,
  RefreshCw,
  type LucideIcon,
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
import { dispatchRunOrigin } from "../../lib/dispatch-run-links";

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
  "--fsd-nav-guide": "rgb(51 65 85)",
} as React.CSSProperties;

/**
 * How much of lucide's 24-unit grid each rail icon's drawing covers.
 *
 * One icon set fills its box unevenly: copy's drawing spans 20 units, plus's
 * 14. Give them the same box and copy is drawn half as big again, which is
 * what a row of them looks like. So each is sized by its drawing instead.
 */
const DRAWN_EXTENT = new Map<LucideIcon, number>([
  [Copy, 20],
  [Check, 16],
  [RefreshCw, 18],
  [Plus, 14],
  [ArrowUpRight, 10],
  [CircleAlert, 20],
]);

/** The size every rail icon's drawing covers, in pixels. */
const DRAWN_SIZE = 11;

/**
 * A rail icon, sized so its drawing covers `DRAWN_SIZE` with one stroke width.
 *
 * Sized inline on purpose: the `Button`'s rule for an svg without a `size-`
 * class overrides a width or height class, which is how a declared `h-3 w-3`
 * ends up drawn at 16px.
 */
function RailIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  const box = (DRAWN_SIZE * 24) / DRAWN_EXTENT.get(Icon)!;
  return (
    <Icon
      className={className}
      style={{ width: box, height: box }}
      strokeWidth={1.5}
      absoluteStrokeWidth
    />
  );
}

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
        // The tool inspects a running server, so it asks for the sessions
        // dispatchers ran work in as well. The wire default does not move: an
        // app's own session list is unchanged unless it asks the same way.
        includeDispatchRuns
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
 * A collection member gets a copy button. A singleton's row label IS its whole
 * id, so there is nothing a copy button could recover that is not already on
 * screen; an instance id is opaque, often long, and truncated to fit the rail,
 * and retyping what a truncation shows is how the wrong copy gets addressed.
 *
 * A session a dispatcher started gets its provenance instead: what the
 * dispatcher did with the session, and a way to open the one that started it.
 * The indent beside it is the navigator's; this is the half that needs the
 * tool's own vocabulary and the tool's own selection.
 */
function RowTrailing({ row }: { row: FlowNavigatorRow }) {
  if (row.type === "instance") return <CopyInstanceId flowId={row.instance.id} />;
  if (row.type === "session" && row.dispatchRun !== undefined) {
    return (
      <DispatchRunProvenance
        topic={row.session.topic}
        parentSessionId={row.dispatchRun.parentSessionId}
        parentInView={row.dispatchRun.parentInView}
        leafAddress={row.leaf.address}
      />
    );
  }
  return null;
}

/**
 * A dispatch run's label and the way back to what started it.
 *
 * The label is read off the run's derivation key — see `dispatchRunOrigin` for
 * what "re-used" can and cannot claim. The parent link opens the session that
 * started this one, whether or not it is one of the rows on screen: a run is an
 * ordinary session of the flow, so this is a selection, not a descent, and
 * there is nothing to come back from.
 *
 * ## Which copy the parent is opened under
 *
 * A session id is not addressable on its own — it is addressable under the flow
 * instance that owns it — and a cross-flow dispatch splits the two owners: the
 * RUN belongs to the instance it was sent to, while the session that sent it
 * belongs to the sender. Opening the parent under the run's owner is the defect
 * the removed descent trail used to cover by remembering each step's owner.
 *
 * So the owner is resolved rather than assumed:
 *
 * - **Parent on screen** — it is a row of this same leaf, and a leaf lists one
 *   flow address, so that address owns it. Nothing is read.
 * - **Parent not on screen** — its owner is unknowable from the rows in hand,
 *   so the click reads the parent record for it. One read, on an explicit
 *   navigation, and never during render: the list itself still fetches nothing.
 */
function DispatchRunProvenance({
  topic,
  parentSessionId,
  parentInView,
  leafAddress,
}: {
  topic?: string;
  parentSessionId: string;
  parentInView: boolean;
  leafAddress: string;
}) {
  const { selectWorkspace, sessionClient } = useDevTool();
  const origin = dispatchRunOrigin(topic);
  // Resolving the owner is a read, and a read takes time the operator does not
  // have to spend waiting: they can pick another session before it lands.
  // Honouring the answer then moves them off what they chose — the record is
  // right, it is simply no longer what was asked for.
  //
  // `isCurrent` rather than `begin`, per the fence's own contract: this read
  // writes no fenced state, it only decides a navigation, and taking a
  // sequence number would supersede whatever data read is genuinely in flight.
  const fence = useWorkspaceFence([]);

  const openParent = useCallback(async () => {
    if (parentInView) {
      selectWorkspace(leafAddress, parentSessionId);
      return;
    }
    try {
      const parent = await sessionClient.getSession(parentSessionId);
      if (!fence.isCurrent()) return;
      // A record written before owners were stamped carries none; the leaf we
      // are listing under is the only honest guess left, and it is the one the
      // rest of this rail already addresses by.
      selectWorkspace(parent.flowId ?? leafAddress, parentSessionId);
    } catch (err) {
      // Deliberately does NOT fall back to opening it somewhere: a session
      // opened under the wrong copy addresses every later read to that copy,
      // which is the failure this resolution exists to prevent.
      // eslint-disable-next-line no-console
      console.error("[devtool] could not resolve the parent session's flow", err);
    }
  }, [fence, parentInView, leafAddress, parentSessionId, selectWorkspace, sessionClient]);

  return (
    <>
      <span
        data-dispatch-run-origin={origin}
        title={
          origin === "re-used"
            ? "Dispatched work. This session is a worker seat's, re-entered by every row that seat runs."
            : "Dispatched work. A dispatcher started this session rather than a person."
        }
        className="rounded bg-slate-800 px-1 text-[9px] uppercase tracking-wide text-slate-400"
      >
        {origin}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        title={`Open the session that started this one: ${parentSessionId}`}
        aria-label={`Open parent session ${parentSessionId}`}
        data-open-parent-session={parentSessionId}
        onClick={() => void openParent()}
      >
        <RailIcon icon={ArrowUpRight} className="text-slate-500" />
      </Button>
    </>
  );
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
        <RailIcon icon={Check} className="text-green-400" />
      ) : (
        <RailIcon icon={Copy} className="text-slate-500" />
      )}
    </Button>
  );
}

/**
 * An open leaf's actions, on the leaf's own row: refresh, and start one.
 *
 * The navigator draws them after the row's copy button and does the aligning,
 * so they are bare buttons. A failed start is said on the row too, as an icon
 * whose text is announced and shown on hover, rather than a line under it.
 *
 * The failed and empty states of the LIST are the navigator's and are not
 * repeated here — it draws its own retry line and its own "no sessions yet",
 * and a second copy of either would disagree with the first the moment one of
 * them changed.
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
      {error !== null && (
        <span role="alert" title={error} className="inline-flex text-red-400">
          <RailIcon icon={CircleAlert} />
          <span className="sr-only">{error}</span>
        </span>
      )}
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
        <RailIcon
          icon={RefreshCw}
          className={`text-slate-500 ${leaf.isLoading ? "animate-spin" : ""}`}
        />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        onClick={() => void handleCreate()}
        title="New session"
      >
        <RailIcon icon={Plus} className="text-slate-500" />
      </Button>
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
