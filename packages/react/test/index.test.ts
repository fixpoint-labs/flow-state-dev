import { describe, expect, it } from "vitest";
import {
  BlockRenderer,
  ItemRenderer,
  MessagesRenderer,
  clearBlockRenderers,
  coreItemImportProof,
  getFlowContext,
  reactPackageMarker,
  registerBlockRenderer,
  setFlowContext,
  useAction,
  useFlowAgent,
  useRequestStream,
  useSession,
  useTypedFlowClient
} from "../src";

describe("@flow-state-dev/react", () => {
  it("exports scaffold marker", () => {
    expect(reactPackageMarker).toBe("@flow-state-dev/react");
  });

  it("keeps core import proof wired", () => {
    expect(coreItemImportProof).toBe("message");
  });

  it("exports react package primitives", () => {
    expect(typeof useFlowAgent).toBe("function");
    expect(typeof useSession).toBe("function");
    expect(typeof useAction).toBe("function");
    expect(typeof useRequestStream).toBe("function");
    expect(typeof useTypedFlowClient).toBe("function");

    expect(typeof BlockRenderer).toBe("function");
    expect(typeof ItemRenderer).toBe("function");
    expect(typeof MessagesRenderer).toBe("function");

    expect(typeof registerBlockRenderer).toBe("function");
    expect(typeof clearBlockRenderers).toBe("function");

    expect(typeof setFlowContext).toBe("function");
    expect(typeof getFlowContext).toBe("function");
  });
});
