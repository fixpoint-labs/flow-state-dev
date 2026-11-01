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

function host(options: { calls: StubToolCall[]; approveTools?: boolean; durable?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "harness-session-approve-"));
  dirs.push(dir);
  mkdirSync(join(dir, "work"), { recursive: true });
  const cwd = join(dir, "work");
  const stub = harnessStub({ toolCalls: options.calls });
  const handed: string[] = [];
  const flow = harnessSessionFlow({
    kind: KIND,
    workspace: { provision: async () => cwd, locate: () => cwd, branch: () => null },
    agent: (feeds: HarnessSessionFeeds) => {
      handed.push(...Object.keys(feeds));
      return stub.slot(feeds as never) as HarnessBlock;
    },
    ...(options.approveTools === false ? {} : { approveTools: true }),
  });
  const state = createFlowState({
    flows: { [KIND]: flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    durable: options.durable ?? true,
  } as never);
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
  const ended = (requestId: string) =>
    until(async () => {
      const now = await status(requestId);
      return now === "completed" || now === "failed" ? now : undefined;
    }, "the turn to end");
  const sessionState = async () => (await (await runtime()).stores.session.get(SESSION))?.state as HarnessSessionState;
  const ran = (name: string) => existsSync(join(cwd, name));
  const decisions = () => stub.toolCalls.map((call) => `${call.run}:${call.decision}`);
  return { turn, pending, answer, ended, status, sessionState, ran, decisions, stub, handed, cwd, dispose: () => state.dispose() };
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
