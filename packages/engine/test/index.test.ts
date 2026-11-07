import { describe, expect, it } from "vitest";
import { createResponseEmitter, parseFlowRoute } from "../src/host";
import {
  createExecutionContext,
  createFlowApiRouter,
  createFlowRegistry,
  executeBlock,
  runAction
} from "../src";
import {
  createInMemoryStores
} from "../src/host";
import { normalizeError } from "../src/errors/normalize-error";
import { replayRequestEvents } from "../src/streaming/resume";
import { runWithCAS } from "../src/stores/cas";
import { serializeSSEFrame } from "../src/streaming/sse";

describe("@flow-state-dev/engine", () => {
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
