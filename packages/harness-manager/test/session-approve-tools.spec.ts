/**
 * A harness session's tool call waits for the user (FIX-2432), in process:
 * a real `createFlowState` with durable execution, the session flow's own
 * turn, and answers through the engine's answer route as a screen sends
 * them. Only the harness is the package's scripted stub, making scripted tool
 * calls; what ran is its own record and the marker files the calls write.
 *
 * Red states produced before these were trusted:
 *   - hand no `onToolApproval` feed: every call runs unasked, and "stops the
 *     turn" fails on the marker.
 *   - drop the grant from the answer's outcome: the re-issued call is held
 *     again, and "resumes on Allow" fails on its decisions.
 *   - read the turn's spend from what this run of the request has left to
 *     hand on (`readRequestSpend`) in place of the request's total: the run
 *     stopped for the approval is lost on resume, and "counts what each run
 *     spent" reads one run's tokens, not two.
 *   - throw past the approval limit instead of failing through the turn's
 *     failure record: the turn fails with no error, end or spend on its record.
 *   - drop the finished hook's end of an unended turn: a turn stopped while
 *     it waits ends `aborted` with no end, stop or spend on its record.
 *   - save the held call in the step that waits, just before it suspends
 *     (FIX-2444's shape), rather than in the step before it: the resume reads
 *     no held call, and both Allow cases, the restarted one too, end after one run.
 *   - drop the refusal of a turn sent while another waits: the second turn
 *     runs, confirms its own conversation, and the first turn's Allow resumes
 *     that one instead of its own.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  ALLOW_FOR_RUN,
  HARNESS_SESSION_APPROVALS_NEED_DURABLE,
  HARNESS_SESSION_TURN_WAITS_ON_APPROVAL,
  MAX_APPROVAL_STEPS,
  harnessSessionFlow,
  harnessStub,
  type HarnessSessionFeeds,
  type HarnessSessionState,
  type StubToolCall,
} from "../src";

const KIND = "approve-session";
const USER = "alice";
const SESSION = "s_approve";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A shell call that writes `name` in the session's folder when it runs. */
function marker(name: string, command = `touch ${name}`): StubToolCall {
  return { toolName: "Bash", input: { command }, run: (run) => writeFileSync(join(run.cwd, name), "ran\n") };
}

function host(options: {
  calls: StubToolCall[];
  approveTools?: boolean;
  durable?: boolean;
  spend?: { inputTokens: number; outputTokens: number; costUsd: number | null };
}) {
  const dir = mkdtempSync(join(tmpdir(), "harness-session-approve-"));
  dirs.push(dir);
  mkdirSync(join(dir, "work"), { recursive: true });
  const cwd = join(dir, "work");
  const stub = harnessStub({ toolCalls: options.calls, ...(options.spend === undefined ? {} : { spend: options.spend }) });
  const handed: string[] = [];
  const makeFlow = () =>
    harnessSessionFlow({
      kind: KIND,
      workspace: { provision: async () => cwd, locate: () => cwd, branch: () => null },
      agent: (feeds: HarnessSessionFeeds) => {
        handed.push(...Object.keys(feeds));
        return stub.slot(feeds as never) as HarnessBlock;
      },
      ...(options.approveTools === false ? {} : { approveTools: true }),
    });
  const stores = inMemoryStores();
  const makeState = (forFlow: ReturnType<typeof makeFlow>) =>
    createFlowState({
      flows: { [KIND]: forFlow },
      stores: { test: { primary: stores } },
      defaultProfile: "test",
      durable: options.durable ?? true,
    } as never);
  let flow = makeFlow();
  let state = makeState(flow);
  /** A host restart: this process's flow and runtime go, and new ones start on the same stores. */
  const restart = async () => {
    await state.dispose();
    flow = makeFlow();
    state = makeState(flow);
  };
  const runtime = async () =>
    (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: { durabilityProvider?: any } }> }).getRuntime();

  /** One turn, the session born with a model the first time, as a create through the flow's routes would be. */
  const turn = async (prompt: string) => {
    const rt = await runtime();
    if ((await rt.stores.session.get(SESSION)) === undefined) {
      const now = Date.now();
      await rt.stores.session.set(
        SESSION,
        { id: SESSION, flowKind: KIND, userId: USER, orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
        "any" as never,
      );
    }
    return (await runAction({
      flow,
      actionName: "turn",
      input: { prompt },
      userId: USER,
      orgId: DEFAULT_ORG_ID,
      sessionId: SESSION,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { requestId?: string; output?: unknown; error?: { message?: string } };
  };
  /** The turn's open stop, as the durability provider lists it. */
  const pending = async (requestId: string) => {
    const rt = await runtime();
    const list = (await rt.runtimeConfig.durabilityProvider!.listSuspended({ status: "pending" })) as Array<{
      requestId: string;
      suspensionId: string;
      kind?: string;
      message?: string;
      data?: Record<string, unknown>;
    }>;
    return list.find((gate) => gate.requestId === requestId);
  };
  const until = async <T,>(read: () => Promise<T | undefined>, what: string, timeoutMs = 20_000): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const status = async (requestId: string) => (await (await runtime()).stores.request.get(requestId))?.status as string | undefined;
  /** Answer the turn's open stop through the engine's answer route, as a screen does. */
  const answer = async (requestId: string, action: "approve" | "reject", data?: unknown): Promise<Response> => {
    const gate = (await pending(requestId))!;
    const router = await state.getRouter();
    const path = [KIND, "requests", requestId, "answer"];
    return router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspensionId: gate.suspensionId, action, ...(data === undefined ? {} : { data }), userId: USER }),
      }),
      { params: { path } } as never,
    );
  };
  /** Stop the turn through the engine's abort route, as a screen's stop button does. */
  const stop = async (requestId: string): Promise<Response> => {
    const router = await state.getRouter();
    const path = [KIND, "requests", requestId, "abort"];
    return router.POST(new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "POST" }), { params: { path } } as never);
  };
  const ended = (requestId: string) =>
    until(async () => {
      const now = await status(requestId);
      return now === "completed" || now === "failed" ? now : undefined;
    }, "the turn to end");
  const sessionState = async () => (await (await runtime()).stores.session.get(SESSION))?.state as HarnessSessionState;
  const ran = (name: string) => existsSync(join(cwd, name));
  const decisions = () => stub.toolCalls.map((call) => `${call.run}:${call.decision}`);
  return { turn, pending, answer, stop, restart, ended, status, sessionState, ran, decisions, stub, handed, cwd, dispose: () => state.dispose() };
}

describe("a harness session's tool call waits for the user", () => {
  it("stops the turn with the call unrun, waiting on an approval naming the tool, the command and the folder", async () => {
    const h = host({ calls: [marker("marker")] });
    try {
      const { requestId } = await h.turn("do the thing");
      const gate = (await h.pending(requestId!))!;
      expect(await h.status(requestId!)).toBe("suspended");
      expect(gate.kind).toBe("approval");
      expect(gate.message).toContain("Bash");
      expect(gate.message).toContain("touch marker");
      expect(gate.message).toContain(h.cwd);
      expect(gate.data).toMatchObject({ tool: "Bash", touches: "touch marker", cwd: h.cwd, approveOptions: [ALLOW_FOR_RUN] });
      expect(h.ran("marker")).toBe(false);
      expect(h.decisions()).toEqual(["0:held"]);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("resumes the conversation that asked on Allow, and the call runs once, after the answer", async () => {
    const h = host({ calls: [marker("marker")] });
    try {
      const { requestId } = await h.turn("do the thing");
      await h.pending(requestId!);
      const answeredAt = Date.now();
      expect((await h.answer(requestId!, "approve")).status).toBe(202);
      expect(await h.ended(requestId!)).toBe("completed");
      expect(h.stub.runs).toHaveLength(2);
      expect(h.stub.runs[1]!.resume).toBe(h.stub.runs[0]!.session);
      expect(h.stub.runs[1]!.prompt).toContain("Make the call again");
      expect(h.decisions()).toEqual(["0:held", "1:allow"]);
      expect(h.stub.toolCalls[1]!.at).toBeGreaterThanOrEqual(answeredAt);
      expect(h.ran("marker")).toBe(true);
      // The turn's record is the turn's, as without approvals: it ended, and failed nothing.
      const record = (await h.sessionState()).turns?.[requestId!];
      expect(record?.failure ?? null).toBeNull();
      expect(record?.endedAt).not.toBeNull();
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("resumes the held call on Allow after the host restarts while the turn waits", async () => {
    const h = host({ calls: [marker("marker")] });
    try {
      const { requestId } = await h.turn("do the thing");
      await h.pending(requestId!);
      await h.restart();
      expect((await h.answer(requestId!, "approve")).status).toBe(202);
      expect(await h.ended(requestId!)).toBe("completed");
      expect(h.stub.runs).toHaveLength(2);
      expect(h.stub.runs[1]!.resume).toBe(h.stub.runs[0]!.session);
      expect(h.decisions()).toEqual(["0:held", "1:allow"]);
      expect(h.ran("marker")).toBe(true);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("counts what each run spent, the one stopped for the approval too", async () => {
    const h = host({ calls: [marker("marker")], spend: { inputTokens: 10, outputTokens: 1, costUsd: 0.1 } });
    try {
      const { requestId } = await h.turn("do the thing");
      await h.pending(requestId!);
      await h.answer(requestId!, "approve");
      expect(await h.ended(requestId!)).toBe("completed");
      expect(h.stub.runs).toHaveLength(2);
      const record = (await h.sessionState()).turns?.[requestId!];
      expect(record?.spend).toMatchObject({ inputTokens: 20, outputTokens: 2 });
      expect(record?.spend?.costUsd).toBeCloseTo(0.2);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("ends the turn on its record when it asks past the most approvals one turn takes", async () => {
    const calls = Array.from({ length: MAX_APPROVAL_STEPS + 1 }, (_, at) => marker(`m${at}`));
    const h = host({ calls, spend: { inputTokens: 1, outputTokens: 1, costUsd: null } });
    try {
      const { requestId } = await h.turn("do the thing");
      for (let answered = 0; answered < MAX_APPROVAL_STEPS; answered += 1) {
        const at = answered;
        await h.answer(requestId!, "approve").then(async () => {
          // The next call's approval, or the turn's end once it asks past the limit.
          const deadline = Date.now() + 20_000;
          for (;;) {
            const gate = await h.pending(requestId!);
            if (gate?.message?.includes(`touch m${at + 1}`)) return;
            const now = await h.status(requestId!);
            if (now === "failed" || now === "completed") return;
            if (Date.now() > deadline) throw new Error(`timed out after answer ${at}`);
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        });
      }
      expect(await h.ended(requestId!)).toBe("failed");
      const record = (await h.sessionState()).turns?.[requestId!];
      expect(record?.error).toContain(`${MAX_APPROVAL_STEPS} tool approvals`);
      expect(record?.endedAt).not.toBeNull();
      expect(record?.spend).toMatchObject({ inputTokens: MAX_APPROVAL_STEPS + 1 });
    } finally {
      await h.dispose();
    }
  }, 120_000);

  it("ends the turn on its record when the user stops it while it waits", async () => {
    const h = host({ calls: [marker("marker")], spend: { inputTokens: 10, outputTokens: 1, costUsd: 0.1 } });
    try {
      const { requestId } = await h.turn("do the thing");
      await h.pending(requestId!);
      expect((await h.stop(requestId!)).status).toBe(204);
      const deadline = Date.now() + 20_000;
      for (;;) {
        const record = (await h.sessionState()).turns?.[requestId!];
        if (record?.endedAt != null) break;
        if (Date.now() > deadline) throw new Error(`the stopped turn never ended on its record (request ${await h.status(requestId!)})`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const record = (await h.sessionState()).turns?.[requestId!];
      expect(record?.stopped).toBe(true);
      expect(record?.spend).toMatchObject({ inputTokens: 10, outputTokens: 1 });
      expect(h.ran("marker")).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("never runs the call on Deny, tells the conversation with the user's note, and the turn goes on", async () => {
    const h = host({ calls: [marker("marker"), marker("second")] });
    try {
      const { requestId } = await h.turn("do the thing");
      await h.pending(requestId!);
      await h.answer(requestId!, "reject", { note: "not in this repo" });
      // The turn goes on to its next call, which waits in turn.
      const next = await (async () => {
        const deadline = Date.now() + 20_000;
        for (;;) {
          const gate = await h.pending(requestId!);
          if (gate?.message?.includes("touch second")) return gate;
          if (Date.now() > deadline) throw new Error("timed out waiting for the next call's approval");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })();
      expect(next.kind).toBe("approval");
      expect(h.stub.runs[1]!.resume).toBe(h.stub.runs[0]!.session);
      expect(h.stub.runs[1]!.prompt).toContain("did not allow");
      expect(h.stub.runs[1]!.prompt).toContain("not in this repo");
      expect(h.ran("marker")).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("lets the same command through for the rest of the turn on Allow for this run, and asks again for another", async () => {
    const h = host({ calls: [marker("one", "pnpm test"), marker("two", "pnpm test"), marker("three", "pnpm test -- foo")] });
    try {
      const { requestId } = await h.turn("do the thing");
      await h.pending(requestId!);
      await h.answer(requestId!, "approve", ALLOW_FOR_RUN.data);
      const deadline = Date.now() + 20_000;
      for (;;) {
        const gate = await h.pending(requestId!);
        if (gate?.message?.includes("pnpm test -- foo")) break;
        if (Date.now() > deadline) throw new Error("timed out waiting for the other command's approval");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(h.decisions()).toEqual(["0:held", "1:allow", "1:allow", "1:held"]);
      expect(h.ran("one") && h.ran("two")).toBe(true);
      expect(h.ran("three")).toBe(false);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("refuses a turn sent while another waits, and the waiting one resumes its own conversation", async () => {
    const h = host({ calls: [marker("marker")] });
    try {
      const first = await h.turn("do the thing");
      await h.pending(first.requestId!);
      // The wait gives back the session's turn slot, so nothing else keeps a
      // second turn out of the checkout and conversation the first one waits in.
      const second = await h.turn("something else");
      expect(JSON.stringify(second)).toContain(HARNESS_SESSION_TURN_WAITS_ON_APPROVAL);
      expect(h.stub.runs).toHaveLength(1);
      expect(await h.status(first.requestId!)).toBe("suspended");
      expect((await h.answer(first.requestId!, "approve")).status).toBe(202);
      expect(await h.ended(first.requestId!)).toBe("completed");
      expect(h.stub.runs.map((run) => run.resume)).toEqual([null, h.stub.runs[0]!.session]);
      expect(h.ran("marker")).toBe(true);
      // Answered, the session takes turns again.
      await h.turn("one more");
      expect(h.stub.runs).toHaveLength(3);
    } finally {
      await h.dispose();
    }
  }, 30_000);
});

describe("a harness session without approvals", () => {
  it("hands no approval feed, and every call runs unasked, as before", async () => {
    const h = host({ calls: [marker("marker")], approveTools: false });
    try {
      const { requestId } = await h.turn("do the thing");
      expect(await h.status(requestId!)).toBe("completed");
      expect(h.handed).not.toContain("onToolApproval");
      expect(h.decisions()).toEqual(["0:unasked"]);
      expect(h.ran("marker")).toBe(true);
    } finally {
      await h.dispose();
    }
  }, 30_000);
});

describe("a harness session with approvals on a host without durable execution", () => {
  it("refuses the turn before the harness runs, saying why", async () => {
    const h = host({ calls: [marker("marker")], durable: false });
    try {
      const result = await h.turn("do the thing");
      expect(result.error?.message ?? (await h.status(result.requestId!))).toBeDefined();
      expect(JSON.stringify(result)).toContain("durable execution");
      expect(HARNESS_SESSION_APPROVALS_NEED_DURABLE).toContain("approveTools");
      expect(h.stub.runs).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  }, 30_000);
});
