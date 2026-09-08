/**
 * Error types for flow registry admission: identity (cardinality and global
 * id) and cross-flow schema validation.
 */
import type { CompatibilityReason } from "./schema-compat";

/** Why `FlowRegistry.register` refused an instance's identity. */
export type FlowIdentityConflictReason =
  /** Another registered instance — of any kind — already holds this id. */
  | "duplicate-id"
  /** A singleton whose id is not its kind: the caller meant a collection and did not say so. */
  | "singleton-id-mismatch"
  /** A registered kind already has the other cardinality policy. */
  | "mixed-cardinality"
  /** The instance carries a cardinality that is neither policy. */
  | "invalid-cardinality"
  /** The instance has no usable id. */
  | "invalid-id"
  /**
   * A flow DEFINITION was handed over in place of an instance, and it cannot
   * run without a config bag nobody can supply to a blueprint.
   */
  | "unminted-config";

export interface FlowIdentityConflictDetails {
  reason: FlowIdentityConflictReason;
  kind: string;
  id: string;
  /** For `duplicate-id`: the kind of the instance already holding the id. */
  existingKind?: string;
  /** For `mixed-cardinality`: the policy the kind is already registered under. */
  existingCardinality?: string;
}

/**
 * Thrown by `FlowRegistry.register` when an instance's identity cannot be
 * admitted: its id is taken, it is a singleton under a custom id, or its kind
 * is already registered under the other cardinality. Refused before any
 * registry state is touched, so the earlier registration stays reachable.
 *
 * Same pattern as {@link CrossFlowSchemaConflictError}: a named class with the
 * facts a caller might branch on, and a message that ends with the remedy.
 */
export class FlowIdentityConflictError extends Error {
  readonly reason: FlowIdentityConflictReason;
  readonly kind: string;
  readonly id: string;
  readonly existingKind?: string;
  readonly existingCardinality?: string;

  constructor(details: FlowIdentityConflictDetails) {
    super(FlowIdentityConflictError.describe(details));
    this.name = "FlowIdentityConflictError";
    this.reason = details.reason;
    this.kind = details.kind;
    this.id = details.id;
    this.existingKind = details.existingKind;
    this.existingCardinality = details.existingCardinality;
  }

  private static describe(d: FlowIdentityConflictDetails): string {
    switch (d.reason) {
      case "duplicate-id":
        return d.existingKind === d.kind
          ? `Flow "${d.kind}" with id "${d.id}" is already registered`
          : `Flow "${d.kind}" cannot register with id "${d.id}": that id already belongs to a ` +
            `registered instance of flow "${d.existingKind}". Instance ids are global across kinds; ` +
            `give one of them a distinct id.`;
      case "singleton-id-mismatch":
        return `Flow "${d.kind}" is a singleton but was instantiated with id "${d.id}". A singleton's ` +
          `id is its kind. If this definition is meant to have several registered instances, ` +
          `declare cardinality: "collection" on defineFlow(...); otherwise call the factory without an id.`;
      case "mixed-cardinality":
        return `Flow "${d.kind}" (id "${d.id}") declares a different flow instance cardinality ` +
          `from the "${d.kind}" instance already registered ("${d.existingCardinality}"). ` +
          `One kind has one policy; declare it once on the definition.`;
      case "invalid-cardinality":
        return `Flow "${d.kind}" (id "${d.id}") has an invalid flow instance cardinality; ` +
          `expected "singleton" or "collection".`;
      case "invalid-id":
        return `Flow "${d.kind}" has no usable instance id; an id must be a non-empty string.`;
      case "unminted-config":
        return `Flow "${d.kind}" was registered as a definition rather than an instance, but it ` +
          `cannot run without a config bag: its configSchema is not satisfied by an empty one, or a ` +
          `block it reaches requires settings the defaults do not supply. Mint it first — ` +
          `register ${d.kind}({ config: { ... } }), not the defineFlow(...) result.`;
    }
  }
}

export type ConflictScope = "user" | "org";

export interface CrossFlowSchemaConflictDetails {
  scope: ConflictScope;
  field: string;
  flowA: string;
  flowB: string;
  reason: CompatibilityReason;
  detail: string;
  /**
   * True when the conflicting field is a resource COLLECTION. Changes only the
   * remedy wording: a collection's storage identity is its `pattern`, and
   * `ResourceCollectionConfig` exposes no `ref` to change.
   */
  collection?: boolean;
}

/**
 * Thrown by `FlowRegistry.register` when two flows declare schemas that would
 * destroy each other's data if stored under the same scope key. Names both
 * flows, the scope, the field path (`stateSchema` or `resources.<ref>`), and
 * the reason; the message ends with the escape hatch to reach for.
 *
 * The escape hatch differs by field, because the two halves isolate at
 * different granularities: the scope record follows the flow-level
 * `isolate*State` flag, while a resource follows its own `flowIsolation` —
 * which overrides that flag in both directions, so pointing a resource
 * conflict at the flow flag would be advice that silently fails to work on a
 * resource declaring `flowIsolation: false`.
 *
 * It also differs when both sides are the SAME flow — two of its own
 * declarations resolving to one cell. `flowIsolation` is no escape there:
 * isolating both still lands them in the same `flowKind` bucket. Only a
 * distinct identity or a reconciled schema separates them.
 */
export class CrossFlowSchemaConflictError extends Error {
  readonly scope: ConflictScope;
  readonly field: string;
  readonly flowA: string;
  readonly flowB: string;
  readonly reason: CompatibilityReason;
  readonly detail: string;

  constructor(details: CrossFlowSchemaConflictDetails) {
    const flag = details.scope === "user" ? "isolateUserState" : "isolateOrgState";
    const isResource = details.field.startsWith("resources.");
    const kind = details.collection === true ? "collection" : "resource";
    // A collection keys on its `pattern` and has no `ref` to change, so the
    // single-resource remedy would be advice that does nothing.
    const identityRemedy = details.collection === true
      ? `give one a distinct pattern`
      : `give one a distinct ref`;
    const sameFlow = details.flowA === details.flowB;

    let message: string;
    if (isResource && sameFlow) {
      const ref = details.field.slice("resources.".length);
      message =
        `Flow "${details.flowA}" declares two ${details.scope}-scoped ${kind}s that both resolve to "${ref}" ` +
        `with incompatible schemas (${details.reason}: ${details.detail}). ` +
        `They address one storage cell, so ${identityRemedy}, or reconcile the schemas.`;
    } else {
      const remedy = isResource
        ? `Set flowIsolation: true on that ${kind} in one of the flows to opt out of cross-flow sharing, ${identityRemedy}, or reconcile the schemas.`
        : `Set ${flag}: true on one of the flows to opt out of cross-flow sharing, or reconcile the schemas.`;
      message =
        `Flows "${details.flowA}" and "${details.flowB}" declare incompatible ${details.scope}.${details.field} schemas ` +
        `(${details.reason}: ${details.detail}). ${remedy}`;
    }
    super(message);
    this.name = "CrossFlowSchemaConflictError";
    this.scope = details.scope;
    this.field = details.field;
    this.flowA = details.flowA;
    this.flowB = details.flowB;
    this.reason = details.reason;
    this.detail = details.detail;
  }
}
