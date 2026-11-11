/**
 * Claude Code mode's tool approvals (FIX-2432): a call the mode doesn't
 * pre-allow stops the turn and waits on the user, and their answer resumes the
 * conversation that asked.
 *
 * The real mode, flow and Claude Code block on a durable `createFlowState`,
 * with only the Agent SDK replaced by the scripted Claude Code
 * (`lib/scripted-claude-code.ts`), which asks the block's `canUseTool` the way
 * Claude Code does. What ran is the file the call writes in the session's own
 * worktree, cut from a real temporary git repository. Answers go through the
 * engine's answer route, as the page's card sends them.
 *
 * Red states produced before these were trusted:
 *   - leave the block's `onToolApproval` unset: no turn waits, and the call is
 *     denied (the scripted SDK can't ask), so "waits" fails.
 *   - keep `bypassPermissions`: the call runs unasked, and "waits" fails on the file.
 *   - the `no-approval` goal control: the turn ends with nothing waiting.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { ClaudeCodeQueryOptions, ResolveClaudeCodeAgent } from "@flow-state-dev/claude-code";
import type { HarnessSessionState } from "@flow-state-dev/harness-manager";

import { CLAUDE_CODE_SESSION, PRE_ALLOWED_TOOLS, claudeCodeSessionFlow } from "@/lib/claude-code-mode";
import { scriptedClaudeCode, scriptedPauses } from "@/lib/scripted-claude-code";

const USER = "u";

let scratch: string;
let repo: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-claude-approvals-")));
  repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  scriptedPauses.stepMs = 0;
  scriptedPauses.slowMs = 0;
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", join(scratch, "state"));
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("GOAL_CONTROL", "");
});

afterEach(() => vi.unstubAllEnvs());

/** A durable host for Claude Code mode, recording what each run of the scripted SDK was handed. */
function host() {
  const runs: ClaudeCodeQueryOptions[] = [];
  const scripted = scriptedClaudeCode();
  const resolve: ResolveClaudeCodeAgent = async (...args) => {
    const agent = await scripted(...args);
    return {
      query: (query) => {
        runs.push(query.options ?? ({} as ClaudeCodeQueryOptions));
        return agent.query(query);
      },
    };
  };
  const flow = claudeCodeSessionFlow({ resolveClaudeAgent: resolve });
  const state = createFlowState({
    flows: [flow],
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    durable: true,
  } as never);
  const runtime = async () =>
    (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: any }> }).getRuntime();

  const turn = async (sessionId: string, prompt: string) => {
    const rt = await runtime();
    if ((await rt.stores.session.get(sessionId)) === undefined) {
      const now = Date.now();
      await rt.stores.session.set(
        sessionId,
        { id: sessionId, flowKind: CLAUDE_CODE_SESSION, userId: USER, orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "scripted-claude-code" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
        "any" as never,
      );
    }
    return (await runAction({
      flow,
      actionName: "turn",
      input: { prompt },
      userId: USER,
      orgId: DEFAULT_ORG_ID,
      sessionId,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { requestId?: string; error?: { message?: string } };
  };
  const pending = async (requestId: string) => {
    const rt = await runtime();
    const list = (await rt.runtimeConfig.durabilityProvider.listSuspended({ status: "pending" })) as Array<{
      requestId: string;
      suspensionId: string;
      kind?: string;
      data?: Record<string, unknown>;
    }>;
    return list.find((gate) => gate.requestId === requestId);
  };
  const status = async (requestId: string) => (await (await runtime()).stores.request.get(requestId))?.status as string | undefined;
  const answer = async (requestId: string, action: "approve" | "reject") => {
    const gate = (await pending(requestId))!;
    const router = await state.getRouter();
    const path = [CLAUDE_CODE_SESSION, "requests", requestId, "answer"];
    return router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspensionId: gate.suspensionId, action, userId: USER }),
      }),
      { params: { path } } as never,
    );
  };
  const ended = async (requestId: string) => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const now = await status(requestId);
      if (now === "completed" || now === "failed") return now;
      if (Date.now() > deadline) throw new Error(`the turn is still ${now}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const sessionState = async (sessionId: string) =>
    ((await (await runtime()).stores.session.get(sessionId))?.state ?? {}) as HarnessSessionState;
  return { runs, turn, pending, status, answer, ended, sessionState, dispose: () => state.dispose() };
}

/** How many times the call ran: the lines it appended to its file in the run's folder. */
function timesRan(cwd: string, file: string): number {
  return existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), "utf8").split("\n").filter(Boolean).length : 0;
}

describe("Claude Code mode asks the user before a tool call it doesn't pre-allow", () => {
  it("prompts for anything but the read-only tools, with the approval feed handed to the run", async () => {
    const h = host();
    try {
      const { requestId } = await h.turn("s-options", "hello");
      expect(await h.ended(requestId!)).toBe("completed");
      const options = h.runs[0]!;
      expect(options.permissionMode).toBe("default");
      expect(options.allowedTools).toEqual(expect.arrayContaining([...PRE_ALLOWED_TOOLS]));
      expect(options.allowedTools).not.toContain("Bash");
      expect(options.canUseTool).toBeTypeOf("function");
    } finally {
      await h.dispose();
    }
  });

  it("stops the turn with the call unrun, waiting on an approval naming the tool, the command and the worktree", async () => {
    const h = host();
    try {
      const { requestId } = await h.turn("s-waits", "[ask:waits.txt] touch a file");
      const gate = await h.pending(requestId!);
      expect(await h.status(requestId!)).toBe("suspended");
      expect(gate?.kind).toBe("approval");
      const cwd = h.runs[0]!.cwd!;
      expect(gate?.data).toMatchObject({ tool: "Bash", touches: "touch waits.txt", cwd });
      expect(timesRan(cwd, "waits.txt")).toBe(0);
      expect((await h.sessionState("s-waits")).turns?.[requestId!]?.waitsOnApproval).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it("on Allow, resumes the same conversation and the call runs once", async () => {
    const h = host();
    try {
      const { requestId } = await h.turn("s-allow", "[ask:allow.txt] touch a file");
      await h.pending(requestId!);
      const confirmed = (await h.sessionState("s-allow")).binding?.confirmed;
      expect(confirmed).toMatch(/^scripted-/);
      expect((await h.answer(requestId!, "approve")).status).toBe(202);
      expect(await h.ended(requestId!)).toBe("completed");
      expect(h.runs).toHaveLength(2);
      expect(h.runs[1]!.resume).toBe(confirmed);
      expect((await h.sessionState("s-allow")).binding?.confirmed).toBe(confirmed);
      expect(timesRan(h.runs[0]!.cwd!, "allow.txt")).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it("on Deny, the call never runs and the turn ends", async () => {
    const h = host();
    try {
      const { requestId } = await h.turn("s-deny", "[ask:deny.txt] touch a file");
      await h.pending(requestId!);
      expect((await h.answer(requestId!, "reject")).status).toBe(202);
      expect(await h.ended(requestId!)).toBe("completed");
      expect(h.runs).toHaveLength(2);
      expect(timesRan(h.runs[0]!.cwd!, "deny.txt")).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it("under the no-approval goal control, nothing waits", async () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "no-approval");
    const h = host();
    try {
      const { requestId } = await h.turn("s-control", "[ask:control.txt] touch a file");
      expect(await h.ended(requestId!)).toBe("completed");
      expect(await h.pending(requestId!)).toBeUndefined();
      expect(h.runs[0]!.canUseTool).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });
});
