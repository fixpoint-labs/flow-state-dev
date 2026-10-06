/**
 * FIX-1789 POC · shape B: a `defineWorkerFlow()` wrapper.
 *
 * Experimental evidence, not production code. The flow accounts for every
 * worker-flow requirement where it is written: the wrapper composes the
 * standard configuration itself, declares shared resources with attribution,
 * carries `standardOnly`, and refuses a flow with no door or with private
 * state at org scope the moment it is defined. It marks what it built, and the
 * installation's registration accepts only marked flows.
 */
import { z } from "zod";
import { defineFlow } from "@flow-state-dev/core";
import type { FlowType } from "@flow-state-dev/core/types";
import { workerConfigSchema } from "../../src/worker-config";
import { contractProblems, sharedResource } from "./contract";

type AnyFlow = FlowType<any, any, any, any, any, any, any>;

/** The mark. Enumerable, so it survives the `Object.assign(mint, flow)` pattern the built-in agent uses. */
export const WORKER_FLOW = Symbol.for("fsd.poc.workerFlow");

type WorkerFlowDefinition = Omit<Parameters<typeof defineFlow>[0], "configSchema"> & {
  /** This flow's own settings, beside the standard configuration. */
  config?: z.ZodRawShape;
  /** Shared resources, by accessor: pattern and entry shape. Attribution is added. */
  shared?: Record<string, { pattern: string; shape: z.ZodRawShape }>;
  /** Keep this flow for standard workers. A property of the flow, wherever it is installed. */
  standardOnly?: boolean;
};

/** Define a worker flow. Throws, naming every problem, when it can't run workers. */
export function defineWorkerFlow(definition: WorkerFlowDefinition): AnyFlow & { [WORKER_FLOW]: { standardOnly: boolean } } {
  const { config, shared, standardOnly, ...rest } = definition as any;
  const sharedResources = Object.fromEntries(
    Object.entries((shared ?? {}) as WorkerFlowDefinition["shared"] & object).map(([k, v]) => [k, sharedResource(v.pattern, v.shape)])
  );
  const flow = defineFlow({
    cardinality: "collection",
    ...rest,
    configSchema: workerConfigSchema().extend(config ?? {}),
    resources: { ...(rest.resources ?? {}), ...sharedResources }
  } as any) as AnyFlow;
  const problems = contractProblems(rest.kind, flow);
  if (problems.length > 0) throw new Error(`defineWorkerFlow("${rest.kind}") refused:\n  - ${problems.join("\n  - ")}`);
  return Object.assign(flow, { [WORKER_FLOW]: { standardOnly: standardOnly === true } }) as any;
}

export type WorkerFlowList = ReadonlyMap<string, { flow: AnyFlow; standardOnly: boolean }>;

/**
 * Register the installation's worker flows: the marked ones only. The checks
 * already ran where each was defined, so registration trusts the mark.
 */
export function registerWorkerFlows(kinds: Record<string, AnyFlow>, builtInAgent: AnyFlow): WorkerFlowList {
  const all: Record<string, AnyFlow> = { agent: builtInAgent, ...kinds };
  const problems: string[] = [];
  const list = new Map<string, { flow: AnyFlow; standardOnly: boolean }>();
  for (const [kind, flow] of Object.entries(all)) {
    const mark = (flow as any)[WORKER_FLOW] as { standardOnly: boolean } | undefined;
    if (mark === undefined) {
      problems.push(`flow "${kind}" was not defined with defineWorkerFlow()`);
      continue;
    }
    if (flow.kind !== kind) {
      problems.push(`"${kind}" is registered with a flow of kind "${flow.kind}"`);
      continue;
    }
    list.set(kind, { flow, standardOnly: mark.standardOnly });
  }
  if (problems.length > 0) {
    throw new Error(`registerWorkerFlows refused ${problems.length} problem(s); nothing was registered:\n  - ${problems.join("\n  - ")}`);
  }
  return list;
}

/** Which flow a worker runs on, or why it can't. Same rule as shape A; the flag comes from the flow. */
export function resolveWorkerFlow(
  list: WorkerFlowList,
  worker: { id: string; flow?: string; standard: boolean }
): { kind: string; flow: AnyFlow } | { refused: string } {
  const kind = worker.flow ?? "agent";
  const entry = list.get(kind);
  if (entry === undefined) {
    return { refused: `worker "${worker.id}" names flow "${kind}", which is not a registered worker flow. Registered: ${[...list.keys()].map((k) => `"${k}"`).join(", ")}` };
  }
  if (entry.standardOnly && !worker.standard) {
    return { refused: `worker "${worker.id}" can't run on flow "${kind}": it is kept for standard workers` };
  }
  return { kind, flow: entry.flow };
}
