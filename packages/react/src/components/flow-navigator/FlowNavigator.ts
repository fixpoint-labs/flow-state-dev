/**
 * `FlowNavigator` — the rail that browses your flows (FIX-1477 S4).
 *
 * It browses *flows*, not a workforce: kinds, the copies under a kind, and
 * those copies' sessions. One mount holds every section, so there is one flow
 * list read, one keyboard order, one scroll container and one selection.
 *
 * How deep a section goes is never told to it. Depth is read off each flow's
 * declared cardinality, which is why there is no `depth`, no `levels` and no
 * per-kind override on the props: a depth passed in would be a second opinion
 * about the host's own flow, and it would be wrong the first time that flow
 * changed shape.
 *
 * Nothing here publishes a class name, and the package brings no CSS framework
 * and no icon set. A host themes it by setting the `--fsd-nav-*` custom
 * properties on any ancestor, and fills the parts that are its own through
 * slots.
 *
 * Every level starts its labels on one column, one twisty's width right of its
 * parent's, and a dashed line (`--fsd-nav-guide`) runs down from each open
 * row past everything under it. A row's slot content shows while the row is
 * pointed at, focused into or selected, and always on a screen with no hover.
 */
import {
  Fragment,
  createElement,
  useCallback,
  useMemo,
  useState,
  type FocusEvent,
  type ReactNode
} from "react";
import {
  createClient,
  createSessionClient,
  type FlowListEntry,
  type SessionSummary
} from "@flow-state-dev/client";
import { useFlowContext } from "../../context/FlowContext";
import {
  groupFlowsIntoSections,
  type FlowNavigatorKindGroup,
  type FlowNavigatorLeaf,
  type FlowNavigatorSection
} from "./grouping";
import {
  useFlowInventory,
  useLeafSessions,
  type FlowNavigatorFlowSource,
  type FlowNavigatorSessionSource,
  type LeafSessions
} from "./reads";
import { arrangeSessionRows, type SessionRow } from "./dispatch-runs";

/** A leaf, plus the state of its session list — what a slot is handed. */
export type FlowNavigatorLeafState = FlowNavigatorLeaf & {
  readonly sessions: readonly SessionSummary[];
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Re-read this leaf's sessions. Safe to call from a host affordance. */
  readonly refresh: () => void;
};

/** Which row a slot is being asked to fill. */
export type FlowNavigatorRow =
  | {
      readonly type: "kind";
      readonly kind: string;
      readonly cardinality: FlowNavigatorLeaf["cardinality"];
      readonly isOpen: boolean;
    }
  | {
      readonly type: "instance";
      readonly kind: string;
      readonly instance: FlowListEntry;
      readonly isOpen: boolean;
    }
  | {
      readonly type: "session";
      readonly leaf: FlowNavigatorLeaf;
      readonly session: SessionSummary;
      readonly isSelected: boolean;
      /**
       * Present when a dispatcher started this session rather than a person
       * (FIX-1440). `parentSessionId` is the session it was started from, and
       * `parentInView` says whether that session is one of the rows on screen
       * — a run whose parent is not in the listing is drawn at the left margin
       * and still carries its provenance.
       */
      readonly dispatchRun?: {
        readonly parentSessionId: string;
        readonly parentInView: boolean;
      };
    };

/**
 * The parts of the rail that belong to the host rather than to the component.
 *
 * Every slot is optional and the navigator renders without any of them. They
 * exist so a host's own affordances — copying an instance id, starting a
 * session, refreshing a list — live in the host that wants them instead of
 * being a reason to keep a second navigator.
 */
export type FlowNavigatorSlots = {
  /** Beside a section's label. */
  readonly sectionHeader?: (section: FlowNavigatorSection) => ReactNode;
  /**
   * At the end of any row. Shown while the row is pointed at, has focus inside
   * it or is selected, and always on a screen with no hover; hidden content
   * keeps its space and stays reachable with Tab.
   */
  readonly rowTrailing?: (row: FlowNavigatorRow) => ReactNode;
  /**
   * An open leaf's actions, drawn on that leaf's own row after `rowTrailing`'s
   * content and revealed the same way. Mounted when the leaf opens, unmounted
   * when it closes. It shares one line with the row's label, so give it icon
   * buttons with an `aria-label`, not text.
   */
  readonly leafToolbar?: (leaf: FlowNavigatorLeafState) => ReactNode;
  /** What a section covering no registered kind says. */
  readonly emptySection?: (section: FlowNavigatorSection) => ReactNode;
};

export type FlowNavigatorProps = {
  /** A label and a set of kind names, per section. Never a depth. */
  readonly sections: readonly FlowNavigatorSection[];
  /** Called with the picked session and the leaf it was listed under. */
  readonly onSelectSession: (sessionId: string, leaf: FlowNavigatorLeaf) => void;
  /** The session to mark as current. Selection is the host's to keep. */
  readonly selectedSessionId?: string;
  /** Falls back to the nearest `FlowProvider`'s `userId`. */
  readonly userId?: string;
  /**
   * The host's own client, so flow reads carry the host's transport.
   *
   * Pass a STABLE reference — one held in a context or a `useMemo`, not an
   * object literal built during render. The reads are fenced on the client
   * they were made through, which is what makes a rebuilt client discard the
   * previous backend's rows; a fresh object every render reads as a rebuilt
   * client every render.
   */
  readonly client?: FlowNavigatorFlowSource;
  /** The host's own session client, so leaf reads carry the host's transport. Stable, as above. */
  readonly sessionClient?: FlowNavigatorSessionSource;
  /**
   * Also list the sessions a dispatcher ran work in, drawn one level under the
   * session that started each one (FIX-1440).
   *
   * Off by default, matching the server: a host that does not ask lists the
   * sessions a person started, exactly as before. A tool that inspects a
   * running server asks; a product surface showing someone their own
   * conversations usually does not.
   */
  readonly includeDispatchRuns?: boolean;
  readonly slots?: FlowNavigatorSlots;
};

/**
 * The published prop names, as a value.
 *
 * Kept so the allow-list can be asserted rather than described. The type test
 * beside it proves this list and `keyof FlowNavigatorProps` are the same set,
 * so adding a `depth`, a `levels` or an `orgId` fails whether or not whoever
 * added it remembered this array.
 */
export const flowNavigatorPropNames = [
  "client",
  "includeDispatchRuns",
  "onSelectSession",
  "sections",
  "selectedSessionId",
  "sessionClient",
  "slots",
  "userId"
] as const;

/** The twisty's column. Every row reserves it, whether or not it can open. */
const TWISTY = 10;
const GAP = 6;
/**
 * One level is exactly the twisty column, so a child's twisty sits under its
 * parent's label and every label at one level starts at one x.
 */
const INDENT_STEP = TWISTY + GAP;

const ENGINE_ID = /^([a-z]+)_\d{13}_([0-9a-f]{6,})$/;

/**
 * What a session row reads: its title, else an engine-minted id shortened to
 * its prefix and its last six characters (`sess_…3df102`), else the id whole.
 * The tail is kept rather than the head because ids minted months apart share
 * their first digits.
 */
function sessionLabel(session: SessionSummary): string {
  if (session.title != null && session.title.trim() !== "") return session.title;
  const match = ENGINE_ID.exec(session.id);
  return match === null ? session.id : `${match[1]}_…${match[2]!.slice(-6)}`;
}

const label = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
} as const;

/** The row's frame. Carries the highlight, so it spans the trailing slot too. */
function rowContainerStyle(isSelected: boolean): Record<string, unknown> {
  return {
    display: "flex",
    alignItems: "center",
    width: "100%",
    boxSizing: "border-box",
    color: isSelected
      ? "var(--fsd-nav-selected-fg, inherit)"
      : "var(--fsd-nav-fg, inherit)",
    background: isSelected
      ? "var(--fsd-nav-selected-bg, rgba(127, 127, 127, 0.25))"
      : "transparent"
  };
}

/** The row's activation target. The indent lives here, on the thing you click. */
function rowButtonStyle(depth: number): Record<string, unknown> {
  return {
    display: "flex",
    alignItems: "center",
    gap: GAP,
    flex: 1,
    // Without this a flex child refuses to shrink below its content, and the
    // label's ellipsis never engages.
    minWidth: 0,
    boxSizing: "border-box",
    padding: `4px 4px 4px ${8 + depth * INDENT_STEP}px`,
    border: "none",
    textAlign: "left",
    font: "inherit",
    fontSize: "var(--fsd-nav-font-size, 13px)",
    cursor: "pointer",
    color: "inherit",
    background: "transparent"
  };
}

const trailingStyle = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  flexShrink: 0,
  paddingRight: 8
} as const;

/** What a slot returns when it has nothing to draw. */
function isBlank(node: ReactNode): boolean {
  return node === undefined || node === null || node === false;
}

/** No hover pointer (a phone, a tablet): nothing can reveal the actions, so show them. */
function screenHasNoHover(): boolean {
  return typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
}

/**
 * One row: its activation button, and the host's trailing content BESIDE it.
 *
 * The trailing slot is a sibling of the button, never a child, and that is the
 * whole reason this helper exists. A host fills the slot with its own
 * affordances — copy this id, start a session — which are buttons and links.
 * An interactive element nested inside another is invalid markup that keyboard
 * and assistive-technology traversal cannot represent, and it leaves the host's
 * click nowhere to go but up into the row handler, so pressing "copy" would
 * expand the row as well.
 *
 * The highlight sits on the container so it spans both, and the indent stays on
 * the button so the thing you click is the thing that is indented.
 *
 * The trailing area is invisible until the row is pointed at, holds focus, or
 * is selected. Invisible, never removed: it keeps its width, so nothing on the
 * row moves when it appears, and its controls stay in the tab order, so
 * tabbing to one is what reveals it. The state is the row's own, so pointing
 * at one row re-renders no other.
 */
function Row(props: {
  readonly depth: number;
  readonly isSelected?: boolean;
  readonly button: Record<string, unknown>;
  readonly content: readonly ReactNode[];
  readonly trailing: ReactNode;
}): ReactNode {
  const { depth, isSelected = false, button, content, trailing } = props;
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  const shown = pointed || focused || isSelected || screenHasNoHover();

  return createElement(
    "div",
    {
      style: rowContainerStyle(isSelected),
      onMouseEnter: () => setPointed(true),
      onMouseLeave: () => setPointed(false),
      onFocus: () => setFocused(true),
      onBlur: (event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }
    },
    createElement(
      "button",
      { type: "button", ...button, style: rowButtonStyle(depth) },
      ...content
    ),
    isBlank(trailing)
      ? null
      : createElement("span", { style: { ...trailingStyle, opacity: shown ? 1 : 0 } }, trailing)
  );
}

/** A note stands in for the rows at `depth`, so it starts on their label column. */
function noteStyle(depth: number): Record<string, unknown> {
  return {
    margin: 0,
    padding: `4px 8px 4px ${8 + depth * INDENT_STEP + INDENT_STEP}px`,
    fontSize: "var(--fsd-nav-note-font-size, 11px)",
    color: "var(--fsd-nav-muted-fg, inherit)"
  };
}

const bareList = { listStyle: "none", margin: 0, padding: 0 } as const;

/** An open row's child list: positioned, so its tree line can hang in it. */
const childList = { ...bareList, position: "relative" } as const;

/**
 * The dashed line down an open parent's children, on the centre of the
 * parent's twisty column. It runs the whole list, past any open child's own
 * rows, and a note included. Decorative: hidden from assistive technology,
 * out of flow so it moves no row, and drawn over a selected row's highlight.
 * `--fsd-nav-guide` colours it; `transparent` hides it.
 */
function treeLine(parentDepth: number): ReactNode {
  return createElement("li", {
    "aria-hidden": "true",
    role: "presentation",
    style: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 8 + parentDepth * INDENT_STEP + TWISTY / 2 - 0.5,
      width: 0,
      borderLeftWidth: 1,
      borderLeftStyle: "dashed",
      borderLeftColor: "var(--fsd-nav-guide, rgba(127, 127, 127, 0.45))",
      pointerEvents: "none"
    }
  });
}

/**
 * `▾`/`▸` as text, because the package ships no icon set. `null` is a row that
 * cannot open: its column is still reserved, so its label lines up.
 */
function twisty(isOpen: boolean | null): ReactNode {
  return createElement(
    "span",
    { "aria-hidden": "true", style: { width: TWISTY, flexShrink: 0 } },
    isOpen === null ? "" : isOpen ? "▾" : "▸"
  );
}

function retryLine(message: string, onRetry: () => void, depth: number): ReactNode {
  return createElement(
    "div",
    { style: noteStyle(depth), role: "alert" },
    message,
    " ",
    createElement(
      "button",
      { type: "button", onClick: onRetry, style: { font: "inherit", cursor: "pointer" } },
      "Retry"
    )
  );
}

/**
 * What a row says about its provenance, if anything.
 *
 * A run drawn at depth 0 is one whose parent is not in this listing — the
 * provenance is still true, so the slot still receives it; only the indent is
 * withheld, because there is nothing on screen to indent under.
 */
function describeDispatchRun(
  entry: SessionRow
): { parentSessionId: string; parentInView: boolean } | undefined {
  if (entry.parentSessionId === undefined) return undefined;
  return { parentSessionId: entry.parentSessionId, parentInView: entry.depth === 1 };
}

/** What every leaf row needs to read its sessions and draw them. */
type LeafContext = {
  readonly source: FlowNavigatorSessionSource;
  readonly userId: string | undefined;
  readonly selectedSessionId: string | undefined;
  readonly includeDispatchRuns: boolean;
  readonly onSelectSession: (sessionId: string, leaf: FlowNavigatorLeaf) => void;
  readonly slots: FlowNavigatorSlots;
};

/** An open leaf's session list, drawn from the read its row holds. */
function SessionList(props: {
  readonly leaf: FlowNavigatorLeaf;
  readonly depth: number;
  readonly state: LeafSessions;
  readonly context: LeafContext;
}): ReactNode {
  const { leaf, depth, state, context } = props;
  const { selectedSessionId, onSelectSession, slots } = context;
  // Arranged, not re-sorted: the listing's order is the server's, and this only
  // moves a dispatch run to sit under the session that started it. With the
  // include off there are no runs in the list and every row comes back at
  // depth 0 in the order it arrived.
  const arranged = useMemo(() => arrangeSessionRows(state.sessions), [state.sessions]);

  const rows =
    state.error !== null
      ? createElement("li", { role: "none" }, retryLine(state.error, state.refresh, depth))
      : state.isLoading && state.sessions.length === 0
        ? createElement(
            "li",
            { role: "none" },
            createElement("p", { style: noteStyle(depth) }, "Loading sessions…")
          )
        : state.sessions.length === 0
          ? createElement(
              "li",
              { role: "none" },
              createElement("p", { style: noteStyle(depth) }, "No sessions yet")
            )
          : arranged.map((entry) => {
              const { session } = entry;
              const isSelected = selectedSessionId === session.id;
              const dispatchRun = describeDispatchRun(entry);
              return createElement(
                "li",
                { key: session.id },
                createElement(Row, {
                  // One level under the session that started it, and never a
                  // second: `entry.depth` is 0 or 1 by construction.
                  depth: depth + entry.depth,
                  isSelected,
                  button: {
                    "aria-current": isSelected ? "true" : undefined,
                    "data-session-id": session.id,
                    title: session.id,
                    ...(dispatchRun === undefined
                      ? {}
                      : { "data-dispatch-run-of": dispatchRun.parentSessionId }),
                    onClick: () => onSelectSession(session.id, leaf)
                  },
                  content: [
                    twisty(null),
                    createElement("span", { style: label }, sessionLabel(session))
                  ],
                  trailing: slots.rowTrailing?.({
                    type: "session",
                    leaf,
                    session,
                    isSelected,
                    ...(dispatchRun === undefined ? {} : { dispatchRun })
                  })
                })
              );
            });

  return createElement(
    "ul",
    { "data-leaf": leaf.address, style: childList },
    treeLine(depth - 1),
    rows
  );
}

/**
 * A leaf's row — a singleton's kind row, or one copy under a collection — and
 * its sessions while it is open.
 *
 * Mounted whether or not the leaf is open, so the row that opens it is never
 * replaced and keeps focus. What waits for the leaf to open is the read: a
 * closed leaf asks the server nothing, and closing retires a read in flight.
 * The host's toolbar joins the row's own trailing content, so it draws on
 * this row and mounts and unmounts with the leaf.
 */
function LeafRow(props: {
  readonly leaf: FlowNavigatorLeaf;
  readonly depth: number;
  readonly isOpen: boolean;
  readonly name: string;
  readonly button: Record<string, unknown>;
  readonly trailing: ReactNode;
  readonly context: LeafContext;
}): ReactNode {
  const { leaf, depth, isOpen, name, button, trailing, context } = props;
  const state = useLeafSessions(
    context.source,
    leaf,
    context.userId,
    context.includeDispatchRuns,
    isOpen
  );

  const toolbar = isOpen
    ? context.slots.leafToolbar?.({
        ...leaf,
        sessions: state.sessions,
        isLoading: state.isLoading,
        error: state.error,
        refresh: state.refresh
      })
    : null;

  return createElement(
    "li",
    null,
    createElement(Row, {
      depth,
      button,
      content: [twisty(isOpen), createElement("span", { style: label }, name)],
      // One fragment whenever there is anything to draw, so opening adds the
      // toolbar after the row's own content without remounting that content.
      // Nothing at all draws no trailing area, whose padding would otherwise
      // cut the label short.
      trailing:
        isBlank(trailing) && isBlank(toolbar)
          ? null
          : createElement(Fragment, null, trailing, toolbar)
    }),
    isOpen ? createElement(SessionList, { leaf, depth: depth + 1, state, context }) : null
  );
}

/** One kind row, plus whatever the flow's cardinality puts under it. */
function KindRow(props: {
  readonly group: FlowNavigatorKindGroup;
  readonly open: ReadonlySet<string>;
  readonly toggle: (key: string) => void;
  readonly context: LeafContext;
}): ReactNode {
  const { group, open, toggle, context } = props;
  const isOpen = open.has(`kind:${group.kind}`);
  const button = {
    "aria-expanded": isOpen,
    "data-kind": group.kind,
    "data-cardinality": group.cardinality,
    onClick: () => toggle(`kind:${group.kind}`)
  };
  const trailing = context.slots.rowTrailing?.({
    type: "kind",
    kind: group.kind,
    cardinality: group.cardinality,
    isOpen
  });

  // A singleton's kind row IS its leaf: there is no copy to pick, so the
  // instance level is not drawn and the sessions hang directly under it.
  if (group.leaf !== null) {
    return createElement(LeafRow, {
      leaf: group.leaf,
      depth: 0,
      isOpen,
      name: group.kind,
      button,
      trailing,
      context
    });
  }

  return createElement(
    "li",
    null,
    createElement(Row, {
      depth: 0,
      button,
      content: [twisty(isOpen), createElement("span", { style: label }, group.kind)],
      trailing
    }),
    isOpen
      ? createElement(
          "ul",
          { style: childList },
          treeLine(0),
          ...group.instances.map((instance) => {
            const key = `instance:${instance.id}`;
            const instanceOpen = open.has(key);
            return createElement(LeafRow, {
              key: instance.id,
              leaf: { kind: group.kind, address: instance.id, cardinality: "collection" },
              depth: 1,
              isOpen: instanceOpen,
              name: instance.id,
              button: {
                "aria-expanded": instanceOpen,
                "data-instance-id": instance.id,
                onClick: () => toggle(key)
              },
              trailing: context.slots.rowTrailing?.({
                type: "instance",
                kind: group.kind,
                instance,
                isOpen: instanceOpen
              }),
              context
            });
          })
        )
      : null
  );
}

/**
 * The clients the navigator reads through when the host supplied none.
 *
 * A component that always built its own would list flows successfully against
 * an authenticating deployment — that route is exempt from authorization — and
 * then fail every session read under it. So the host's clients win, and these
 * exist only for the unauthenticated case.
 */
function useDefaultSources(
  client: FlowNavigatorFlowSource | undefined,
  sessionClient: FlowNavigatorSessionSource | undefined,
  userId: string | undefined,
  baseUrl: string | undefined
): { flows: FlowNavigatorFlowSource; sessions: FlowNavigatorSessionSource } {
  // Memoised so the fences below key on one stable object. A fresh client each
  // render would retire and re-open every read, forever.
  return useMemo(
    () => ({
      flows:
        client ??
        // `flowKind` is required to build a client and unused by `listFlows`,
        // which addresses the server's whole registry.
        createClient({ flowKind: "flow-navigator", userId: userId ?? "anonymous", baseUrl }),
      sessions: sessionClient ?? createSessionClient({ baseUrl })
    }),
    [client, sessionClient, userId, baseUrl]
  );
}

/**
 * The rail. One mount, one flow-list read, one scroll container.
 */
export function FlowNavigator(props: FlowNavigatorProps): ReactNode {
  const context = useFlowContext();
  const userId = props.userId ?? context.userId;
  const slots = props.slots ?? {};

  const sources = useDefaultSources(
    props.client,
    props.sessionClient,
    userId,
    context.baseUrl
  );

  const inventory = useFlowInventory(sources.flows);
  const views = useMemo(
    () => groupFlowsIntoSections(inventory.flows, props.sections),
    [inventory.flows, props.sections]
  );

  // "Nothing registered" is a claim about the server, and only a flow list that
  // SUCCEEDED supports one. Two states have no answer to report: a read still
  // in flight, and a read that failed. The failure is reported once, above,
  // with its retry — repeating it per section as "no seats on this server"
  // would be the same missing answer wearing a confident face.
  const answered = !inventory.isLoading && inventory.error === null;

  const leafContext: LeafContext = {
    source: sources.sessions,
    userId,
    selectedSessionId: props.selectedSessionId,
    includeDispatchRuns: props.includeDispatchRuns ?? false,
    onSelectSession: props.onSelectSession,
    slots
  };

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set<string>());
  const toggle = useCallback((key: string) => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return createElement(
    "nav",
    {
      "data-fsd-flow-navigator": "",
      // The one scroll container. Every level below indents inside it, so a
      // fully expanded rail scrolls as a single list rather than nesting a
      // scrollbar inside 256 pixels.
      style: {
        overflowY: "auto",
        height: "100%",
        color: "var(--fsd-nav-fg, inherit)",
        background: "var(--fsd-nav-bg, transparent)"
      }
    },
    inventory.error !== null ? retryLine(inventory.error, inventory.refresh, 0) : null,
    ...views.map((view) =>
      createElement(
        "section",
        { key: view.section.label },
        createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 8px 4px",
              fontSize: "var(--fsd-nav-section-font-size, 11px)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--fsd-nav-muted-fg, inherit)"
            }
          },
          createElement("span", { style: { flex: 1 } }, view.section.label),
          slots.sectionHeader?.(view.section)
        ),
        view.kinds.length === 0
          ? !answered
            ? inventory.error !== null
              ? null
              : createElement("p", { style: noteStyle(0) }, "Loading flows…")
            : // Not an error, and the other sections are unaffected: a kind the
              // server does not have is a section with nothing in it.
              (slots.emptySection?.(view.section) ??
                createElement(
                  "p",
                  { style: noteStyle(0), "data-empty-section": view.section.label },
                  `No ${view.section.label.toLowerCase()} on this server`
                ))
          : createElement(
              "ul",
              { "aria-label": view.section.label, style: bareList },
              ...view.kinds.map((group) =>
                createElement(KindRow, { key: group.kind, group, open, toggle, context: leafContext })
              )
            )
      )
    )
  );
}

export type { FlowNavigatorLeaf, FlowNavigatorSection } from "./grouping";
