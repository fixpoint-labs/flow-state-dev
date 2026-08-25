import { describe, expect, it } from "vitest";
import { toUserContent } from "../src/utility/to-user-content";

describe("toUserContent", () => {
  it("passes a string through unchanged", () => {
    expect(toUserContent("already text")).toBe("already text");
  });

  it("serializes a structured value as 2-space JSON", () => {
    expect(toUserContent({ goal: "ship", n: 2 })).toBe(
      JSON.stringify({ goal: "ship", n: 2 }, null, 2)
    );
  });
});
