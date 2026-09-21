/**
 * Grouping the flow list into the rows a navigator draws (FIX-1477 S2).
 *
 * This is the level the flat instance list did not have. A flat list draws one
 * row per registered instance, so two copies of one kind are two top-level
 * rows and nothing about a row is derived from its kind — right for a tool
 * inspecting one server, wrong for a rail browsing a workforce, where the kind
 * is the thing you navigate by and the copies live under it.
 *
 * Pure, and separated from the component for that reason: the shape of the
 * rows is the part worth asserting on its own.
 */
import type { FlowListEntry } from "@flow-state-dev/client";

/** How a flow kind is addressed, and therefore how deep its rows go. */
export type FlowCardinality = FlowListEntry["cardinality"];

/**
 * A label and the kind names it covers. There is nothing else in a section,
 * and deliberately so — a section says *which* kinds, never how deep they go.
 *
 * `kinds` is omitted by a host that cannot name them. An app filtering on the
 * kinds it ships writes them down; a general inspector is pointed at whatever
 * server is running and learns the kind names by asking, so requiring the list
 * would make it read the flow list itself purely to hand the answer back —
 * one-read-per-host lost to a workaround rather than to a bug.
 *
 * Absent and empty are NOT the same. `kinds: []` is a filter that was named
 * and excludes everything; omitting it is a host that never had one. A host
 * deriving its filter starts with an empty array, and collapsing the two would
 * show it the whole server for the frame before its own list arrives.
 */
export type FlowNavigatorSection = {
  readonly label: string;
  readonly kinds?: readonly string[];
};

/**
 * The address a session list is read for: a singleton kind, or one instance of
 * a collection kind. Only a leaf is ever read; a collection's kind row is not
 * one.
 */
export type FlowNavigatorLeaf = {
  readonly kind: string;
  /** The flow address — a kind for a singleton, an instance id for a collection member. */
  readonly address: string;
  readonly cardinality: FlowCardinality;
};

/** One kind row, with whatever sits under it. */
export type FlowNavigatorKindGroup = {
  readonly kind: string;
  readonly cardinality: FlowCardinality;
  /**
   * The copies under a collection kind, in flow-list order. Empty for a
   * singleton, which has no instance level to draw.
   */
  readonly instances: readonly FlowListEntry[];
  /**
   * The singleton's own leaf — its id, which *is* its kind. `null` for a
   * collection kind, whose leaves are its instances.
   */
  readonly leaf: FlowNavigatorLeaf | null;
  /**
   * The flow-list entry `leaf` was built from, so a slot filling that leaf can
   * read what the flow DECLARES — its actions, whether it requires a user —
   * rather than reading the flow list a second time to find out. `null`
   * alongside a `null` leaf, for the same reason: a collection kind's entries
   * are its instances, and each instance row carries its own.
   */
  readonly entry: FlowListEntry | null;
};

/** One section's rows. */
export type FlowNavigatorSectionView = {
  readonly section: FlowNavigatorSection;
  readonly kinds: readonly FlowNavigatorKindGroup[];
};

/**
 * Group a flow list into sections of kind rows.
 *
 * A kind appears once however many instances carry it, and the instances hang
 * under it in the order the server listed them. A kind that no entry carries
 * is not drawn at all; a section that matches no kind comes back with an empty
 * `kinds`, which the component renders as an empty section rather than an
 * error.
 *
 * Cardinality is folded rather than taken from one entry: a kind is declared
 * once, so its entries agree, and where they somehow did not, reading the kind
 * as a collection keeps every copy addressable instead of filing them all
 * under a kind query that would mix them together.
 */
export function groupFlowsIntoSections(
  flows: readonly FlowListEntry[],
  sections: readonly FlowNavigatorSection[]
): readonly FlowNavigatorSectionView[] {
  return sections.map((section) => {
    // `undefined` is "every kind"; an array — including an empty one — is a
    // filter the host named and this honours exactly.
    const wanted = section.kinds === undefined ? null : new Set(section.kinds);
    const order: string[] = [];
    const byKind = new Map<string, FlowListEntry[]>();

    for (const entry of flows) {
      if (wanted !== null && !wanted.has(entry.kind)) continue;
      const existing = byKind.get(entry.kind);
      if (existing === undefined) {
        order.push(entry.kind);
        byKind.set(entry.kind, [entry]);
      } else {
        existing.push(entry);
      }
    }

    const kinds = order.map((kind): FlowNavigatorKindGroup => {
      const entries = byKind.get(kind) ?? [];
      const cardinality: FlowCardinality = entries.some(
        (entry) => entry.cardinality === "collection"
      )
        ? "collection"
        : "singleton";

      return cardinality === "collection"
        ? { kind, cardinality, instances: entries, leaf: null, entry: null }
        : {
            kind,
            cardinality,
            instances: [],
            leaf: { kind, address: entries[0]?.id ?? kind, cardinality },
            entry: entries[0] ?? null,
          };
    });

    return { section, kinds };
  });
}
