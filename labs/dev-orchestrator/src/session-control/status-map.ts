/**
 * Pure status → board-state mapping. Same discipline as the stage machine's
 * `nextAction` (../stage-machine.ts): I/O-free so it's exhaustively unit
 * testable, consulted by the `reportStatus` action to decide whether (and
 * how) to move the Linear board.
 *
 * Deliberately thin for the prototype — only the transitions already
 * committed to by the existing spec stage (../flow/stages/spec.ts's
 * SPEC_PARK_TARGET) and its implement-stage analogue are mapped. Every other
 * {stage, status} pair is informational only (registry write, no board
 * write) until the full mapping is designed; see "Status ↔ board mapping
 * ownership" in docs/session-telemetry-mcp.md.
 */
import type { LinearStateName, OrchestrationStage } from "../types";
import type { SessionStatus } from "./schemas";

export interface StatusMapInput {
  stage: OrchestrationStage;
  status: SessionStatus;
}

/** The Linear state `reportStatus` should assert, or `null` for no board write. */
export function boardStateForStatus({ stage, status }: StatusMapInput): LinearStateName | null {
  if (status !== "done") return null;
  switch (stage) {
    case "spec":
      return "In Spec Review";
    case "implement":
      return "In Review";
    case "review":
      return null;
    default:
      return null;
  }
}
