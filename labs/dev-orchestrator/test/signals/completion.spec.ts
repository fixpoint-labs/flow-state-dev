/**
 * Tests for the composite completion predicate: Linear state advancement,
 * GitHub PR readiness (existence / draft / checks), and the wall-clock watchdog.
 * Clients are real instances over fakes so the predicate exercises the same
 * code paths the driver does.
 */
import { describe, expect, it } from "vitest";
import { evaluateCompletion, type CompletionClients } from "../../src/signals/completion";
import { LinearStatusClient, type LinearTransport } from "../../src/signals/linear";
import { GitHubSignalClient, type GhExec } from "../../src/signals/github";
import type { WatchSpec } from "../../src/types";

function clients(state: string | null, ghStdout: string, ghCode = 0): CompletionClients {
  const transport: LinearTransport = {
    getIssueState: async () => state,
    setIssueState: async () => {},
    comment: async () => {},
  };
  const exec: GhExec = async () => ({ stdout: ghStdout, stderr: "", code: ghCode });
  return {
    linear: new LinearStatusClient(transport),
    github: new GitHubSignalClient(exec),
  };
}

const linearWatch: WatchSpec = {
  kind: "linear-state",
  target: "In Spec Review",
  branch: null,
  requireChecks: false,
};

const prWatch: WatchSpec = {
  kind: "github-pr",
  target: null,
  branch: "fix/FIX-1",
  requireChecks: true,
};

const freshClock = { issueId: "FIX-1", createdAt: 1000, now: 1500, watchdogMs: 10_000 };

describe("evaluateCompletion — linear-state", () => {
  it("is ready once the board reaches the target state", async () => {
    const res = await evaluateCompletion(linearWatch, clients("In Spec Review", "[]"), freshClock);
    expect(res.ready).toBe(true);
    expect(res.signal).toMatchObject({ kind: "linear-state", observedState: "In Spec Review" });
  });

  it("is ready when the board has advanced PAST the target", async () => {
    const res = await evaluateCompletion(linearWatch, clients("Spec Approved", "[]"), freshClock);
    expect(res.ready).toBe(true);
  });

  it("is not ready while the board is still behind the target", async () => {
    const res = await evaluateCompletion(linearWatch, clients("In Spec Dev", "[]"), freshClock);
    expect(res.ready).toBe(false);
    expect(res.timedOut).toBe(false);
  });
});

describe("evaluateCompletion — github-pr", () => {
  const greenPr = JSON.stringify([
    { number: 9, isDraft: false, url: "u", statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] },
  ]);
  const draftPr = JSON.stringify([
    { number: 9, isDraft: true, url: "u", statusCheckRollup: [] },
  ]);
  const pendingPr = JSON.stringify([
    { number: 9, isDraft: false, url: "u", statusCheckRollup: [{ status: "IN_PROGRESS" }] },
  ]);

  it("is ready when a non-draft PR exists and checks are green", async () => {
    const res = await evaluateCompletion(prWatch, clients(null, greenPr), freshClock);
    expect(res.ready).toBe(true);
    expect(res.signal).toMatchObject({ kind: "github-pr" });
  });

  it("is not ready while the PR is a draft", async () => {
    const res = await evaluateCompletion(prWatch, clients(null, draftPr), freshClock);
    expect(res.ready).toBe(false);
  });

  it("is not ready while checks are pending (when checks are required)", async () => {
    const res = await evaluateCompletion(prWatch, clients(null, pendingPr), freshClock);
    expect(res.ready).toBe(false);
  });

  it("ignores checks when requireChecks is false", async () => {
    const watch: WatchSpec = { ...prWatch, requireChecks: false };
    const res = await evaluateCompletion(watch, clients(null, pendingPr), freshClock);
    expect(res.ready).toBe(true);
  });

  it("is not ready when no PR exists yet", async () => {
    const res = await evaluateCompletion(prWatch, clients(null, "[]"), freshClock);
    expect(res.ready).toBe(false);
  });
});

describe("evaluateCompletion — watchdog", () => {
  it("times out once the budget elapses with no signal", async () => {
    const expiredClock = { issueId: "FIX-1", createdAt: 0, now: 20_000, watchdogMs: 10_000 };
    const res = await evaluateCompletion(linearWatch, clients("In Spec Dev", "[]"), expiredClock);
    expect(res.ready).toBe(false);
    expect(res.timedOut).toBe(true);
  });

  it("a fresh signal wins over an elapsed clock (ready, not timedOut)", async () => {
    const expiredClock = { issueId: "FIX-1", createdAt: 0, now: 20_000, watchdogMs: 10_000 };
    const res = await evaluateCompletion(linearWatch, clients("In Spec Review", "[]"), expiredClock);
    expect(res.ready).toBe(true);
    expect(res.timedOut).toBe(false);
  });
});
