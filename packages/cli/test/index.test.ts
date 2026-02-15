import { describe, expect, it } from "vitest";
import { cliPackageMarker } from "../src";

describe("@flow-state-dev/cli", () => {
  it("exports scaffold marker", () => {
    expect(cliPackageMarker).toBe("@flow-state-dev/cli");
  });
});
