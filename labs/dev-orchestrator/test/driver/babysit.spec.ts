/**
 * Driver integration tests. The babysit loop runs against the real durable
 * runtime (in-memory stores + checkpoint provider) with every external
 * dependency faked: the Linear board is a mutable in-memory state advanced on
 * each poll-sleep (simulating the dispatched skill / the human moving the
 * board), the `claude` resolver is a spy, and GitHub is unused by the spec
 * stage. These exercise the full dispatch → park → poll → resume → gate →
 * transition cycle and restart idempotency end to end.
 */
import { describe, expect, it, vi } from "vitest";
import { createInMemoryStores, createCheckpointDurabilityProvider } from "@flow-state-dev/server";
import type { ResolveClaudeCli } from "@flow-state-dev/claude-code/cli";
import { babysit } from "../../src/driver/babysit";
import { buildDevOrchestratorFlow } from "../../src/flow/flow";
import type { HumanGate } from "../../src/driver/human-gate";
import { LinearStatusClient, type LinearTransport } from "../../src/signals/linear";
import { GitHubSignalClient, type GhExec } from "../../src/signals/github";

function durableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  return { stores, provider };
}

/** Mutable Linear board with recorded comments and a settable state. */
function mutableBoard(initial: string) {
  let state = initial;
  const comments: string[] = [];
  const transport: LinearTransport = {
    getIssueState: async () => state,
    setIssueState: async (_id, s) => {
      state = s;
    },
    comment: async (_id, body) => {
      comments.push(body);
    },
  };
  return {
    client: new LinearStatusClient(transport),
    comments,
    set: (s: string) => {
      state = s;
    },
    get: () => state,
  };
}

const unusedGithub = new GitHubSignalClient((async () => ({ stdout: "[]", stderr: "", code: 0 })) as GhExec);

function spyResolveClaudeCli() {
  const exec = vi.fn(async () => ({
    stdout: "Dispatched: https://claude.ai/code/session_test",
    stderr: "",
    code: 0,
  }));
  const resolve: ResolveClaudeCli = () => ({ bin: "claude", exec });
  return { resolve, exec };
}

describe("babysit — full spec cycle", () => {
  it("dispatches, parks, resumes on board advance, gates on approval, then stops at the implement boundary", async () => {
    const board = mutableBoard("Ready to Spec");
    const claude = spyResolveClaudeCli();
    const flow = buildDevOrchestratorFlow({
      linear: board.client,
      repoRoot: "/repo",
      resolveClaudeCli: claude.resolve,
    });
    const { stores, provider } = durableStores();

    // Each poll-sleep advances the board one step: the create-spec skill moves
    // it to In Spec Review, then the human approves to Spec Approved.
    const advances = ["In Spec Review", "Spec Approved"];
    const sleep = vi.fn(async () => {
      const next = advances.shift();
      if (next !== undefined) board.set(next);
    });

    const result = await babysit({
      issueId: "FIX-1",
      flow,
      stores,
      provider,
      linear: board.client,
      github: unusedGithub,
      sleep,
      now: () => 1_000,
      maxTicks: 20,
    });

    expect(claude.exec).toHaveBeenCalledTimes(1);
    expect(result.stagesCompleted).toBe(1);
    expect(result.finalState).toBe("Spec Approved");
    // Stops gracefully at the implement boundary (not built in this slice).
    expect(result.reason).toContain("implement");
    expect(board.comments.some((c) => c.includes("Spec approved"))).toBe(true);
  });

  it("escalates (comment + stop) when the agent watchdog elapses with no board advance", async () => {
    const board = mutableBoard("Ready to Spec"); // never advances
    const claude = spyResolveClaudeCli();
    const flow = buildDevOrchestratorFlow({
      linear: board.client,
      repoRoot: "/repo",
      resolveClaudeCli: claude.resolve,
    });
    const { stores, provider } = durableStores();

    // The suspension's createdAt is real wall-clock; report a clock already an
    // hour past it so the 30-minute agent watchdog trips on the first poll.
    const result = await babysit({
      issueId: "FIX-2",
      flow,
      stores,
      provider,
      linear: board.client,
      github: unusedGithub,
      sleep: vi.fn(async () => {}),
      now: () => Date.now() + 61 * 60_000,
      agentWatchdogMs: 30 * 60_000,
      maxTicks: 10,
    });

    expect(result.reason).toContain("watchdog");
    expect(board.comments.some((c) => c.includes("timed out"))).toBe(true);
  });
});

describe("babysit — gate rejection stops instead of re-parking", () => {
  it("stops with a rejection reason when the human sends the spec back", async () => {
    const board = mutableBoard("Ready to Spec");
    const claude = spyResolveClaudeCli();
    const flow = buildDevOrchestratorFlow({
      linear: board.client,
      repoRoot: "/repo",
      resolveClaudeCli: claude.resolve,
    });
    const { stores, provider } = durableStores();

    // Advance to In Spec Review (spec authored), then the human rejects by
    // moving the board back to In Spec Dev.
    const advances = ["In Spec Review", "In Spec Dev"];
    const sleep = vi.fn(async () => {
      const next = advances.shift();
      if (next !== undefined) board.set(next);
    });

    const result = await babysit({
      issueId: "FIX-9",
      flow,
      stores,
      provider,
      linear: board.client,
      github: unusedGithub,
      sleep,
      now: () => 1_000,
      maxTicks: 20,
    });

    expect(result.reason).toBe("rejected at gate");
    expect(board.comments.some((c) => c.includes("Spec rejected"))).toBe(true);
    // It did not spin: the loop terminated well under the tick budget.
    expect(result.ticks).toBeLessThan(20);
  });
});

describe("babysit — attended approval advances the board", () => {
  it("records an out-of-band (stdin-style) approval on the board so the stage isn't re-run", async () => {
    const board = mutableBoard("Ready to Spec");
    const claude = spyResolveClaudeCli();
    const flow = buildDevOrchestratorFlow({
      linear: board.client,
      repoRoot: "/repo",
      resolveClaudeCli: claude.resolve,
    });
    const { stores, provider } = durableStores();

    // The spec is authored (board → In Spec Review), then the human approves via
    // the gate WITHOUT moving the board — the --attended/stdin case.
    const advances = ["In Spec Review"];
    const sleep = vi.fn(async () => {
      const next = advances.shift();
      if (next !== undefined) board.set(next);
    });
    const stdinApproval: HumanGate = {
      poll: async () => ({ ready: true, reject: false, note: "approved at stdin", timedOut: false }),
    };

    const result = await babysit({
      issueId: "FIX-11",
      flow,
      stores,
      provider,
      linear: board.client,
      github: unusedGithub,
      humanGate: stdinApproval,
      sleep,
      now: () => 1_000,
      maxTicks: 20,
    });

    // The board was advanced to Spec Approved (recording the approval), and the
    // driver stopped at the implement boundary instead of re-parking forever.
    expect(board.get()).toBe("Spec Approved");
    expect(result.reason).toContain("implement");
  });
});

describe("babysit — error boundary", () => {
  it("survives transient I/O failures and escalates after the consecutive-error cap", async () => {
    let calls = 0;
    const client = new LinearStatusClient({
      getIssueState: async () => {
        calls += 1;
        throw new Error("transient Linear 500");
      },
      setIssueState: async () => {},
      comment: async () => {},
    });
    const flow = buildDevOrchestratorFlow({ linear: client, repoRoot: "/repo" });
    const { stores, provider } = durableStores();

    const result = await babysit({
      issueId: "FIX-10",
      flow,
      stores,
      provider,
      linear: client,
      github: unusedGithub,
      sleep: vi.fn(async () => {}),
      maxConsecutiveErrors: 3,
      maxTicks: 50,
    });

    // The loop did not crash; it retried and then escalated at the cap.
    expect(result.reason).toBe("repeated errors");
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

describe("babysit — restart idempotency", () => {
  it("does not re-dispatch across an interrupt-and-rerun (dispatch replays from checkpoint)", async () => {
    const board = mutableBoard("Ready to Spec");
    const claude = spyResolveClaudeCli();
    const flow = buildDevOrchestratorFlow({
      linear: board.client,
      repoRoot: "/repo",
      resolveClaudeCli: claude.resolve,
    });
    const { stores, provider } = durableStores();

    // First process: stop right after the dispatch + initial park.
    const first = await babysit({
      issueId: "FIX-3",
      flow,
      stores,
      provider,
      linear: board.client,
      github: unusedGithub,
      sleep: vi.fn(async () => {}),
      now: () => 1_000,
      maxTicks: 1,
    });
    expect(claude.exec).toHaveBeenCalledTimes(1);
    expect(first.stagesCompleted).toBe(0);

    // Second process: same stores/provider/flow. The board advances to drive the
    // run to completion; the dispatch step must NOT run again.
    const advances = ["In Spec Review", "Spec Approved"];
    const second = await babysit({
      issueId: "FIX-3",
      flow,
      stores,
      provider,
      linear: board.client,
      github: unusedGithub,
      sleep: vi.fn(async () => {
        const next = advances.shift();
        if (next !== undefined) board.set(next);
      }),
      now: () => 2_000,
      maxTicks: 20,
    });

    expect(claude.exec).toHaveBeenCalledTimes(1); // still once, across both runs
    expect(second.stagesCompleted).toBe(1);
    expect(second.finalState).toBe("Spec Approved");
  });
});
