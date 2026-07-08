/**
 * Pure unit tests for the status → board-state mapping. Exhaustive over the
 * {stage, status} space the prototype currently maps; everything else is
 * asserted as a deliberate no-op (informational-only) per the header comment
 * in status-map.ts.
 */
import { describe, expect, it } from "vitest";
import { boardStateForStatus } from "../../src/session-control/status-map";
import type { SessionStatus } from "../../src/session-control/schemas";
import type { OrchestrationStage } from "../../src/types";

const STAGES: OrchestrationStage[] = ["spec", "implement", "review"];
const STATUSES: SessionStatus[] = ["working", "awaiting-review", "addressing-feedback", "done", "errored"];

describe("boardStateForStatus", () => {
  it("maps spec-stage done to In Spec Review", () => {
    expect(boardStateForStatus({ stage: "spec", status: "done" })).toBe("In Spec Review");
  });

  it("maps implement-stage done to In Review", () => {
    expect(boardStateForStatus({ stage: "implement", status: "done" })).toBe("In Review");
  });

  it("review-stage done is a no-op (no known target state yet)", () => {
    expect(boardStateForStatus({ stage: "review", status: "done" })).toBeNull();
  });

  it("every non-done status is informational only, for every stage", () => {
    for (const stage of STAGES) {
      for (const status of STATUSES) {
        if (status === "done") continue;
        expect(boardStateForStatus({ stage, status })).toBeNull();
      }
    }
  });
});
