// FIX-2878 D1, D2.
/**
 * A coding task runs on the settings its first claim froze, for its whole life.
 *
 * Why it matters: the server writes a task's harness at filing so that text a
 * model read can't pick its coder. That only holds if the run then starts on
 * that harness, and keeps to it: a retry or a line typed in its session that
 * re-read the worker's file could land on another vendor, lose its session,
 * or resume a session another harness made.
 *
 * - **D2's guarantee.** A no-pick filing to a worker whose `harness:` names
 *   another harness runs on the filled default.
 * - **The freeze (D1).** The first claim writes the run settings on the run
 *   record; a retry runs them, whatever the task's input says by then.
 * - **A run from before the freeze (D2).** A record that froze nothing and
 *   holds a session starts fresh at its next claim, once; a finished one's
 *   door talk is refused by name.
 *
 * Graded on which scripted harness ran, the session each run was offered, and
 * the run record the manager wrote, through the router a client files with.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { Harness } from "@flow-state-dev/core/harness";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";
import type { CompletionRunContext, PromptRunContext } from "../src/manager";
import { harnessStub, type HarnessStubOptions } from "../src/harness-stub";
import { harnesses } from "../src/kit";
import { seedRepo } from "./fixtures";

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const worker = (name: string, extra: string) => `---\nname: ${name}\ndescription: ${name}.\n${extra}---\nYou are ${name}.`;
const brief = (text: string) => (_run: PromptRunContext) => text;
const finished = (run: CompletionRunContext) => run.stopReport === "finished";
const FINISHED = ["completed", "errored", "failed", "cancelled"];
type Stored = { id: string; status: string; error?: string; input?: Record<string, unknown>; metadata?: Record<string, unknown>; run?: { sessionId?: string } };

/**
 * An app on two scripted harnesses, `codex` the kit's default, whose one coder's own `harness:` is
 * `cursor`: Lead files to it.
 */
async function boot(stubs: { codex?: HarnessStubOptions; cursor?: HarnessStubOptions } = {}) {
  const root = mkdtempSync(join(tmpdir(), "fsd-run-settings-"));
  dirs.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  seedRepo(repo);
  const directory = join(root, "team");
  for (const [file, body] of Object.entries({
    "teams/core/workers/lead/WORKER.md": worker("Lead", "delegates:\n  - core.coder\n"),
    "teams/core/workers/coder/WORKER.md": worker("Coder", "flow: coder\nharness: cursor\n"),
  })) {
    mkdirSync(join(directory, file, ".."), { recursive: true });
    writeFileSync(join(directory, file), body);
  }
  const codex = harnessStub(stubs.codex);
  const cursor = harnessStub(stubs.cursor);
  const harness = (id: string, stub: typeof codex): Harness => ({ id, label: id, agent: stub.slot, readiness: async () => ({ ready: true }), pass: [] });
  const state = createFlowState({
    kits: [
      harnesses({
        workspace: localWorkspaceHost({ root: join(root, "runs"), remotes: { allow: ["file"] }, source: () => ({ kind: "repo", repo: `file://${repo}` }) }),
        defaultHarness: "codex",
        judge: false,
        modes: { implement: { instructions: brief("implement"), doneWhen: finished, requires: ["issue"] }, answer: { instructions: brief("answer"), doneWhen: finished } },
        defaultMode: "answer",
      }),
      workforce({ directory }),
    ],
    fill: { [harnesses.slots.harnesses]: [harness("codex", codex), harness("cursor", cursor)] },
    stores: { default: { primary: inMemoryStores() } },
  });
  states.push(state);
  await state.ready();
  const router = await state.getRouter();
  const stores = (await state.getRuntime()).stores;
  const post = async (path: string[], body: unknown) => {
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: { path } },
    );
    return { status: res.status, body: (await res.json()) as any };
  };
  const created = await post(["agent", "sessions"], { userId: "alice", state: { workerId: "core.lead" } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const conversation = created.body.session.id as string;
  const settle = async (requestId: string) => {
    for (let n = 0; n < 500 && (await stores.request.get(requestId))?.status === "in_progress"; n++) await new Promise((r) => setTimeout(r, 10));
    return stores.request.get(requestId);
  };
  const userKey = `alice:~org:${DEFAULT_ORG_ID}`;
  const task = async (taskId: string) => {
    const entries = await stores.resourceState.getByPrefix("user", userKey, "tasks/");
    return Object.values(entries).map((entry) => entry.state as Stored).find((stored) => stored.id === taskId)!;
  };
  /** The task's run records, by key. */
  const records = async (taskId: string) =>
    Object.entries(await stores.resourceState.getByPrefix("user", userKey, "runs/")).filter(([key]) => key.includes(taskId.replace(/_/g, "-")) || key.includes(taskId));
  /** Rewrite the task's one run record. */
  const rewriteRecord = async (taskId: string, change: (record: Record<string, unknown>) => Record<string, unknown>) => {
    const [[key, record]] = await records(taskId);
    await stores.resourceState.set("user", userKey, key!, change(record!.state as Record<string, unknown>) as never, "any");
  };
  /** File a no-pick task to core.coder from Lead's conversation, and wait for it to end. */
  const fileAndSettle = async () => {
    const sent = await post(["agent", conversation, "actions", "createTask_tasks"], { userId: "alice", input: { goal: "Why does the export skip archived rows?", assignee: "core.coder" } });
    const filed = (await settle(sent.body.request.id))?.result?.output as { ok: boolean; taskId: string };
    expect(filed, JSON.stringify(filed)).toMatchObject({ ok: true });
    let stored = await task(filed.taskId);
    for (let n = 0; n < 500 && !FINISHED.includes(stored.status); n++) {
      await new Promise((r) => setTimeout(r, 20));
      stored = await task(filed.taskId);
    }
    return stored;
  };
  /** A line typed in the run's own session, through its door. */
  const say = async (sessionId: string, message: string) => {
    const sent = await post(["coder", sessionId, "actions", "respond"], { userId: "alice", input: { message } });
    if (sent.status !== 202) return { error: JSON.stringify(sent.body) };
    const done = await settle(sent.body.request.id);
    return { error: done?.result?.error === undefined ? undefined : JSON.stringify(done.result.error), status: done?.status };
  };
  return { codex, cursor, fileAndSettle, task, records, rewriteRecord, say, userKey, stores };
}

describe("a coding task's run settings", () => {
  it("run a no-pick filing on the filled default harness, not its worker's own, and freeze them on the run record", async () => {
    const app = await boot();
    const done = await app.fileAndSettle();
    expect(done.status, JSON.stringify(done)).toBe("completed");
    expect(app.codex.runs).toHaveLength(1);
    expect(app.cursor.runs).toHaveLength(0);
    const [[, record]] = await app.records(done.id);
    expect(record!.state).toMatchObject({ frozenHarness: "codex", frozenModel: null, frozenPlan: null, frozenReview: false, frozenMode: "answer", source: null });
  });

  it("keep a retry on what the first claim froze, whatever the task's input says by then", async () => {
    let app!: Awaited<ReturnType<typeof boot>>;
    const first = () => app.codex.runs.length === 1;
    app = await boot({
      codex: {
        // The first attempt fails; meanwhile the task's input is made to name another harness.
        statusOf: () => (first() ? "errored" : "completed"),
        duringRun: async () => {
          if (!first()) return;
          const entries = await app.stores.resourceState.getByPrefix("user", app.userKey, "tasks/");
          const [key, entry] = Object.entries(entries).find(([, e]) => (e.state as Stored).status === "in_progress")!;
          const state = entry.state as Stored;
          await app.stores.resourceState.set("user", app.userKey, key, { ...state, input: { ...state.input, harness: "cursor" } } as never, "any");
        },
      },
    });
    const done = await app.fileAndSettle();
    expect(app.codex.runs.length, JSON.stringify(done)).toBe(2);
    expect(app.cursor.runs).toHaveLength(0);
    // The retry continued the session the first attempt's harness confirmed.
    expect(app.codex.runs[1]!.resume).toBe(app.codex.runs[0]!.session);
  });

  it("start a run whose record froze nothing fresh at its next claim, once, and freeze it then", async () => {
    let app!: Awaited<ReturnType<typeof boot>>;
    const first = () => app.codex.runs.length === 1;
    app = await boot({
      codex: {
        statusOf: () => (first() ? "errored" : "completed"),
        duringRun: async (run) => {
          if (!first()) return;
          // The record as a build before the freeze left it: a session, and no run settings.
          const entries = await app.stores.resourceState.getByPrefix("user", app.userKey, "runs/");
          for (const [key, entry] of Object.entries(entries)) {
            const state = entry.state as Record<string, unknown>;
            await app.stores.resourceState.set("user", app.userKey, key, { ...state, sessionId: run.session, frozenHarness: null, frozenModel: null, frozenPlan: null, frozenReview: null, frozenMode: null } as never, "any");
          }
        },
      },
    });
    const done = await app.fileAndSettle();
    expect(app.codex.runs).toHaveLength(2);
    // Its session may be another harness's: the next claim doesn't resume it.
    expect(app.codex.runs[1]!.resume).toBeNull();
    const [[, record]] = await app.records(done.id);
    expect(record!.state).toMatchObject({ frozenHarness: "codex", frozenMode: "answer" });
  });

  it("refuse a line into a finished run whose record froze nothing, by name, and talk to one that froze them", async () => {
    const app = await boot();
    const done = await app.fileAndSettle();
    const session = done.run?.sessionId;
    expect(session, JSON.stringify(done)).toBeDefined();
    expect((await app.say(session!, "And the deleted rows?")).error).toBeUndefined();
    expect(app.codex.runs).toHaveLength(2);
    await app.rewriteRecord(done.id, (record) => ({ ...record, frozenHarness: null, frozenModel: null, frozenPlan: null, frozenReview: null, frozenMode: null }));
    const refused = await app.say(session!, "And the archived ones?");
    expect(refused.error).toContain("ran before its coder was recorded with it");
    expect(app.codex.runs).toHaveLength(2);
  });
});
