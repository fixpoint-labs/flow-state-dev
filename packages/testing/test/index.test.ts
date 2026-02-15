import { describe, expect, it } from "vitest";
import { testingPackageMarker } from "../src";

describe("@flow-state-dev/testing", () => {
  it("exports scaffold marker", () => {
    expect(testingPackageMarker).toBe("@flow-state-dev/testing");
  });
});
