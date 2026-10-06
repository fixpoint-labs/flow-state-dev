/**
 * FIX-1789 POC · shape A: a list the installation keeps.
 *
 * Experimental evidence, not production code. Today's `HireOptions.kinds` map,
 * grown by one optional field per entry. The installation registers its worker
 * flows once, at boot; every flow on the list is checked against the whole
 * contract there, before any worker is hired, and the list is the only thing a
 * worker's `flow:` resolves against.
 *
 * A flow is written with plain `defineFlow`. Nothing marks it: admission is
 * what the flow is, not which function built it (worker-config.ts's rule).
 */
import type { FlowType } from "@flow-state-dev/core/types";
import { contractProblems } from "./contract";

type AnyFlow = FlowType<any, any, any, any, any, any, any>;

/** One entry: a flow, and whether this installation keeps it for standard workers. */
export type WorkerFlowEntry = AnyFlow | { flow: AnyFlow; standardOnly?: boolean };

/** The installation's registered worker flows, checked. */
export type WorkerFlowList = ReadonlyMap<string, { flow: AnyFlow; standardOnly: boolean }>;

/**
 * Register the installation's worker flows. Every problem with every flow is
 * collected and thrown together: nothing is registered over a refusal.
 *
 * @param entries By kind. The built-in `agent` sits underneath, as today; an
 *   entry under `agent` replaces it, and its `standardOnly` is the entry's.
 */
export function registerWorkerFlows(
  entries: Record<string, WorkerFlowEntry>,
  builtInAgent: AnyFlow
): WorkerFlowList {
  const all: Record<string, WorkerFlowEntry> = { agent: builtInAgent, ...entries };
  const problems: string[] = [];
  const list = new Map<string, { flow: AnyFlow; standardOnly: boolean }>();
  for (const [kind, entry] of Object.entries(all)) {
    const { flow, standardOnly } = typeof entry === "function" ? { flow: entry, standardOnly: false } : { standardOnly: false, ...entry };
    if (flow.kind !== kind) {
      problems.push(`"${kind}" is registered with a flow of kind "${flow.kind}"`);
      continue;
    }
    const found = contractProblems(kind, flow);
    if (found.length > 0) problems.push(...found);
    else list.set(kind, { flow, standardOnly });
  }
  if (problems.length > 0) {
    throw new Error(`registerWorkerFlows refused ${problems.length} problem(s); nothing was registered:\n  - ${problems.join("\n  - ")}`);
  }
  return list;
}

/** Which flow a worker runs on, or why it can't. `standard` is where its configuration came from. */
export function resolveWorkerFlow(
  list: WorkerFlowList,
  worker: { id: string; flow?: string; standard: boolean }
): { kind: string; flow: AnyFlow } | { refused: string } {
  // The default first, then the flag: a worker naming no flow is an `agent` worker.
  const kind = worker.flow ?? "agent";
  const entry = list.get(kind);
  if (entry === undefined) {
    return { refused: `worker "${worker.id}" names flow "${kind}", which is not a registered worker flow. Registered: ${[...list.keys()].map((k) => `"${k}"`).join(", ")}` };
  }
  if (entry.standardOnly && !worker.standard) {
    return { refused: `worker "${worker.id}" can't run on flow "${kind}": this installation keeps it for standard workers` };
  }
  return { kind, flow: entry.flow };
}
