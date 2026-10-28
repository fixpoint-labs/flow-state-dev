/**
 * The usage record through a real flow: the one query, its refresh, and the
 * one writer's rules. Every read goes through `runAction` on an in-memory
 * store, the path a host's HTTP door takes, so what is asserted is what a
 * screen or a worker gets back.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, HarnessUsageReader, HarnessUsageReading, HarnessUsageReport } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  HARNESS_USAGE,
  applyReading,
  applyRunWindow,
  harnessUsageAction,
  harnessUsageCollection,
  harnessUsageStateSchema,
  recordHarnessUsage,
  type HarnessUsageRow,
  type HarnessUsageState,
} from "../src/harness-usage";

const NOW = Date.now();
const SIGNED_IN: HarnessUsageReading = {
  status: "windows",
  accountId: "acct_1",
  plan: "pro",
  windows: [
    { id: "codex:primary", label: null, minutes: 300, usedPercent: 42, level: null, resetsAt: NOW + 3_600_000 },
    { id: "codex:secondary", label: null, minutes: 10_080, usedPercent: 7, level: null, resetsAt: NOW + 86_400_000 },
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
  const runWrite = handler({
    name: "usage-run-write",
    inputSchema: z.object({ report: z.unknown() }),
    outputSchema: z.object({ outcome: z.string() }),
    uses: [defineCapability({ name: "usage-run-write", resources: { [HARNESS_USAGE]: harnessUsageCollection } })],
    execute: async (input, ctx: BlockContext) => ({ outcome: await recordHarnessUsage(ctx, input.report as HarnessUsageReport) }),
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
      runWrite: { block: runWrite },
      raw: { block: raw },
    },
  } as never)({ id: "usage-flow" } as never);
  const state = createFlowState({ flows: { "usage-flow": flow }, stores: { test: { primary: inMemoryStores() } }, defaultProfile: "test" } as never);
  const act = async (actionName: string, input: unknown, userId = "alice", orgId = "org_1"): Promise<any> => {
    const rt = (await (state as any).getRuntime()) as { stores: unknown; runtimeConfig: object };
    const result = (await runAction({
      flow,
      actionName,
      input,
      userId,
      orgId,
      sessionId: `s_${userId}_${Math.random().toString(36).slice(2)}`,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { output?: unknown; error?: unknown };
    if (result.error !== undefined) throw new Error(JSON.stringify(result.error));
    return result.output;
  };
  const usage = async (refresh: boolean, userId?: string, orgId?: string): Promise<HarnessUsageRow[]> =>
    ((await act("harnessUsage", refresh ? { refresh: true } : {}, userId, orgId)) as { harnesses: HarnessUsageRow[] }).harnesses;
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

  it("keeps one person's racing refreshes in two organizations apart: each organization's row is read", async () => {
    const codex = scripted([SIGNED_IN]);
    const { usage } = lab({ codex: codex.reader });
    const [first, second] = await Promise.all([usage(true, "alice", "org_1"), usage(true, "alice", "org_2")]);
    expect(codex.calls()).toBe(2);
    for (const rows of [first, second]) expect(rows[0]).toMatchObject({ status: "windows", refreshError: null });
  });

  it("stores no window outside 0 to 100: a reader that sends one reads as unavailable", async () => {
    const bad = scripted([{ ...SIGNED_IN, windows: [{ ...SIGNED_IN.windows[0]!, usedPercent: 140 }] }]);
    const { usage } = lab({ codex: bad.reader });
    const rows = await usage(true);
    expect(rows[0]).toMatchObject({ status: "unavailable", reason: "Codex sent a reading that isn't one", windows: [] });
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

/** A `five_hour` window as Claude Code reports it during a run. */
function runReport(overrides: Partial<HarnessUsageReport> & { usedPercent?: number | null; level?: "ok" | "warning" | "reached" } = {}): HarnessUsageReport {
  const { usedPercent = null, level = "ok", ...rest } = overrides;
  return {
    harness: "claude-code",
    window: { id: "five_hour", label: null, minutes: 300, usedPercent, level, resetsAt: NOW + 3_600_000 },
    observedAt: NOW,
    runStartedAt: NOW - 1_000,
    accountId: "alice@example.com",
    ...rest,
  };
}

const EMPTY: HarnessUsageState = harnessUsageStateSchema.parse({});

/** Apply a merge's result as the writer does. */
function after(stored: HarnessUsageState, merged: { state: Partial<HarnessUsageState> }): HarnessUsageState {
  return harnessUsageStateSchema.parse({ ...stored, ...merged.state });
}

describe("recordHarnessUsage — a run's one window", () => {
  it("writes the run owner's row only, through the same collection the query reads", async () => {
    const { act, usage } = lab({});
    expect(await act("runWrite", { report: runReport({ usedPercent: 91, level: "warning" }) }, "alice")).toEqual({ outcome: "recorded" });
    const [alice] = await usage(false, "alice");
    expect(alice).toMatchObject({ harness: "claude-code", status: "windows", checkedAt: null });
    expect(alice!.windows.map((w) => [w.id, w.usedPercent, w.level, w.origin])).toEqual([["five_hour", 91, "warning", "run"]]);
    expect(await usage(false, "bob")).toEqual([]);
  });

  it("parses a row stored before level and accountAt existed", () => {
    const legacy = harnessUsageStateSchema.parse({
      status: "windows",
      account: "abc",
      windows: [{ id: "codex:primary", label: null, minutes: 300, usedPercent: 42, resetsAt: null, checkedAt: 1, origin: "read" }],
      checkedAt: 1,
    });
    expect(legacy.accountAt).toBe(0);
    expect(legacy.windows[0]!.level).toBeNull();
  });
});

describe("applyRunWindow", () => {
  it("upserts one window by id and keeps the others, leaving the record's clock and plan", () => {
    const stored = after(EMPTY, applyReading(EMPTY, { status: "windows", accountId: "alice@example.com", plan: "max", windows: [] }, NOW - 5_000));
    const withWeek = after(stored, applyRunWindow(stored, runReport({ window: { id: "seven_day", label: null, minutes: 10_080, usedPercent: null, level: "ok", resetsAt: null } })));
    const both = after(withWeek, applyRunWindow(withWeek, runReport({ observedAt: NOW + 1 })));
    expect(both.windows.map((w) => w.id).sort()).toEqual(["five_hour", "seven_day"]);
    expect(both).toMatchObject({ checkedAt: NOW - 5_000, plan: "max" });
  });

  it("refuses an event older than the stored window", () => {
    const stored = after(EMPTY, applyRunWindow(EMPTY, runReport({ usedPercent: 91, level: "warning", observedAt: NOW })));
    expect(applyRunWindow(stored, runReport({ observedAt: NOW - 1 })).result).toBe("refused-older");
  });

  it("doesn't let a run that started before a look found an API key bring windows back", () => {
    const keyed = after(EMPTY, applyReading(EMPTY, { status: "api-key", reason: "key" }, NOW));
    expect(applyRunWindow(keyed, runReport({ runStartedAt: NOW - 1, observedAt: NOW + 10 })).result).toBe("refused-older");
    expect(applyRunWindow(keyed, runReport({ runStartedAt: NOW + 1, observedAt: NOW + 10 })).result).toBe("recorded");
  });

  it("lets a run that was already going fill a record a failed look left unavailable", () => {
    // A failed look learned nothing about the sign-in, unlike one that found an API key.
    const failed = after(EMPTY, applyReading(EMPTY, { status: "unavailable", reason: "no answer" }, NOW));
    const recovered = applyRunWindow(failed, runReport({ runStartedAt: NOW - 1, observedAt: NOW + 10 }));
    expect(recovered.result).toBe("recorded");
    expect(after(failed, recovered)).toMatchObject({ status: "windows" });
  });

  it("takes a named run's window observed before a failed look that landed first", () => {
    // The run's account lookup can take seconds, so its event may land after a later look.
    const failed = after(EMPTY, applyReading(EMPTY, { status: "unavailable", reason: "no answer" }, NOW));
    const late = applyRunWindow(failed, runReport({ accountId: "a@example.com", runStartedAt: NOW - 100, observedAt: NOW - 50 }));
    expect(late.result).toBe("recorded");
  });

  it("keeps holding back a run from before a sign-out after a newer run fills the record", () => {
    const out = after(EMPTY, applyReading(EMPTY, { status: "signed-out", reason: "no sign-in" }, NOW));
    const fresh = after(out, applyRunWindow(out, runReport({ accountId: "b@example.com", runStartedAt: NOW + 100, observedAt: NOW + 200 })));
    const stale = applyRunWindow(fresh, runReport({ accountId: "a@example.com", runStartedAt: NOW - 100, observedAt: NOW + 300 }));
    expect(stale.result).toBe("refused-older");
    expect(fresh.windows).toHaveLength(1);
  });

  it("rebinds to a new account whole: the old account's windows and plan go", () => {
    const a = after(EMPTY, applyReading(EMPTY, { status: "windows", accountId: "a@example.com", plan: "max", windows: [] }, NOW - 10_000));
    const aRun = after(a, applyRunWindow(a, runReport({ accountId: "a@example.com", window: { id: "seven_day", label: null, minutes: 10_080, usedPercent: 80, level: "warning", resetsAt: null }, observedAt: NOW - 5_000 })));
    const b = after(aRun, applyRunWindow(aRun, runReport({ accountId: "b@example.com", observedAt: NOW })));
    expect(b.windows.map((w) => w.id)).toEqual(["five_hour"]);
    expect(b).toMatchObject({ plan: null, accountAt: NOW });
    // Account A's event, retried after B's, is refused whole.
    expect(applyRunWindow(b, runReport({ accountId: "a@example.com", observedAt: NOW - 1 })).result).toBe("refused-older");
  });

  it("treats a move between no account and a named one, either way, as a rebind", () => {
    const seven = { id: "seven_day", label: null, minutes: 10_080, usedPercent: null, level: "ok" as const, resetsAt: null };
    const anon = after(EMPTY, applyRunWindow(EMPTY, runReport({ accountId: null, window: seven })));
    const named = after(anon, applyRunWindow(anon, runReport({ accountId: "b@example.com", observedAt: NOW + 1 })));
    expect(named.windows.map((w) => w.id)).toEqual(["five_hour"]);
    const tokenOnly = after(named, applyRunWindow(named, runReport({ accountId: null, observedAt: NOW + 2, window: seven })));
    expect(tokenOnly.account).toBeNull();
    expect(tokenOnly.windows.map((w) => w.id)).toEqual(["seven_day"]);
  });

  it("refuses a late event from another account once the stored one is confirmed after it (A, B late, A)", () => {
    const a = after(EMPTY, applyRunWindow(EMPTY, runReport({ accountId: "a@example.com", observedAt: NOW })));
    // A look confirms A at NOW + 2; B's event, observed at NOW + 1, lands after it.
    const confirmed = after(a, applyReading(a, { status: "windows", accountId: "a@example.com", plan: "max", windows: [] }, NOW + 2));
    expect(confirmed.accountAt).toBe(NOW + 2);
    expect(applyRunWindow(confirmed, runReport({ accountId: "b@example.com", observedAt: NOW + 1 })).result).toBe("refused-older");
  });
});

describe("applyReading over run windows", () => {
  const stored = after(EMPTY, applyRunWindow(EMPTY, runReport({ usedPercent: 91, level: "warning" })));

  it("keeps a run's window on the same account and adds the plan", () => {
    const read = after(stored, applyReading(stored, { status: "windows", accountId: "alice@example.com", plan: "max", windows: [] }, NOW + 1_000));
    expect(read.plan).toBe("max");
    expect(read.windows.map((w) => [w.id, w.usedPercent, w.origin])).toEqual([["five_hour", 91, "run"]]);
  });

  it("keeps the newer of a run window and a read window on a shared id", () => {
    const window = { id: "five_hour", label: null, minutes: 300, usedPercent: 50, level: null, resetsAt: null };
    const older = applyReading(stored, { status: "windows", accountId: "alice@example.com", plan: "max", windows: [window] }, NOW - 1);
    // The record had no clock, so the reading is taken, but the run's newer window stays.
    expect(after(stored, older).windows.map((w) => [w.usedPercent, w.origin])).toEqual([[91, "run"]]);
  });

  it("clears a run's windows on a look from a token-only sign-in after a named one", () => {
    const named = after(EMPTY, applyRunWindow(EMPTY, runReport({ usedPercent: 91, level: "warning" })));
    const read = after(named, applyReading(named, { status: "windows", accountId: null, plan: null, windows: [] }, NOW + 1));
    expect(read.windows).toEqual([]);
    expect(read.account).toBeNull();
  });

  it("refuses a no-number look observed before a run's window it would clear", () => {
    // The look saw an API key at NOW - 1; a run that started after it wrote at NOW; the look lands last.
    expect(applyReading(stored, { status: "api-key", reason: "key" }, NOW - 1).result).toBe("refused-older");
  });

  it("keeps a run's window when the first look fails, with the failure beside it", () => {
    // No look has landed yet, so the record has no clock: the run's window is still what is known.
    const merged = applyReading(stored, { status: "unavailable", reason: "Claude Code did not answer" }, NOW + 1);
    expect(merged.result).toBe("kept-stored");
    const kept = after(stored, merged);
    expect(kept.windows.map((w) => [w.usedPercent, w.origin])).toEqual([[91, "run"]]);
    expect(kept.refreshError).toBe("Claude Code did not answer");
  });

  it("clears every window on a move to an API key or another account", () => {
    expect(after(stored, applyReading(stored, { status: "api-key", reason: "key" }, NOW + 1)).windows).toEqual([]);
    const b = after(stored, applyReading(stored, { status: "windows", accountId: "b@example.com", plan: "pro", windows: [] }, NOW + 1));
    expect(b.windows).toEqual([]);
  });
});

