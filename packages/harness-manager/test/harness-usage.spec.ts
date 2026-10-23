/**
 * The usage record through a real flow: the one query, its refresh, and the
 * one writer's rules. Every read goes through `runAction` on an in-memory
 * store, the path a host's HTTP door takes, so what is asserted is what a
 * screen or a worker gets back.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, HarnessUsageReader, HarnessUsageReading } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  HARNESS_USAGE,
  harnessUsageAction,
  harnessUsageCollection,
  recordHarnessUsage,
  type HarnessUsageRow,
} from "../src/harness-usage";

const NOW = Date.now();
const SIGNED_IN: HarnessUsageReading = {
  status: "windows",
  accountId: "acct_1",
  plan: "pro",
  windows: [
    { id: "codex:primary", label: null, minutes: 300, usedPercent: 42, resetsAt: NOW + 3_600_000 },
    { id: "codex:secondary", label: null, minutes: 10_080, usedPercent: 7, resetsAt: NOW + 86_400_000 },
  ],
};

/** A flow with the query on it, and a test-only door straight to the writer. */
function lab(readers: Record<string, HarnessUsageReader>, timeoutMs?: number) {
  const write = handler({
    name: "usage-write",
    inputSchema: z.object({ harness: z.string(), reading: z.unknown(), checkedAt: z.number() }),
    outputSchema: z.object({ outcome: z.string() }),
    uses: [defineCapability({ name: "usage-write", resources: { [HARNESS_USAGE]: harnessUsageCollection } })],
    execute: async (input, ctx: BlockContext) => ({
      outcome: await recordHarnessUsage(ctx, input.harness, input.reading as HarnessUsageReading, input.checkedAt),
    }),
  });
  const raw = handler({
    name: "usage-raw",
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
    uses: [defineCapability({ name: "usage-raw", resources: { [HARNESS_USAGE]: harnessUsageCollection } })],
    execute: async (_input, ctx: BlockContext) =>
      (await (ctx.resources as any)[HARNESS_USAGE].list()).map((ref: { path: string; state: unknown }) => ({ path: ref.path, state: ref.state })),
  });
  const flow = defineFlow({
    kind: "usage-flow",
    actions: {
      harnessUsage: harnessUsageAction({ readers, ...(timeoutMs === undefined ? {} : { timeoutMs }) }),
      write: { block: write },
      raw: { block: raw },
    },
  } as never)({ id: "usage-flow" } as never);
  const state = createFlowState({ flows: { "usage-flow": flow }, stores: { test: { primary: inMemoryStores() } }, defaultProfile: "test" } as never);
  const act = async (actionName: string, input: unknown, userId = "alice"): Promise<any> => {
    const rt = (await (state as any).getRuntime()) as { stores: unknown; runtimeConfig: object };
    const result = (await runAction({
      flow,
      actionName,
      input,
      userId,
      orgId: "org_1",
      sessionId: `s_${userId}_${Math.random().toString(36).slice(2)}`,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { output?: unknown; error?: unknown };
    if (result.error !== undefined) throw new Error(JSON.stringify(result.error));
    return result.output;
  };
  const usage = async (refresh: boolean, userId?: string): Promise<HarnessUsageRow[]> =>
    ((await act("harnessUsage", refresh ? { refresh: true } : {}, userId)) as { harnesses: HarnessUsageRow[] }).harnesses;
  return { act, usage };
}

/** A reader that counts its calls and answers what it is told. */
function scripted(answers: Array<HarnessUsageReading | "hang">) {
  let calls = 0;
  const reader: HarnessUsageReader = async (options) => {
    const answer = answers[Math.min(calls, answers.length - 1)]!;
    calls += 1;
    if (answer === "hang") {
      return new Promise((_, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    return answer;
  };
  return { reader, calls: () => calls };
}

describe("harnessUsage — the one query", () => {
  it("lists a registered harness before anyone has read it, and starts nothing without refresh", async () => {
    const codex = scripted([SIGNED_IN]);
    const { usage } = lab({ codex: codex.reader });
    const rows = await usage(false);
    expect(rows).toEqual([
      { harness: "codex", status: "unavailable", reason: "Not checked yet", plan: null, windows: [], checkedAt: null, ageMs: null, refreshError: null },
    ]);
    expect(codex.calls()).toBe(0);
  });

  it("reads on refresh, and returns every window with its age and roll-over", async () => {
    const codex = scripted([SIGNED_IN]);
    const { usage } = lab({ codex: codex.reader });
    const [row] = await usage(true);
    expect(row).toMatchObject({ harness: "codex", status: "windows", reason: null, plan: "pro", refreshError: null });
    expect(row!.windows.map((w) => [w.id, w.usedPercent, w.minutes, w.rolledOver, w.origin])).toEqual([
      ["codex:primary", 42, 300, false, "read"],
      ["codex:secondary", 7, 10_080, false, "read"],
    ]);
    expect(row!.ageMs).toBeGreaterThanOrEqual(0);
    expect(row!.ageMs).toBeLessThan(5_000);
  });

  it("refreshes at most once a minute per person, and each person holds their own row", async () => {
    const codex = scripted([SIGNED_IN]);
    const { usage } = lab({ codex: codex.reader });
    await usage(true);
    await usage(true);
    expect(codex.calls()).toBe(1);
    await usage(true, "bob");
    expect(codex.calls()).toBe(2);
  });

  it("counts a failed attempt against the minute, shares one call between racing refreshes, and keeps the stored row", async () => {
    const codex = scripted(["hang"]);
    const { act, usage } = lab({ codex: codex.reader }, 200);
    // A good reading from over a minute ago, so the next refresh may try.
    await act("write", { harness: "codex", reading: SIGNED_IN, checkedAt: Date.now() - 120_000 });
    const [first, second] = await Promise.all([usage(true), usage(true)]);
    const third = await usage(true);
    expect(codex.calls()).toBe(1);
    for (const rows of [first!, second!, third]) {
      expect(rows[0]).toMatchObject({ status: "windows", refreshError: "Codex did not answer within 0.2 s" });
      expect(rows[0]!.windows[0]!.usedPercent).toBe(42);
      expect(rows[0]!.ageMs).toBeGreaterThanOrEqual(120_000);
    }
  });

  it("answers with the stored row when a reader throws before it returns a promise", async () => {
    const throws: HarnessUsageReader = () => {
      throw new Error("no program");
    };
    const { act, usage } = lab({ codex: throws });
    await act("write", { harness: "codex", reading: SIGNED_IN, checkedAt: Date.now() - 120_000 });
    const rows = await usage(true);
    expect(rows[0]).toMatchObject({ status: "windows", refreshError: "Codex's usage could not be read" });
    expect(rows[0]!.windows[0]!.usedPercent).toBe(42);
  });
});

describe("recordHarnessUsage — the one writer", () => {
  it("never goes backwards: an older reading leaves the stored one, status and all", async () => {
    const { act, usage } = lab({});
    const t = Date.now();
    expect(await act("write", { harness: "codex", reading: SIGNED_IN, checkedAt: t })).toEqual({ outcome: "recorded" });
    expect(
      await act("write", { harness: "codex", reading: { status: "signed-out", reason: "late" }, checkedAt: t - 1_000 }),
    ).toEqual({ outcome: "refused-older" });
    const [row] = await usage(false);
    expect(row).toMatchObject({ status: "windows", plan: "pro" });
  });

  it("replaces the whole record on a sign-in change, so no earlier account's percent is left", async () => {
    const { act, usage } = lab({});
    const t = Date.now();
    await act("write", { harness: "codex", reading: SIGNED_IN, checkedAt: t });
    await act("write", { harness: "codex", reading: { status: "api-key", reason: "Codex uses an API key" }, checkedAt: t + 1 });
    const rows = await usage(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ harness: "codex", status: "api-key", plan: null, windows: [] });
  });

  it("says a window rolled over when its reset has passed, by the server's clock", async () => {
    const { act, usage } = lab({});
    const past: HarnessUsageReading = {
      ...SIGNED_IN,
      windows: [{ id: "codex:primary", label: null, minutes: 300, usedPercent: 99, resetsAt: Date.now() - 1_000 }],
    } as HarnessUsageReading;
    await act("write", { harness: "codex", reading: past, checkedAt: Date.now() - 3 * 3_600_000 });
    const [row] = await usage(false);
    expect(row!.windows[0]).toMatchObject({ usedPercent: 99, rolledOver: true });
    expect(row!.ageMs).toBeGreaterThanOrEqual(3 * 3_600_000);
  });

  it("stores the account as a hash and no email", async () => {
    const { act } = lab({});
    await act("write", { harness: "codex", reading: SIGNED_IN, checkedAt: Date.now() });
    const [row] = (await act("raw", {})) as Array<{ path: string; state: { account: string } }>;
    expect(row!.path).toBe("harness-usage/codex");
    expect(row!.state.account).toMatch(/^[0-9a-f]+$/);
    expect(JSON.stringify(row)).not.toContain("acct_1");
    expect(JSON.stringify(row)).not.toContain("@");
  });
});
