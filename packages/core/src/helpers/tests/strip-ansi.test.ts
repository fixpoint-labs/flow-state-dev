import { describe, expect, it } from "vitest";
import { stripAnsi } from "../strip-ansi";

describe("stripAnsi", () => {
  it("removes colour and style codes, keeping every word a person reads", () => {
    expect(stripAnsi("\u001b[1m\u001b[31mUnauthenticated request\u001b[0m to AI Gateway.")).toBe(
      "Unauthenticated request to AI Gateway."
    );
    expect(stripAnsi("\u001b[38;5;196mred\u001b[39m and \u001b[?25lcursor")).toBe("red and cursor");
  });

  it("leaves text without codes as is, brackets included", () => {
    expect(stripAnsi("plain [1m] text")).toBe("plain [1m] text");
  });
});
