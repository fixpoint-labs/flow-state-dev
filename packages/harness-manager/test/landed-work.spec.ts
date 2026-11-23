/**
 * Where an accepted run's work went, and what became of the pull request it
 * landed on (FIX-2884): the settle stamps it, matched by address, so a
 * finished task's screen never asks for a review of work that already merged.
 */
import { describe, expect, it } from "vitest";
import { landedOf, withSettledState } from "../src/landed-work";

const OPENED = { kind: "pull-request", url: "https://github.com/acme/app/pull/7", number: 7, branch: "b", base: "main" } as const;

describe("withSettledState", () => {
  it("stamps the merged or closed state the settle read for the pull request the work landed on", () => {
    expect(withSettledState(OPENED, [{ url: OPENED.url, state: "merged" }])).toEqual({ ...OPENED, state: "merged" });
    expect(withSettledState(OPENED, [{ url: OPENED.url, state: "closed" }])).toEqual({ ...OPENED, state: "closed" });
  });

  it("matches by address: the same number in another repository says nothing about this one", () => {
    expect(withSettledState(OPENED, [{ url: "https://github.com/acme/other/pull/7", state: "merged" }])).toEqual(OPENED);
  });

  it("adds nothing while it is open, and leaves a local merge or no landing as given", () => {
    expect(withSettledState(OPENED, [{ url: OPENED.url, state: "open" }])).toEqual(OPENED);
    const merge = { kind: "merge", branch: "main", commit: "c1", checkout: "/w", from: "b" } as const;
    expect(withSettledState(merge, [{ url: null, state: "merged" }])).toBe(merge);
    expect(withSettledState(null, [])).toBeNull();
  });
});

describe("landedOf", () => {
  it("reads the stamped state, and drops keys beside the shape", () => {
    expect(landedOf({ ...OPENED, state: "merged", remote: "origin" })).toEqual({ ...OPENED, state: "merged" });
    expect(landedOf(OPENED)).toEqual(OPENED);
  });
});
