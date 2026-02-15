import { describe, expect, it } from "vitest";
import { devtoolPackageMarker } from "../src";

describe("@flow-state-dev/devtool", () => {
  it("exports scaffold marker", () => {
    expect(devtoolPackageMarker).toBe("@flow-state-dev/devtool");
  });
});
