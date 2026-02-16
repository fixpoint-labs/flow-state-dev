import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores,
  runWithCAS,
  serverPackageMarker
} from "../src";

describe("@flow-state-dev/server", () => {
  it("exports scaffold marker", () => {
    expect(serverPackageMarker).toBe("@flow-state-dev/server");
  });

  it("exports wave 1.e server primitives", () => {
    expect(typeof createExecutionContext).toBe("function");
    expect(typeof createInMemoryStores).toBe("function");
    expect(typeof runWithCAS).toBe("function");
  });
});
