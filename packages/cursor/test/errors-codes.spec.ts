/**
 * Each of this package's errors carries a stable `code`, so a host branches on
 * the failure without reading its message. The run's failure codes are emitted
 * into error items and stored, so they keep their values when names change.
 */
import { describe, expect, it } from "vitest";
import { CursorAgentAbortedError, CursorAgentConfigError, CursorAgentRunError, CursorSdkNotInstalledError } from "../src/index";

describe("the cursor errors' codes", () => {
  it("are stable values a host can branch on", () => {
    expect(new CursorSdkNotInstalledError().code).toBe("CURSOR_SDK_NOT_INSTALLED");
    expect(new CursorAgentConfigError("bad option").code).toBe("CURSOR_AGENT_CONFIG_INVALID");
    expect(new CursorAgentAbortedError(null).code).toBe("CURSOR_AGENT_ABORTED");
    expect(new CursorAgentRunError("failed", { cause: "x" }).code).toBe("CURSOR_AGENT_RUN_FAILED");
  });
});
