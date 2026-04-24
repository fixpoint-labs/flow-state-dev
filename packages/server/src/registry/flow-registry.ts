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
import { CrossFlowSchemaConflictError } from "./errors";
import type { ConflictScope } from "./errors";
import { compareZodSchemas, type CompatibilityResult } from "./schema-compat";

/**
 * Registry contract used by server routing/execution layers.
 */
export interface FlowRegistry {
  register(flow: FlowInstance): void;
  registerMany(flows: FlowInstance[]): void;
  get(kind: string, id?: string): FlowInstance | undefined;
  list(): FlowInstance[];
  /**
   * Describes the merged cross-flow schema view. Useful for diagnostics and
   * devtool surfaces. Returned maps are defensive copies.
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
   * schemas conflict with an already-registered flow.
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

    // Validate cross-flow schemas before mutating registry state so that
    // a failed registration leaves the registry untouched.
    this.validateAndIndex(flow);

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

  private validateAndIndex(flow: FlowInstance): void {
    const userDeclaration = flow.isolateUserState
      ? undefined
      : collectScopeDeclaration(flow, "user");
    const projectDeclaration = flow.isolateProjectState
      ? undefined
      : collectScopeDeclaration(flow, "project");

    if (userDeclaration !== undefined) {
      this.validateScope("user", flow.kind, userDeclaration);
    }
    if (projectDeclaration !== undefined) {
      this.validateScope("project", flow.kind, projectDeclaration);
    }

    // Passed validation — index participants. Skip re-indexing when the same
    // kind is already present (different `id`, same kind — same schema shape).
    if (userDeclaration !== undefined && !this.participants.user.has(flow.kind)) {
      this.participants.user.set(flow.kind, {
        flowKind: flow.kind,
        stateSchema: userDeclaration.stateSchema,
        resourceSchemas: { ...userDeclaration.resourceSchemas },
      });
    }
    if (projectDeclaration !== undefined && !this.participants.project.has(flow.kind)) {
      this.participants.project.set(flow.kind, {
        flowKind: flow.kind,
        stateSchema: projectDeclaration.stateSchema,
        resourceSchemas: { ...projectDeclaration.resourceSchemas },
      });
    }
  }

  private validateScope(
    scope: ConflictScope,
    flowKind: string,
    incoming: ScopeDeclaration
  ): void {
    for (const existing of this.participants[scope].values()) {
      if (existing.flowKind === flowKind) {
        // Same kind re-registered: skip. defineFlow returns structurally
        // equivalent instances for a given definition.
        continue;
      }

      if (incoming.stateSchema !== undefined && existing.stateSchema !== undefined) {
        reportIfIncompatible(
          compareZodSchemas(existing.stateSchema, incoming.stateSchema),
          {
            scope,
            field: "stateSchema",
            flowA: existing.flowKind,
            flowB: flowKind,
          }
        );
      }

      for (const [name, incomingSchema] of Object.entries(incoming.resourceSchemas)) {
        const existingSchema = existing.resourceSchemas[name];
        if (existingSchema === undefined) {
          continue;
        }
        reportIfIncompatible(
          compareZodSchemas(existingSchema, incomingSchema),
          {
            scope,
            field: `resources.${name}`,
            flowA: existing.flowKind,
            flowB: flowKind,
          }
        );
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

function reportIfIncompatible(
  result: CompatibilityResult,
  ctx: {
    scope: ConflictScope;
    field: string;
    flowA: string;
    flowB: string;
  }
): void {
  if (result.kind === "incompatible") {
    throw new CrossFlowSchemaConflictError({
      scope: ctx.scope,
      field: ctx.field,
      flowA: ctx.flowA,
      flowB: ctx.flowB,
      reason: result.reason,
      detail: result.detail,
    });
  }
  if (result.kind === "compatible" && result.warnings.length > 0) {
    console.warn(
      `[flow-state] Flows "${ctx.flowA}" and "${ctx.flowB}" declare structurally compatible but non-identical ${ctx.scope}.${ctx.field} schemas: ${result.warnings.join("; ")}. This is allowed but may indicate a silent schema drift — consider reconciling.`
    );
  }
}

function describeScope(
  entries: Map<string, ScopeParticipant>
): SharedScopeDescription {
  const resources: Record<string, ZodTypeAny> = {};
  let stateSchema: ZodTypeAny | undefined;
  for (const entry of entries.values()) {
    if (stateSchema === undefined && entry.stateSchema !== undefined) {
      stateSchema = entry.stateSchema;
    }
    for (const [name, schema] of Object.entries(entry.resourceSchemas)) {
      if (resources[name] === undefined) {
        resources[name] = schema;
      }
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
