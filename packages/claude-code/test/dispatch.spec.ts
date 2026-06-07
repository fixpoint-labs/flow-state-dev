import { describe, it, expect } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { claudeRemoteDispatch, CLAUDE_REMOTE_TASKS_KEY } from "../src/cli/dispatch";
import type { ClaudeCliExec } from "../src/cli/resolve-cli";
import { ClaudeCliNotFoundError, ClaudeRemoteDispatchError } from "../src/cli/errors";
import type { ClaudeRemoteHandle } from "../src/cli/types";

/** Build a dispatch block whose CLI invocation is a controllable stub. */
function withExec(exec: ClaudeCliExec) {
  return claudeRemoteDispatch({ resolveClaudeCli: () => ({ bin: "claude", exec }) });
}

const URL = "https://claude.ai/code/3f9a1c2d-1b2c-4d5e-8f90-abcdef012345";

describe("claudeRemoteDispatch", () => {
  it("returns a parsed handle on a successful dispatch", async () => {
    const block = withExec(async () => ({ stdout: `View at ${URL}\n`, stderr: "", code: 0 }));
    const { output, error } = await testBlock(block, { input: { instructions: "Fix the bug" } });

    expect(error).toBeNull();
    const handle = output as ClaudeRemoteHandle;
    expect(handle.source).toBe("cli-remote");
    expect(handle.status).toBe("dispatched");
    expect(handle.url).toBe(URL);
    expect(handle.sessionId).toBe("3f9a1c2d-1b2c-4d5e-8f90-abcdef012345");
    expect(handle.instructions).toBe("Fix the bug");
    expect(handle.raw).toContain(URL);
  });

  it("persists the handle in session state", async () => {
    const block = withExec(async () => ({ stdout: `View at ${URL}\n`, stderr: "", code: 0 }));
    const { state } = await testBlock(block, { input: { instructions: "Fix the bug" } });

    const tasks = state.session[CLAUDE_REMOTE_TASKS_KEY] as ClaudeRemoteHandle[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].url).toBe(URL);
  });

  it("appends to existing handles rather than replacing them", async () => {
    const block = withExec(async () => ({ stdout: `View at ${URL}\n`, stderr: "", code: 0 }));
    const prior: ClaudeRemoteHandle = {
      source: "cli-remote",
      status: "dispatched",
      sessionId: "prior",
      url: null,
      dispatchedAt: 1,
      instructions: "earlier",
      raw: "",
    };
    const { state } = await testBlock(block, {
      input: { instructions: "Fix the bug" },
      session: { state: { [CLAUDE_REMOTE_TASKS_KEY]: [prior] } },
    });

    const tasks = state.session[CLAUDE_REMOTE_TASKS_KEY] as ClaudeRemoteHandle[];
    expect(tasks).toHaveLength(2);
    expect(tasks[0].sessionId).toBe("prior");
  });

  it("emits a persisted status item carrying the URL", async () => {
    const block = withExec(async () => ({ stdout: `View at ${URL}\n`, stderr: "", code: 0 }));
    const { items } = await testBlock(block, { input: { instructions: "Fix the bug" } });

    const status = items.find((i) => i.type === "status" && String(i.message).includes(URL));
    expect(status).toBeDefined();
  });

  it("treats exit 0 with unparseable output as a dispatch with a null URL (no throw)", async () => {
    const block = withExec(async () => ({ stdout: "queued, see your dashboard", stderr: "", code: 0 }));
    const { output, error } = await testBlock(block, { input: { instructions: "Fix the bug" } });

    expect(error).toBeNull();
    const handle = output as ClaudeRemoteHandle;
    expect(handle.url).toBeNull();
    expect(handle.sessionId).toBeNull();
    expect(handle.raw).toBe("queued, see your dashboard");
  });

  it("throws ClaudeRemoteDispatchError on a non-zero exit", async () => {
    const block = withExec(async () => ({ stdout: "", stderr: "not logged in", code: 1 }));
    const { error } = await testBlock(block, { input: { instructions: "Fix the bug" } });

    // The runtime wraps execute throws in a FlowError; the original is `cause`.
    expect(error?.cause).toBeInstanceOf(ClaudeRemoteDispatchError);
    expect((error?.cause as ClaudeRemoteDispatchError).detail?.exitCode).toBe(1);
  });

  it("throws ClaudeCliNotFoundError when the binary cannot be launched", async () => {
    const enoent = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    const block = withExec(async () => {
      throw enoent;
    });
    const { error } = await testBlock(block, { input: { instructions: "Fix the bug" } });

    expect(error?.cause).toBeInstanceOf(ClaudeCliNotFoundError);
  });

  it("throws ClaudeRemoteDispatchError when instructions are blank after trimming", async () => {
    const block = withExec(async () => ({ stdout: URL, stderr: "", code: 0 }));
    const { error } = await testBlock(block, { input: { instructions: "   " } });

    expect(error?.cause).toBeInstanceOf(ClaudeRemoteDispatchError);
  });
});
