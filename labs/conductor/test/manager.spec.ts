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
import { acquireCheckout, encodeSegment } from "../src/workspace";
import {
  createConductorHarness,
  USER_ID,
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
const COLLECTION_ID = "conductor-tasks--t0--harness-manager";

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
    // Principal- and epic-namespaced: two users, or two epics, never share a ref.
    expect(row.run?.branch).toBe(
      `conductor/t0/${encodeSegment(USER_ID)}/${COLLECTION_ID}/${ISSUE}--${PHASE}`,
    );
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
      // Every bound is explicit here because the ordering IS the subject:
      // the waiter must outlast the 250ms hold without ever becoming eligible
      // to steal the tree as stale.
      runTimeoutMs: 1_000,
      provisionTimeoutMs: 2_000,
      ownership: { waitMs: 5_000, pollMs: 20, staleAfterMs: 4_000 },
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

    expect(built.boardId).toBe("conductor--t0--second-phase");
    // A distinct STORAGE identity, not just a distinct routing id: two epic
    // boards sharing a collection would operate on the same rows.
    expect(built.collectionId).toBe("conductor-tasks--t0--second-phase");
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
  it("returns the existing row when the seeds are sequential", async () => {
    // Two rows for one issue-phase derive the same checkout, the same branch and
    // the same run record — so a duplicated seed charges two full coding runs
    // whose independently valid claims overwrite one shared record.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => true,
    });

    const first = await live.call<{ taskId: string }>("seed", {
      issue: ISSUE,
      phase: PHASE,
    });
    await settle(live);
    const second = await live.call<{ taskId: string }>("seed", {
      issue: ISSUE,
      phase: PHASE,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Named, not merely equal — see the concurrent case below.
    expect(first.taskId).toBe(`${ISSUE}--${PHASE}`);
    expect(second.taskId).toBe(first.taskId);

    const { rows } = await live.call<{ rows: StatusRow[] }>("status", { issue: ISSUE });
    expect(rows).toHaveLength(1);
    expect(seen.prompts).toHaveLength(1);
  });

  it("returns one row when the seeds are CONCURRENT", async () => {
    // **The interleaving the sequential test cannot reach.** That one awaits the
    // first seed's settlement before starting the second, so both calls see the
    // row already present and the create path never runs twice — it exercises
    // the early return and reports on the race. A check that cannot observe the
    // ordering it is meant to cover is not a check (tenet 7).
    //
    // Here both seeds are in flight together, so both can find the row absent
    // before either creates it and the loser's create hits the id that now
    // exists. Losing is the correct outcome — one row was filed — so the loser
    // must re-read and answer with the winner's row rather than surfacing a
    // conflict the caller cannot act on.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => true,
    });

    const results = await Promise.allSettled([
      live.call<{ taskId: string }>("seed", { issue: ISSUE, phase: PHASE }),
      live.call<{ taskId: string }>("seed", { issue: ISSUE, phase: PHASE }),
    ]);

    // Neither call fails: a lost race is an idempotent success, not an error.
    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    const ids = results.map((r) =>
      r.status === "fulfilled" ? r.value.taskId : "rejected",
    );

    // **Both name a REAL row, and it is the same one.** The set-size check alone
    // was vacuous while `seed` discarded its own id: both reads were `undefined`,
    // so the set had size one and the assertion passed on two nothings. Assert
    // the id exists and equals the derived identity before asserting agreement —
    // a check that cannot tell one row from no rows is not a check.
    for (const id of ids) {
      expect(id).toBe(`${ISSUE}--${PHASE}`);
    }
    expect(new Set(ids).size).toBe(1);

    await settle(live);
    const { rows } = await live.call<{ rows: StatusRow[] }>("status", { issue: ISSUE });
    expect(rows).toHaveLength(1);
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

describe("the drain budget covers the whole worker", () => {
  // The defect: `detachedDrainTimeoutMs` was `runTimeoutMs`, the agent step
  // alone. A worker also waits for the lock, provisions, and probes for the PR —
  // and the engine carves its cancellation reserve OUT of this budget rather
  // than adding to it, so the effective wait was already LESS than the agent's
  // own deadline. A valid run near its deadline was cancelled before it could
  // produce a verdict.
  const budgetFor = async (over: Record<string, unknown> = {}) => {
    const { conductorFlow } = await import("../src/flow");
    const { workspace, ...rest } = over as { workspace?: object };
    return conductorFlow({
      epic: "budget-epic",
      workspace: {
        root: "/tmp/conductor-budget",
        sourceRepo: "/tmp/conductor-budget-repo",
        baseRef: "main",
        ...(workspace ?? {}),
      },
      runTimeoutMs: 1_800_000,
      ...rest,
    }).drainBudgetMs;
  };

  it("exceeds the agent deadline by more than the lock wait", async () => {
    // The property, not the arithmetic. Asserting a computed constant would
    // pass just as happily for a budget that forgot a term.
    const runTimeoutMs = 1_800_000;
    const budget = await budgetFor();
    const { resolveOwnership } = await import("../src/manager");
    const { ownership } = resolveOwnership({ runTimeoutMs });

    expect(budget).toBeGreaterThan(runTimeoutMs);
    expect(budget).toBeGreaterThan(runTimeoutMs + ownership.waitMs);
  });

  it("grows when any one term grows", async () => {
    // Every term is load-bearing. A budget that ignored one would be FLAT here
    // for that term — which is exactly how the reported defect looked.
    const base = await budgetFor();
    expect(await budgetFor({ runTimeoutMs: 3_600_000 })).toBeGreaterThan(base);
    expect(
      await budgetFor({ workspace: { provisionTimeoutMs: 1_200_000 } }),
    ).toBeGreaterThan(base);
    expect(
      await budgetFor({ ownership: { waitMs: 9_000_000, staleAfterMs: 8_000_000 } }),
    ).toBeGreaterThan(base);
  });

  it("refuses a budget past the ceiling a timer honours", async () => {
    // The state this fix creates: the budget is now DERIVED, so inputs that are
    // each individually legal can push it past 2**31-1 — where a timer silently
    // clamps to 1ms and cancels every run immediately. That is the very failure
    // the budget exists to prevent, arriving through the fix for it.
    await expect(budgetFor({ runTimeoutMs: 2_000_000_000 })).rejects.toThrow(
      /exceeds the largest delay a timer honours/,
    );
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
        provisionTimeoutMs: 1_000,
        ownership: { waitMs: 90_000, staleAfterMs: 30_000 },
      }),
    ).toThrow(/must exceed/);
  });

  it("refuses a stale window that clears the run but not the provisioning", async () => {
    // The gap the reordering opened. The lock is taken BEFORE the checkout is
    // provisioned, so the longest a live attempt can legitimately hold it is the
    // run's deadline PLUS the git budget. A window sized against the deadline
    // alone can elapse while the holder is still inside `worktree add` — the
    // replacement clears the lock and two agents mutate one checkout.
    //
    // 40s clears the 30s run and not the 30s+20s hold, so this passes the OLD
    // inequality and fails the real one. A test using a window inside the run's
    // deadline would have passed either way.
    expect(() =>
      createConductorHarness({
        resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
        runTimeoutMs: 30_000,
        provisionTimeoutMs: 20_000,
        ownership: { waitMs: 90_000, staleAfterMs: 40_000 },
      }),
    ).toThrow(/longest a live attempt can hold the lock/);
  });

  it("accepts a stale window past the whole legitimate hold", async () => {
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    const h = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      runTimeoutMs: 30_000,
      provisionTimeoutMs: 1_000,
      ownership: { waitMs: 90_000, staleAfterMs: 90_000 },
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

describe("the ledger is partitioned by tenant", () => {
  // The inverse of the checkout/branch isolation, and it was the asymmetry left
  // after that fold. User scope is keyed on the BARE user id —
  // `createExecutionContext` passes `scopeId: userId`, while session scope
  // tenant-qualifies its key — so two tenants sharing a user id share every
  // `user`-scoped collection. The board is one: one tenant's `wake` could claim
  // a row another filed and run it in the claiming tenant's workspace, with
  // status and retry accounting shared.
  const base = {
    epic: "shared-epic",
    workspace: { root: "/tmp/conductor-tenants", sourceRepo: "/tmp/x", baseRef: "main" },
    runTimeoutMs: 30_000,
  };

  it("gives two tenants different ledgers for the same epic", async () => {
    const { conductorFlow } = await import("../src/flow");
    const acme = conductorFlow({ ...base, tenant: "acme" });
    const globex = conductorFlow({ ...base, tenant: "globex" });

    // Storage — the half that decides who can claim whose row.
    expect(acme.collectionId).not.toBe(globex.collectionId);
    // Routing — hashed into the derived workstream session id.
    expect(acme.boardId).not.toBe(globex.boardId);
  });

  it("puts the tenant in the run topic too, through the same id", async () => {
    // The run topic leads with the collection identity, so partitioning that
    // partitions the run record as well — one change, both stores.
    const { conductorFlow } = await import("../src/flow");
    const { runTopic } = await import("../src/run-record");
    const acme = conductorFlow({ ...base, tenant: "acme" });
    const globex = conductorFlow({ ...base, tenant: "globex" });

    expect(runTopic(acme.collectionId, ISSUE, PHASE)).not.toBe(
      runTopic(globex.collectionId, ISSUE, PHASE),
    );
  });

  it("keeps the tenant and the epic apart when the delimiter is redistributed", async () => {
    // The measured defect, at the three sites that carry it. With a bare `-`
    // join, `(tenant "a-b", epic "c")` and `(tenant "a", epic "b-c")` BOTH
    // spelled `conductor-tasks-a-b-c` — two tenants sharing one claim pool and
    // one run topic. A test over two obviously-different tenants cannot fail on
    // that, which is why this one redistributes the delimiter instead.
    const { conductorFlow } = await import("../src/flow");
    const { runTopic } = await import("../src/run-record");
    const left = conductorFlow({ ...base, tenant: "a-b", epic: "c" });
    const right = conductorFlow({ ...base, tenant: "a", epic: "b-c" });

    // Storage — who can claim whose row.
    expect(left.collectionId).not.toBe(right.collectionId);
    // Routing — hashed into the derived workstream session id.
    expect(left.boardId).not.toBe(right.boardId);
    // The run record, which leads with the collection identity.
    expect(runTopic(left.collectionId, ISSUE, PHASE)).not.toBe(
      runTopic(right.collectionId, ISSUE, PHASE),
    );
  });

  it("accepts any tenant id and keeps distinct ones distinct", async () => {
    const { conductorFlow } = await import("../src/flow");
    for (const bad of ["../escape", "a/b", "..", "", "with space"]) {
      // Encoded, not validated — every tenant id is usable, and distinct ones
      // stay distinct. That is the property; a grammar was the old answer.
      expect(conductorFlow({ ...base, tenant: bad }).collectionId).not.toBe(
        conductorFlow({ ...base, tenant: `${bad}x` }).collectionId,
      );
    }
  });

  it("gives two conductors on ONE epic the same board, whatever phase they run", async () => {
    // **A known limit, pinned rather than fixed.** The board identity is
    // (tenant, epic) by design — the phase is deliberately not a third
    // discriminator — so building a second conductor for another phase of the
    // SAME epic points both at one collection. The other one's `wake` then
    // claims these rows, the manager's phase guard refuses them, and the
    // refusal costs a valid task an attempt: `attempts` is incremented inside
    // the claim write, so it is spent before any guard can run.
    //
    // The supported shape is the one directly below: a second phase gets its
    // own `epic`. This assertion exists so the limit is a recorded property
    // rather than folklore, and so anyone who later makes the phase part of the
    // identity has to come here and say so.
    const { conductorFlow } = await import("../src/flow");
    const { implementPhase } = await import("../src/implement");
    const implement = conductorFlow({ ...base, phase: implementPhase() });
    const review = conductorFlow({
      ...base,
      phase: { phase: "review", readable: {}, buildPrompt: () => "r", isDone: () => true },
    });

    expect(review.collectionId).toBe(implement.collectionId);
    expect(review.boardId).toBe(implement.boardId);

    // And the supported shape: a distinct epic separates them completely.
    const separated = conductorFlow({
      ...base,
      epic: "shared-epic-review",
      phase: { phase: "review", readable: {}, buildPrompt: () => "r", isDone: () => true },
    });
    expect(separated.collectionId).not.toBe(implement.collectionId);
    expect(separated.boardId).not.toBe(implement.boardId);
  });

  describe("every action refuses another tenant BEFORE touching the board", () => {
    // The guarantee this file documents used to hold for exactly one of the
    // three actions. The tenant check lived only in the manager, which runs
    // when the drain DISPATCHES a claimed row — so `seed` wrote with no check
    // at all, `status` read with no check at all, and `wake` claimed first and
    // refused after.
    //
    // Each test below therefore asserts the *timing*, not just the refusal: a
    // check that only asserted "it threw" passes on every one of those bugs.
    const OTHER = "acme";

    function conductorFor(tenant: string): ConductorHarness {
      const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
      return Object.assign(
        createConductorHarness({
          resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
          isDone: () => true,
          tenant,
        }),
        { seen },
      );
    }

    it("refuses a foreign SEED before the row is written", async () => {
      // Cross-tenant task INJECTION. Refusing after the write would leave the
      // row filed on someone else's board and report a failure — the worst of
      // both.
      live = conductorFor(OTHER);

      await expect(
        live.call("seed", { issue: ISSUE, phase: PHASE }, undefined, "globex"),
      ).rejects.toThrow(/serves "acme"/);

      // Nothing was filed. Read as the RIGHT tenant, or the read would be
      // refused too and this would pass because it saw nothing either way.
      const { rows } = await live.call<{ rows: StatusRow[] }>("status", {}, undefined, OTHER);
      expect(rows).toHaveLength(0);
    });

    it("refuses a foreign STATUS before the ledger is read", async () => {
      // Cross-tenant DISCLOSURE. A refusal that has already listed the rows has
      // already read them; the only way to know it refused first is that no row
      // comes back with the error.
      live = conductorFor(OTHER);
      await live.call("seed", { issue: ISSUE, phase: PHASE }, undefined, OTHER);

      await expect(
        live.call("status", { issue: ISSUE }, undefined, "globex"),
      ).rejects.toThrow(/serves "acme"/);
    });

    it("refuses a foreign WAKE without charging the row an attempt", async () => {
      // The one that needed the gate rather than a message. `applyClaimToTask`
      // sets `in_progress` and increments `attempts` in the SAME write, so a
      // refusal from inside the manager arrives one charged attempt too late —
      // on a valid task belonging to someone else. Repeated foreign wakes would
      // exhaust its retry budget without ever running it.
      //
      // Asserting only that `wake` threw would pass with the attempt still
      // burnt, which is precisely the bug.
      live = conductorFor(OTHER);
      await live.call("seed", { issue: ISSUE, phase: PHASE }, undefined, OTHER);

      const before = await live.call<{ rows: StatusRow[] }>(
        "status",
        { issue: ISSUE },
        undefined,
        OTHER,
      );

      await expect(live.call("wake", {}, undefined, "globex")).rejects.toThrow(
        /serves "acme"/,
      );

      const after = await live.call<{ rows: StatusRow[] }>(
        "status",
        { issue: ISSUE },
        undefined,
        OTHER,
      );
      expect(after.rows[0].attempts).toBe(before.rows[0].attempts);
      expect(after.rows[0].status).toBe(before.rows[0].status);
    });

    it("does not let a tenant NAMED like the default alias an untenanted one", async () => {
      // The state the tenant check itself introduced. `?? "single-tenant"`
      // collapsed absence into a value, so a real tenant called `single-tenant`
      // and a request with no tenant resolved identically — same user id, same
      // user-scoped board, each able to claim the other's rows — while the
      // WORKSPACE kept them apart (`t0` vs `t1...`). A task could then execute
      // and report against a checkout that was not its own.
      //
      // Absence and a name are different facts, and this asserts the board
      // agrees with the checkout about that.
      const { conductorFlow } = await import("../src/flow");
      const untenanted = conductorFlow({ ...base });
      const named = conductorFlow({ ...base, tenant: "single-tenant" });

      expect(named.collectionId).not.toBe(untenanted.collectionId);
      expect(named.boardId).not.toBe(untenanted.boardId);
    });

    it("refuses an untenanted request on a tenanted conductor, and the reverse", async () => {
      // Both directions, because the comparison is now between two values that
      // can each be undefined — a check written as `a !== b` passes vacuously if
      // one side silently defaults.
      live = conductorFor(OTHER);
      await expect(
        live.call("seed", { issue: ISSUE, phase: PHASE }, undefined, undefined),
      ).rejects.toThrow(/serves "acme"; the request resolved to no tenant/);

      live.dispose();
      live = createConductorHarness({
        resolveClaudeAgent: scriptedAgent([sdkResult("success")], {
          prompts: [],
          cwds: [],
        }),
        isDone: () => true,
      });
      await expect(
        live.call("seed", { issue: ISSUE, phase: PHASE }, undefined, "acme"),
      ).rejects.toThrow(/serves no tenant; the request resolved to "acme"/);
    });

    it("does not let a REQUEST named like the default pass as untenanted", async () => {
      // The other half of the sentinel. The identity test above covers the
      // conductor's own derivation; this covers the comparison — `requestTenant`
      // used to answer `"single-tenant"` for a request that carried no tenant at
      // all, so a request genuinely resolved to a tenant of that name was
      // indistinguishable from one resolved to nothing, and the untenanted
      // conductor accepted both.
      live = createConductorHarness({
        resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
        isDone: () => true,
      });

      await expect(
        live.call("seed", { issue: ISSUE, phase: PHASE }, undefined, "single-tenant"),
      ).rejects.toThrow(/serves no tenant; the request resolved to "single-tenant"/);

      // And the direction that actually aliased: a conductor built FOR a tenant
      // of that name must not accept a request carrying no tenant. With the old
      // `?? "single-tenant"` it did — the untenanted caller resolved to exactly
      // this conductor's tenant and was let straight through to its board.
      live.dispose();
      live = createConductorHarness({
        resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
        isDone: () => true,
        tenant: "single-tenant",
      });
      await expect(
        live.call("seed", { issue: ISSUE, phase: PHASE }, undefined, undefined),
      ).rejects.toThrow(/serves "single-tenant"; the request resolved to no tenant/);
    });

    it("still serves the tenant it was built for", async () => {
      // The guard has to leave the product working, or it is just an outage.
      live = conductorFor(OTHER);
      const { taskId } = await live.call<{ taskId: string }>(
        "seed",
        { issue: ISSUE, phase: PHASE },
        undefined,
        OTHER,
      );
      expect(taskId).toBe(`${ISSUE}--${PHASE}`);
    });
  });
});
