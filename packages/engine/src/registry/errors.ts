/**
 * Error types for cross-flow schema registry validation.
 */
import type { CompatibilityReason } from "./schema-compat";

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
