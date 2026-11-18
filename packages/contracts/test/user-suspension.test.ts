// FIX-2770.
/**
 * The user-suspension predicate in one place. The SQL stores read
 * `USER_SUSPENSION_REASONS` where the engine reads `isUserSuspension`, so the
 * two must name the same set, the old `human_*` names included: a drift would
 * list a suspension in one store and hide it in another. `suspensionShape` lives
 * beside them so a server read draws the same card the browser does.
 */
import { describe, expect, it } from "vitest";
import { isUserSuspension } from "../src";
import { USER_SUSPENSION_REASONS, suspensionShape } from "../src/types/suspension";

describe("USER_SUSPENSION_REASONS", () => {
  it("is exactly the reasons isUserSuspension accepts", () => {
    const candidates = ["user_approval", "user_input", "human_approval", "human_input", "external_event", "wait", "custom"]; // retired-name-refusal: stops core 0.2.0 stored
    expect([...USER_SUSPENSION_REASONS].sort()).toEqual(candidates.filter((reason) => isUserSuspension({ reason })).sort());
    expect(USER_SUSPENSION_REASONS).toHaveLength(4);
  });
});

describe("suspensionShape, from contracts", () => {
  it("draws the card from reason, allow and schema", () => {
    expect(suspensionShape({ reason: "user_approval" })).toBe("approval");
    expect(suspensionShape({ reason: "user_input", allow: ["approve", "reject"] })).toBe("approval");
    expect(suspensionShape({ reason: "user_input", allow: ["submit"] })).toBe("question");
    expect(suspensionShape({ reason: "user_input", allow: ["submit"], resumeSchema: { type: "string", enum: ["a"] } })).toBe("selection");
    expect(
      suspensionShape({ reason: "user_input", allow: ["submit"], resumeSchema: { type: "object", properties: { n: { type: "number" } } } })
    ).toBe("form");
  });
});
