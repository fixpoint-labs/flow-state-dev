/**
 * Which turn's window the divider reads, off workforce's session turns view.
 * The window only moves forward once turns have left it, so the divider
 * follows the latest turn that read one: a turn still starting, or one that
 * read no history, has no mark yet, and reading it would take the divider off
 * the screen. The view lists the turn actions only, so the board's own passes
 * never reach this read.
 */
import { describe, expect, it } from "vitest";
import { windowReadOf } from "../src/lib/conversation";

const turn = (id: string, startedAt: number, historyStart?: string) => ({ id, startedAt, historyStart: historyStart === undefined ? null : { requestId: historyStart } });

describe("the window the divider reads", () => {
  it("is the latest turn's", () => {
    expect(windowReadOf([turn("r7", 7, "r2"), turn("r8", 8, "r3")], undefined)).toEqual({ historyStart: "r3" });
  });

  it("goes by when a turn started, not where the view lists it", () => {
    expect(windowReadOf([turn("r8", 8, "r3"), turn("r7", 7, "r2")], undefined)).toEqual({ historyStart: "r3" });
  });

  it("stays on the last turn that read one while the newest has no mark yet, so the divider doesn't drop out", () => {
    expect(windowReadOf([turn("r8", 8, "r3"), turn("r9", 9)], undefined)).toEqual({ historyStart: "r3" });
  });

  it("is none while no turn's window has dropped one", () => {
    expect(windowReadOf([turn("r1", 1), turn("r2", 2)], undefined)).toEqual({});
  });

  it("carries the summary's mark, and whether the summary has a hole", () => {
    expect(windowReadOf([turn("r8", 8, "r3")], { throughRequestId: "r4", complete: false })).toEqual({
      historyStart: "r3",
      summarizedThrough: "r4",
      summaryComplete: false,
    });
  });
});
