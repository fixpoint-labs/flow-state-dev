/**
 * Fake read sources for the `@flow-state-dev/react` workforce stories.
 *
 * `Roster`, `BoardColumns`, `WorkerDetail` and `FlowNavigator` each take the
 * client they read through as a prop (the slice of the one client they read), so a story drives every state from the
 * outside: a read that never settles is loading, a rejected read is the error
 * line, an empty page is empty. Each source is built once at module scope,
 * because the components fence their reads on the client's identity and a
 * fresh object every render would read as a rebuilt client.
 */
import type { FlowNavigatorProps } from "@flow-state-dev/react";
import type { PanelItemSource, PanelRowSource } from "@flow-state-dev/react/workforce";

type NavigatorClient = NonNullable<FlowNavigatorProps["client"]>;
type FlowSource = Pick<NavigatorClient, "flows">;
type SessionSource = NavigatorClient["sessions"];
type FlowEntry = Awaited<ReturnType<FlowSource["flows"]>>[number];
type SessionEntry = Awaited<ReturnType<SessionSource["list"]>>[number];

/** A promise that never settles, so a component stays on its loading render. */
const pending = <T>(): Promise<T> => new Promise<T>(() => {});

/** A collection that answers with these rows, one page. */
export function resourcesSource(rows: readonly { topic: string; clientData: unknown }[]): PanelRowSource {
  return { resources: { listCollectionResources: async () => ({ items: [...rows] }) } };
}

/** A collection read that never answers. */
export const loadingRowsSource: PanelRowSource = { resources: { listCollectionResources: () => pending() } };

/** A collection read that fails with this message. */
export function failingRowsSource(message: string): PanelRowSource {
  return {
    resources: {
      listCollectionResources: async () => {
        throw new Error(message);
      },
    },
  };
}

/** A single-item read that answers with this row, or `null` for an absent topic. */
export function itemSource(clientData: unknown): PanelItemSource {
  return {
    resources: {
      getCollectionResourceState: async (_sessionId, _ref, topic) =>
        clientData === null ? null : { topic, clientData },
    },
  };
}

/** A single-item read that never answers. */
export const loadingItemSource: PanelItemSource = { resources: { getCollectionResourceState: () => pending() } };

/** A single-item read that fails with this message. */
export function failingItemSource(message: string): PanelItemSource {
  return {
    resources: {
      getCollectionResourceState: async () => {
        throw new Error(message);
      },
    },
  };
}

/** One roster row, as the roster collection publishes it. */
export function rosterWorker(workerId: string, flow: string, instructions: string | null = null) {
  return { topic: workerId, clientData: { workerId, flow, instructions } };
}

/** One board row, as a board publishes it. */
export function boardTask(
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
  return { flows: async () => [...flows] };
}

/** A flow list read that never answers. */
export const loadingFlowsSource: FlowSource = { flows: () => pending() };

/** A flow list read that fails with this message. */
export function failingFlowsSource(message: string): FlowSource {
  return {
    flows: async () => {
      throw new Error(message);
    },
  };
}

/**
 * A session listing keyed by flow address: a singleton leaf is asked by its
 * flow kind, a collection's copy by its instance id.
 */
export function sessionsSource(byAddress: Readonly<Record<string, readonly SessionEntry[]>>): SessionSource {
  return {
    list: async (options) => [...(byAddress[options?.flowId ?? options?.flowKind ?? ""] ?? [])],
  };
}
