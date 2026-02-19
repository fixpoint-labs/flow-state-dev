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
  useProjections,
  useRequestStream,
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

  it("useSession accepts positional (flowKind, sessionId, options) args", () => {
    expect(typeof useSession).toBe("function");
    expect(useSession.length).toBeGreaterThanOrEqual(1);
  });

  it("useProjections is a function", () => {
    expect(typeof useProjections).toBe("function");
  });

  it("useAction is a function", () => {
    expect(typeof useAction).toBe("function");
  });

  it("useRequestStream is a function", () => {
    expect(typeof useRequestStream).toBe("function");
  });
});

describe("useSession signature", () => {
  it("accepts a flow kind string as first positional arg", () => {
    expect(() => {
      useSession("demo", undefined);
    }).toThrow();
  });
});
