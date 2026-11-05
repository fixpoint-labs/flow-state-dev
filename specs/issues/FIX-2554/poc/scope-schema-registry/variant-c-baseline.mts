/**
 * POC · Variant C — FIX-2554 as it stands (#4770 head 8f9bf63), plus a refusal.
 *
 * The fill reads only the flow's own `stateSchema`. A block's or capability's
 * scope schema types `ctx.session.state` and is never applied. #4770 adds one
 * targeted refusal (`hireWorkforce` refuses a manager flow whose session
 * schema doesn't default the fields its board reads). `checkFlowC` is that
 * refusal generalized: at definition, every field a reachable block or
 * capability declares must also be declared, compatibly, by the flow. The
 * author fixes it by restating (or spreading an exported shape into) the
 * flow's schema — the `board.sessionStateShape` pattern #4770 uses.
 *
 * Would export: nothing. The check is internal to `defineFlow`.
 */
import type { FlowInstance } from "../../../../../packages/core/src/index";
import { applyScopeStateDefaults } from "./fill.mts";
import { reconcile, mergeNodes, nodeHasDefault, type Declaration, type Scope, ScopeSchemaConflict } from "./reconcile.mts";
import { blockDeclarations, flowOwnDeclarations, reachableBlocks } from "./collect.mts";

/** Variant C's read path: the flow's own schema only. */
export function readStateC(flow: FlowInstance, scope: Scope, stored: unknown) {
  return applyScopeStateDefaults((flow as any)[scope]?.stateSchema, stored);
}

/**
 * Refuse a flow whose blocks declare a scope field the flow doesn't declare
 * compatibly. Block-vs-block conflicts are found too (the blocks are
 * reconciled first), so the error can name both blocks.
 */
export function checkFlowC(flow: FlowInstance): void {
  const blockDecls: Declaration[] = reachableBlocks(flow).flatMap(blockDeclarations);
  const blocks = reconcile(blockDecls);
  const own = reconcile(flowOwnDeclarations(flow));
  for (const [scope, node] of Object.entries(blocks) as Array<[Scope, any]>) {
    const flowNode = own[scope] as any;
    for (const [key, field] of node.fields as Map<string, any>) {
      const declared = flowNode?.fields.get(key);
      if (declared === undefined) {
        if (!nodeHasDefault(field)) continue; // nothing to fill, nothing lost

        throw new ScopeSchemaConflict(
          "type", `${scope}.state.${key}`, field.meta.source, `flow "${flow.kind}"`,
          "— the first declares it, the second does not, so its default is never applied; restate it in the flow's schema"
        );
      }
      mergeNodes(declared, field, `${scope}.state.${key}`);
    }
  }
}
