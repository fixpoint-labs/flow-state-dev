import { describe, expect, it } from "vitest";
import { serverPackageMarker } from "../src";

describe("@flow-state-dev/server", () => {
  it("exports scaffold marker", () => {
    expect(serverPackageMarker).toBe("@flow-state-dev/server");
  });
});
