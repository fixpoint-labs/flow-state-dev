/**
 * POC · where scope schemas are declared today, read off built blocks and flows.
 *
 * Two findings this file encodes (verified by `run.mts`, check 0):
 * - A built block keeps its OWN `sessionStateSchema` / `userStateSchema` /
 *   `orgStateSchema` on `block.config`.
 * - A capability's scope schemas are NOT on `block.config`: `resolveCapabilities`
 *   merges them (`mergeSurfaceInto` → `extendSchema`, last-wins) and then drops
 *   the result. What survives is `config.__resolvedCapabilities`, the flattened
 *   capability list, each still carrying its own schemas. So any runtime
 *   variant reads capabilities from there (presets' schemas are not covered
 *   here — they would need the merged surface kept per source).
 */
import type { BlockDefinition, FlowInstance } from "../../../../../packages/core/src/index";
import { walkBlockGraph } from "../../../../../packages/core/src/helpers/block-graph";
import { SCOPES, type Declaration } from "./reconcile.mts";

/** Every scope schema one block declares: its own, then each capability it uses. */
export function blockDeclarations(block: BlockDefinition): Declaration[] {
  const cfg = block.config as Record<string, any>;
  const out: Declaration[] = [];
  for (const scope of SCOPES) {
    const own = cfg[`${scope}StateSchema`];
    if (own !== undefined) out.push({ scope, schema: own, source: `block "${block.name}"` });
    for (const cap of (cfg.__resolvedCapabilities ?? []) as Array<Record<string, any>>) {
      const s = cap[`${scope}StateSchema`];
      if (s !== undefined) out.push({ scope, schema: s, source: `capability "${cap.name}" (via block "${block.name}")` });
    }
  }
  return out;
}

/** The flow's own scope schemas. */
export function flowOwnDeclarations(flow: FlowInstance): Declaration[] {
  const f = flow as Record<string, any>;
  return SCOPES.flatMap((scope) => {
    const s = f[scope]?.stateSchema;
    return s === undefined ? [] : [{ scope, schema: s, source: `flow "${flow.kind}"` }];
  });
}

/**
 * The roots `defineFlow`'s private `actionBlocks` enumerates, read back off the
 * instance. In real code variant B reuses `defineFlow`'s existing `reachable`
 * walk and needs none of this.
 */
export function flowRoots(flow: FlowInstance): BlockDefinition[] {
  const f = flow as Record<string, any>;
  const core = (e: any): BlockDefinition[] => [e?.block, e?.onCompleted, e?.onErrored].filter(Boolean);
  const roots: BlockDefinition[] = [];
  for (const map of [f.actions, f.internal, f.task]) for (const e of Object.values(map ?? {})) roots.push(...core(e));
  for (const sub of Object.values(f.webhooks ?? {}) as any[]) for (const b of Object.values(sub.on ?? {})) roots.push(...core(b));
  for (const s of Object.values(f.schedules?.static ?? {})) roots.push(...core(s));
  for (const k of ["onStarted", "onCompleted", "onErrored", "onFinished", "onStepErrored"]) {
    if (f.request?.[k] !== undefined) roots.push(f.request[k]);
  }
  return roots;
}

/** Every block reachable from the flow, through composition and static tools. */
export function reachableBlocks(flow: FlowInstance): BlockDefinition[] {
  return walkBlockGraph(flowRoots(flow));
}
