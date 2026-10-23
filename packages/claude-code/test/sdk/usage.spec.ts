/**
 * Claude Code's usage, two ways: a run's `rate_limit_event` handed to
 * `onUsage` as one window, and `readClaudeUsage` mapping the account probe.
 * The event shapes are the ones the pinned CLI builds (FIX-2142's POC): a
 * percent only on a warning, as a fraction; `resetsAt` in epoch seconds; no
 * window on an API key.
 */
import { describe, expect, it, vi } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import type { HarnessUsageReport } from "@flow-state-dev/core/types";
import { claudeCodeAgent } from "../../src/sdk/agent";
import { readClaudeUsage, usageWindowOf } from "../../src/sdk/usage";
import type { SdkMessageLike } from "../../src/sdk/types";

const RESETS = 1_800_000_000;
const ALLOWED = { status: "allowed", resetsAt: RESETS, rateLimitType: "five_hour" };
const WARNING = { status: "allowed_warning", resetsAt: RESETS, rateLimitType: "seven_day", utilization: 0.91 };
const REJECTED = { status: "rejected", resetsAt: RESETS, rateLimitType: "five_hour" };
const API_KEY = { status: "allowed" };

const RESULT_OK: SdkMessageLike = { type: "result", subtype: "success", result: "done", session_id: "sess_1" };

describe("usageWindowOf", () => {
  it("reads a plain allowed event as ok with no percent, never 0", () => {
    expect(usageWindowOf(ALLOWED)).toEqual({ id: "five_hour", label: null, minutes: 300, usedPercent: null, level: "ok", resetsAt: RESETS * 1000 });
  });

  it("scales a warning's fraction to a percent", () => {
    expect(usageWindowOf(WARNING)).toMatchObject({ id: "seven_day", minutes: 10_080, usedPercent: 91, level: "warning" });
  });

  it("reads rejected as reached, and a window it has no length for by its id", () => {
    expect(usageWindowOf(REJECTED)).toMatchObject({ level: "reached", usedPercent: null });
    expect(usageWindowOf({ status: "allowed", rateLimitType: "overage" })).toMatchObject({ id: "overage", minutes: null, resetsAt: null });
  });

  it("reports nothing for an event that names no window, or a status it doesn't know", () => {
    expect(usageWindowOf(API_KEY)).toBeNull();
    expect(usageWindowOf({ status: "throttled", rateLimitType: "five_hour" })).toBeNull();
    expect(usageWindowOf(undefined)).toBeNull();
  });

  it("drops a utilization above 1 rather than show it as thousands of percent", () => {
    expect(usageWindowOf({ ...WARNING, utilization: 91 })).toMatchObject({ usedPercent: null, level: "warning" });
  });
});

describe("claudeCodeAgent — onUsage", () => {
  /** A run that sends `events`, on a query that answers `accountInfo`. */
  function run(events: unknown[], options: { account?: () => Promise<{ email?: string }>; onUsage: (report: HarnessUsageReport) => unknown; detached?: boolean }) {
    const accountInfo = vi.fn(options.account ?? (async () => ({ email: "alice@example.com", subscriptionType: "max" })));
    const block = claudeCodeAgent({
      resolveClaudeAgent: () => ({
        query: () => {
          const iterable = (async function* () {
            yield { type: "system", subtype: "init", session_id: "sess_1" } as SdkMessageLike;
            for (const info of events) yield { type: "rate_limit_event", session_id: "sess_1", rate_limit_info: info } as SdkMessageLike;
            yield RESULT_OK;
          })();
          return Object.assign(iterable, { accountInfo });
        },
      }),
      ...(options.detached === false ? {} : { detached: true }),
      onUsage: async (report) => {
        await options.onUsage(report);
      },
    });
    return { block, accountInfo };
  }

  it("hands each window to the host with the run's account and start, asking the account once", async () => {
    const reports: HarnessUsageReport[] = [];
    const before = Date.now();
    const { block, accountInfo } = run([ALLOWED, WARNING, API_KEY], { onUsage: (r) => reports.push(r) });
    const { error } = await testBlock(block, { input: { prompt: "go" } });
    expect(error).toBeNull();
    expect(reports.map((r) => [r.harness, r.window.id, r.window.usedPercent, r.window.level, r.accountId])).toEqual([
      ["claude-code", "five_hour", null, "ok", "alice@example.com"],
      ["claude-code", "seven_day", 91, "warning", "alice@example.com"],
    ]);
    expect(reports[0]!.runStartedAt).toBeGreaterThanOrEqual(before);
    expect(reports[0]!.observedAt).toBeGreaterThanOrEqual(reports[0]!.runStartedAt);
    expect(accountInfo).toHaveBeenCalledTimes(1);
  });

  it("reports no account for a token-only sign-in", async () => {
    const reports: HarnessUsageReport[] = [];
    const { block } = run([ALLOWED], { account: async () => ({}), onUsage: (r) => reports.push(r) });
    await testBlock(block, { input: { prompt: "go" } });
    expect(reports[0]!.accountId).toBeNull();
  });

  it("drops a window whose account can't be read, rather than record it as a different account", async () => {
    // A failed lookup read as "no account" would rebind the row and clear the real account's windows.
    const reports: HarnessUsageReport[] = [];
    let asked = 0;
    const { block } = run([ALLOWED, WARNING], {
      account: async () => {
        asked += 1;
        if (asked === 1) throw new Error("not ready");
        return { email: "alice@example.com" };
      },
      onUsage: (r) => reports.push(r),
    });
    await testBlock(block, { input: { prompt: "go" } });
    expect(reports.map((r) => [r.window.level, r.accountId])).toEqual([["warning", "alice@example.com"]]);
  });

  it("finishes the run when the host's write throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { block } = run([REJECTED], {
      onUsage: () => {
        throw new Error("store down");
      },
    });
    const { output, error } = await testBlock(block, { input: { prompt: "go" } });
    expect(error).toBeNull();
    expect((output as { status: string }).status).toBe("completed");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("store down"));
    warn.mockRestore();
  });

  it("is allowed in-session, where onSession is refused", () => {
    expect(() => claudeCodeAgent({ onUsage: () => undefined })).not.toThrow();
  });
});

describe("readClaudeUsage", () => {
  const read = (found: Awaited<ReturnType<NonNullable<Parameters<typeof readClaudeUsage>[0]["probe"]>>>) =>
    readClaudeUsage({ env: {}, probe: async () => found });

  it("maps a sign-in to its account and plan, with no windows", async () => {
    expect(await read({ status: "account", email: "alice@example.com", subscriptionType: "max" })).toEqual({
      status: "windows",
      accountId: "alice@example.com",
      plan: "max",
      windows: [],
    });
    expect(await read({ status: "account", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" })).toEqual({ status: "windows", accountId: null, plan: null, windows: [] });
  });

  it("says why there is no number, with no percent", async () => {
    expect(await read({ status: "account", apiKeySource: "ANTHROPIC_API_KEY" })).toEqual({ status: "api-key", reason: "Claude Code uses an API key: no subscription limit" });
    expect(await read({ status: "none", reason: "x" })).toEqual({ status: "signed-out", reason: "Claude Code is not signed in: not available automatically" });
    expect((await read({ status: "sdk-missing", reason: "x" })).status).toBe("unavailable");
  });

  it("says unavailable, not signed out, when the probe got no answer, so the stored reading stays", async () => {
    expect(await read({ status: "none", reason: "Claude Code did not report an account within 10000 ms", unanswered: true })).toEqual({
      status: "unavailable",
      reason: "Claude Code did not report an account within 10000 ms",
    });
  });
});
