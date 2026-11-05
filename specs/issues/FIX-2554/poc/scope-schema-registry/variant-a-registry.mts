/**
 * POC · Variant A — a schema registry in core (the owner's idea).
 *
 * Every block registers its scope schemas when it is BUILT, every flow when it
 * is DEFINED, and anything else may register directly. The registry merges
 * incrementally under the shared rules and refuses a conflict at the
 * registration that introduces it. The runtime fill reads the registry's
 * merged schema for the scope.
 *
 * The lifetime question is the whole design. A block is built at module load,
 * before any server exists, so build-time registration can only reach a
 * registry that also exists at module load: a process-global. That is
 * `defaultRegistry` below, and what `run.mts` measures. Scoping the registry
 * to a server (for multi-tenant or multi-server processes, or tests) means a
 * block can no longer register itself when built; something must walk the
 * flows a server receives and register their blocks — which is variant B
 * plus a server-level cross-flow check.
 *
 * Would export from core: `SchemaRegistry`, `defaultRegistry` (or a
 * `registerScopeSchema(scope, schema, source)` function), and the conflict
 * error class. Root export for direct registration to be usable by adopters;
 * the rest could sit on `core/internal`. Plus one call in `buildBlock` and
 * one in `defineFlow`.
 */
import type { ZodTypeAny } from "zod";
import type { BlockDefinition, FlowInstance } from "../../../../../packages/core/src/index";
import { applyScopeStateDefaults } from "./fill.mts";
import { reconcile, toSchema, type Declaration, type MergeNode, type Scope } from "./reconcile.mts";
import { blockDeclarations, flowOwnDeclarations } from "./collect.mts";

export class SchemaRegistry {
  private roots: Partial<Record<Scope, MergeNode>> = {};
  private seen = new Set<ZodTypeAny>();
  private cache: Partial<Record<Scope, ZodTypeAny>> = {};

  /** Register one schema directly — no block or flow needed. Throws on conflict, registering nothing. */
  register(decl: Declaration): void {
    if (this.seen.has(decl.schema)) return;
    this.roots = reconcile([decl], this.roots); // throws before mutating on conflict
    this.seen.add(decl.schema);
    delete this.cache[decl.scope];
  }

  /** What `buildBlock` would call once per block it builds. */
  registerBlock(block: BlockDefinition): void {
    for (const d of blockDeclarations(block)) this.register(d);
  }

  /** What `defineFlow` would call once per flow it defines. */
  registerFlow(flow: FlowInstance): void {
    for (const d of flowOwnDeclarations(flow)) this.register(d);
  }

  /** The merged schema for a scope, across EVERYTHING registered in this registry. */
  merged(scope: Scope): ZodTypeAny | undefined {
    const root = this.roots[scope];
    if (root === undefined) return undefined;
    return (this.cache[scope] ??= toSchema(root));
  }
}

/** The process-wide instance build-time registration needs. */
export const defaultRegistry = new SchemaRegistry();

/** Variant A's read path: the scope's merged schema from the registry, then FIX-2554's fill. */
export function readStateA(registry: SchemaRegistry, scope: Scope, stored: unknown) {
  return applyScopeStateDefaults(registry.merged(scope), stored);
}
