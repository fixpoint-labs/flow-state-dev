/**
 * POC · Variant B — no global registry; each flow reconciles its own tree.
 *
 * At `defineFlow`, walk the flow's reachable blocks (the same `walkBlockGraph`
 * closure `defineFlow` already walks for dispatch targets, flow-config
 * requirements and block resources), collect every scope schema the flow and
 * its blocks and capabilities declare, and union them under the shared rules
 * into one runtime schema per scope. The fill reads that. A conflict refuses
 * the flow at definition, naming the field and both declarers.
 *
 * User and org records are one blob shared by every flow on a server, so a
 * per-flow union cannot see two flows typing `user.state.theme` differently.
 * `checkServerB` is the second half: at server registration (where
 * `createFlowState` already admits flows), reconcile the flows' merged user and
 * org schemas against each other — detection only, nothing is merged into a
 * flow's read. Session records belong to one flow and are not compared.
 *
 * Would export: nothing new at core's root. The merged schemas ride on the flow
 * instance (an internal field, e.g. `flow.session.runtimeStateSchema`), and the
 * engine's three `readXState` calls in `createExecutionContext` read it instead
 * of `flow.<scope>.stateSchema`. `checkServerB` lives in the engine, next to
 * flow admission. Direct registration has no global to land in; a schema not
 * attached to a block is declared through a capability or the flow's own
 * schema (both already exist).
 */
import type { ZodTypeAny } from "zod";
import type { FlowInstance } from "../../../../../packages/core/src/index";
import { applyScopeStateDefaults } from "./fill.mts";
import { reconcile, toSchema, SCOPES, type Declaration, type Scope } from "./reconcile.mts";
import { blockDeclarations, flowOwnDeclarations, reachableBlocks } from "./collect.mts";

export type MergedSchemas = Partial<Record<Scope, ZodTypeAny>>;

/** What `defineFlow` would compute once, off its existing reachable walk. Throws on conflict. */
export function mergeFlowSchemas(flow: FlowInstance): MergedSchemas {
  const decls: Declaration[] = [
    ...flowOwnDeclarations(flow),
    ...reachableBlocks(flow).flatMap(blockDeclarations)
  ];
  const roots = reconcile(decls);
  const out: MergedSchemas = {};
  for (const scope of SCOPES) if (roots[scope] !== undefined) out[scope] = toSchema(roots[scope]!);
  return out;
}

/** Variant B's read path: this flow's merged schema, then FIX-2554's fill. */
export function readStateB(merged: MergedSchemas, scope: Scope, stored: unknown) {
  return applyScopeStateDefaults(merged[scope], stored);
}

/**
 * Server admission: two flows that type the same user/org field differently
 * share one record, so refuse the pair. Merges nothing into either flow.
 */
export function checkServerB(flows: ReadonlyArray<{ flow: FlowInstance; merged: MergedSchemas }>): void {
  for (const scope of ["user", "org"] as const) {
    reconcile(
      flows.flatMap(({ flow, merged }) =>
        merged[scope] === undefined ? [] : [{ scope, schema: merged[scope]!, source: `flow "${flow.kind}"` }]
      )
    );
  }
}
