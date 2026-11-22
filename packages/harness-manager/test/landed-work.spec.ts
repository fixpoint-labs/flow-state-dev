/**
 * `landedOf` reads where an accepted run's work went, and whether the pull
 * request it opened has since merged or closed (FIX-2884), so a finished
 * task's screen never asks for a review of work that already landed.
 */
import { describe, expect, it } from "vitest";
import { landedOf } from "../src/landed-work";

const OPENED = { kind: "pull-request", url: "https://github.com/acme/app/pull/7", number: 7, branch: "b", base: "main" };

describe("landedOf", () => {
  it("carries the merged or closed state the output's settled reads record for the pull request it opened", () => {
    expect(landedOf(OPENED, [{ number: 7, state: "merged", url: OPENED.url, title: null }])).toEqual({ ...OPENED, state: "merged" });
    expect(landedOf(OPENED, [{ number: 7, state: "closed" }])).toEqual({ ...OPENED, state: "closed" });
  });

  it("says nothing of a state while the pull request is open, unread, or another one's", () => {
    expect(landedOf(OPENED, [{ number: 7, state: "open" }])).toEqual(OPENED);
    expect(landedOf(OPENED, null)).toEqual(OPENED);
    expect(landedOf(OPENED, [{ number: 8, state: "merged" }])).toEqual(OPENED);
  });
});
