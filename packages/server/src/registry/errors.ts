/**
 * Error types for cross-flow schema registry validation.
 */
import type { CompatibilityReason } from "./schema-compat";

export type ConflictScope = "user" | "project";

export interface CrossFlowSchemaConflictDetails {
  scope: ConflictScope;
  field: string;
  flowA: string;
  flowB: string;
  reason: CompatibilityReason;
  detail: string;
}

/**
 * Thrown at `FlowRegistry.register` time when two flows declare schemas that
 * would destroy each other's data if stored under the same scope key.
 *
 * The error message names both flows, the scope (`user` or `project`), the
 * field path within the scope (`stateSchema` or `resources.<name>`), and
 * the reason the two declarations are incompatible. The suggested resolution
 * is printed at the end of the message.
 */
export class CrossFlowSchemaConflictError extends Error {
  readonly scope: ConflictScope;
  readonly field: string;
  readonly flowA: string;
  readonly flowB: string;
  readonly reason: CompatibilityReason;
  readonly detail: string;

  constructor(details: CrossFlowSchemaConflictDetails) {
    const message = formatMessage(details);
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

function formatMessage(details: CrossFlowSchemaConflictDetails): string {
  const isolateFlag = details.scope === "user" ? "isolateUserState" : "isolateProjectState";
  return [
    `CrossFlowSchemaConflictError: Flows "${details.flowA}" and "${details.flowB}" declare incompatible`,
    ` ${details.scope}.${details.field} schemas.`,
    `\n  reason: ${details.reason} — ${details.detail}.`,
    `\n  Set ${isolateFlag}: true on one of the flows to opt out of cross-flow sharing,`,
    ` or reconcile the schemas so they are structurally compatible.`,
  ].join("");
}
