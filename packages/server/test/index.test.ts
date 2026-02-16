import { describe, expect, it } from "vitest";
import {
  createResponseEmitter,
  createExecutionContext,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  executeBlock,
  normalizeError,
  parseFlowRoute,
  replayRequestEvents,
  runAction,
  runWithCAS,
  serializeSSEFrame,
  serverPackageMarker
} from "../src";

describe("@flow-state-dev/server", () => {
  it("exports scaffold marker", () => {
    expect(serverPackageMarker).toBe("@flow-state-dev/server");
  });

  it("exports server runtime primitives", () => {
    expect(typeof createExecutionContext).toBe("function");
    expect(typeof createInMemoryStores).toBe("function");
    expect(typeof createFlowRegistry).toBe("function");
    expect(typeof createFlowApiRouter).toBe("function");
    expect(typeof parseFlowRoute).toBe("function");
    expect(typeof runWithCAS).toBe("function");
    expect(typeof createResponseEmitter).toBe("function");
    expect(typeof serializeSSEFrame).toBe("function");
    expect(typeof replayRequestEvents).toBe("function");
    expect(typeof executeBlock).toBe("function");
    expect(typeof runAction).toBe("function");
    expect(typeof normalizeError).toBe("function");
  });
});
