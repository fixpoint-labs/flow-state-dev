/**
 * Path-segment escaping for user-controlled blockInstanceId values (FIX-814).
 *
 * Tool names / call ids and router branch names are embedded into the
 * slash-delimited structural path. Percent-escaping the reserved characters
 * (`% / [ ] :`) is what keeps both exact-equality and prefix matching over the
 * logical path unambiguous — the property generator-resume gate-matching
 * depends on.
 */
import { describe, it, expect } from "vitest";
import {
  blockPathTool,
  blockPathBranch,
  extendBlockPath,
} from "../src/block-instance-id";

describe("blockPathTool escaping (FIX-814)", () => {
  it("distinct call ids containing reserved chars produce distinct, non-prefix-colliding paths", () => {
    // The classic exploit: one call id looks like it nests under a sibling.
    const a = extendBlockPath("root", blockPathTool("t", "abc"));
    const b = extendBlockPath("root", blockPathTool("t", "abc]/nested"));

    expect(a).not.toEqual(b);
    // Without escaping, b would be `.../tool[t][abc]/nested]`, which
    // startsWith(a + "/"). Escaping the `]` and `/` breaks that false prefix.
    expect(b.startsWith(a + "/")).toBe(false);
  });

  it("escapes each reserved character in the call id", () => {
    const seg = blockPathTool("t", "a]b[c/d:e%f");
    expect(seg).toBe("tool[t][a%5Db%5Bc%2Fd%3Ae%25f]");
  });

  it("escapes reserved characters in the tool name", () => {
    // Framework tool names legitimately contain `/` and `.`.
    const seg = blockPathTool("tf.memory/recall", "0");
    expect(seg).toBe("tool[tf.memory%2Frecall][0]");
  });

  it("keeps the step-indexed disambiguator (`${step}:${callId}`) unambiguous", () => {
    const s0 = extendBlockPath("root", blockPathTool("t", "0:call_1"));
    const s1 = extendBlockPath("root", blockPathTool("t", "1:call_1"));
    expect(s0).not.toEqual(s1);
    // The `:` is escaped, so the two steps' paths can never prefix-collide.
    expect(s1.startsWith(s0 + "/")).toBe(false);
  });

  it("a genuine composite tool suspension prefix-matches its own tool, not a sibling", () => {
    const toolA = extendBlockPath("root/gen", blockPathTool("compositeA", "0:c1"));
    const toolB = extendBlockPath("root/gen", blockPathTool("compositeB", "0:c2"));
    // A nested suspension under toolA extends its path with a real segment.
    const nestedUnderA = extendBlockPath(toolA, "step[0]");

    expect(nestedUnderA.startsWith(toolA + "/")).toBe(true);
    expect(nestedUnderA.startsWith(toolB + "/")).toBe(false);
  });
});

describe("blockPathBranch escaping (FIX-814)", () => {
  it("escapes reserved characters in the branch name", () => {
    expect(blockPathBranch("a]b/c")).toBe("branch[a%5Db%2Fc]");
  });

  it("distinct branch names never prefix-collide", () => {
    const a = extendBlockPath("root", blockPathBranch("cold"));
    const b = extendBlockPath("root", blockPathBranch("cold]/x"));
    expect(b.startsWith(a + "/")).toBe(false);
  });
});
