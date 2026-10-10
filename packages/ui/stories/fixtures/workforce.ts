/**
 * Fake read sources for the `@flow-state-dev/react` workforce stories.
 *
 * `Roster`, `BoardColumns`, `SeatDetail` and `FlowNavigator` each take the
 * client they read through as a prop, so a story drives every state from the
 * outside: a read that never settles is loading, a rejected read is the error
 * line, an empty page is empty. Each source is built once at module scope,
 * because the components fence their reads on the client's identity and a
 * fresh object every render would read as a rebuilt client.
 */
import type {
  FlowNavigatorProps,
  PanelItemSource,
  PanelRowSource,
} from "@flow-state-dev/react";

type FlowSource = NonNullable<FlowNavigatorProps["client"]>;
type SessionSource = NonNullable<FlowNavigatorProps["sessionClient"]>;
type FlowEntry = Awaited<ReturnType<FlowSource["listFlows"]>>[number];
type SessionEntry = Awaited<ReturnType<SessionSource["listSessions"]>>[number];

/** A promise that never settles, so a component stays on its loading render. */
const pending = <T>(): Promise<T> => new Promise<T>(() => {});

/** A collection that answers with these rows, one page. */
export function rowsSource(rows: readonly { topic: string; clientData: unknown }[]): PanelRowSource {
  return { listCollectionItems: async () => ({ items: [...rows] }) };
}

/** A collection read that never answers. */
export const loadingRowsSource: PanelRowSource = { listCollectionItems: () => pending() };

/** A collection read that fails with this message. */
export function failingRowsSource(message: string): PanelRowSource {
  return {
    listCollectionItems: async () => {
      throw new Error(message);
    },
  };
}

/** A single-item read that answers with this row, or `null` for an absent topic. */
export function itemSource(clientData: unknown): PanelItemSource {
  return {
    getCollectionItemState: async (_sessionId, _ref, topic) =>
      clientData === null ? null : { topic, clientData },
  };
}

/** A single-item read that never answers. */
export const loadingItemSource: PanelItemSource = { getCollectionItemState: () => pending() };

/** A single-item read that fails with this message. */
export function failingItemSource(message: string): PanelItemSource {
  return {
    getCollectionItemState: async () => {
      throw new Error(message);
    },
  };
}

/** One roster row, as the roster collection publishes it. */
export function rosterRow(seatId: string, flow: string, instructions: string | null = null) {
  return { topic: seatId, clientData: { seatId, flow, instructions } };
}

/** One board row, as a board publishes it. */
export function boardRow(
  id: string,
  status: string,
  card: { title?: string; goal?: string; assignee?: string; error?: string } = {}
) {
  return { topic: id, clientData: { id, status, ...card } };
}

/** One entry in the flow list. */
export function flowEntry(id: string, kind: string, cardinality: FlowEntry["cardinality"]): FlowEntry {
  return { id, kind, cardinality, requireUser: false, actions: [] };
}

/** One session in a leaf's listing. */
export function sessionEntry(id: string, flowKind: string, title?: string): SessionEntry {
  return {
    id,
    flowKind,
    userId: "story-user",
    createdAt: 0,
    updatedAt: 0,
    ...(title === undefined ? {} : { title }),
  };
}

/** A flow list that answers with these flows. */
export function flowsSource(flows: readonly FlowEntry[]): FlowSource {
  return { listFlows: async () => [...flows] };
}

/** A flow list read that never answers. */
export const loadingFlowsSource: FlowSource = { listFlows: () => pending() };

/** A flow list read that fails with this message. */
export function failingFlowsSource(message: string): FlowSource {
  return {
    listFlows: async () => {
      throw new Error(message);
    },
  };
}

/**
 * A session listing keyed by flow address: a singleton leaf is asked by its
 * kind, a collection member by its instance id.
 */
export function sessionsSource(byAddress: Readonly<Record<string, readonly SessionEntry[]>>): SessionSource {
  return {
    listSessions: async (options) => [...(byAddress[options?.flowId ?? options?.flowKind ?? ""] ?? [])],
  };
}
