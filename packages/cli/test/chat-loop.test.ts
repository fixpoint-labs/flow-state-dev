import { describe, expect, it } from "vitest";
import { decideIdleInterrupt } from "../src/chat/loop";

describe("decideIdleInterrupt", () => {
  it("warns and arms on the first idle Ctrl-C", () => {
    expect(decideIdleInterrupt(false)).toEqual({ action: "warn", armed: true });
  });

  it("exits and disarms on a second idle Ctrl-C while armed", () => {
    expect(decideIdleInterrupt(true)).toEqual({ action: "exit", armed: false });
  });
});
