import { describe, expect, it } from "vitest";
import { clientPackageMarker } from "../src";

describe("@flow-state-dev/client", () => {
  it("exports scaffold marker", () => {
    expect(clientPackageMarker).toBe("@flow-state-dev/client");
  });
});
