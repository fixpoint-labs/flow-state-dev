/**
 * The Claude Code dispatcher — the vendor-specific half of the seam.
 *
 * The behaviour worth pinning is not the flag list; it is that this dispatcher
 * **settles rather than throws** on every way a vendor can go wrong, because a
 * thrown error skips the ledger and loses the transition.
 */

import { describe, expect, it, vi } from "vitest";
import { type ClaudeCliExec } from "@flow-state-dev/claude-code/cli";
import { claudeCodeDispatcher } from "../../src/dispatch/claude-code";
import type { PhaseBrief } from "../../src/dispatch/types";

const BRIEF: PhaseBrief = {
  dispatchId: "FIX-1#1",
  entityId: "FIX-1",
  entityKind: "issue",
  phase: "IMPLEMENTATION",
  action: "implement",
  branch: "fix/FIX-1",
  workspacePath: "/repo/.conductor/worktrees/FIX-1",
  guidancePaths: ["docs/philosophy.md"],
  because: "The spec was approved.",
  summary: "Make the thing work.",
};

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

const at = () => new Date("2026-08-14T12:00:00Z");

describe("the claude-code dispatcher", () => {
  it("declares worktree isolation, because the CLI edits whatever directory it is pointed at", () => {
    const dispatcher = claudeCodeDispatcher();
    expect(dispatcher.isolation).toBe("worktree");
    expect(dispatcher.vendor).toBe("claude-code");
  });

  it("runs headlessly in the provisioned workspace with a non-interactive permission mode", async () => {
    const exec = execReturning(success());
    await claudeCodeDispatcher({ exec, now: at }).run(BRIEF);

    expect(exec).toHaveBeenCalledTimes(1);
    const [bin, args, options] = vi.mocked(exec).mock.calls[0]!;
    expect(bin).toBe("claude");
    expect(args[0]).toBe("-p");
    expect(args.slice(2)).toEqual([
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
    ]);
    // A prompting permission mode would hang forever: there is no terminal.
    expect(args).not.toContain("manual");
    expect(options.cwd).toBe(BRIEF.workspacePath);
  });

  it("passes the rendered brief as the prompt, so the harness knows the work, the branch and the reason", async () => {
    const exec = execReturning(success());
    await claudeCodeDispatcher({ exec, now: at }).run(BRIEF);
    const prompt = vi.mocked(exec).mock.calls[0]![1][1]!;
    expect(prompt).toContain("FIX-1");
    expect(prompt).toContain("fix/FIX-1");
    expect(prompt).toContain("The spec was approved.");
    expect(prompt).toContain("docs/philosophy.md");
  });

  it("adds --model only when one is configured, so the CLI's own default is not overridden by accident", async () => {
    const withModel = execReturning(success());
    await claudeCodeDispatcher({ exec: withModel, model: "opus", now: at }).run(BRIEF);
    expect(vi.mocked(withModel).mock.calls[0]![1]).toContain("--model");

    const withoutModel = execReturning(success());
    await claudeCodeDispatcher({ exec: withoutModel, now: at }).run(BRIEF);
    expect(vi.mocked(withoutModel).mock.calls[0]![1]).not.toContain("--model");
  });

  it("reports the vendor's cost and run id, which is the only place cost accounting can come from", async () => {
    const result = await claudeCodeDispatcher({ exec: execReturning(success()), now: at }).run(
      BRIEF,
    );
    expect(result.outcome).toBe("completed");
    expect(result.costUsd).toBe(1.25);
    expect(result.vendorRunId).toBe("sess-abc");
    expect(result.dispatchId).toBe("FIX-1#1");
    expect(result.startedAt).toBe("2026-08-14T12:00:00.000Z");
  });

  it("reports the branch it worked on and nothing more — a PR is a fact conductor reads from GitHub", async () => {
    const result = await claudeCodeDispatcher({ exec: execReturning(success()), now: at }).run(
      BRIEF,
    );
    expect(result.produced).toEqual({ branch: "fix/FIX-1" });
    expect(result.produced.pullNumber).toBeUndefined();
  });

  it("fails on a non-zero exit and carries the vendor's stderr as the reason", async () => {
    const result = await claudeCodeDispatcher({
      exec: execReturning("", 1, "context window exceeded"),
      now: at,
    }).run(BRIEF);
    expect(result.outcome).toBe("failed");
    expect(result.error).toBe("context window exceeded");
  });

  it("fails when the vendor reports is_error despite exiting zero", async () => {
    const result = await claudeCodeDispatcher({
      exec: execReturning(success({ is_error: true, result: "hit max turns" })),
      now: at,
    }).run(BRIEF);
    expect(result.outcome).toBe("failed");
    expect(result.error).toBe("hit max turns");
    // Cost is still real when the run failed — the tokens were spent.
    expect(result.costUsd).toBe(1.25);
  });

  it("settles as failed when the binary cannot be launched, instead of throwing past the ledger", async () => {
    const exec: ClaudeCliExec = async () => {
      throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    };
    const result = await claudeCodeDispatcher({ exec, now: at }).run(BRIEF);
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("ENOENT");
  });

  it("treats unreadable stdout on a zero exit as a completion with no cost, not as a failure", async () => {
    const result = await claudeCodeDispatcher({
      exec: execReturning("Welcome to Claude Code!\n"),
      now: at,
    }).run(BRIEF);
    expect(result.outcome).toBe("completed");
    expect(result.costUsd).toBeNull();
    expect(result.vendorRunId).toBeNull();
  });

  it("refuses to run without the workspace its isolation model promised", async () => {
    const exec = execReturning(success());
    const result = await claudeCodeDispatcher({ exec, now: at }).run({
      ...BRIEF,
      workspacePath: null,
    });
    expect(result.outcome).toBe("failed");
    expect(exec).not.toHaveBeenCalled();
  });
});

