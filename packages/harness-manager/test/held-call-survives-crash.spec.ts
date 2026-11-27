// FIX-2445.
/**
 * A held tool call survives its host dying between the hold and the answer.
 *
 * A harness session's turn runs on host A; the harness asks about a call, the
 * feed holds it, and the harness step ends stopped for it. Host A dies as the
 * next step, the one that writes the held call onto the turn's state, starts:
 * the harness step's end is in the request's log, and from then on every store
 * call hangs, as a dead process's do. Host B starts on the same stores, finds
 * the request `interrupted` (its stale-request sweep) and continues it through
 * the continue route. The replay injects the recorded harness step and runs
 * the rest: the turn must wait on the same approval, and Allow must resume the
 * conversation with the call let through.
 *
 * Why it matters: the held call crossed from the harness step to the next one
 * in an in-memory map, which died with host A. Host B's replay then found no
 * held call, waited on nothing, and ended the turn as if the run had finished,
 * with the call never asked about and never run.
 *
 * The manager hands its held call on the same way, but a crashed manager run
 * is not continued at all today: the engine's crash continuation restores only
 * the request's root sequencer state, and the manager runs nested under its
 * task action. Its in-process tests (`approve-tools.spec.ts`) cover how its call is handed on.
 *
 * Red states produced before this was trusted:
 *   - hand the held call on in an in-memory map (the code before this test):
 *     the replay waits on nothing, and the turn ends after one run.
 *   - kill host A as the harness step's stop is first logged as an event,
 *     before the step's output is kept: the replay runs the harness step again
 *     and three runs are made, so the kill point is after the output is kept.
 */
import type { HarnessBlock, HarnessFeeds } from "@flow-state-dev/core/harness";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction, type FlowState, type StoreAdapter, type StoreRegistry } from "@flow-state-dev/engine";
import { harnessSessionFlow, harnessStub, type StubToolCall } from "../src";

const KIND = "approve-crash";
const USER = "alice";
const SESSION = "s_approve_crash";
/** The step after the harness step's stop, which writes the held call onto the turn's state: host A dies as it starts. */
const HELD_CALL_STEP = `${KIND}-tool-held`;

const dirs: string[] = [];
const live: FlowState[] = [];
afterEach(async () => {
  // The dead host is never disposed: its store calls hang.
  for (const state of live.splice(0)) await state.dispose();
});
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A shell call that writes `name` in the session's folder when it runs. */
function marker(name: string): StubToolCall {
  return { toolName: "Bash", input: { command: `touch ${name}` }, run: (run) => writeFileSync(join(run.cwd, name), "ran\n") };
}

/** Stores whose every call hangs once the request's log naming `trigger` is kept, as a dead process's do. */
function dyingAfter(stores: StoreAdapter, trigger: string) {
  let dead = false;
  const never = new Promise<never>(() => {});
  const wrap = <T extends object>(store: T): T =>
    new Proxy(store, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (dead) return never;
          const result = value.apply(target, args);
          if (String(prop) !== "persistItems" || !JSON.stringify(args).includes(trigger)) return result;
          dead = true;
          return Promise.resolve(result).then(() => never);
        };
      },
    });
  let registry: Promise<Partial<StoreRegistry>> | undefined;
  const resolve = (slots: Parameters<StoreAdapter["resolve"]>[0]) =>
    (registry ??= stores.resolve(slots).then(
      (inner) =>
        Object.fromEntries(
          Object.entries(inner).map(([name, store]) => [name, store === undefined ? store : wrap(store as object)]),
        ) as Partial<StoreRegistry>,
    ));
  return { stores: { ...stores, resolve } as StoreAdapter, dead: () => dead };
}

async function until<T>(read: () => Promise<T | undefined> | T | undefined, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "harness-session-crash-"));
  dirs.push(dir);
  const cwd = join(dir, "work");
  mkdirSync(cwd, { recursive: true });
  const stub = harnessStub({ toolCalls: [marker("marker")] });
  const makeFlow = () =>
    harnessSessionFlow({
      kind: KIND,
      workspace: { provision: async () => cwd, locate: () => cwd, branch: () => null },
      agent: (feeds: HarnessFeeds) => stub.slot(feeds as never) as HarnessBlock,
      approveTools: true,
    });
  const shared = inMemoryStores();
  const makeHost = (stores: StoreAdapter) => {
    const flow = makeFlow();
    const state = createFlowState({
      flows: [flow],
      stores: { test: { primary: stores } },
      defaultProfile: "test",
      durable: true,
      staleSweepIntervalMs: 100,
      staleSweepThresholdMs: 500,
    } as never);
    return { flow, state };
  };
  const runtimeOf = async (state: FlowState) =>
    (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: Record<string, any> }> }).getRuntime();
  return { cwd, stub, shared, makeHost, runtimeOf, ran: (name: string) => existsSync(join(cwd, name)) };
}

describe("a harness session's held tool call, its host killed between the hold and the answer", { timeout: 60_000 }, () => {
  it("waits on the same approval on the next host, and Allow resumes the conversation with the call let through", async () => {
    const s = setup();
    const dying = dyingAfter(s.shared, HELD_CALL_STEP);
    const first = s.makeHost(dying.stores);
    const firstRt = await s.runtimeOf(first.state);
    const now = Date.now();
    await firstRt.stores.session.set(
      SESSION,
      { id: SESSION, flowKind: KIND, userId: USER, orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
      "any" as never,
    );
    void runAction({
      flow: first.flow,
      actionName: "turn",
      input: { prompt: "do the thing" },
      userId: USER,
      orgId: DEFAULT_ORG_ID,
      sessionId: SESSION,
      stores: firstRt.stores,
      runtimeConfig: { ...firstRt.runtimeConfig },
    } as never);
    await until(() => (dying.dead() ? true : undefined), "host A to die after the held call's step");
    expect(s.stub.toolCalls.map((call) => call.decision)).toEqual(["held"]);

    // Host B, on the same stores. The dead host's hold on the worktree is stale and taken over.
    rmSync(`${s.cwd}.lock`, { force: true });
    const next = s.makeHost(s.shared).state;
    live.push(next);
    // The router starts the host's sweeps.
    const router = await next.getRouter();
    const rt = await s.runtimeOf(next);
    const requestId = await until(async () => (await rt.stores.request.list({ sessionId: SESSION }))[0]?.id as string | undefined, "the turn's request");
    const status = async () => (await rt.stores.request.get(requestId))?.status as string | undefined;
    await until(async () => ((await status()) === "interrupted" ? true : undefined), "the stale sweep to mark the turn interrupted");

    const continuePath = [KIND, "sessions", SESSION, "requests", requestId, "continue"];
    const continued = await router.POST(
      new Request(`http://localhost/api/flows/${continuePath.join("/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      { params: { path: continuePath } } as never,
    );
    expect(continued.status).toBe(202);

    // The turn waits on the call it was stopped for, on host B.
    const gate = await until(async () => {
      const list = (await rt.runtimeConfig.durabilityProvider!.listSuspended({ status: "pending" })) as Array<{
        requestId: string;
        suspensionId: string;
        kind?: string;
        data?: Record<string, unknown>;
      }>;
      return list.find((pending) => pending.requestId === requestId);
    }, "the turn to wait on the held call's approval", 10_000).catch(async (error) => {
      throw new Error(`${(error as Error).message}; the turn is ${await status()} after ${s.stub.runs.length} run(s)`);
    });
    expect(gate.kind).toBe("approval");
    expect(gate.data).toMatchObject({ tool: "Bash", touches: "touch marker" });
    expect(s.ran("marker")).toBe(false);

    const answerPath = [KIND, "requests", requestId, "answer"];
    const answered = await router.POST(
      new Request(`http://localhost/api/flows/${answerPath.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspensionId: gate.suspensionId, action: "approve", userId: USER }),
      }),
      { params: { path: answerPath } } as never,
    );
    expect(answered.status).toBe(202);
    await until(async () => ((await status()) === "completed" ? true : undefined), "the turn to complete");
    expect(s.stub.runs).toHaveLength(2);
    expect(s.stub.runs[1]!.resume).toBe(s.stub.runs[0]!.session);
    expect(s.stub.toolCalls.map((call) => `${call.run}:${call.decision}`)).toEqual(["0:held", "1:allow"]);
    expect(s.ran("marker")).toBe(true);
  });
});

