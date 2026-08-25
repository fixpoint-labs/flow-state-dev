/**
 * Flow registry primitives for server-side flow lookup by kind/id.
 *
 * The registry also enforces cross-flow schema compatibility: at registration
 * time, a flow's `user.stateSchema`, `org.stateSchema`, and user/org resource
 * schemas are validated against every other already-registered flow's
 * declarations. Incompatible pairs throw a `CrossFlowSchemaConflictError` —
 * see `registry/errors.ts` and the `state-and-scopes` architecture doc.
 *
 * The two halves are gated at different granularities, because they key at
 * different granularities (see {@link collectScopeDeclaration}): the scope
 * record's `stateSchema` drops out under flow-level isolation, while each
 * resource drops out on its own effective `flowIsolation`.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ZodTypeAny } from "zod";
import { resolveResourceIsolation } from "../stores/scope-keys";
import { CrossFlowSchemaConflictError, type ConflictScope } from "./errors";
import { compareZodSchemas } from "./schema-compat";

/**
 * Registry contract used by server routing/execution layers.
 */
export interface FlowRegistry {
  register(flow: FlowInstance): void;
  registerMany(flows: FlowInstance[]): void;
  get(kind: string, id?: string): FlowInstance | undefined;
  list(): FlowInstance[];
  /**
   * Merged cross-flow schema view — what each scope's shared storage looks
   * like once isolated declarations are excluded. Diagnostics and devtool
   * surfaces consume this.
   */
  describeSharedSchemas(): SharedSchemasDescription;
}

export interface SharedSchemasDescription {
  user: SharedScopeDescription;
  org: SharedScopeDescription;
  participants: { user: string[]; org: string[] };
}

export interface SharedScopeDescription {
  stateSchema?: ZodTypeAny;
  resources: Record<string, ZodTypeAny>;
}

type ScopeParticipant = {
  flowKind: string;
  stateSchema?: ZodTypeAny;
  resourceSchemas: Record<string, ZodTypeAny>;
};

/**
 * In-memory flow registry implementation for runtime and tests.
 */
export class InMemoryFlowRegistry implements FlowRegistry {
  private readonly flowsByKind = new Map<string, Map<string, FlowInstance>>();

  /**
   * Per-scope list of flows participating in that scope's SHARED storage. A
   * flow appears here once it contributes anything non-isolated — its scope
   * record's `stateSchema`, a shared resource, or both; see
   * {@link collectScopeDeclaration}, which decides those two independently.
   *
   * Kept keyed by `flowKind` — the first registered instance of a given kind
   * seeds the schema view for that scope; later registrations of the same kind
   * are assumed to match (defineFlow produces structurally equal instances,
   * modulo the per-instance overrides noted on {@link validateScope}).
   */
  private readonly participants: Record<ConflictScope, Map<string, ScopeParticipant>> = {
    user: new Map(),
    org: new Map(),
  };

  /**
   * Registers a single flow instance. Duplicate `(kind,id)` is rejected.
   * Throws `CrossFlowSchemaConflictError` when the flow's non-isolated
   * schemas conflict with an already-registered flow. Registration is
   * transactional — a failure leaves every internal map untouched.
   */
  register(flow: FlowInstance): void {
    const existingByKind = this.flowsByKind.get(flow.kind);
    if (existingByKind?.has(flow.id)) {
      throw new Error(
        `Flow "${flow.kind}" with id "${flow.id}" is already registered`
      );
    }

    // Validate both scopes before mutating any state. If the org-scope
    // check throws after the user-scope check passes, no participant entry
    // should linger for the user scope.
    //
    // Isolation is applied inside `collectScopeDeclaration`, per half, and
    // NOT as a flow-level gate here: a flow that isolates a scope can still
    // declare a `flowIsolation: false` resource at it, which does share a
    // durable cell with other flows and must be compared.
    const userDecl = collectScopeDeclaration(flow, "user");
    const orgDecl = collectScopeDeclaration(flow, "org");

    if (userDecl) this.validateScope("user", flow.kind, userDecl);
    if (orgDecl) this.validateScope("org", flow.kind, orgDecl);

    // All validation passed — commit.
    const byId = existingByKind ?? new Map<string, FlowInstance>();
    if (existingByKind === undefined) {
      this.flowsByKind.set(flow.kind, byId);
    }
    byId.set(flow.id, flow);
    this.indexParticipant("user", flow.kind, userDecl);
    this.indexParticipant("org", flow.kind, orgDecl);
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

  describeSharedSchemas(): SharedSchemasDescription {
    return {
      user: describeScope(this.participants.user),
      org: describeScope(this.participants.org),
      participants: {
        user: [...this.participants.user.keys()].sort(),
        org: [...this.participants.org.keys()].sort(),
      },
    };
  }

  private indexParticipant(
    scope: ConflictScope,
    flowKind: string,
    declaration: ScopeDeclaration | undefined
  ): void {
    if (declaration === undefined) return;
    // Only the first instance of a given kind seeds the participant entry —
    // later instances (same kind, different id) are structurally equivalent.
    if (this.participants[scope].has(flowKind)) return;
    this.participants[scope].set(flowKind, {
      flowKind,
      stateSchema: declaration.stateSchema,
      resourceSchemas: { ...declaration.resourceSchemas },
    });
  }

  /**
   * Compares an incoming declaration against every other registered kind.
   *
   * **What the resource half keys on, and the two overlaps it deliberately
   * does NOT catch.** A user/org resource's storage identity is
   * `(scope, ref, effective flowIsolation)`. `collectScopeDeclaration` has
   * already dropped the isolated ones, so what remains is an exact match on
   * `ref` within one scope's shared set. Two ways two flows can still land on
   * one durable cell without ever being compared:
   *
   *   1. **Overlapping collection keyspaces.** A collection's `ref` is its
   *      glob pattern, so a collection at `files/*` and a concrete resource at
   *      `files/a` index under different refs — while `resolveCollectionKey`
   *      resolves the collection's `"a"` to `files/a`, the very same
   *      `ResourceStateStore` cell.
   *   2. **Same-kind instances with differing resource overrides.**
   *      `FlowInstanceOptions` lets each instance override `resources`, but
   *      participants are retained per `flowKind` (first instance wins — see
   *      `indexParticipant`) and same-kind pairs are skipped just below. Two
   *      instances of one definition are therefore never compared, even when
   *      their overrides disagree over a shared cell.
   *
   * Both are excluded **by design, not by oversight**, and both are FIX-1207's.
   * They are one question — what identity the check keys on — and answering it
   * means extending the identity model, which is new capability. This check had
   * not run at all since FIX-435; restoring it is the repair, and widening it
   * here would turn a one-file fix into a subsystem change.
   */
  private validateScope(
    scope: ConflictScope,
    flowKind: string,
    incoming: ScopeDeclaration
  ): void {
    for (const existing of this.participants[scope].values()) {
      // Same kind re-registered: skip. defineFlow produces structurally
      // equivalent instances for a given definition. (Exclusion 2 above —
      // per-instance `resources` overrides make that assumption defeasible.)
      if (existing.flowKind === flowKind) continue;

      if (incoming.stateSchema !== undefined && existing.stateSchema !== undefined) {
        checkPair(scope, "stateSchema", existing.flowKind, flowKind, existing.stateSchema, incoming.stateSchema);
      }

      // Exact-ref comparison — exclusion 1 above.
      for (const [ref, incomingSchema] of Object.entries(incoming.resourceSchemas)) {
        const existingSchema = existing.resourceSchemas[ref];
        if (existingSchema === undefined) continue;
        checkPair(scope, `resources.${ref}`, existing.flowKind, flowKind, existingSchema, incomingSchema);
      }
    }
  }
}

type ScopeDeclaration = {
  stateSchema?: ZodTypeAny;
  resourceSchemas: Record<string, ZodTypeAny>;
};

/** Resource declaration shape this module reads off `flow.resources`. */
type ResourceEntry = {
  scope?: string;
  ref?: string;
  pattern?: string;
  flowIsolation?: boolean;
  stateSchema?: ZodTypeAny;
};

/**
 * The storage `ref` a resource declaration occupies — the namespace half of
 * its storage identity, and deliberately NOT the accessor key: a flow may
 * expose one shared resource under any accessor it likes, and may reuse an
 * accessor for a different `ref`.
 *
 * Mirrors `effectiveStorageTuple` in core's `flow/defineFlow.ts`: an explicit
 * `ref` wins, a collection falls back to its `pattern`, anything else to the
 * accessor key.
 */
function storageRef(entry: ResourceEntry, accessor: string): string {
  return entry.ref ?? entry.pattern ?? accessor;
}

/**
 * What one flow contributes to a scope's shared-storage view.
 *
 * The two halves are collected under different isolation rules because they
 * key under different isolation rules:
 *
 *   - The **scope record's `stateSchema`** is a single blob per scope, keyed
 *     by the flow-level `isolateUserState` / `isolateOrgState` flag
 *     (`resolveUserStorageKey`). Flow-level isolation removes it from the
 *     shared view entirely.
 *   - **Resources** key per resource off the flat `flow.resources` map
 *     (FIX-435), each entry carrying its own intrinsic `scope` and its own
 *     `flowIsolation` override — which wins over the flow-level flag in BOTH
 *     directions. So effective isolation is resolved per resource
 *     (`resolveResourceIsolation`, the same helper the storage-key path uses),
 *     independently of the flow-level flag. An isolated resource is namespaced
 *     by `flowKind` and therefore cannot collide with another flow's, so it
 *     does not participate.
 *
 * Before this was fixed the resource half read `flow.user.resources` /
 * `flow.org.resources` — maps that stopped existing at FIX-435 — so it
 * iterated `undefined` and collected nothing for either scope.
 */
function collectScopeDeclaration(
  flow: FlowInstance,
  scope: ConflictScope
): ScopeDeclaration | undefined {
  const scopeConfig = scope === "user" ? flow.user : flow.org;
  const flowIsolatesScope =
    scope === "user" ? flow.isolateUserState : flow.isolateOrgState;

  const stateSchema = flowIsolatesScope
    ? undefined
    : (scopeConfig as { stateSchema?: ZodTypeAny } | undefined)?.stateSchema;

  const resources = flow.resources as Record<string, ResourceEntry> | undefined;
  const resourceSchemas: Record<string, ZodTypeAny> = {};
  for (const [accessor, entry] of Object.entries(resources ?? {})) {
    if (entry === undefined || entry.scope !== scope) continue;
    if (resolveResourceIsolation(entry.flowIsolation, flow, scope)) continue;
    const schema = entry.stateSchema;
    if (schema === undefined) continue;
    resourceSchemas[storageRef(entry, accessor)] = schema;
  }

  if (stateSchema === undefined && Object.keys(resourceSchemas).length === 0) {
    return undefined;
  }

  return { stateSchema, resourceSchemas };
}

function checkPair(
  scope: ConflictScope,
  field: string,
  flowA: string,
  flowB: string,
  schemaA: ZodTypeAny,
  schemaB: ZodTypeAny
): void {
  const result = compareZodSchemas(schemaA, schemaB);
  if (result.kind === "incompatible") {
    throw new CrossFlowSchemaConflictError({
      scope,
      field,
      flowA,
      flowB,
      reason: result.reason,
      detail: result.detail,
    });
  }
  if (result.kind === "compatible" && result.warnings.length > 0) {
    console.warn(
      `[flow-state] Flows "${flowA}" and "${flowB}" declare structurally compatible but non-identical ${scope}.${field} schemas: ${result.warnings.join("; ")}`
    );
  }
}

function describeScope(entries: Map<string, ScopeParticipant>): SharedScopeDescription {
  const resources: Record<string, ZodTypeAny> = {};
  let stateSchema: ZodTypeAny | undefined;
  for (const entry of entries.values()) {
    stateSchema ??= entry.stateSchema;
    for (const [name, schema] of Object.entries(entry.resourceSchemas)) {
      resources[name] ??= schema;
    }
  }
  return { stateSchema, resources };
}

/**
 * Creates an empty in-memory flow registry.
 */
export function createFlowRegistry(): FlowRegistry {
  return new InMemoryFlowRegistry();
}
