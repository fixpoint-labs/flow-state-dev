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
}

/**
 * Thrown by `FlowRegistry.register` when two flows declare schemas that would
 * destroy each other's data if stored under the same scope key. Names both
 * flows, the scope, the field path (`stateSchema` or `resources.<name>`), and
 * the reason; the message ends with the `isolate*State` flag to set for an
 * escape hatch.
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
    super(
      `Flows "${details.flowA}" and "${details.flowB}" declare incompatible ${details.scope}.${details.field} schemas (${details.reason}: ${details.detail}). ` +
      `Set ${flag}: true on one of the flows to opt out of cross-flow sharing, or reconcile the schemas.`
    );
    this.name = "CrossFlowSchemaConflictError";
    this.scope = details.scope;
    this.field = details.field;
    this.flowA = details.flowA;
    this.flowB = details.flowB;
    this.reason = details.reason;
    this.detail = details.detail;
  }
}
