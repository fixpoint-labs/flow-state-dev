/**
 * `runClaudeHeadless` — the blocking local `claude -p` run.
 *
 * The behaviour worth pinning is not the flag list; it is that this settles on
 * every way the CLI can go wrong, and that it reports cost even then. Callers
 * keep a ledger off the returned value, so a thrown error would lose the record.
 */
import { describe, expect, it, vi } from "vitest";
import {
  runClaudeHeadless,
  parseClaudeJson,
  type ClaudeCliExec,
} from "../src/cli/index";

const success = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    session_id: "sess-abc",
    total_cost_usd: 1.25,
    ...extra,
  });

const execReturning = (stdout: string, code = 0, stderr = ""): ClaudeCliExec =>
  vi.fn(async () => ({ stdout, stderr, code }));

describe("runClaudeHeadless", () => {
  it("runs the agent in the given directory in headless JSON mode", async () => {
    const exec = execReturning(success());
    await runClaudeHeadless({ prompt: "do the thing", cwd: "/repo/wt", exec });

    expect(exec).toHaveBeenCalledTimes(1);
    const [bin, args, options] = vi.mocked(exec).mock.calls[0]!;
    expect(bin).toBe("claude");
    expect(args).toEqual(["-p", "do the thing", "--output-format", "json"]);
    expect(options.cwd).toBe("/repo/wt");
  });

  it("adds --model and --permission-mode only when configured, so the CLI's own defaults stand", async () => {
    const configured = execReturning(success());
    await runClaudeHeadless({
      prompt: "p",
      exec: configured,
      model: "opus",
      permissionMode: "acceptEdits",
    });
    expect(vi.mocked(configured).mock.calls[0]![1]).toEqual([
      "-p",
      "p",
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "opus",
    ]);

    const bare = execReturning(success());
    await runClaudeHeadless({ prompt: "p", exec: bare });
    expect(vi.mocked(bare).mock.calls[0]![1]).not.toContain("--model");
    expect(vi.mocked(bare).mock.calls[0]![1]).not.toContain("--permission-mode");
  });

  it("reports the vendor's cost, session id and answer — the only place cost accounting can come from", async () => {
    const result = await runClaudeHeadless({ prompt: "p", exec: execReturning(success()) });
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.costUsd).toBe(1.25);
    expect(result.sessionId).toBe("sess-abc");
    expect(result.finalMessage).toBe("done");
  });

  it("fails on a non-zero exit and carries the CLI's stderr as the reason", async () => {
    const result = await runClaudeHeadless({
      prompt: "p",
      exec: execReturning("", 1, "context window exceeded"),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("context window exceeded");
  });

  it("falls back to the exit code when the CLI failed silently", async () => {
    const result = await runClaudeHeadless({ prompt: "p", exec: execReturning("", 7) });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("`claude` exited with code 7.");
  });

  it("fails when the CLI reports is_error despite exiting zero, and still reports the spend", async () => {
    const result = await runClaudeHeadless({
      prompt: "p",
      exec: execReturning(success({ is_error: true, result: "hit max turns" })),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("hit max turns");
    // The tokens were spent whether or not the run got anywhere.
    expect(result.costUsd).toBe(1.25);
  });

  it("settles as a failure when the binary cannot be launched, instead of throwing at the caller", async () => {
    const exec: ClaudeCliExec = async () => {
      throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    };
    const result = await runClaudeHeadless({ prompt: "p", exec });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOENT");
    expect(result.costUsd).toBeNull();
  });

  it("settles as a failure when the run timed out", async () => {
    const exec: ClaudeCliExec = async () => {
      throw new Error("`claude` timed out after 1000ms");
    };
    const result = await runClaudeHeadless({ prompt: "p", exec, timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("treats unreadable stdout on a zero exit as a success with no cost, not as a failure", async () => {
    const result = await runClaudeHeadless({
      prompt: "p",
      exec: execReturning("Welcome to Claude Code!\n"),
    });
    expect(result.ok).toBe(true);
    expect(result.costUsd).toBeNull();
    expect(result.sessionId).toBeNull();
    expect(result.finalMessage).toBeNull();
  });

  it("names the configured binary in its failure reasons, so a wrong path is diagnosable", async () => {
    const exec: ClaudeCliExec = async () => {
      throw new Error("spawn /opt/claude ENOENT");
    };
    const result = await runClaudeHeadless({ prompt: "p", bin: "/opt/claude", exec });
    expect(result.error).toContain("/opt/claude");
  });
});

describe("parseClaudeJson", () => {
  it("finds the JSON object even behind leading chatter on stdout", () => {
    expect(parseClaudeJson(`some banner\n${success()}\n`)?.session_id).toBe("sess-abc");
  });

  it("returns null rather than throwing when nothing parses", () => {
    expect(parseClaudeJson("not json at all")).toBeNull();
  });
});
