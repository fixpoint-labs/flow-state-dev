/** Collect the session, user and org schemas for a flow or isolated block. */
import type { ZodTypeAny } from "zod";
import type { BlockDefinition } from "../types/block";
import type { FlowInstance } from "../types/flow";
import {
  mergeScopeStateSchemas,
  refuseUnstoredFactoryDefaults,
  type ScopeStateDeclaration
} from "../helpers/scope-state-merge";
import { getBaseCapability } from "../capability/merge";
import type { CapabilityRef } from "../capability/types";

const STATE_SCOPES = ["session", "user", "org"] as const;
type ScopeKind = (typeof STATE_SCOPES)[number];

/**
 * Every scope-state schema the reachable blocks declare, for one scope: each
 * block's own, then each capability it uses, named by the capability so a
 * refusal points at what the author wrote. Dynamic `uses` and presets
 * contribute none.
 */
function blockScopeStateDeclarations(
  scope: ScopeKind,
  reachable: readonly BlockDefinition[]
): ScopeStateDeclaration[] {
  const key = `${scope}StateSchema` as const;
  const out: ScopeStateDeclaration[] = [];
  for (const block of reachable) {
    const config = block.config as Partial<Record<typeof key, ZodTypeAny>> & {
      __resolvedCapabilities?: readonly CapabilityRef[];
    };
    const own = config[key];
    if (own !== undefined) out.push({ schema: own, source: `block "${block.name}"` });
    for (const ref of config.__resolvedCapabilities ?? []) {
      const capability = getBaseCapability(ref);
      const schema = capability[key];
      if (schema !== undefined) {
        out.push({ schema, source: `capability "${capability.name}" (used by block "${block.name}")` });
      }
    }
  }
  return out;
}

/**
 * The schema each scope's reads fill defaults from: the flow's own
 * `stateSchema` merged with every declaration its reachable blocks and their
 * capabilities make (`mergeScopeStateSchemas`). The flow's own schema still
 * validates writes; this one only fills defaults, so a block's declared
 * default reads on a fresh record without the flow restating it.
 *
 * Throws when two declarations disagree on a field, naming both. Never calls
 * an author's default factory: a dynamic default agrees only with itself.
 */
export function mergeFlowScopeStateSchemas(
  kind: string,
  scopes: Pick<FlowInstance, ScopeKind>,
  reachable: readonly BlockDefinition[]
): NonNullable<FlowInstance["scopeStateSchemas"]> {
  const merged: Partial<Record<ScopeKind, ZodTypeAny>> = {};
  for (const scope of STATE_SCOPES) {
    const own = scopes[scope]?.stateSchema;
    const declarations = [
      ...(own === undefined ? [] : [{ schema: own, source: `flow "${kind}"` }]),
      ...blockScopeStateDeclarations(scope, reachable)
    ];
    refuseUnstoredFactoryDefaults(`Flow "${kind}"`, scope, own, declarations);
    const schema = mergeScopeStateSchemas(`Flow "${kind}"`, scope, declarations);
    if (schema !== undefined) merged[scope] = schema;
  }
  return merged;
}
