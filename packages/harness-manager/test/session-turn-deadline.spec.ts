/**
 * A harness session's turn ends at its deadline (FIX-2680): a harness wedged
 * on a hung tool would otherwise keep its agent, and everything it started,
 * alive for as long as the host runs. The harness is the package's scripted
 * stub, paused on a step that only its abort ends, so the turn ends only if
 * the deadline stops it.
 *
 * Red states produced before these were trusted:
 *   - no deadline on the harness step: both wedged turns run until the test's
 *     own timeout.
 *   - the approval stop alone on the approval turn's step, without the
 *     deadline beside it: the approval case runs until the test's timeout.
 *   - the record's `stopped` read off the step's signal, which the deadline
 *     aborted: the timed-out turn reads as a person's stop.
 *   - a 30-minute default: the turn is stopped before 59 minutes.
 *   - no check on the option: a zero, negative, NaN or over-long deadline builds.
 *   - the step's timer left running when it settles: an hour-long timer
 *     outlives each finished turn.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/harness";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessSessionFlow, harnessStub, type HarnessSessionFeeds, type HarnessSessionState } from "../src";

const KIND = "deadline-session";
const USER = "alice";

/** The longest timer there is: only an abort ends the step. */
const FOREVER = 2 ** 31 - 1;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function host(options: { turnTimeoutMs?: number; approveTools?: boolean; finishes?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "harness-session-deadline-"));
  dirs.push(dir);
  const cwd = join(dir, "work");
  mkdirSync(cwd, { recursive: true });
  const stub = harnessStub(options.finishes === true ? {} : { steps: ["working"], stepEveryMs: FOREVER });
  const flow = harnessSessionFlow({
    kind: KIND,
    workspace: { provision: async () => cwd, locate: () => cwd, branch: () => null },
    agent: (feeds: HarnessSessionFeeds) => stub.slot(feeds as never) as HarnessBlock,
    ...(options.turnTimeoutMs === undefined ? {} : { turnTimeoutMs: options.turnTimeoutMs }),
    ...(options.approveTools === true ? { approveTools: true } : {}),
  });
  const stores = inMemoryStores();
  const state = createFlowState({
    flows: [flow],
    stores: { test: { primary: stores } },
    defaultProfile: "test",
    durable: true,
  } as never);
  const runtime = async () =>
    (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: Record<string, unknown> }> }).getRuntime();
  const turn = async (sessionId: string, prompt: string) => {
    const rt = await runtime();
    const now = Date.now();
    await rt.stores.session.set(
      sessionId,
      { id: sessionId, flowKind: KIND, userId: USER, orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
      "any" as never,
    );
    const result = (await runAction({
      flow,
      actionName: "turn",
      input: { prompt },
      userId: USER,
      orgId: DEFAULT_ORG_ID,
      sessionId,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { requestId?: string; error?: { message?: string } };
    const session = (await rt.stores.session.get(sessionId))?.state as HarnessSessionState;
    return { result, record: session.turns?.[result.requestId!] };
  };
  return { turn, stub, dispose: () => state.dispose() };
}

describe("a harness session turn's deadline", () => {
  it("ends a turn whose harness never finishes, with the turn recorded as timed out rather than a generic error", async () => {
    const h = host({ turnTimeoutMs: 200 });
    try {
      const startedAt = Date.now();
      const { result, record } = await h.turn("s-wedged", "do the thing");
      // The harness ran, and only its abort ended it.
      expect(h.stub.runs).toHaveLength(1);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
      expect(result.error?.message).toMatch(/timed out after 200ms/);
      expect(record?.timedOut).toBe(true);
      // Not a person's stop: a page tells the two apart.
      expect(record?.stopped).toBe(false);
      expect(record?.error).toMatch(/timed out after 200ms/);
      // Ended like any other turn: a page reads its end and what it spent.
      expect(record?.endedAt).not.toBeNull();
    } finally {
      await h.dispose();
    }
  }, 20_000);

  it("ends a turn with tool approvals on the same way: the deadline joins the approval stop, it doesn't replace it", async () => {
    const h = host({ turnTimeoutMs: 200, approveTools: true });
    try {
      const { result, record } = await h.turn("s-wedged-approvals", "do the thing");
      expect(h.stub.runs).toHaveLength(1);
      expect(result.error?.message).toMatch(/timed out after 200ms/);
      expect(record?.timedOut).toBe(true);
      expect(record?.stopped).toBe(false);
      expect(record?.waitsOnApproval ?? null).toBeNull();
    } finally {
      await h.dispose();
    }
  }, 20_000);

  it("leaves a turn that ends before its deadline unmarked", async () => {
    const h = host({ turnTimeoutMs: 60_000, finishes: true });
    try {
      const { result, record } = await h.turn("s-quick", "do the thing");
      expect(result.error).toBeUndefined();
      expect(record?.timedOut ?? null).toBeNull();
      expect(record?.error ?? null).toBeNull();
    } finally {
      await h.dispose();
    }
  }, 20_000);

  it("is an hour when the host sets none: a turn still running at 59 minutes goes on, and one at 60 is stopped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    const h = host({});
    try {
      let settled = false;
      const ending = h.turn("s-default", "do the thing").finally(() => {
        settled = true;
      });
      await vi.waitFor(() => expect(h.stub.runs).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(59 * 60_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      const { record } = await ending;
      expect(record?.timedOut).toBe(true);
      expect(record?.error).toMatch(/timed out after 3600000ms/);
    } finally {
      vi.useRealTimers();
      await h.dispose();
    }
  }, 20_000);

  it("is refused at build when it is no deadline a timer honours, rather than stopping every turn at once", () => {
    for (const turnTimeoutMs of [0, -1, Number.NaN, 2 ** 31]) {
      expect(() => host({ turnTimeoutMs })).toThrow(/turnTimeoutMs must be a positive whole number/);
    }
  });

  it("lets go of its timer when the turn ends first, so finished turns leave no hour-long timer behind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const h = host({ finishes: true });
    try {
      await h.turn("s-warm", "warm the host up");
      const before = vi.getTimerCount();
      const { record } = await h.turn("s-cleared", "do the thing");
      expect(record?.endedAt).not.toBeNull();
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
      await h.dispose();
    }
  }, 20_000);
});
