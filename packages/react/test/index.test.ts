import { describe, expect, it } from "vitest";
import { coreItemImportProof, reactPackageMarker } from "../src";

describe("@flow-state-dev/react", () => {
  it("exports scaffold marker", () => {
    expect(reactPackageMarker).toBe("@flow-state-dev/react");
  });

  it("keeps core import proof wired", () => {
    expect(coreItemImportProof).toBe("message");
  });
});
