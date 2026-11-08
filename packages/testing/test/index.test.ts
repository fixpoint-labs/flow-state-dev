import { describe, expect, it } from "vitest";
import {
  createMockModelResolver,
  createTestContext,
  mockGenerator,
  snapshotTrace,
  testBlock,
  testFlow,
  testItems
} from "../src";

describe("@flow-state-dev/testing", () => {
  it("exports runtime test APIs", () => {
    expect(typeof createTestContext).toBe("function");
    expect(typeof testBlock).toBe("function");
    expect(typeof testFlow).toBe("function");
    expect(typeof testItems).toBe("function");
    expect(typeof snapshotTrace).toBe("function");
    expect(typeof mockGenerator).toBe("function");
    expect(typeof createMockModelResolver).toBe("function");
  });
});
