/**
 * Claude Code mode's session flow, end to end below the page
 * (`specs/issues/FIX-1915/PLAN.md` V5, V6; BUSINESS-RULES BR-1 to BR-4,
 * BR-7, BR-10 to BR-13b, BR-23a).
 *
 * The real flow and the real Claude Code block, with only the Agent SDK
 * replaced by the scripted Claude Code (`lib/scripted-claude-code.ts`) behind
 * a recorder. Worktrees are cut from a real temporary git repository: "the
 * main checkout is untouched" is a fact about the disk.
 *
 * Red states produced before these were trusted:
 *   - clear the confirmed id on a refused resume: the BR-3 case fails.
 *   - derive the notice from the session's binding only: the confirmed-then-failed case reads "continued".
 *   - read every failure before a confirmation as refused: the fail-early case reads "refused".
 *   - key the place by the raw session id: the hostile-ids case fails.
 *   - hand the run the repository itself: the main-checkout case fails.
 *   - leave `env` unset: the planted variable is handed to the run.
 *   - record a failure only on a throw: the errored-result case reads "continued".
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import type { ClaudeAgentQueryOptions, ResolveClaudeAgent } from "@flow-state-dev/claude-code/sdk";

import { claudeCodeSessionFlow, CLAUDE_CODE_SESSION } from "@/lib/claude-code-mode";
import { availableHarnessFlows, resetModeAvailabilityForTests } from "@/lib/harness-gate";
import { turnNotice, UNKNOWN_CONVERSATION, type HarnessSessionState } from "@/lib/harness-turn";
import { sessionBranch, worktreeRoot } from "@/lib/harness-worktree";
import { scriptedClaudeCode, scriptedPauses } from "@/lib/scripted-claude-code";

let scratch: string;
let repo: string;
let stateHome: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-harness-session-")));
  repo = join(scratch, "repo");
  stateHome = join(scratch, "state");
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
  vi.stubEnv("XDG_STATE_HOME", stateHome);
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("GOAL_CONTROL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetModeAvailabilityForTests();
});

/** The scripted Claude Code, recording what each run was handed. */
function recorded(onRun?: (options: ClaudeAgentQueryOptions) => void) {
  const runs: ClaudeAgentQueryOptions[] = [];
  const scripted = scriptedClaudeCode();
  const resolve: ResolveClaudeAgent = async (...args) => {
    const agent = await scripted(...args);
    return {
      query: (query) => {
        const options = query.options ?? ({} as ClaudeAgentQueryOptions);
        runs.push(options);
        onRun?.(options);
        return agent.query(query);
      },
    };
  };
  return { runs, resolve };
}

type Recorder = ReturnType<typeof recorded>;

async function turn(
  stores: ReturnType<typeof createInMemoryStores>,
  recorder: Recorder,
  sessionId: string,
  prompt: string,
  extra: Record<string, unknown> = {},
) {
  return testFlow({
    flow: claudeCodeSessionFlow({ resolveClaudeAgent: recorder.resolve }),
    action: "turn",
    userId: "u",
    sessionId,
    input: { prompt, ...extra },
    stores,
  });
}

async function stateOf(stores: ReturnType<typeof createInMemoryStores>, sessionId: string): Promise<HarnessSessionState> {
  return ((await stores.session.get(sessionId))?.state ?? {}) as HarnessSessionState;
}

async function noticeOf(stores: ReturnType<typeof createInMemoryStores>, sessionId: string, requestId: string, status: "completed" | "failed") {
  const state = await stateOf(stores, sessionId);
  return turnNotice(state.turns?.[requestId] ?? null, status, state.binding?.confirmed ?? null);
}

describe("which conversation a turn continues (V5)", () => {
  it("records the id Claude Code names, and the next turn continues it (BR-1, BR-2)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const first = await turn(stores, recorder, "s-continue", "hello");
    expect(first.status).toBe("completed");
    const bound = (await stateOf(stores, "s-continue")).binding?.confirmed;
    expect(bound).toMatch(/^scripted-/);
    expect(await noticeOf(stores, "s-continue", first.requestId, "completed")).toMatchObject({ kind: "started" });

    const second = await turn(stores, recorder, "s-continue", "again");
    expect(second.status).toBe("completed");
    expect(recorder.runs.map((run) => run.resume)).toEqual([undefined, bound]);
    expect(await noticeOf(stores, "s-continue", second.requestId, "completed")).toMatchObject({ kind: "continued", conversation: bound });
  });

  it("a refused conversation fails as refused, keeps the id, and the next turn asks for it again (BR-3)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-refused", "hello");
    const bound = (await stateOf(stores, "s-refused")).binding?.confirmed;

    const refused = await turn(stores, recorder, "s-refused", "[refuse] go on");
    expect(refused.status).toBe("failed");
    const record = (await stateOf(stores, "s-refused")).turns?.[refused.requestId];
    expect(record).toMatchObject({ asked: bound, failure: UNKNOWN_CONVERSATION });
    expect(record?.error).toContain("No conversation found");
    expect(await noticeOf(stores, "s-refused", refused.requestId, "failed")).toMatchObject({ kind: "refused", conversation: bound });
    expect((await stateOf(stores, "s-refused")).binding?.confirmed).toBe(bound);

    await turn(stores, recorder, "s-refused", "try again");
    expect(recorder.runs.at(-1)?.resume).toBe(bound);
  });

  it("a turn that confirmed the id and then failed shows its error, not a refusal (BR-3, BR-10)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-late", "hello");
    const bound = (await stateOf(stores, "s-late")).binding?.confirmed;

    const failed = await turn(stores, recorder, "s-late", "[fail] go on");
    expect(failed.status).toBe("failed");
    const record = (await stateOf(stores, "s-late")).turns?.[failed.requestId];
    expect(record).toMatchObject({ asked: bound, confirmed: bound });
    expect(record?.failure).not.toBe(UNKNOWN_CONVERSATION);
    expect(await noticeOf(stores, "s-late", failed.requestId, "failed")).toMatchObject({ kind: "error" });
    expect((await stateOf(stores, "s-late")).binding?.confirmed).toBe(bound);
  });

  it("a run Claude Code ends on an error result, not a throw, shows its error and keeps the id (BR-3, BR-10)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-errored", "hello");
    const bound = (await stateOf(stores, "s-errored")).binding?.confirmed;

    const errored = await turn(stores, recorder, "s-errored", "[errored] go on");
    const record = (await stateOf(stores, "s-errored")).turns?.[errored.requestId];
    expect(record).toMatchObject({ asked: bound, confirmed: bound, failure: null });
    expect(record?.error).toEqual(expect.any(String));
    expect(await noticeOf(stores, "s-errored", errored.requestId, errored.status as "completed" | "failed")).toMatchObject({
      kind: "error",
    });
    expect((await stateOf(stores, "s-errored")).binding?.confirmed).toBe(bound);

    await turn(stores, recorder, "s-errored", "and again");
    expect(recorder.runs.at(-1)?.resume).toBe(bound);
  });

  it("a failure before any confirmation for another reason is an error, and the id stays (BR-3)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-early", "hello");
    const bound = (await stateOf(stores, "s-early")).binding?.confirmed;

    const failed = await turn(stores, recorder, "s-early", "[fail-early] go on");
    expect(failed.status).toBe("failed");
    const record = (await stateOf(stores, "s-early")).turns?.[failed.requestId];
    expect(record).toMatchObject({ asked: bound, confirmed: null });
    expect(record?.failure).not.toBe(UNKNOWN_CONVERSATION);
    expect(await noticeOf(stores, "s-early", failed.requestId, "failed")).toMatchObject({ kind: "error" });

    await turn(stores, recorder, "s-early", "try again");
    expect(recorder.runs.at(-1)?.resume).toBe(bound);
  });

  it("a different id moves the binding and says a new conversation started (BR-4)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-moved", "hello");
    const before = (await stateOf(stores, "s-moved")).binding?.confirmed;
    const moved = await turn(stores, recorder, "s-moved", "[new] go on");
    const after = (await stateOf(stores, "s-moved")).binding?.confirmed;
    expect(after).not.toBe(before);
    expect(await noticeOf(stores, "s-moved", moved.requestId, "completed")).toMatchObject({ kind: "moved", conversation: after, previous: before });
  });

  it("nothing the caller sends chooses the conversation or the directory (BR-7)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-caller", "hello");
    const bound = (await stateOf(stores, "s-caller")).binding?.confirmed;
    const firstCwd = recorder.runs[0]?.cwd;
    await turn(stores, recorder, "s-caller", "again", { resume: "attacker", cwd: repo, binding: { confirmed: "attacker" } });
    expect(recorder.runs[1]?.resume).toBe(bound);
    expect(recorder.runs[1]?.cwd).toBe(firstCwd);
    expect((await stateOf(stores, "s-caller")).binding?.confirmed).toBe(bound);
  });
});

describe("where a session works (V6)", () => {
  it("every turn, and a restart, gets the same worktree and branch; two sessions, two (BR-11)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-place-a", "one");
    await turn(stores, recorder, "s-place-a", "two");
    // A restart: a new flow built over the same stores.
    await turn(stores, recorder, "s-place-a", "three");
    await turn(stores, recorder, "s-place-b", "one");
    const [a1, a2, a3, b1] = recorder.runs.map((run) => run.cwd);
    expect(a1).toBe(a2);
    expect(a1).toBe(a3);
    expect(b1).not.toBe(a1);
    for (const cwd of [a1, b1]) expect(cwd!.startsWith(realpathSync(worktreeRoot(repo)) + sep)).toBe(true);
    expect(git(a1!, "branch", "--show-current").trim()).toBe(sessionBranch({ flowKind: CLAUDE_CODE_SESSION, sessionId: "s-place-a" }));
    expect(git(b1!, "branch", "--show-current").trim()).toBe(sessionBranch({ flowKind: CLAUDE_CODE_SESSION, sessionId: "s-place-b" }));
  });

  it("hostile session ids stay inside the root and make valid, distinct branches (BR-11)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const hostile = ["../../escape", "..", "a/b", "A", "a", "_0041", "_e", "a_b", "a+b", "x".repeat(300), "refs/heads/main", "-dash", "sp ace"];
    for (const id of hostile) {
      const result = await turn(stores, recorder, id, "hello");
      expect(result.error, id).toBeUndefined();
    }
    const cwds = recorder.runs.map((run) => run.cwd!);
    const root = realpathSync(worktreeRoot(repo));
    for (const cwd of cwds) expect(cwd.startsWith(root + sep)).toBe(true);
    expect(new Set(cwds).size).toBe(hostile.length);
    const branches = hostile.map((sessionId) => sessionBranch({ flowKind: CLAUDE_CODE_SESSION, sessionId }));
    expect(new Set(branches).size).toBe(hostile.length);
    for (const branch of branches) execFileSync("git", ["check-ref-format", `refs/heads/${branch}`]);
    for (const [i, cwd] of cwds.entries()) expect(git(cwd, "branch", "--show-current").trim()).toBe(branches[i]);
  });

  it("a run's edit lands in its worktree; the main checkout is unchanged (BR-12)", async () => {
    const stores = createInMemoryStores();
    const before = git(repo, "status", "--porcelain");
    const recorder = recorded((options) => writeFileSync(join(options.cwd!, "edited.txt"), "by the run\n"));
    await turn(stores, recorder, "s-edit", "edit a file");
    const cwd = recorder.runs[0]!.cwd!;
    expect(cwd).not.toBe(repo);
    expect(git(cwd, "status", "--porcelain")).toContain("edited.txt");
    expect(git(repo, "status", "--porcelain")).toBe(before);
    expect(existsSync(join(repo, "edited.txt"))).toBe(false);
  });

  it("the run's sandbox writes only its worktree, never its .git pointer (BR-13)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-fence", "hello");
    const run = recorder.runs[0]!;
    const sandbox = run.sandbox as { enabled?: boolean; failIfUnavailable?: boolean; filesystem?: { allowWrite?: string[]; denyWrite?: string[] } };
    expect(sandbox.enabled).toBe(true);
    expect(sandbox.failIfUnavailable).toBe(true);
    expect(sandbox.filesystem?.allowWrite).toContain(run.cwd);
    expect(sandbox.filesystem?.allowWrite).not.toContain(repo);
    expect(sandbox.filesystem?.denyWrite).toContain(join(run.cwd!, ".git"));
  });

  it("runs with no sandbox only when KITCHEN_SINK_HARNESS_UNSANDBOXED=1 asks for it", async () => {
    // The person opted out of confinement for every harness; the run must not
    // still ask for a sandbox the host may not have.
    vi.stubEnv("KITCHEN_SINK_HARNESS_UNSANDBOXED", "1");
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-unfenced", "hello");
    expect(recorder.runs[0]!.sandbox).toBeUndefined();
  });

  it("the run is offered Claude Code's to-do tools, so a turn asked to plan can record one (BR-14)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-plan-tools", "[plan] make a plan");
    expect(recorder.runs[0]!.allowedTools).toEqual(expect.arrayContaining(["TaskCreate", "TaskUpdate"]));
  });

  it("the run starts with the allowlisted environment, not the server's (BR-13b)", async () => {
    vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", "do-not-hand-this-over");
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-env", "hello");
    const env = recorder.runs[0]!.env as Record<string, string | undefined> | undefined;
    expect(env).toBeDefined();
    expect(env!.KITCHEN_SINK_PLANTED_SECRET).toBeUndefined();
    expect(env!.PATH).toBe(process.env.PATH);
  });

  it("a deleted session leaves its worktree and branch (BR-23a)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-deleted", "hello");
    const cwd = recorder.runs[0]!.cwd!;
    await stores.session.delete("s-deleted");
    expect(await stores.session.get("s-deleted")).toBeUndefined();
    expect(existsSync(cwd)).toBe(true);
    const branch = sessionBranch({ flowKind: CLAUDE_CODE_SESSION, sessionId: "s-deleted" });
    expect(git(repo, "branch", "--list", branch).trim()).not.toBe("");
  });

  it("with harness modes off, the flow is not served and its sessions stay in the store (FIX-1914 BR-16)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-kept", "hello");
    // Modes off at the next start.
    vi.stubEnv("VERCEL", "1");
    resetModeAvailabilityForTests();
    const flows = await availableHarnessFlows({ "claude-code": () => claudeCodeSessionFlow({ resolveClaudeAgent: recorder.resolve }) });
    expect(flows["claude-code"]).toBeUndefined();
    expect((await stores.session.get("s-kept"))?.state).toMatchObject({ binding: { confirmed: expect.stringMatching(/^scripted-/) } });
  });
});
