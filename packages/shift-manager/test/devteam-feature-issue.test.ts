// FIX-2878.
/**
 * Which feature a stored coder row is for, as the EM reads it before it
 * files: the EM files a feature once, and finds the row it filed by this.
 *
 * Why it matters: a row stored before tasks declared their input carried
 * whatever fields a model wrote, `mode` and `issue` among them. Read as
 * feature work, such a row would answer "already filed" for an issue nobody
 * filed, and the feature would never start. So a plain `mode` and `issue`
 * count only on a row the coder's filing check stamped; an old row names a
 * feature only through the old `harnessFeature` marker.
 *
 * Graded on `featureIssueOf`, the reader the EM's filing door dedupes by.
 */
import { describe, expect, it } from "vitest";
import { featureIssueOf } from "../teams/devteam/workforce/flows/workers/em.mts";

describe("the feature a stored coder row is for", () => {
  it("is none on a row the filing check never stamped, whatever its plain mode and issue say", () => {
    expect(featureIssueOf({ input: { mode: "implement", issue: "FIX-123" } })).toBeUndefined();
    expect(featureIssueOf({ input: { mode: "implement", issue: "FIX-123" }, metadata: { inputFilledFor: { flow: "coder", declaration: "an-older-declaration" } } })).toBeUndefined();
  });

  it("is the old marker's issue on a row stored before modes", () => {
    expect(featureIssueOf({ input: { harnessFeature: { issue: "FIX-123", phase: "implement" } } })).toBe("FIX-123");
  });
});
