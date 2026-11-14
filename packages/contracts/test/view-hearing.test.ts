import { describe, expect, it } from "vitest";
import { mayHold } from "../src/types/view-hearing";

describe("the path rule", () => {
  // FIX-1506's rule.
  it("mayHold: every doubt a yes", () => {
    expect(mayHold("roster/a", ["roster"])).toBe(true);
    expect(mayHold("workforce/workers/a", ["roster", "workforce/workers"])).toBe(true);
    expect(mayHold("workforce/other/a", ["roster", "workforce/workers"])).toBe(false);
    expect(mayHold("anything", undefined)).toBe(true);
    expect(mayHold("anything", ["roster", ""])).toBe(true);
    // A change at an ancestor of a root may touch anything beneath it.
    expect(mayHold("notes", ["notes/shared"])).toBe(true);
    expect(mayHold("notes/private", ["notes/shared"])).toBe(false);
    expect(mayHold("note", ["notes/shared"])).toBe(false);
  });
});
