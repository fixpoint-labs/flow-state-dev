/**
 * The adapter's pure reads of a landing: the verdict an accept sends, and where an accepted run's
 * work went. A plain accept sends no `land`, so a review that can't land reads as it always did.
 */
import { describe, expect, it } from "vitest";
import { acceptOf, landedOf } from "../src/adapter";

describe("acceptOf", () => {
  it("is a plain accept without a land", () => {
    expect(acceptOf()).toStrictEqual({ verdict: "accepted" });
  });

  it("names the land the accept takes", () => {
    expect(acceptOf("pull-request")).toStrictEqual({ verdict: "accepted", land: "pull-request" });
    expect(acceptOf("merge")).toStrictEqual({ verdict: "accepted", land: "merge" });
  });
});

describe("landedOf", () => {
  it("reads a pull request the run opened", () => {
    const landed = { kind: "pull-request", url: "https://github.com/acme/relay/pull/7", number: 7, branch: "t-1--code", base: "main" };
    expect(landedOf(landed)).toStrictEqual(landed);
  });

  it("reads a merge into the person's checkout", () => {
    const landed = { kind: "merge", branch: "main", commit: "c15d6f098abc", checkout: "/work/relay", from: "t-1--code" };
    expect(landedOf(landed)).toStrictEqual(landed);
  });

  it("reads nothing from an output that names no landing, or one that is malformed", () => {
    expect(landedOf(undefined)).toBeUndefined();
    expect(landedOf(null)).toBeUndefined();
    expect(landedOf("merge")).toBeUndefined();
    expect(landedOf({ kind: "pull-request", number: 7 })).toBeUndefined();
    expect(landedOf({ kind: "elsewhere", url: "x" })).toBeUndefined();
  });
});
