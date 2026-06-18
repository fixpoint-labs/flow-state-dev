/**
 * Exhaustive unit tests for the pure stage machine. Every Linear state maps to
 * exactly one action, and the dispatch-in-flight / from-backlog context flags
 * change the answer in the ways the orchestrator depends on for restart safety.
 */
import { describe, expect, it } from "vitest";
import { nextAction, type DriverState } from "../src/stage-machine";
import type { LinearStateName } from "../src/types";

const fresh: DriverState = { fromBacklog: false };
const backlog: DriverState = { fromBacklog: true };

describe("nextAction — dispatch entry points", () => {
  it("dispatches the spec stage from Ready to Spec", () => {
    expect(nextAction("Ready to Spec", fresh)).toEqual({ kind: "dispatch", stage: "spec" });
  });

  it("dispatches implement from Spec Approved", () => {
    expect(nextAction("Spec Approved", fresh)).toEqual({ kind: "dispatch", stage: "implement" });
  });

  it("dispatches review from In Review", () => {
    expect(nextAction("In Review", fresh)).toEqual({ kind: "dispatch", stage: "review" });
  });
});

describe("nextAction — agent-running states await", () => {
  it("awaits the spec agent in In Spec Dev", () => {
    expect(nextAction("In Spec Dev", fresh)).toEqual({ kind: "await-agent", stage: "spec" });
  });

  it("awaits the implement agent in In Development", () => {
    expect(nextAction("In Development", fresh)).toEqual({ kind: "await-agent", stage: "implement" });
  });
});

describe("nextAction — human gates", () => {
  it("awaits the human at the spec-approval gate in In Spec Review", () => {
    expect(nextAction("In Spec Review", fresh)).toEqual({ kind: "await-human", gate: "spec-approval" });
  });
});

describe("nextAction — terminal and unknown states", () => {
  it("reports done at Done", () => {
    expect(nextAction("Done", fresh)).toEqual({ kind: "done" });
  });

  it("noops on Canceled and Duplicate", () => {
    expect(nextAction("Canceled", fresh)).toMatchObject({ kind: "noop" });
    expect(nextAction("Duplicate", fresh)).toMatchObject({ kind: "noop" });
  });

  it("noops (does not throw) on an unrecognized state", () => {
    const action = nextAction("Some Future State" as LinearStateName, fresh);
    expect(action.kind).toBe("noop");
    if (action.kind === "noop") expect(action.reason).toContain("Unrecognized");
  });
});

describe("nextAction — from-backlog opt-in", () => {
  it("noops on Todo/Backlog by default", () => {
    expect(nextAction("Todo", fresh).kind).toBe("noop");
    expect(nextAction("Backlog", fresh).kind).toBe("noop");
  });

  it("dispatches spec from Todo/Backlog when fromBacklog is set", () => {
    expect(nextAction("Todo", backlog)).toEqual({ kind: "dispatch", stage: "spec" });
    expect(nextAction("Backlog", backlog)).toEqual({ kind: "dispatch", stage: "spec" });
  });
});
