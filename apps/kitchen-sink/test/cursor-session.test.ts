/**
 * Cursor mode's session flow, end to end below the page
 * (`specs/issues/FIX-1917/PLAN.md` V5; BUSINESS-RULES BR-1 to BR-3a, BR-6,
 * BR-8 to BR-11, BR-15a, BR-16, BR-19, BR-23).
 *
 * The real flow and the real Cursor block, with only the Cursor SDK replaced
 * by the scripted Cursor (`lib/scripted-cursor.ts`) behind a recorder.
 * Worktrees are cut from a real temporary git repository.
 *
 * Red states produced before these were trusted:
 *   - register the flow with `recordPlan` off: the whole-list and empty-list cases find no record.
 *   - leave `env` unset in real mode: the options case finds no allowlist.
 *   - refuse with an error code other than the SDK's `agent_not_found`: the BR-3 case reads as an error.
 *   - record a failure only on a throw: the errored-run case reads "continued".
 *   - record a failed run with a fixed line, not the handle's `failureMessage`: the errored-run case loses Cursor's words.
 * The notice's own red states (a cleared id, a notice from session-wide
 * fields) are FIX-1915's, on the same shared flow (`harness-session.test.ts`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OBSERVED_PLAN, OBSERVED_PLAN_LIST, readPlanTarget } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import type { ResolveCursorClient } from "@flow-state-dev/cursor";

import { CURSOR_DEFAULT_MODEL, CURSOR_SESSION, cursorBlockOptions, cursorSessionFlow } from "@/lib/cursor-mode";
import { kitchenSinkHarnessFeeds } from "@/lib/harness-session-flow";
import type { HarnessSessionState } from "@flow-state-dev/harness-manager";
import { turnNotice, UNKNOWN_CONVERSATION } from "@/lib/harness-turn";
import { sessionBranch, worktreeRoot } from "@/lib/harness-worktree";
import { SCRIPTED_WHOLE_LIST, scriptedCursor, scriptedCursorPauses } from "@/lib/scripted-cursor";

let scratch: string;
let repo: string;
let stateHome: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-cursor-session-")));
  repo = join(scratch, "repo");
  stateHome = join(scratch, "state");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  scriptedCursorPauses.stepMs = 0;
  scriptedCursorPauses.slowMs = 0;
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", stateHome);
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("GOAL_CONTROL", "");
});

afterEach(() => vi.unstubAllEnvs());

/** What one open asked of the client: a new agent, or the one it resumed, and where. */
interface Opened {
  readonly resumed: string | null;
  readonly cwd: string | undefined;
  readonly options: Record<string, unknown>;
}

/** The scripted Cursor, recording each agent the block opens. */
function recorded() {
  const opens: Opened[] = [];
  const scripted = scriptedCursor();
  const resolve: ResolveCursorClient = async (ctx) => {
    const client = await scripted(ctx);
    return {
      create: (options) => {
        opens.push({ resumed: null, cwd: options.local?.cwd, options: options as Record<string, unknown> });
        return client.create(options);
      },
      resume: (agentId, options) => {
        opens.push({ resumed: agentId, cwd: options.local?.cwd, options: options as Record<string, unknown> });
        return client.resume(agentId, options);
      },
    };
  };
  return { opens, resolve };
}

type Recorder = ReturnType<typeof recorded>;
type Stores = ReturnType<typeof createInMemoryStores>;

async function turn(stores: Stores, recorder: Recorder, sessionId: string, prompt: string) {
  return testFlow({
    flow: cursorSessionFlow({ resolveCursorClient: recorder.resolve }),
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

/**
 * The plan a turn's panel reads, as it finds it: the turn's run pointer, then
 * the conversation's rows and its list marker, by topic under the collection.
 */
async function planOf(stores: Stores, sessionId: string, requestId: string) {
  const under = async (collection: string, prefix: string) =>
    Object.entries(await stores.resourceState.getByPrefix("session", sessionId, `${collection}/${prefix}`))
      .map(([key, entry]) => ({ topic: key.slice(collection.length + 1), state: entry.state as Record<string, unknown> }))
      .sort((a, b) => a.topic.localeCompare(b.topic, "en", { numeric: true }));
  const pointers = await under(OBSERVED_PLAN_LIST, `${requestId}/`);
  const target = readPlanTarget(requestId, pointers.map((p) => ({ topic: p.topic, conversation: p.state.conversation as string | null })));
  if (target.kind !== "conversation") throw new Error(`turn ${requestId} left no pointer to its conversation's plan`);
  const markers = (await under(OBSERVED_PLAN_LIST, target.namespace)).filter((m) => m.topic === target.namespace);
  return { rows: await under(OBSERVED_PLAN, `${target.namespace}/`), markers, namespace: target.namespace };
}

describe("which agent a turn continues (V5)", () => {
  it("records the agent Cursor opens, and the next turn resumes it (BR-1, BR-2)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const first = await turn(stores, recorder, "s-continue", "hello");
    expect(first.status).toBe("completed");
    const bound = (await stateOf(stores, "s-continue")).binding?.confirmed;
    expect(bound).toMatch(/^scripted-cursor-/);
    expect(await noticeOf(stores, "s-continue", first.requestId, "completed")).toMatchObject({ kind: "started" });

    const second = await turn(stores, recorder, "s-continue", "again");
    expect(second.status).toBe("completed");
    expect(recorder.opens.map((open) => open.resumed)).toEqual([null, bound]);
    expect(await noticeOf(stores, "s-continue", second.requestId, "completed")).toMatchObject({ kind: "continued", conversation: bound });
  });

  it("an agent Cursor won't resume fails as refused, keeps the id, and the next turn asks for it again (BR-3)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-refused", "hello");
    const bound = (await stateOf(stores, "s-refused")).binding?.confirmed;

    const refused = await turn(stores, recorder, "s-refused", "[refuse] go on");
    expect(refused.status).toBe("failed");
    const record = (await stateOf(stores, "s-refused")).turns?.[refused.requestId];
    expect(record).toMatchObject({ asked: bound, confirmed: null, failure: UNKNOWN_CONVERSATION });
    expect(record?.error).toContain(`Cursor did not continue agent ${bound}`);
    expect(await noticeOf(stores, "s-refused", refused.requestId, "failed")).toMatchObject({ kind: "refused", conversation: bound });
    expect((await stateOf(stores, "s-refused")).binding?.confirmed).toBe(bound);

    await turn(stores, recorder, "s-refused", "try again");
    expect(recorder.opens.at(-1)?.resumed).toBe(bound);
  });

  it("a run that resumed the agent and then failed shows its error, not a refusal (BR-3a)", async () => {
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

  it("a run Cursor reports as errored, a result rather than a throw, shows its error and keeps the id (BR-3a, BR-7)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-errored", "hello");
    const bound = (await stateOf(stores, "s-errored")).binding?.confirmed;

    const errored = await turn(stores, recorder, "s-errored", "[errored] go on");
    const record = (await stateOf(stores, "s-errored")).turns?.[errored.requestId];
    expect(record).toMatchObject({ asked: bound, confirmed: bound, failure: null });
    // Cursor's own words for the failure, not a line Kitchen Sink makes up, so
    // the person reads why the harness failed the run (a refused model, say).
    expect(record?.error).toBe("scripted run Cursor reports as errored");
    expect(await noticeOf(stores, "s-errored", errored.requestId, errored.status as "completed" | "failed")).toMatchObject({
      kind: "error",
      conversation: bound,
    });
    expect((await stateOf(stores, "s-errored")).binding?.confirmed).toBe(bound);

    await turn(stores, recorder, "s-errored", "try again");
    expect(recorder.opens.at(-1)?.resumed).toBe(bound);
  });

  it("a failure before Cursor opens the agent, for another reason, is an error, and the id stays (BR-3)", async () => {
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
    expect(recorder.opens.at(-1)?.resumed).toBe(bound);
  });

  it("a turn works in the session's own worktree, on its branch, every time (BR-21 via FIX-1915)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await turn(stores, recorder, "s-place", "one");
    await turn(stores, recorder, "s-place", "two");
    const [a, b] = recorder.opens.map((open) => open.cwd);
    expect(a).toBe(b);
    expect(a!.startsWith(realpathSync(worktreeRoot(repo)) + sep)).toBe(true);
    expect(git(a!, "branch", "--show-current").trim()).toBe(sessionBranch({ flowKind: CURSOR_SESSION, sessionId: "s-place" }));
    expect(sessionBranch({ flowKind: CURSOR_SESSION, sessionId: "s-place" })).toMatch(/^kitchen-sink\/cursor-session\//);
  });
});

describe("Cursor's to-do list in the plan record (V5, BR-8 to BR-11, BR-15a, BR-16)", () => {
  it("records the whole list Cursor confirmed, not the partial update it sent", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const planned = await turn(stores, recorder, "s-plan", "[plan] make a plan");
    expect(planned.status).toBe("completed");
    const { rows, markers } = await planOf(stores, "s-plan", planned.requestId);
    expect(rows.map((row) => [row.state.title, row.state.status])).toEqual(SCRIPTED_WHOLE_LIST.map((t) => [t.content, t.status]));
    expect(markers).toHaveLength(1);
    expect(markers[0]!.state).toMatchObject({ status: "complete", count: SCRIPTED_WHOLE_LIST.length });
  });

  it("an update Cursor rejects records nothing, and the turn still completes (BR-11)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const rejected = await turn(stores, recorder, "s-plan-fail", "[plan-fail] make a plan");
    expect(rejected.status).toBe("completed");
    expect(await planOf(stores, "s-plan-fail", rejected.requestId)).toMatchObject({ rows: [], markers: [] });
  });

  it("a list Cursor empties is recorded as complete and empty, not as no plan (BR-15a)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const emptied = await turn(stores, recorder, "s-plan-empty", "[plan-empty] clear the plan");
    const { rows, markers } = await planOf(stores, "s-plan-empty", emptied.requestId);
    expect(rows).toEqual([]);
    expect(markers.map((m) => m.state)).toEqual([expect.objectContaining({ status: "complete", count: 0 })]);
  });

  it("a later turn with no update keeps the agent's plan as the first turn left it (FIX-2259)", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    const first = await turn(stores, recorder, "s-plan-later", "[plan] make a plan");
    const later = await turn(stores, recorder, "s-plan-later", "no plan this time");
    const before = await planOf(stores, "s-plan-later", first.requestId);
    const after = await planOf(stores, "s-plan-later", later.requestId);
    expect(after.namespace).toBe(before.namespace);
    expect(after.rows.map((row) => [row.state.title, row.state.status])).toEqual(SCRIPTED_WHOLE_LIST.map((t) => [t.content, t.status]));
    // Unchanged: every row still names the turn that wrote it.
    expect(new Set(after.rows.map((row) => row.state.requestId))).toEqual(new Set([first.requestId]));
  });
});

describe("what Kitchen Sink hands the Cursor block (S5, BR-19, BR-23)", () => {
  it("a real run gets the allowlisted environment, the session's model in agent mode, no sandbox, and the plan recorded", () => {
    vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", "do-not-hand-this-over");
    vi.stubEnv("CURSOR_API_KEY", "key");
    const options = cursorBlockOptions(kitchenSinkHarnessFeeds(CURSOR_SESSION));
    expect(options.resolveCursorClient).toBeUndefined();
    expect(options.env).toBeDefined();
    expect(options.env!.KITCHEN_SINK_PLANTED_SECRET).toBeUndefined();
    expect(options.env!.PATH).toBe(process.env.PATH);
    expect(options.env!.HOME).toBe(process.env.HOME);
    expect(options.env!.CURSOR_API_KEY).toBe("key");
    expect(options.recordPlan).toBe(true);
    // Cursor's sandbox is off: Kitchen Sink confines no run.
    expect(options.agent).toEqual({ mode: "agent", local: { sandboxOptions: { enabled: false } } });
    expect(options.model).toBeTypeOf("function");
  });

  it("trusted, the run gets the named key and still loads no project settings (FIX-2421 D1)", () => {
    vi.stubEnv("KITCHEN_SINK_HARNESS_TRUSTED", "1");
    vi.stubEnv("KITCHEN_SINK_HARNESS_PASS", "KITCHEN_SINK_NAMED_KEY");
    vi.stubEnv("KITCHEN_SINK_NAMED_KEY", "the-operator-named-this");
    vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", "still-not-named");
    const options = cursorBlockOptions(kitchenSinkHarnessFeeds(CURSOR_SESSION));
    expect(options.env!.KITCHEN_SINK_NAMED_KEY).toBe("the-operator-named-this");
    expect(options.env!.KITCHEN_SINK_PLANTED_SECRET).toBeUndefined();
    // Cursor's SDK can't keep a source's hooks out, so no source is loaded.
    expect(options.agent).toEqual({ mode: "agent", local: { sandboxOptions: { enabled: false } } });
  });

  it("test mode runs the scripted Cursor in this process, with no env", () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    const options = cursorBlockOptions(kitchenSinkHarnessFeeds(CURSOR_SESSION));
    expect(options.resolveCursorClient).toBeDefined();
    expect(options.env).toBeUndefined();
  });

  it("the no-record control turns the plan record off, so the block declares none", () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "no-record");
    expect(cursorBlockOptions(kitchenSinkHarnessFeeds(CURSOR_SESSION)).recordPlan).toBe(false);
  });

  it("nothing the caller sends reaches the agent's options", async () => {
    const stores = createInMemoryStores();
    const recorder = recorded();
    await testFlow({
      flow: cursorSessionFlow({ resolveCursorClient: recorder.resolve }),
      action: "turn",
      userId: "u",
      sessionId: "s-caller",
      input: { prompt: "hello", cwd: repo, resume: "attacker", agent: { model: { id: "other" } } },
      stores,
    });
    expect(recorder.opens[0]).toMatchObject({ resumed: null });
    expect(recorder.opens[0]!.cwd).not.toBe(repo);
    // A session stored with no model runs on the mode's default; the caller's `agent.model` goes nowhere.
    expect(recorder.opens[0]!.options.model).toEqual({ id: CURSOR_DEFAULT_MODEL });
  });
});
