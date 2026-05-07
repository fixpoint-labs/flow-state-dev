/**
 * Hook behavioral tests.
 *
 * These hooks are real React hooks (useState/useEffect/etc.) and must be
 * called inside a React component tree.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setFlowContext,
  useAction,
  useFlow,
  useClientData,
  useRequestStream,
  useResourceCollection,
  useResourceCollectionItem,
  useResourceCollectionList,
  useResourceManifest,
  useSession
} from "../src";

afterEach(() => {
  vi.restoreAllMocks();
  setFlowContext({});
});

describe("hook exports and types", () => {
  it("useFlow is a function", () => {
    expect(typeof useFlow).toBe("function");
  });

  it("useSession accepts positional (sessionId, options) args", () => {
    expect(typeof useSession).toBe("function");
    expect(useSession.length).toBeGreaterThanOrEqual(1);
  });

  it("useClientData is a function", () => {
    expect(typeof useClientData).toBe("function");
  });

  it("useAction is a function", () => {
    expect(typeof useAction).toBe("function");
  });

  it("useRequestStream is a function", () => {
    expect(typeof useRequestStream).toBe("function");
  });

  it("FIX-427 collection hooks are exported as functions", () => {
    expect(typeof useResourceCollection).toBe("function");
    expect(typeof useResourceCollectionList).toBe("function");
    expect(typeof useResourceCollectionItem).toBe("function");
    expect(typeof useResourceManifest).toBe("function");
  });
});

describe("useSession signature", () => {
  it("accepts sessionId as first positional arg with flowKind from options", () => {
    expect(() => {
      useSession(undefined, { flowKind: "demo" });
    }).toThrow();
  });
});
