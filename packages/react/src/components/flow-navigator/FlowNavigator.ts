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
 */
import { createElement, useCallback, useMemo, useState, type ReactNode } from "react";
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
  type FlowNavigatorSessionSource
} from "./reads";

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
  /** Beside any row's name. */
  readonly rowTrailing?: (row: FlowNavigatorRow) => ReactNode;
  /** The strip inside an open leaf, above its sessions. */
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
  "onSelectSession",
  "sections",
  "selectedSessionId",
  "sessionClient",
  "slots",
  "userId"
] as const;

const INDENT_STEP = 12;

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
    gap: 6,
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
 */
function row(options: {
  readonly depth: number;
  readonly isSelected?: boolean;
  readonly button: Record<string, unknown>;
  readonly content: readonly ReactNode[];
  readonly trailing: ReactNode;
}): ReactNode {
  const { depth, isSelected = false, button, content, trailing } = options;

  return createElement(
    "div",
    { style: rowContainerStyle(isSelected) },
    createElement(
      "button",
      { type: "button", ...button, style: rowButtonStyle(depth) },
      ...content
    ),
    trailing === undefined || trailing === null || trailing === false
      ? null
      : createElement("span", { style: trailingStyle }, trailing)
  );
}

function noteStyle(depth: number): Record<string, unknown> {
  return {
    margin: 0,
    padding: `4px 8px 4px ${8 + depth * INDENT_STEP}px`,
    fontSize: "var(--fsd-nav-note-font-size, 11px)",
    color: "var(--fsd-nav-muted-fg, inherit)"
  };
}

const bareList = { listStyle: "none", margin: 0, padding: 0 } as const;

/** `▾`/`▸` as text, because the package ships no icon set. */
function twisty(isOpen: boolean): ReactNode {
  return createElement(
    "span",
    { "aria-hidden": "true", style: { width: 10, flexShrink: 0 } },
    isOpen ? "▾" : "▸"
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
 * A leaf's session list, mounted only while the leaf is open.
 *
 * Mounting IS the gate: no open leaf, no hook, no request. Collapsing unmounts
 * it, which retires its fence, so a response that arrives afterwards has
 * nothing to write to.
 */
function LeafSessionList(props: {
  readonly leaf: FlowNavigatorLeaf;
  readonly depth: number;
  readonly source: FlowNavigatorSessionSource;
  readonly userId: string | undefined;
  readonly selectedSessionId: string | undefined;
  readonly onSelectSession: (sessionId: string, leaf: FlowNavigatorLeaf) => void;
  readonly slots: FlowNavigatorSlots;
}): ReactNode {
  const { leaf, depth, source, userId, selectedSessionId, onSelectSession, slots } = props;
  const state = useLeafSessions(source, leaf, userId);

  const toolbar = slots.leafToolbar?.({
    ...leaf,
    sessions: state.sessions,
    isLoading: state.isLoading,
    error: state.error,
    refresh: state.refresh
  });

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
          : state.sessions.map((session) => {
              const isSelected = selectedSessionId === session.id;
              return createElement(
                "li",
                { key: session.id },
                row({
                  depth,
                  isSelected,
                  button: {
                    "aria-current": isSelected ? "true" : undefined,
                    "data-session-id": session.id,
                    onClick: () => onSelectSession(session.id, leaf)
                  },
                  content: [
                    createElement("span", { style: label }, session.title ?? session.id)
                  ],
                  trailing: slots.rowTrailing?.({
                    type: "session",
                    leaf,
                    session,
                    isSelected
                  })
                })
              );
            });

  return createElement(
    "ul",
    { "data-leaf": leaf.address, style: bareList },
    toolbar === undefined || toolbar === null
      ? null
      : createElement(
          "li",
          { role: "none", style: { padding: `2px 8px 2px ${8 + depth * INDENT_STEP}px` } },
          toolbar
        ),
    rows
  );
}

/** One kind row, plus whatever the flow's cardinality puts under it. */
function KindRow(props: {
  readonly group: FlowNavigatorKindGroup;
  readonly open: ReadonlySet<string>;
  readonly toggle: (key: string) => void;
  readonly source: FlowNavigatorSessionSource;
  readonly userId: string | undefined;
  readonly selectedSessionId: string | undefined;
  readonly onSelectSession: (sessionId: string, leaf: FlowNavigatorLeaf) => void;
  readonly slots: FlowNavigatorSlots;
}): ReactNode {
  const { group, open, toggle, source, userId, selectedSessionId, onSelectSession, slots } =
    props;
  const isOpen = open.has(`kind:${group.kind}`);

  const leafProps = {
    source,
    userId,
    selectedSessionId,
    onSelectSession,
    slots
  };

  const children = !isOpen
    ? null
    : group.leaf !== null
      ? // A singleton's kind row IS its leaf: there is no copy to pick, so the
        // instance level is not drawn and the sessions hang directly under it.
        createElement(LeafSessionList, {
          leaf: group.leaf,
          depth: 1,
          ...leafProps
        })
      : createElement(
          "ul",
          { style: bareList },
          ...group.instances.map((instance) => {
            const key = `instance:${instance.id}`;
            const instanceOpen = open.has(key);
            const leaf: FlowNavigatorLeaf = {
              kind: group.kind,
              address: instance.id,
              cardinality: "collection"
            };

            return createElement(
              "li",
              { key: instance.id },
              row({
                depth: 1,
                button: {
                  "aria-expanded": instanceOpen,
                  "data-instance-id": instance.id,
                  onClick: () => toggle(key)
                },
                content: [
                  twisty(instanceOpen),
                  createElement("span", { style: label }, instance.id)
                ],
                trailing: slots.rowTrailing?.({
                  type: "instance",
                  kind: group.kind,
                  instance,
                  isOpen: instanceOpen
                })
              }),
              instanceOpen
                ? createElement(LeafSessionList, {
                    leaf,
                    depth: 2,
                    ...leafProps
                  })
                : null
            );
          })
        );

  return createElement(
    "li",
    null,
    row({
      depth: 0,
      button: {
        "aria-expanded": isOpen,
        "data-kind": group.kind,
        "data-cardinality": group.cardinality,
        onClick: () => toggle(`kind:${group.kind}`)
      },
      content: [twisty(isOpen), createElement("span", { style: label }, group.kind)],
      trailing: slots.rowTrailing?.({
        type: "kind",
        kind: group.kind,
        cardinality: group.cardinality,
        isOpen
      })
    }),
    children
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
                createElement(KindRow, {
                  key: group.kind,
                  group,
                  open,
                  toggle,
                  source: sources.sessions,
                  userId,
                  selectedSessionId: props.selectedSessionId,
                  onSelectSession: props.onSelectSession,
                  slots
                })
              )
            )
      )
    )
  );
}

export type { FlowNavigatorLeaf, FlowNavigatorSection } from "./grouping";
