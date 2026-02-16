/**
 * Flow registry primitives for server-side flow lookup by kind/id.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";

/**
 * Registry contract used by server routing/execution layers.
 */
export interface FlowRegistry {
  register(flow: FlowInstance): void;
  registerMany(flows: FlowInstance[]): void;
  get(kind: string, id?: string): FlowInstance | undefined;
  list(): FlowInstance[];
}

/**
 * In-memory flow registry implementation for runtime and tests.
 */
export class InMemoryFlowRegistry implements FlowRegistry {
  private readonly flowsByKind = new Map<string, Map<string, FlowInstance>>();

  /**
   * Registers a single flow instance. Duplicate `(kind,id)` is rejected.
   */
  register(flow: FlowInstance): void {
    let byId = this.flowsByKind.get(flow.kind);
    if (byId === undefined) {
      byId = new Map<string, FlowInstance>();
      this.flowsByKind.set(flow.kind, byId);
    }

    if (byId.has(flow.id)) {
      throw new Error(
        `Flow "${flow.kind}" with id "${flow.id}" is already registered`
      );
    }

    byId.set(flow.id, flow);
  }

  /**
   * Registers multiple flow instances.
   */
  registerMany(flows: FlowInstance[]): void {
    for (const flow of flows) {
      this.register(flow);
    }
  }

  /**
   * Resolves a flow by kind and optional id. Without id, returns a deterministic default.
   */
  get(kind: string, id?: string): FlowInstance | undefined {
    const byId = this.flowsByKind.get(kind);
    if (byId === undefined) {
      return undefined;
    }

    if (id !== undefined) {
      return byId.get(id);
    }

    // Prefer kind-matching id when present, otherwise first registered instance.
    return byId.get(kind) ?? byId.values().next().value;
  }

  /**
   * Lists all registered flows in deterministic order.
   */
  list(): FlowInstance[] {
    const kinds = Array.from(this.flowsByKind.keys()).sort((left, right) =>
      left.localeCompare(right)
    );
    const result: FlowInstance[] = [];

    for (const kind of kinds) {
      const byId = this.flowsByKind.get(kind);
      if (byId === undefined) {
        continue;
      }

      const ids = Array.from(byId.keys()).sort((left, right) =>
        left.localeCompare(right)
      );
      for (const id of ids) {
        const flow = byId.get(id);
        if (flow !== undefined) {
          result.push(flow);
        }
      }
    }

    return result;
  }
}

/**
 * Creates an empty in-memory flow registry.
 */
export function createFlowRegistry(): FlowRegistry {
  return new InMemoryFlowRegistry();
}
