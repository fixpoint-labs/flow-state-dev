/**
 * Each of this package's errors carries a stable `code`, so a host branches on
 * the failure without reading its message. The run's failure codes are emitted
 * into error items and stored, so they keep their values when names change.
 */
import { describe, expect, it } from "vitest";
import { CodexAgentAbortedError, CodexAgentConfigError, CodexAgentRunError, CodexSdkNotInstalledError } from "../src/index";

describe("the codex errors' codes", () => {
  it("are stable values a host can branch on", () => {
    expect(new CodexSdkNotInstalledError().code).toBe("CODEX_SDK_NOT_INSTALLED");
    expect(new CodexAgentConfigError("bad option").code).toBe("CODEX_AGENT_CONFIG_INVALID");
    expect(new CodexAgentAbortedError(null).code).toBe("CODEX_AGENT_ABORTED");
    expect(new CodexAgentRunError("failed", { cause: "x" }).code).toBe("CODEX_AGENT_RUN_FAILED");
  });
});
