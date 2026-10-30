/**
 * Codex mode's session flow, end to end below the page
 * (`specs/issues/FIX-1916/PLAN.md` V1, V3, V5; BUSINESS-RULES BR-1 to BR-5,
 * BR-9, BR-12, BR-13, BR-20).
 *
 * The real flow and the real Codex block, with only the Codex SDK replaced by
 * the scripted Codex (`lib/scripted-codex.ts`) behind a recorder. Worktrees
 * are cut from a real temporary git repository. Each turn's notice is derived
 * by FIX-1915's `turnNotice`, which has no Codex branch.
 *
 * Red states produced before these were trusted:
 *   - have the scripted refusal name a fresh id: the BR-4 "never a new thread" case fails.
 *   - classify every failure before a thread is named as a refusal (in the Codex
 *     package): the sign-in case reads refused.
 *   - the BR-13 case's probe is checked on Claude Code mode's flow, which does
 *     declare a plan record, so its empty answer for Codex can't come from a probe
 *     that reads nothing.
 *   - leave `client.env` unset: the options case finds no allowlist.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OBSERVED_PLAN } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import type { ResolveCodexClient } from "@flow-state-dev/codex";
import { CodexAgentAbortedError } from "@flow-state-dev/codex";

import { claudeCodeSessionFlow } from "@/lib/claude-code-mode";
import { CODEX_SESSION, codexBlockOptions, codexClient, codexClientOptions, codexSessionFlow, type CodexMcpServer } from "@/lib/codex-mode";
import { kitchenSinkHarnessFeeds } from "@/lib/harness-session-flow";
import type { HarnessSessionState } from "@flow-state-dev/harness-manager";
import { turnNotice, UNKNOWN_CONVERSATION } from "@/lib/harness-turn";
import { sessionBranch, worktreeRoot } from "@/lib/harness-worktree";
import { scriptedCodex, scriptedCodexPauses } from "@/lib/scripted-codex";

let scratch: string;
let repo: string;
let stateHome: string;

const vercelMcp: CodexMcpServer = { name: "vercel", transport: { url: "https://example.invalid/mcp" } };
const vercelOverrides = ['mcp_servers={"vercel"={url="https://example.invalid/mcp",enabled=false}}'];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-codex-session-")));
  repo = join(scratch, "repo");
  stateHome = join(scratch, "state");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  scriptedCodexPauses.stepMs = 0;
  scriptedCodexPauses.slowMs = 0;
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", stateHome);
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("GOAL_CONTROL", "");
});

afterEach(() => vi.unstubAllEnvs());

/** What one thread open asked of the client: a new thread, or the one it resumed, and where. */
interface Opened {
  readonly resumed: string | null;
  readonly options: Record<string, unknown>;
}

/** The scripted Codex, recording each thread the block opens. */
function recorded() {
  const opens: Opened[] = [];
  const scripted = scriptedCodex();
  const resolve: ResolveCodexClient = async (ctx) => {
    const client = await scripted(ctx);
    return {
      startThread: (options) => {
        opens.push({ resumed: null, options: { ...options } });
        return client.startThread(options);
      },
      resumeThread: (id, options) => {
        opens.push({ resumed: id, options: { ...options } });
        return client.resumeThread(id, options);
      },
    };
  };
  return { opens, resolve };
}

type Recorder = ReturnType<typeof recorded>;
type Stores = ReturnType<typeof createInMemoryStores>;

async function turn(stores: Stores, recorder: Recorder, sessionId: string, prompt: string) {
  return testFlow({
    flow: codexSessionFlow({ resolveCodexClient: recorder.resolve }),
    action: "turn",
    userId: "u",
    sessionId,
    input: { prompt },
    stores,
  });
}

async function stateOf(stores: Stores, sessionId: string): Promise<HarnessSessionState> {
  return ((await stores.session.get(sessionId))?.state ?? {}) as HarnessSessionState;
}

async function noticeOf(stores: Stores, sessionId: string, requestId: string, status: "completed" | "failed") {
  const state = await stateOf(stores, sessionId);
  return turnNotice(state.turns?.[requestId] ?? null, status, state.binding?.confirmed ?? null);
}

/** A session with one completed turn, and the thread it bound. */
async function bound(stores: Stores, recorder: Recorder, sessionId: string): Promise<string> {
  await turn(stores, recorder, sessionId, "hello");
  const id = (await stateOf(stores, sessionId)).binding?.confirmed;
  expect(id).toMatch(/^scripted-codex-/);
  return id!;
}

describe("which thread a turn continues (V1)", () => {
  it("records the thread Codex names, and the next turn resumes it, which Codex names again (BR-1, BR-2)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const first = await turn(stores, recorder, "s-continue", "hello");
    expect(first.status).toBe("completed");
    const id = (await stateOf(stores, "s-continue")).binding?.confirmed;
    expect(id).toMatch(/^scripted-codex-/);
    expect(await noticeOf(stores, "s-continue", first.requestId, "completed")).toMatchObject({ kind: "started", conversation: id });

    const second = await turn(stores, recorder, "s-continue", "again");
    expect(second.status).toBe("completed");
    expect(recorder.opens.map((open) => open.resumed)).toEqual([null, id]);
    expect((await stateOf(stores, "s-continue")).turns?.[second.requestId]).toMatchObject({ asked: id, confirmed: id });
    expect(await noticeOf(stores, "s-continue", second.requestId, "completed")).toMatchObject({ kind: "continued", conversation: id });
  });

  it("a thread Codex no longer has fails as refused, keeps the id, and the next turn asks for it again (BR-3)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const id = await bound(stores, recorder, "s-refused");

    const refused = await turn(stores, recorder, "s-refused", "[refuse] go on");
    expect(refused.status).toBe("failed");
    const record = (await stateOf(stores, "s-refused")).turns?.[refused.requestId];
    expect(record).toMatchObject({ asked: id, confirmed: null, failure: UNKNOWN_CONVERSATION });
    expect(record?.error).toContain(`Codex did not continue thread ${id}`);
    expect(await noticeOf(stores, "s-refused", refused.requestId, "failed")).toMatchObject({ kind: "refused", conversation: id });
    expect((await stateOf(stores, "s-refused")).binding?.confirmed).toBe(id);

    const again = await turn(stores, recorder, "s-refused", "[refuse] try again");
    expect(recorder.opens.at(-1)?.resumed).toBe(id);
    expect(await noticeOf(stores, "s-refused", again.requestId, "failed")).toMatchObject({ kind: "refused", conversation: id });
  });

  it("a refused thread is never replaced: no new thread starts in its place (BR-4)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const id = await bound(stores, recorder, "s-never-new");
    await turn(stores, recorder, "s-never-new", "[refuse] go on");
    await turn(stores, recorder, "s-never-new", "[refuse] go on");
    expect(recorder.opens.map((open) => open.resumed)).toEqual([null, id, id]);
    const turns = Object.values((await stateOf(stores, "s-never-new")).turns ?? {});
    expect(turns.filter((t) => t.confirmed !== null && t.confirmed !== id)).toEqual([]);
  });

  it("a different thread Codex names on its own follows FIX-1915's rule: the session follows the new one (BR-4)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const id = await bound(stores, recorder, "s-moved");
    const moved = await turn(stores, recorder, "s-moved", "[new] go on");
    const now = (await stateOf(stores, "s-moved")).binding?.confirmed;
    expect(now).not.toBe(id);
    expect(await noticeOf(stores, "s-moved", moved.requestId, "completed")).toMatchObject({
      kind: "moved",
      conversation: now,
      previous: id,
    });
  });

  it("a turn Codex itself fails, after naming the thread, shows failed, not refused, and keeps the id (BR-5)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const id = await bound(stores, recorder, "s-failed");

    const failed = await turn(stores, recorder, "s-failed", "[fail] go on");
    const record = (await stateOf(stores, "s-failed")).turns?.[failed.requestId];
    expect(record).toMatchObject({ asked: id, confirmed: id, failure: null });
    expect(record?.error).toEqual(expect.any(String));
    expect(await noticeOf(stores, "s-failed", failed.requestId, failed.status as "completed" | "failed")).toMatchObject({
      kind: "error",
      conversation: id,
    });

    await turn(stores, recorder, "s-failed", "try again");
    expect(recorder.opens.at(-1)?.resumed).toBe(id);
  });

  it("a sign-in failure before Codex names a thread is an error, not a refusal, and the id stays (BR-3, BR-20)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const id = await bound(stores, recorder, "s-signin");

    const failed = await turn(stores, recorder, "s-signin", "[fail-early] go on");
    expect(failed.status).toBe("failed");
    const record = (await stateOf(stores, "s-signin")).turns?.[failed.requestId];
    expect(record).toMatchObject({ asked: id, confirmed: null });
    expect(record?.failure).not.toBe(UNKNOWN_CONVERSATION);
    expect(record?.error).toContain("401 Unauthorized");
    expect(await noticeOf(stores, "s-signin", failed.requestId, "failed")).toMatchObject({ kind: "error" });

    await turn(stores, recorder, "s-signin", "try again");
    expect(recorder.opens.at(-1)?.resumed).toBe(id);
  });

  it("a first turn that fails before Codex names a thread records nothing, so the next turn starts the first thread (BR-9)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const failed = await turn(stores, recorder, "s-first", "[fail-early] hello");
    expect(failed.status).toBe("failed");
    expect((await stateOf(stores, "s-first")).binding?.confirmed ?? null).toBeNull();

    const next = await turn(stores, recorder, "s-first", "hello again");
    expect(recorder.opens.map((open) => open.resumed)).toEqual([null, null]);
    expect(await noticeOf(stores, "s-first", next.requestId, "completed")).toMatchObject({ kind: "started" });
  });

  it("a turn works in the session's own worktree, on its branch, every time (BR-10 via FIX-1915)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-place", "one");
    await turn(stores, recorder, "s-place", "two");
    const [a, b] = recorder.opens.map((open) => open.options.workingDirectory as string);
    expect(a).toBe(b);
    expect(a!.startsWith(realpathSync(worktreeRoot(repo)) + sep)).toBe(true);
    expect(git(a!, "branch", "--show-current").trim()).toBe(sessionBranch({ flowKind: CODEX_SESSION, sessionId: "s-place" }));
    expect(sessionBranch({ flowKind: CODEX_SESSION, sessionId: "s-place" })).toMatch(/^kitchen-sink\/codex-session\//);
  });
});

describe("the plan panel (V3, BR-13)", () => {
  /** The flow's collections the plan panel reads its rows from: the pattern it looks for. */
  const planCollections = (flow: { resources?: Record<string, unknown> }) =>
    Object.values(flow.resources ?? {}).filter(
      (r) => (r as { pattern?: unknown }).pattern === `${OBSERVED_PLAN}/**`,
    );

  it("Codex mode declares no plan record, which the panel reads as 'Codex reports no plan'", () => {
    // The probe reads a flow that does declare one, so its empty answer below means something.
    expect(planCollections(claudeCodeSessionFlow() as never)).not.toHaveLength(0);
    expect(planCollections(codexSessionFlow() as never)).toHaveLength(0);
  });
});

describe("what Kitchen Sink hands the Codex block (S1, BR-10, BR-12)", () => {
  it("a real run gets the allowlisted environment, no approvals, no sandbox and the session's model", () => {
    vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", "do-not-hand-this-over");
    vi.stubEnv("CODEX_API_KEY", "sk-key");
    vi.stubEnv("CODEX_HOME", "/codex-home");
    const options = codexBlockOptions(kitchenSinkHarnessFeeds(CODEX_SESSION));
    // The SDK's own client, built once Codex has listed its MCP servers (`codexClient`).
    expect(options.resolveCodexClient).toBeTypeOf("function");
    expect(options.client).toBeUndefined();
    const client = codexClientOptions();
    expect(client.env).toBeDefined();
    expect(client.env!.KITCHEN_SINK_PLANTED_SECRET).toBeUndefined();
    expect(client.env!.PATH).toBe(process.env.PATH);
    expect(client.env!.HOME).toBe(process.env.HOME);
    expect(client.env!.CODEX_HOME).toBe("/codex-home");
    expect(client.env!.CODEX_API_KEY).toBe("sk-key");
    expect(client.config).toEqual({ service_tier: "default" });
    // No approvals and no sandbox: Kitchen Sink confines no run.
    // The model is the session's, through the block's own option, never a fixed thread setting.
    expect(options.thread).toEqual({ approvalPolicy: "never", sandboxMode: "danger-full-access" });
    expect(options.model).toBeTypeOf("function");
  });

  it("a run takes neither the tier nor the MCP servers your own Codex settings name", () => {
    // Codex's overrides add to its settings, so each server is turned off by
    // name; an empty `mcp_servers` would leave every one of them on.
    const options = codexClientOptions(process.env, [vercelMcp, { name: "local.with.dots", transport: { command: "never-start-this" } }]);
    expect(options.config).toMatchObject({
      service_tier: "default",
    });
    expect(options.configOverrides).toEqual([
      'mcp_servers={"vercel"={url="https://example.invalid/mcp",enabled=false},"local.with.dots"={command="never-start-this",enabled=false}}',
    ]);
  });

  it("the SDK's client is built with the servers Codex lists, asked once", async () => {
    const asked: Array<Record<string, string>> = [];
    const resolve = codexClient(async (env) => {
      asked.push(env);
      return [vercelMcp];
    });
    const first = (await resolve({} as never)) as unknown as { exec: { rawConfigOverrides?: string[] } };
    await resolve({} as never);
    expect(asked).toHaveLength(1);
    expect(first.exec.rawConfigOverrides).toEqual(vercelOverrides);
  });

  it("a list Codex can't give is said in the session and asked again on the next run, never silently skipped", async () => {
    let asked = 0;
    const resolve = codexClient(async () => {
      asked += 1;
      if (asked === 1) throw new Error("codex mcp list timed out");
      return [vercelMcp];
    });
    const notes: Array<{ message: string; transient?: boolean }> = [];
    const ctx = (signal: AbortSignal) =>
      ({ signal, emit: { status: (message: string, opts?: { transient?: boolean }) => notes.push({ message, transient: opts?.transient }) } }) as never;
    const first = (await resolve(ctx(new AbortController().signal))) as unknown as { exec: { rawConfigOverrides?: string[] } };
    expect(first.exec.rawConfigOverrides).toBeUndefined();
    expect(notes).toEqual([{ message: expect.stringContaining("codex mcp list timed out"), transient: false }]);
    const next = (await resolve(ctx(new AbortController().signal))) as unknown as { exec: { rawConfigOverrides?: string[] } };
    expect(asked).toBe(2);
    expect(next.exec.rawConfigOverrides).toEqual(vercelOverrides);
  });

  it("a run stopped while the first MCP list is still coming stops then, and the list still serves the next run", async () => {
    let finish: (names: readonly CodexMcpServer[]) => void = () => {};
    const resolve = codexClient(() => new Promise((done) => (finish = done)));
    const stop = new AbortController();
    const first = resolve({ signal: stop.signal } as never);
    stop.abort();
    await expect(first).rejects.toBeInstanceOf(CodexAgentAbortedError);
    finish([vercelMcp]);
    const next = (await resolve({ signal: new AbortController().signal } as never)) as unknown as {
      exec: { rawConfigOverrides?: string[] };
    };
    expect(next.exec.rawConfigOverrides).toEqual(vercelOverrides);
  });

  it("test mode runs the scripted Codex", () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    expect(codexBlockOptions(kitchenSinkHarnessFeeds(CODEX_SESSION)).resolveCodexClient).toBeDefined();
  });

  it("nothing the caller sends reaches the thread's options", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await testFlow({
      flow: codexSessionFlow({ resolveCodexClient: recorder.resolve }),
      action: "turn",
      userId: "u",
      sessionId: "s-caller",
      input: { prompt: "hello", cwd: repo, resume: "attacker", thread: { sandboxMode: "danger-full-access" } },
      stores,
    });
    expect(recorder.opens[0]).toMatchObject({ resumed: null });
    expect(recorder.opens[0]!.options.workingDirectory).not.toBe(repo);
    // The caller's `danger-full-access` is ignored because the block's own
    // thread options replace it wholesale — it happens to be the same value
    // Kitchen Sink sets, so this asserts the caller's `resume` and `cwd` were
    // dropped rather than that the mode is sandboxed.
    expect(recorder.opens[0]!.options.sandboxMode).toBe("danger-full-access");
  });
});
