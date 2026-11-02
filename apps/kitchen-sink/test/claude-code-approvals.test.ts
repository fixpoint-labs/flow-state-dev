/**
 * Claude Code mode's tool approvals (FIX-2432), in process: Kitchen Sink's own
 * Claude Code session flow on a durable `createFlowState`, worktrees cut from
 * a real temporary git repository, and answers through the engine's answer
 * route as the page's card sends them. Only the Agent SDK is replaced, by the
 * scripted Claude Code, whose `[touch:<file>]` call asks through the run's
 * `canUseTool` as Claude Code does. What ran is the file on disk.
 *
 * The browser half, with a server restart, is the goal check
 * `goals/kitchen-sink-harness/claude-code-waits-for-approval/`.
 *
 * Red states produced before these were trusted:
 *   - build the flow with approvals off (`no-approval`): "stops the turn" fails, the file is written unasked.
 *   - pass the block no `onToolApproval`: the same, through `bypassPermissions`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { ClaudeAgentQueryOptions, ResolveClaudeAgent } from "@flow-state-dev/claude-code/sdk";
import type { HarnessSessionState } from "@flow-state-dev/harness-manager";

import { claudeCodeSessionFlow, CLAUDE_CODE_SESSION, READ_ONLY_TOOLS } from "@/lib/claude-code-mode";
import { locateSessionWorktree } from "@/lib/harness-worktree";
import { scriptedClaudeCode, scriptedPauses } from "@/lib/scripted-claude-code";

const USER = "u";

let scratch: string;
let repo: string;
let stateHome: string;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-claude-code-approvals-")));
  repo = join(scratch, "repo");
  stateHome = join(scratch, "state");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  scriptedPauses.stepMs = 0;
  scriptedPauses.slowMs = 0;
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", stateHome);
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("GOAL_CONTROL", "");
});

afterEach(() => vi.unstubAllEnvs());

/** A durable Kitchen Sink host with Claude Code mode, the scripted SDK recording what each run was handed. */
function host(sessionId: string) {
  const runs: ClaudeAgentQueryOptions[] = [];
  const scripted = scriptedClaudeCode();
  const resolve: ResolveClaudeAgent = async (...args) => {
    const agent = await scripted(...args);
    return {
      query: (query) => {
        runs.push(query.options ?? {});
        return agent.query(query);
      },
    };
  };
  const stores = inMemoryStores();
  const makeFlow = () => claudeCodeSessionFlow({ resolveClaudeAgent: resolve });
  let flow = makeFlow();
  const makeState = () =>
    createFlowState({
      flows: { [CLAUDE_CODE_SESSION]: flow },
      stores: { test: { primary: stores } },
      defaultProfile: "test",
      durable: true,
    } as never);
  let state = makeState();
  const runtime = async () =>
    (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: { durabilityProvider?: any } }> }).getRuntime();
  const worktree = () => locateSessionWorktree(repo, { flowKind: CLAUDE_CODE_SESSION, sessionId });

  const turn = async (prompt: string) => {
    const rt = await runtime();
    if ((await rt.stores.session.get(sessionId)) === undefined) {
      const now = Date.now();
      await rt.stores.session.set(
        sessionId,
        { id: sessionId, flowKind: CLAUDE_CODE_SESSION, userId: USER, orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: {}, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
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
    } as never)) as { requestId?: string };
  };
  const pending = async (requestId: string) => {
    const list = (await (await runtime()).runtimeConfig.durabilityProvider!.listSuspended({ status: "pending" })) as Array<{
      requestId: string;
      suspensionId: string;
      kind?: string;
      message?: string;
    }>;
    return list.find((gate) => gate.requestId === requestId);
  };
  const status = async (requestId: string) => (await (await runtime()).stores.request.get(requestId))?.status as string | undefined;
  const answer = async (requestId: string, action: "approve" | "reject") => {
    const gate = (await pending(requestId))!;
    const path = [CLAUDE_CODE_SESSION, "requests", requestId, "answer"];
    return (await state.getRouter()).POST(
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
      if (Date.now() > deadline) throw new Error("timed out waiting for the turn to end");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  /** A host restart: the flow state goes, and a new one starts on the same stores. */
  const restart = async () => {
    await state.dispose();
    rmSync(`${worktree()}.lock`, { force: true });
    flow = makeFlow();
    state = makeState();
  };
  const sessionState = async () => (await (await runtime()).stores.session.get(sessionId))?.state as HarnessSessionState;
  return { runs, turn, pending, status, answer, ended, restart, worktree, sessionState, dispose: () => state.dispose() };
}

describe("Claude Code mode asks before a tool call", () => {
  it("stops the turn with the call unrun, waiting on an approval naming the command and the worktree", async () => {
    const h = host("s-waits");
    try {
      const { requestId } = await h.turn("[touch:marker.txt] make it");
      const gate = (await h.pending(requestId!))!;
      expect(await h.status(requestId!)).toBe("suspended");
      expect(gate.kind).toBe("approval");
      expect(gate.message).toContain("touch marker.txt");
      expect(gate.message).toContain(h.worktree());
      expect(existsSync(join(h.worktree(), "marker.txt"))).toBe(false);
      // The run asks for everything but reading and searching.
      expect(h.runs[0]!.permissionMode).toBe("default");
      expect(h.runs[0]!.allowedTools).toEqual(expect.arrayContaining([...READ_ONLY_TOOLS]));
      expect(h.runs[0]!.allowedTools).not.toContain("Bash");
      expect(h.runs[0]!.canUseTool).toBeTypeOf("function");
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("on Allow after a restart, the same conversation makes the call once, after the answer", async () => {
    const h = host("s-allow");
    try {
      const { requestId } = await h.turn("[touch:marker.txt] make it");
      await h.pending(requestId!);
      const asked = (await h.sessionState()).binding?.confirmed;
      expect(asked).toMatch(/^scripted-/);
      await h.restart();
      const answeredAt = Date.now();
      expect((await h.answer(requestId!, "approve")).status).toBe(202);
      expect(await h.ended(requestId!)).toBe("completed");
      expect(h.runs).toHaveLength(2);
      expect(h.runs[1]!.resume).toBe(asked);
      expect((await h.sessionState()).binding?.confirmed).toBe(asked);
      const madeAt = Number(readFileSync(join(h.worktree(), "marker.txt"), "utf8"));
      expect(madeAt).toBeGreaterThanOrEqual(answeredAt);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("on Deny, the call never runs and the turn ends", async () => {
    const h = host("s-deny");
    try {
      const { requestId } = await h.turn("[touch:marker.txt] make it");
      await h.pending(requestId!);
      await h.answer(requestId!, "reject");
      expect(await h.ended(requestId!)).toBe("completed");
      expect(existsSync(join(h.worktree(), "marker.txt"))).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("under the goal control no-approval, asks nothing and the call runs unasked", async () => {
    vi.stubEnv("GOAL_CONTROL", "no-approval");
    const h = host("s-control");
    try {
      const { requestId } = await h.turn("[touch:marker.txt] make it");
      expect(await h.ended(requestId!)).toBe("completed");
      expect(h.runs[0]!.permissionMode).toBe("bypassPermissions");
      expect(h.runs[0]!.canUseTool).toBeUndefined();
      expect(existsSync(join(h.worktree(), "marker.txt"))).toBe(true);
    } finally {
      await h.dispose();
    }
  }, 30_000);
});
