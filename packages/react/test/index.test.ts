import { describe, expect, it } from "vitest";
import {
  ApprovalRenderer,
  FlowProvider,
  ItemRenderer,
  coreItemImportProof,
  deriveSuspensions,
  getFlowContext,
  reactPackageMarker,
  resolveSuspension,
  useAction,
  useFlow,
  useFlowContext,
  useClientData,
  useRequestStream,
  useSession,
  useSuspensions
} from "../src";

describe("@flow-state-dev/react", () => {
  it("exports scaffold marker", () => {
    expect(reactPackageMarker).toBe("@flow-state-dev/react");
  });

  it("keeps core import proof wired", () => {
    expect(coreItemImportProof).toBe("message");
  });

  it("exports hooks", () => {
    expect(typeof useFlow).toBe("function");
    expect(typeof useSession).toBe("function");
    expect(typeof useClientData).toBe("function");
    expect(typeof useAction).toBe("function");
    expect(typeof useRequestStream).toBe("function");
  });

  it("exports FlowProvider and context helpers", () => {
    expect(typeof FlowProvider).toBe("function");
    expect(typeof useFlowContext).toBe("function");
    expect(typeof getFlowContext).toBe("function");
  });

  it("exports render helpers", () => {
    expect(typeof ItemRenderer).toBe("function");
  });

  it("exports useSuspensions and HITL helpers", () => {
    expect(typeof useSuspensions).toBe("function");
    expect(typeof deriveSuspensions).toBe("function");
    expect(typeof resolveSuspension).toBe("function");
    expect(typeof ApprovalRenderer).toBe("function");
  });
});
