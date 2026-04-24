/**
 * Flow registry primitives for server-side flow lookup by kind/id.
 *
 * The registry also enforces cross-flow schema compatibility: at registration
 * time, every non-isolated flow's `user.stateSchema`, `project.stateSchema`,
 * and user/project resource schemas are validated against every other
 * already-registered flow's declarations. Incompatible pairs throw a
 * `CrossFlowSchemaConflictError` — see `registry/errors.ts` and the
 * `state-and-scopes` architecture doc.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ZodTypeAny } from "zod";
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
   * Merged cross-flow schema view (non-isolated flows only). Diagnostics and
   * devtool surfaces consume this.
   */
  describeSharedSchemas(): SharedSchemasDescription;
}

export interface SharedSchemasDescription {
  user: SharedScopeDescription;
  project: SharedScopeDescription;
  participants: { user: string[]; project: string[] };
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
   * Per-scope list of participating flows (non-isolated only). Kept keyed by
   * `flowKind` — the first registered instance of a given kind seeds the
   * schema view for that scope; later registrations of the same kind are
   * assumed to match (defineFlow produces structurally equal instances).
   */
  private readonly participants: Record<ConflictScope, Map<string, ScopeParticipant>> = {
    user: new Map(),
    project: new Map(),
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

    // Validate both scopes before mutating any state. If the project-scope
    // check throws after the user-scope check passes, no participant entry
    // should linger for the user scope.
    const userDecl = flow.isolateUserState
      ? undefined
      : collectScopeDeclaration(flow, "user");
    const projectDecl = flow.isolateProjectState
      ? undefined
      : collectScopeDeclaration(flow, "project");

    if (userDecl) this.validateScope("user", flow.kind, userDecl);
    if (projectDecl) this.validateScope("project", flow.kind, projectDecl);

    // All validation passed — commit.
    const byId = existingByKind ?? new Map<string, FlowInstance>();
    if (existingByKind === undefined) {
      this.flowsByKind.set(flow.kind, byId);
    }
    byId.set(flow.id, flow);
    this.indexParticipant("user", flow.kind, userDecl);
    this.indexParticipant("project", flow.kind, projectDecl);
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
      project: describeScope(this.participants.project),
      participants: {
        user: [...this.participants.user.keys()].sort(),
        project: [...this.participants.project.keys()].sort(),
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

  private validateScope(
    scope: ConflictScope,
    flowKind: string,
    incoming: ScopeDeclaration
  ): void {
    for (const existing of this.participants[scope].values()) {
      // Same kind re-registered: skip. defineFlow produces structurally
      // equivalent instances for a given definition.
      if (existing.flowKind === flowKind) continue;

      if (incoming.stateSchema !== undefined && existing.stateSchema !== undefined) {
        checkPair(scope, "stateSchema", existing.flowKind, flowKind, existing.stateSchema, incoming.stateSchema);
      }

      for (const [name, incomingSchema] of Object.entries(incoming.resourceSchemas)) {
        const existingSchema = existing.resourceSchemas[name];
        if (existingSchema === undefined) continue;
        checkPair(scope, `resources.${name}`, existing.flowKind, flowKind, existingSchema, incomingSchema);
      }
    }
  }
}

type ScopeDeclaration = {
  stateSchema?: ZodTypeAny;
  resourceSchemas: Record<string, ZodTypeAny>;
};

function collectScopeDeclaration(
  flow: FlowInstance,
  scope: ConflictScope
): ScopeDeclaration | undefined {
  const scopeConfig = scope === "user" ? flow.user : flow.project;
  if (scopeConfig === undefined) {
    return undefined;
  }

  const stateSchema = (scopeConfig as { stateSchema?: ZodTypeAny }).stateSchema;
  const resources = (scopeConfig as {
    resources?: Record<string, { stateSchema?: ZodTypeAny }>;
  }).resources;

  const resourceSchemas: Record<string, ZodTypeAny> = {};
  if (resources !== undefined) {
    for (const [name, config] of Object.entries(resources)) {
      const schema = config?.stateSchema;
      if (schema !== undefined) {
        resourceSchemas[name] = schema;
      }
    }
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
