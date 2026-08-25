/**
 * The cross-layer path, deterministically.
 *
 * A real runtime, a real detached dispatch into a child session, the real claim
 * gate, the real `user`-scoped board and its fenced settlement — with the SDK
 * `query` and the done-condition stubbed so a verdict can be staged.
 *
 * **Every assertion is on the BOARD ROW, read through `status`.** A declined
 * settlement is silent (`recordSuccess` writes `ifAllowed: true`), so the run
 * record and the request both read as success over an open row; a check that
 * trusted either would certify nothing.
 */
import { describe, expect, it, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireCheckout } from "../src/workspace";
import {
  createConductorHarness,
  hangingAgent,
  scriptedAgent,
  sdkResult,
  throwingAgent,
  type ConductorHarness,
} from "./harness";

type StatusRow = {
  taskId: string;
  issue: string | null;
  phase: string | null;
  status: string;
  attempts: number;
  feedback: string | null;
  /** The whole run row, as `status` returns it. */
  run: {
    attempt: number | null;
    taskId: string | null;
    outcome: string | null;
    reason: string | null;
    sessionId: string | null;
    finalMessage: string | null;
    workspacePath: string | null;
    branch: string | null;
    usage: { inputTokens: number; outputTokens: number } | null;
    costUsd: number | null;
    childSessionId: string | null;
    requestId: string | null;
    updatedAt: number | null;
  } | null;
};

const ISSUE = "FIX-1219";
const PHASE = "implement";
/** The harness's default epic, so the ledger can be addressed by accessor key. */
const COLLECTION_ID = "conductor-tasks-harness-manager";

let live: ConductorHarness | undefined;
afterEach(() => {
  live?.dispose();
  live = undefined;
});

async function readStatus(h: ConductorHarness): Promise<StatusRow> {
  const { rows } = await h.call<{ rows: StatusRow[] }>("status", { issue: ISSUE });
  return rows[0];
}

/**
 * Wait for the claimed attempt to stop running.
 *
 * The drain hands the row to a workstream and returns with it still open —
 * the seeding request deliberately does not wait for the run. So the assertion
 * point is when the row leaves `in_progress`, which is where the board's own
 * fenced settlement has landed.
 */
async function settle(h: ConductorHarness, timeoutMs = 10_000): Promise<StatusRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await readStatus(h);
    if (row !== undefined && row.status !== "in_progress") return row;
    if (Date.now() >= deadline) {
      throw new Error(
        `the row never left in_progress within ${timeoutMs}ms — last seen ` +
          `${JSON.stringify(row)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Seed one issue-phase, drain, and wait for the attempt to settle. */
async function seedAndDrain(h: ConductorHarness): Promise<StatusRow> {
  await h.call("seed", { issue: ISSUE, phase: PHASE });
  return settle(h);
}

/**
 * Seed and drain, tolerating a row that never leaves `in_progress`.
 *
 * Used only where the point IS that settlement was declined: the row keeps
 * whatever status the out-of-band write left on it, so `settle` would spend its
 * whole timeout deciding that nothing happened.
 */
async function settleOrGiveUp(h: ConductorHarness): Promise<StatusRow> {
  await h.call("seed", { issue: ISSUE, phase: PHASE });
  const deadline = Date.now() + 5_000;
  for (;;) {
    const row = await readStatus(h);
    if (row?.status === "cancelled") return row;
    if (Date.now() >= deadline) return row;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Drain again — claiming whatever is ready, including a re-pended retry. */
async function wakeAndSettle(h: ConductorHarness): Promise<StatusRow> {
  await h.call("wake", {});
  return settle(h);
}

describe("the manager — the verdict at each exit", () => {
  it("completes the row when the run succeeded AND the job is done", async () => {
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => true,
    });

    const row = await seedAndDrain(live);

    expect(row.status).toBe("completed");
    expect(row.run?.outcome).toBe("succeeded");
    expect(row.run?.sessionId).toBe("sess_stub");
    expect(row.run?.costUsd).toBe(0.02);
    // The run was given a checkout that is not the server's directory, and the
    // row records the one it was given.
    expect(seen.cwds[0]).toBe(row.run?.workspacePath);
    expect(row.run?.workspacePath).toContain(`${ISSUE}--${PHASE}`);
    expect(row.run?.branch).toBe(`conductor/${ISSUE}-${PHASE}`);
  });

  it("re-pends the row with the reason when the run REPORTED failure", async () => {
    // The whole premise: a run that exhausts its turn budget does not throw. It
    // finishes normally and reports the bad news inside its result.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("error_max_turns")], seen),
      isDone: () => true,
    });

    const row = await seedAndDrain(live);

    expect(row.status).toBe("pending");
    expect(row.feedback).toContain("error_max_turns");
    expect(row.run?.outcome).toBe("failed");
    expect(row.run?.reason).toContain("error_max_turns");
  });

  it("does NOT complete a run that opened the PR and THEN reported failure", async () => {
    // Half the conjunction. A done-condition consulted alone would complete
    // this row — decision 1's own pathology re-entering through the gate meant
    // to close it. A suite that only varies the done-condition passes with the
    // bug in place, so both arms are staged.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("error_max_budget_usd")], seen),
      isDone: () => true,
    });

    const row = await seedAndDrain(live);

    expect(row.status).not.toBe("completed");
    expect(row.run?.outcome).toBe("failed");
  });

  it("does NOT complete a run that finished cleanly and did not do the job", async () => {
    // The other arm. A clean finish that left no pull request is a failed
    // attempt, not a success with a caveat.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => false,
    });

    const row = await seedAndDrain(live);

    expect(row.status).not.toBe("completed");
    expect(row.run?.outcome).toBe("failed");
    expect(row.run?.reason).toContain("still not done");
  });

  it("fails the attempt on a throw, from the throw's message alone", async () => {
    // On a thrown exit the block wraps and rethrows BEFORE any handle exists,
    // so there is no session id and no terminal text on this path.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: throwingAgent("the transport died", seen),
      isDone: () => true,
    });

    const row = await seedAndDrain(live);

    expect(row.status).toBe("pending");
    expect(row.run?.outcome).toBe("failed");
    expect(row.run?.reason).toContain("the transport died");
  });

  it("settles errored once the retry budget is spent", async () => {
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("error_max_turns")], seen),
      isDone: () => true,
      maxAttempts: 2,
    });

    await seedAndDrain(live);
    const row = await wakeAndSettle(live);

    expect(row.status).toBe("errored");
    expect(row.run?.outcome).toBe("failed");
  });
});

describe("the manager — what carries across an attempt", () => {
  it("tells attempt 2 why attempt 1 stopped, off the board's own feedback", async () => {
    // Asserted on the PROMPT the harness received, not on the run row — the row
    // keeps only the last outcome and is overwritten when attempt 2 opens, so it
    // is not the carrier.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    let call = 0;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent(() => {
        call += 1;
        return [sdkResult(call === 1 ? "error_max_turns" : "success")];
      }, seen),
      isDone: () => true,
      maxAttempts: 3,
    });

    await seedAndDrain(live);
    const settled = await wakeAndSettle(live);

    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts[0]).not.toContain("error_max_turns");
    expect(seen.prompts[1]).toContain("error_max_turns");
    expect(settled.status).toBe("completed");
  });

  it("gives attempt 2 the checkout attempt 1 left, uncommitted work included", async () => {
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    let call = 0;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent(() => {
        call += 1;
        // Attempt 1 leaves an uncommitted file behind, exactly as a real run
        // that ran out of turns would.
        if (call === 1) {
          writeFileSync(join(seen.cwds[0] as string, "in-progress.txt"), "half done");
        }
        return [sdkResult(call === 1 ? "error_max_turns" : "success")];
      }, seen),
      isDone: () => true,
      maxAttempts: 3,
    });

    await seedAndDrain(live);
    await wakeAndSettle(live);

    expect(seen.cwds[1]).toBe(seen.cwds[0]);
    // Asserted on the WORK still being there, not on a call count: the point is
    // that nothing reset, forced, or discarded it.
    const carried = join(seen.cwds[1] as string, "in-progress.txt");
    expect(existsSync(carried)).toBe(true);
    expect(readFileSync(carried, "utf8")).toBe("half done");
  });

  it("a thrown retry does not inherit the previous attempt's metadata", async () => {
    // `upsert` patch-merges, so an attempt that writes only what it can report
    // leaves the LAST attempt's session id and cost sitting beside its own
    // outcome. A thrown attempt has none of its own, so the stale one would be
    // shown precisely when it is most misleading. A suite exercising two
    // SUCCESSFUL attempts passes with this bug in place — the second write
    // supplies the fields the first one did.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    let call = 0;
    const agent = (): ReturnType<typeof scriptedAgent> =>
      ((ctx: unknown) => {
        call += 1;
        return call === 1
          ? scriptedAgent([sdkResult("error_max_turns")], seen)(ctx as never)
          : throwingAgent("the transport died", seen)(ctx as never);
      }) as ReturnType<typeof scriptedAgent>;

    live = createConductorHarness({
      resolveClaudeAgent: agent(),
      isDone: () => true,
      maxAttempts: 3,
    });

    await seedAndDrain(live);
    const afterFirst = await readStatus(live);
    // All four of the verdict's optional fields, populated.
    expect(afterFirst.run?.sessionId).toBe("sess_stub");
    expect(afterFirst.run?.finalMessage).not.toBeNull();
    expect(afterFirst.run?.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(afterFirst.run?.costUsd).toBe(0.02);

    const afterThrow = await wakeAndSettle(live);

    expect(afterThrow.run?.outcome).toBe("failed");
    expect(afterThrow.run?.reason).toContain("the transport died");
    // And all four cleared. **Four, not three**: a test that checked the session
    // id, the terminal text and the cost would pass while `usage` still carried
    // attempt 1's numbers, which is the same silent half-truth the clearing rule
    // exists to prevent — just on the field nobody enumerated.
    expect(afterThrow.run?.sessionId).toBeNull();
    expect(afterThrow.run?.finalMessage).toBeNull();
    expect(afterThrow.run?.usage).toBeNull();
    expect(afterThrow.run?.costUsd).toBeNull();
  });
});

describe("the manager — the deadline", () => {
  it("aborts the run and re-pends the row when the wall clock runs out", async () => {
    // The fourth exit, and the one a three-exit suite quietly omits. The
    // manager composes the harness step with an abort signal, which core
    // composes into the block's own signal and the SDK path forwards into the
    // query's abort controller — so this asserts the whole chain, not just that
    // a timeout value was passed somewhere.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: hangingAgent(seen),
      isDone: () => true,
      maxAttempts: 3,
      runTimeoutMs: 150,
    });

    const row = await seedAndDrain(live);

    expect(row.status).toBe("pending");
    expect(row.run?.outcome).toBe("failed");
    expect(row.run?.reason).toMatch(/abort/i);
    // Nothing was reported, so nothing is claimed.
    expect(row.run?.sessionId).toBeNull();
    expect(row.run?.usage).toBeNull();
    expect(row.run?.costUsd).toBeNull();
  });
});

describe("the manager — contention, and what it must not cost", () => {
  it("waits out a held checkout without spending a retry", async () => {
    // The second half of obligation B, and the half a test asserting only
    // exclusivity would miss. Every throw out of this worker reaches the
    // board's fenced failure recorder and spends one attempt — so a reclaimed
    // attempt that merely REFUSED a held tree would be charged for the
    // displaced attempt's lease lag, and overlapping wakes could exhaust the
    // budget before the old run noticed it had lost its claim.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => true,
      ownership: { waitMs: 5_000, pollMs: 20, staleAfterMs: 60_000 },
    });

    const checkout = join(live.workspaceRoot, `${ISSUE}--${PHASE}`);
    const held = await acquireCheckout(checkout, "a displaced attempt", {
      waitMs: 1_000,
      pollMs: 20,
      staleAfterMs: 60_000,
    });
    setTimeout(() => held.release(), 250);

    const row = await seedAndDrain(live);

    expect(row.status).toBe("completed");
    // The whole point: ordinary contention resolved by waiting and cost
    // nothing. One claim, one attempt.
    expect(row.attempts).toBe(1);
  });
});

describe("the manager — a declined settlement is silent", () => {
  it("status reports the board row as not completed when the claim was lost", async () => {
    // `recordSuccess` writes with `ifAllowed: true`, so a `complete()` refused
    // on a lost claim is DROPPED rather than thrown: the worker returns
    // normally and the workstream request completes. Inferring completion from
    // the run record or from request status would therefore be the same
    // silent-success defect this lab exists to remove, relocated into the thing
    // that verifies it.
    //
    // The claim is lost mid-attempt by settling the row out of band, from
    // inside the done-condition — which is where a real reclaim or cancel would
    // land relative to the verdict.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: async (run) => {
        const ledger = (run.ctx as unknown as {
          resources: Record<string, { upsert(k: string, u: unknown): Promise<unknown> }>;
        }).resources[COLLECTION_ID];
        const rows = await live!.call<{ rows: StatusRow[] }>("status", { issue: ISSUE });
        await ledger.upsert(rows.rows[0].taskId, { status: "cancelled" });
        return true;
      },
    });

    const row = await settleOrGiveUp(live);

    expect(row.status).not.toBe("completed");
    // And the run record does not claim success either — the same loss that
    // declines the settlement refuses the run-row write, so there is no window
    // in which the two disagree. That is stronger than the row merely being
    // open, and it is the property `status` rests on.
    expect(row.run?.outcome).not.toBe("succeeded");
  });
});

describe("the manager — the phase surface", () => {
  it("runs a second, trivial phase with no edit to the manager", async () => {
    // A constraint check on epic theme 2, not evidence for a phase machine: a
    // manager that cannot be pointed at a different record without being edited
    // has broken it, and passing three values satisfies that literally.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    const h = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
    });
    live = h;

    // Rebuild the same lab against a different phase spec, through the public
    // option — no manager source is touched.
    const { conductorFlow } = await import("../src/flow");
    const built = conductorFlow({
      epic: "second-phase",
      workspace: { root: h.workspaceRoot, sourceRepo: h.sourceRepo, baseRef: "main" },
      phase: {
        phase: "review",
        readable: {},
        buildPrompt: () => "review it",
        isDone: () => true,
      },
      runTimeoutMs: 5_000,
    });

    expect(built.boardId).toBe("conductor-second-phase");
    // A distinct STORAGE identity, not just a distinct routing id: two epic
    // boards sharing a collection would operate on the same rows.
    expect(built.collectionId).toBe("conductor-tasks-second-phase");
    expect(built.collectionId).not.toBe(h.built.collectionId);
  });

  it("constructs a detached board — the worker declares no session state", async () => {
    // The regression is a construction-time throw, so the assertion is that the
    // board builds at all.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    expect(() =>
      createConductorHarness({
        resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      }).dispose(),
    ).not.toThrow();
  });
});

describe("the flow — seeding twice", () => {
  it("returns the existing row rather than minting a second run", async () => {
    // Two rows for one issue-phase derive the same checkout, the same branch and
    // the same run record — so a duplicated seed charges two full coding runs
    // whose independently valid claims overwrite one shared record, and `status`
    // answers with two rows carrying the last writer's metadata.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => true,
    });

    await live.call("seed", { issue: ISSUE, phase: PHASE });
    await settle(live);
    await live.call("seed", { issue: ISSUE, phase: PHASE });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Asserted on the BOARD and on the harness, never on a return value: one
    // row and one run are the properties that matter, and `status` answering
    // with two rows carrying the last writer's metadata is the observable harm.
    const { rows } = await live.call<{ rows: StatusRow[] }>("status", { issue: ISSUE });
    expect(rows).toHaveLength(1);
    expect(seen.prompts).toHaveLength(1);
  });
});

describe("the flow — how much it runs at once", () => {
  it("does NOT bound simultaneous coding runs, and that is measured not assumed", async () => {
    // A characterization test, pinning a surprising truth so nobody re-assumes
    // the comfortable one.
    //
    // The board's `concurrency` is now 1 rather than the substrate's default of
    // 4 — worth setting, because it bounds how many rows one drain hands off at
    // a time. But it does NOT bound how many coding runs are alive: a detached
    // dispatch hands off and returns, releasing the drain's slot long before the
    // run it started finishes. Two seeded issues therefore produce two live runs
    // whatever `concurrency` is.
    //
    // So "one issue at a time" is a property of how you seed, not something the
    // board enforces, and the README says exactly that. If a future change makes
    // the board gate detached runs, this test goes red and the README needs
    // rewriting with it — which is the point of pinning it.
    let running = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    live = createConductorHarness({
      resolveClaudeAgent: () => ({
        query: async function* () {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise<void>((r) => release.push(r));
          running -= 1;
          yield sdkResult("success") as never;
        },
      }),
      isDone: () => true,
    });

    await live.call("seed", { issue: "FIX-1001", phase: PHASE });
    await live.call("seed", { issue: "FIX-1002", phase: PHASE });
    await live.call("wake", {});
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(peak).toBe(2);
    for (const done of release) done();
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
});

describe("the manager — the stale window is refused at construction", () => {
  it("refuses a stale window inside the run's own deadline", () => {
    // A stale window shorter than the deadline means a live attempt's lock ages
    // past "stale" while it is still working, so a replacement clears it and two
    // agents mutate one checkout — obligation B violated by configuration.
    // There is no runtime moment at which that announces itself, so it is
    // refused where it can still be seen.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    expect(() =>
      createConductorHarness({
        resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
        runTimeoutMs: 60_000,
        ownership: { staleAfterMs: 30_000 },
      }),
    ).toThrow(/must exceed/);
  });

  it("accepts a stale window past the deadline", () => {
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    const h = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      runTimeoutMs: 30_000,
      ownership: { staleAfterMs: 90_000 },
    });
    h.dispose();
  });
});

describe("the flow — one board, one phase", () => {
  it("refuses to file a row for a phase this board does not run", async () => {
    // Without this the caller's phase names the checkout, the branch and the run
    // record while the CONFIGURED phase supplies the prompt and the
    // done-condition — so a `review` row would be handed implement's
    // instructions, judged by implement's completion check, and settled as a
    // completed review.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => true,
    });

    // The action's error is wrapped by `runAction`, so the assertion is on the
    // message surviving into the envelope rather than on the envelope's shape.
    await expect(live.call("seed", { issue: ISSUE, phase: "review" })).rejects.toThrow(
      /review/,
    );

    // Nothing was filed and nothing ran.
    const { rows } = await live.call<{ rows: StatusRow[] }>("status", {});
    expect(rows).toHaveLength(0);
    expect(seen.prompts).toHaveLength(0);
  });

  it("refuses to RUN a row whose phase changed under it", async () => {
    // The seed guard is the friendly one; this is the load-bearing one. A task
    // can reach this board by any route that can write a row, so the manager
    // checks too — and this stages that by rewriting the filed row's payload
    // out of band, from inside the done-condition, exactly where a row that
    // "arrived another way" is indistinguishable from one that was edited.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      maxAttempts: 3,
      isDone: async (run) => {
        const ledger = (
          run.ctx as unknown as {
            resources: Record<
              string,
              {
                getOptional(k: string): Promise<{ state: unknown } | undefined>;
                upsert(k: string, u: unknown): Promise<unknown>;
              }
            >;
          }
        ).resources[COLLECTION_ID];
        const taskId = `${ISSUE}--${PHASE}`;
        const row = (await ledger.getOptional(taskId))?.state as { input?: unknown };
        await ledger.upsert(taskId, {
          ...row,
          input: { issue: ISSUE, phase: "review" },
        });
        // Fail this attempt so the row re-pends and a second one claims it.
        return false;
      },
    });

    await seedAndDrain(live);
    expect(seen.prompts).toHaveLength(1);

    const after = await wakeAndSettle(live);

    // The second attempt refused before building a prompt or touching the tree.
    //
    // Asserted on the board's own `feedback` — captured by `fail()` when it
    // re-pended the row — rather than on the run record. The refusal happens
    // before the row is opened, so there is deliberately no run-record identity
    // to fence a write against yet, and the board is the honest witness.
    expect(seen.prompts).toHaveLength(1);
    expect(after.feedback).toMatch(/configured for "implement"/);
  });
});

describe("the run record — readable from any coordinator session", () => {
  it("answers a status call from a session that never saw the run", async () => {
    // The shape that reproduced the bug, now asserting the fix.
    //
    // `sharedToWorkstream` gave one identity across A session's lineage, and a
    // new coordinator session is a different lineage root — so `status` from a
    // fresh session returned the board row with `run: null`, losing the failure
    // reason, the harness session, the cost and the checkout. The board said the
    // job was done and the record of what it did was absent: a silent partial
    // answer.
    //
    // Reachable through ordinary use, not just in a test — the CLI mints a fresh
    // session per invocation unless one is named, so the documented
    // seed / wake / status sequence was three lineages.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => true,
    });

    const original = await seedAndDrain(live);
    expect(original.run?.sessionId).toBe("sess_stub");

    // A genuinely different coordinator session — not a child of the first.
    const { rows } = await live.call<{ rows: StatusRow[] }>(
      "status",
      { issue: ISSUE },
      `sess_a_different_coordinator_${Date.now()}`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("completed");
    // The half that was null before: everything only this row holds.
    expect(rows[0].run).not.toBeNull();
    expect(rows[0].run?.outcome).toBe("succeeded");
    expect(rows[0].run?.sessionId).toBe("sess_stub");
    expect(rows[0].run?.costUsd).toBe(0.02);
    expect(rows[0].run?.workspacePath).toBe(original.run?.workspacePath);
    expect(rows[0].run?.branch).toBe(original.run?.branch);
  });
});
