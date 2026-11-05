/**
 * Which request's window the divider reads. The window only moves forward
 * once turns have left it, so the divider follows the latest turn that read
 * one: a turn still starting, or one that read no history, has no mark yet,
 * and reading it would take the divider off the screen.
 */
import type { SessionRequestSummary } from "@flow-state-dev/client";
import { describe, expect, it } from "vitest";
import { windowReadOf } from "../src/adapter";

const request = (id: string, startedAtMs: number, historyStart?: string, actionName = "chat"): SessionRequestSummary =>
  ({ id, actionName, status: "completed", startedAtMs, ...(historyStart === undefined ? {} : { historyStart: { requestId: historyStart } }) }) as SessionRequestSummary;

describe("the window the divider reads", () => {
  it("is the latest answering turn's", () => {
    expect(windowReadOf([request("r7", 7, "r2"), request("r8", 8, "r3")], undefined)).toEqual({ historyStart: "r3" });
  });

  it("stays on the last turn that read one while the newest has no mark yet, so the divider doesn't drop out", () => {
    const starting = { ...request("r9", 9), status: "in_progress" } as SessionRequestSummary;
    expect(windowReadOf([request("r8", 8, "r3"), starting], undefined)).toEqual({ historyStart: "r3" });
  });

  it("leaves out the board's quiet dispatches", () => {
    expect(windowReadOf([request("r8", 8, "r3"), request("d1", 9, "r5", "dispatch")], undefined)).toEqual({ historyStart: "r3" });
  });

  it("is none while no turn's window has dropped one", () => {
    expect(windowReadOf([request("r1", 1), request("r2", 2)], undefined)).toEqual({});
  });

  it("carries the summary's mark, and whether the summary has a hole", () => {
    expect(windowReadOf([request("r8", 8, "r3")], { clientData: { throughRequestId: "r4", complete: false } })).toEqual({
      historyStart: "r3",
      summarizedThrough: "r4",
      summaryComplete: false,
    });
  });
});
