/** The executable must report harness and transport failures truthfully on stdout. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { scriptedCodex } from "./scripted-codex";
import { CodexAgentAbortedError } from "@flow-state-dev/codex";

const { runCli } = vi.hoisted(() => ({ runCli: vi.fn() }));
vi.mock("../src/cli", async (original) => ({
  ...await original<typeof import("../src/cli")>(),
  runCli,
}));

const argv = process.argv;
const exitCode = process.exitCode;
afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("skill stdout and exit status", () => {
  it.each(["failed-turn", "transport", "cancelled"])("reports a real adapter %s without retrying", async (kind) => {
    const actual = await vi.importActual<typeof import("../src/cli")>("../src/cli");
    const codex = scriptedCodex([
      { type: "thread.started", thread_id: "confirmed-thread" },
      { type: "turn.failed", error: { message: "Invalid User API Key" } },
    ], kind === "transport" ? new Error("connection lost") : kind === "cancelled" ? new CodexAgentAbortedError(null) : undefined);
    runCli.mockImplementation((parsed) => actual.runCli({ ...parsed, host: { codex: { resolveCodexClient: codex.resolve } } }));
    process.argv = ["node", "run.ts", "implement", "--harness", "codex", "--task", "test"];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../src/run");
    const envelope = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(envelope.ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(codex.rec.prompts).toHaveLength(1);
    if (kind === "failed-turn") {
      expect(envelope.error).toBe("Invalid User API Key");
      expect(envelope.output).toMatchObject({ source: "codex/sdk", sessionId: "confirmed-thread", outcome: "failed" });
    }
    if (kind === "transport") expect(envelope.error).toContain("connection lost");
  });

  it("prints wiring exceptions as failures on stdout", async () => {
    runCli.mockRejectedValue(new Error("SDK version mismatch"));
    process.argv = ["node", "run.ts", "implement", "--task", "test"];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../src/run");
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: "SDK version mismatch" });
    expect(process.exitCode).toBe(1);
  });
  it.each([
    ["completed", "finished", null, true],
    ["errored", "failed", "[unknown] Invalid User API Key", false],
    ["errored", null, null, false],
    ["completed", "stopped-at-limit", null, false],
  ])("reports %s / %s", async (status, outcome, failureMessage, ok) => {
    const output = { source: "cursor/sdk", sessionId: "confirmed-agent", status, outcome, failureMessage };
    runCli.mockResolvedValue({ door: "implement", result: { output } });
    process.argv = ["node", "run.ts", "implement", "--task", "test"];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../src/run");
    const envelope = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(envelope).toMatchObject({ ok, door: "implement", output });
    expect(process.exitCode ?? 0).toBe(ok ? 0 : 1);
    if (failureMessage) expect(envelope.error).toBe(failureMessage);
  });
});
