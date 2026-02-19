import { describe, expect, it } from "vitest";
import {
  createTestContext,
  mockGenerator,
  snapshotTrace,
  testBlock,
  testFlow,
  testItems,
  testRouter,
  testSequencer,
  testingPackageMarker
} from "../src";

describe("@flow-state-dev/testing", () => {
  it("exports package marker", () => {
    expect(testingPackageMarker).toBe("@flow-state-dev/testing");
  });

  it("exports runtime test APIs", () => {
    expect(typeof createTestContext).toBe("function");
    expect(typeof testBlock).toBe("function");
    expect(typeof testSequencer).toBe("function");
    expect(typeof testRouter).toBe("function");
    expect(typeof testFlow).toBe("function");
    expect(typeof testItems).toBe("function");
    expect(typeof snapshotTrace).toBe("function");
    expect(typeof mockGenerator).toBe("function");
  });
});
