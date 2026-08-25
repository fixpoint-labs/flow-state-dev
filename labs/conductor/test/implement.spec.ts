/**
 * The completion check's state rule, and the seed's identity.
 */
import { describe, expect, it } from "vitest";
import { hasCompletingPr } from "../src/implement";
import {
  conductorTaskId,
  branchFor,
  checkoutPathFor,
  type RunLocation,
  type RunPrincipal,
  encodeSegment,
} from "../src/workspace";

const ALICE: RunPrincipal = { userId: "alice" };
const EPIC = "conductor-tasks-test-epic";
const at = (issue: string, phase: string): RunLocation => ({
  principal: ALICE,
  epic: EPIC,
  issue,
  phase,
});

describe("the done-condition — which pull requests count", () => {
  it("does NOT complete on a pull request that was closed without merging", async () => {
    // The defect this pins, and it is not hypothetical: a closed-unmerged pull
    // request is an ordinary artifact of this repo's own process. Counting one
    // means a later attempt that exits cleanly completes the task with no open
    // and no merged pull request anywhere — a silent success, re-entering
    // through the completion check that exists to prevent silent successes.
    expect(hasCompletingPr(JSON.stringify([{ number: 1437, state: "CLOSED" }]))).toBe(false);
  });

  it("completes on an open one, and on a merged one", async () => {
    // Both arms matter. Open is the ordinary case; merged is the run that
    // opened a PR and had it merged before the verdict was read — which asking
    // only for open ones would have missed.
    expect(hasCompletingPr(JSON.stringify([{ number: 1, state: "OPEN" }]))).toBe(true);
    expect(hasCompletingPr(JSON.stringify([{ number: 2, state: "MERGED" }]))).toBe(true);
  });

  it("takes the branch when any row counts, even beside a closed one", async () => {
    // A branch can carry a closed attempt and a live one.
    expect(
      hasCompletingPr(
        JSON.stringify([
          { number: 1, state: "CLOSED" },
          { number: 2, state: "OPEN" },
        ]),
      ),
    ).toBe(true);
  });

  it("refuses anything it cannot classify, rather than completing", async () => {
    // BP-030: an answer we cannot read must not complete a task. Empty output,
    // malformed JSON, a row with no state, a shape that is not a list.
    for (const stdout of ["", "[]", "not json", '[{"number":1}]', '{"number":1}']) {
      expect(hasCompletingPr(stdout)).toBe(false);
    }
  });
});

describe("the board task's identity", () => {
  it("is stable per issue-phase, so a repeated seed cannot mint a second run", () => {
    // Two rows for one issue-phase derive the same checkout, the same branch and
    // the same run record — so a duplicated seed charges two full coding runs
    // whose claims overwrite one shared record.
    expect(conductorTaskId("FIX-1219", "implement")).toBe(
      conductorTaskId("FIX-1219", "implement"),
    );
    expect(conductorTaskId("FIX-1219", "implement")).not.toBe(
      conductorTaskId("FIX-1219", "review"),
    );
    expect(conductorTaskId("FIX-1219", "implement")).not.toBe(
      conductorTaskId("FIX-1220", "implement"),
    );
  });

  it("is validated like a path segment, because it lands in the ledger's key space", () => {
    for (const bad of ["../escape", "a/b", "..", "", "with space"]) {
      expect(() => conductorTaskId(bad, "implement")).toThrow(/not a usable identity segment/);
      expect(() => conductorTaskId("FIX-1", bad)).toThrow(/not a usable identity segment/);
    }
  });

  it("agrees with the checkout and branch it is derived alongside", () => {
    // One issue-phase, one identity everywhere — the property that makes a
    // duplicate seed a duplicate of something rather than a second run.
    const config = { root: "/w", sourceRepo: "/r", baseRef: "main" };
    expect(checkoutPathFor(config, at("FIX-1219", "implement"))).toContain(
      conductorTaskId("FIX-1219", "implement"),
    );
    expect(branchFor(at("FIX-1219", "implement"))).toBe(
      // The principal segment is DERIVED, not spelled: it is a digest, and a
      // literal here would only pin how the digest happens to be computed
      // today. What this asserts is the SHAPE — untenanted tag, principal,
      // board identity, framed leaf.
      `conductor/t0/${encodeSegment("alice")}/conductor-tasks-test-epic/FIX-1219--implement`,
    );
  });
});
