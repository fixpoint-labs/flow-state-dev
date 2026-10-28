/**
 * The project the screen names for a worker comes from the conversation's own
 * `workProjectId`, as the session read shows it, so a pick made in another tab
 * or client shows too (FIX-2280).
 */
import { describe, expect, it } from "vitest";
import { workProjectOf } from "../src/adapter";

describe("a worker's project, read from its conversation", () => {
  it("names the shared project the session read shows, whoever set it", () => {
    expect(workProjectOf({ workerId: "lead", workProjectId: "shared/apollo" })).toBe("apollo");
  });

  it("names none before a pick, and none for a private project the screen doesn't list", () => {
    expect(workProjectOf({ workerId: "lead" })).toBeUndefined();
    expect(workProjectOf(undefined)).toBeUndefined();
    expect(workProjectOf({ workProjectId: "private/apollo" })).toBeUndefined();
    expect(workProjectOf({ workProjectId: "apollo" })).toBeUndefined();
  });
});
