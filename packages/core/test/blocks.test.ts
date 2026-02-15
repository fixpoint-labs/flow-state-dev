import { describe, expect, it } from "vitest";
import { generator, handler, router, sequencer } from "../src";

describe("@flow-state-dev/core test harness", () => {
  it("exports canonical block builders", () => {
    expect(typeof handler).toBe("function");
    expect(typeof generator).toBe("function");
    expect(typeof sequencer).toBe("function");
    expect(typeof router).toBe("function");
  });
});
