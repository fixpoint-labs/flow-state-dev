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
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireCheckout, conductorTaskId, encodeSegment } from "../src/workspace";
import {
  createConductorHarness,
  USER_ID,
  hangingAgent,
  scriptedAgent,
  sdkResult,
  throwingAgent,
  type ConductorHarness,
  seedRepo,
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

/**
 * A real repository for the flows built below.
 *
 * `conductorFlow` refuses a `sourceRepo` that is not a git repository, and
 * refuses one that IS the dispatcher's own — the guard the env door has always
 * applied, now applied at the programmatic door too. Before that, these specs
 * built flows against paths like `/tmp/x` that no repository ever occupied, and
 * nothing objected. One repo for the file rather than one per test: the checks
 * are the thing under test elsewhere, and here it just has to be real.
 */
let sharedRepoPath: string | undefined;
function sharedRepo(): string {
  if (sharedRepoPath === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "conductor-flow-repo-"));
    seedRepo(dir);
    sharedRepoPath = dir;
  }
  return sharedRepoPath;
}

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
    expect(row.run?.workspacePath).toContain(conductorTaskId(ISSUE, PHASE));
    // Principal- and epic-namespaced: two users, or two epics, never share a ref.
    expect(row.run?.branch).toBe(
      `conductor/t0/${encodeSegment(USER_ID)}/${COLLECTION_ID}/${conductorTaskId(ISSUE, PHASE)}`,
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

describe("what the retry is told about the last attempt", () => {
  it("names the previous harness session in attempt 2's prompt", async () => {
    // The collision: `openRunRow` applies the attempt-scoped clear, which nulls
    // `sessionId` — correctly, since it describes the attempt now running. But
    // the prompt read that same field to name the LAST attempt's session, and
    // the clear runs first, so it always saw `null` and the line was silently
    // never emitted. A rule and a reader that were each right alone.
    //
    // Asserted on the PROMPT the agent actually received, not on the row: the
    // row is exactly the thing that was misleading here.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => false,
      maxAttempts: 3,
    });

    await seedAndDrain(live);
    expect(seen.prompts).toHaveLength(1);
    // Attempt 1 has nothing to carry, so it must NOT invent a session line.
    expect(seen.prompts[0]).not.toMatch(/previous run's harness session/);

    await wakeAndSettle(live);

    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts[1]).toMatch(/The previous run's harness session was sess_stub\./);
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

    const checkout = join(live.workspaceRoot, conductorTaskId(ISSUE, PHASE));
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
    expect(first.taskId).toBe(conductorTaskId(ISSUE, PHASE));
    expect(second.taskId).toBe(first.taskId);

    const { rows } = await live.call<{ rows: StatusRow[] }>("status", { issue: ISSUE });
    expect(rows).toHaveLength(1);
    expect(seen.prompts).toHaveLength(1);
  });

  it("refuses a row at this id whose payload describes something else", async () => {
    // Idempotent has to mean "this row IS the one asked for", not "a row exists
    // at that id". The board is a shared collection and this flow already
    // assumes a task can reach it by any route that can write a row — so a row
    // filed at this id with a foreign payload was reported as a successful seed
    // while the task asked for was never filed. The next drain then claims the
    // foreign row, charges it an attempt, and the manager's id guard refuses it:
    // a silent nothing-happened, paid for out of somebody else's retry budget.
    //
    // Staged by corrupting the payload through the ledger the board actually
    // reads, rather than by asserting on the comparison in isolation — the
    // defect is that `seed` never looked, so the check has to run from `seed`.
    let corrupted = false;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], {
        prompts: [],
        cwds: [],
      }),
      isDone: async (run) => {
        if (!corrupted) {
          const ledger = (run.ctx as unknown as {
            resources: Record<string, { upsert(k: string, u: unknown): Promise<unknown> }>;
          }).resources[COLLECTION_ID];
          await ledger.upsert(conductorTaskId(ISSUE, PHASE), {
            input: { issue: "FIX-SOMEONE-ELSE", phase: PHASE },
          });
          corrupted = true;
        }
        return true;
      },
    });

    await live.call("seed", { issue: ISSUE, phase: PHASE });

    // Waited on the corruption itself rather than on settlement: rewriting the
    // payload is exactly what makes this row invisible to `status`, so `settle`
    // would poll for a row it can no longer find.
    const deadline = Date.now() + 8_000;
    while (!corrupted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(corrupted, "the drain never reached the completion check").toBe(true);

    await expect(live.call("seed", { issue: ISSUE, phase: PHASE })).rejects.toThrow(
      /does not describe/,
    );
  }, 20_000);

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
      expect(id).toBe(conductorTaskId(ISSUE, PHASE));
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

describe("a failed attempt releases the tree", () => {
  it("does not strand the lock when provisioning fails", async () => {
    // The only other release is the agent step's `onSettled`, which never fires
    // when the throw happens BEFORE that step is dispatched. Staged with a
    // deleted branch, which is one of the real ways `provisionCheckout` throws:
    // the checkout exists, so the branch is checked, and the branch is gone.
    //
    // The assertion is on the LOCK FILE, not on the row. A test that only
    // checked the attempt failed would pass with the lock stranded — and a
    // stranded lock is not visible until the next retry waits out the stale
    // window, which is now the run's deadline plus the whole git budget.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      isDone: () => false,
      maxAttempts: 3,
    });

    // Attempt 1 provisions the checkout and fails the done-condition, leaving a
    // real tree and a real branch behind.
    const first = await seedAndDrain(live);
    expect(first.status).toBe("pending");
    const checkout = join(live.workspaceRoot, ...[]);
    expect(seen.prompts).toHaveLength(1);

    // Now delete the branch out from under it, so attempt 2 throws inside
    // provisioning — after the lock is taken.
    const branch = first.run?.branch;
    expect(branch).toBeTruthy();
    // `update-ref -d`, not `branch -D`: the branch is checked out in the
    // worktree, so `branch -D` refuses — while the thing being staged (a ref
    // that vanished underneath a live checkout) is exactly what this does.
    execFileSync("git", ["update-ref", "-d", `refs/heads/${String(branch)}`], {
      cwd: live.sourceRepo,
      stdio: "pipe",
    });

    const after = await wakeAndSettle(live);
    expect(after.feedback).toMatch(/no longer\s+exists/);
    // The agent was never dispatched on attempt 2, so `onSettled` never ran.
    expect(seen.prompts).toHaveLength(1);

    // The lock must be gone anyway.
    const lock = `${first.run?.workspacePath}.lock`;
    expect(existsSync(lock), `${lock} was left behind`).toBe(false);
    void checkout;
  });
});

describe("the git inputs are validated at the programmatic door too", () => {
  // The door was already identified — the block above re-checks every NUMERIC
  // option here for exactly the reason stated there. What did not happen is
  // asking which OTHER rules use the same door. Two did, and the repository
  // guard is the one that matters: `fsdev.config.ts` and the goal runner both
  // refuse a `sourceRepo` that is the dispatcher's own repository, and a caller
  // reaching `conductorFlow` directly passed through neither.
  //
  // That is not a hardening nicety. It is obligation A — a run drives ANOTHER
  // repository rather than editing the thing that dispatched it — and this was
  // the last door open on it.
  const base = { epic: "git-inputs-epic", workspace: { root: "/tmp/g", baseRef: "main" } };

  it("refuses the repository this process is itself running from", async () => {
    const { conductorFlow } = await import("../src/flow");
    // `process.cwd()` during the suite IS the dispatcher's repository, which is
    // what makes this the real case rather than a staged one.
    expect(() =>
      conductorFlow({ ...base, workspace: { ...base.workspace, sourceRepo: process.cwd() } }),
    ).toThrow(/is the repository this process is itself running from/);
  });

  it("refuses a source repo that is not a git repository at all", async () => {
    const { conductorFlow } = await import("../src/flow");
    const empty = mkdtempSync(join(tmpdir(), "conductor-not-repo-"));
    expect(() =>
      conductorFlow({ ...base, workspace: { ...base.workspace, sourceRepo: empty } }),
    ).toThrow(/not a git repository/);
  });

  it("refuses a base ref the repository does not have, naming the option", async () => {
    const { conductorFlow } = await import("../src/flow");
    // The message must name `workspace.baseRef`, not `CONDUCTOR_BASE_REF`: a
    // caller who never set an environment variable would go looking in the
    // wrong place, which is the two-thirds-of-a-rule failure this file keeps
    // finding.
    expect(() =>
      conductorFlow({
        ...base,
        workspace: { ...base.workspace, sourceRepo: sharedRepo(), baseRef: "no-such-ref" },
      }),
    ).toThrow(/workspace\.baseRef "no-such-ref" does not resolve/);
  });

  it("refuses an empty tenant rather than deriving one every request is refused against", async () => {
    // `tenantSegment` spends `undefined` on untenanted, so `""` derives a
    // TENANTED identity — while `runPrincipal` and the HTTP extractor both read
    // an empty tenant as untenanted. The conductor builds, and then the gate
    // refuses every seed, wake and status against it.
    //
    // Refused rather than normalized to `undefined`: normalizing would collapse
    // a config that says it is tenanted onto the untenanted identity, which is
    // the aliasing the partition exists to prevent.
    const { conductorFlow } = await import("../src/flow");
    expect(() =>
      conductorFlow({
        ...base,
        tenant: "",
        workspace: { ...base.workspace, sourceRepo: sharedRepo() },
      }),
    ).toThrow(/tenant is an empty string/);

    // An OMITTED tenant is the untenanted conductor and stays legal — the point
    // is that the two are different, not that tenancy is now mandatory.
    expect(() =>
      conductorFlow({ ...base, workspace: { ...base.workspace, sourceRepo: sharedRepo() } }),
    ).not.toThrow();
  });

  it("refuses a relative workspace root, which one task can resolve two ways", async () => {
    // `checkoutPathFor` resolves the root against `process.cwd()`. Relative, the
    // checkout for one DURABLE task therefore depends on where the process is
    // standing when the attempt runs — so a long-lived host that changes
    // directory between attempts sends the retry to a different, empty tree,
    // while the uncommitted work the retry prompt tells it to continue from sits
    // in the first one. Nothing errors; the derivation is stable per directory
    // and stably wrong across two.
    //
    // The file used to ask for an absolute root in a comment and call this case
    // unguarded. An unenforced convention is what every other guard at this door
    // replaced.
    const { conductorFlow } = await import("../src/flow");
    expect(() =>
      conductorFlow({
        ...base,
        workspace: { ...base.workspace, root: "checkouts", sourceRepo: sharedRepo() },
      }),
    ).toThrow(/workspace\.root is relative/);

    // `./` is the same mistake wearing a prefix that looks deliberate.
    expect(() =>
      conductorFlow({
        ...base,
        workspace: { ...base.workspace, root: "./checkouts", sourceRepo: sharedRepo() },
      }),
    ).toThrow(/workspace\.root is relative/);
  });

  it("refuses a relative source repo, which the identity check cannot pin either", async () => {
    // The guard above shipped covering `root` and not its sibling — the same
    // rule-versus-instance failure this describe block is named for, committed
    // while adding a guard against it. Both fields are paths, both are used
    // later, and only one was carried through.
    //
    // The harm here is worse than a lost checkout. `assertDistinctRepository`
    // resolves a relative `sourceRepo` against the working directory it is
    // called in, so it can clear a path that later resolves — from a different
    // directory — to the dispatcher's OWN repository. The guard says yes about
    // one repository and `git worktree add` runs against another, which is the
    // exact outcome that check exists to make impossible.
    const { conductorFlow } = await import("../src/flow");
    expect(() =>
      conductorFlow({ ...base, workspace: { ...base.workspace, sourceRepo: "../somewhere" } }),
    ).toThrow(/workspace\.sourceRepo is relative/);

    // And the refusal comes BEFORE the identity check, so the message names the
    // real problem rather than reporting on a path it resolved by accident.
    expect(() =>
      conductorFlow({ ...base, workspace: { ...base.workspace, sourceRepo: "." } }),
    ).toThrow(/workspace\.sourceRepo is relative/);
  });

  it("still builds on a repository and ref that are real", async () => {
    const { conductorFlow } = await import("../src/flow");
    expect(() =>
      conductorFlow({ ...base, workspace: { ...base.workspace, sourceRepo: sharedRepo() } }),
    ).not.toThrow();
  });
});

describe("numeric options are validated at the programmatic door too", () => {
  // The env door got this two rounds ago. `conductorFlow` is EXPORTED, so a
  // host reaches the same values without passing through `positiveIntFromEnv` —
  // and `NaN` fails every downstream comparison silently, surviving
  // `resolveOwnership` and surfacing at `AbortSignal.timeout` only after the row
  // is claimed and the checkout provisioned. One attempt charged per retry for a
  // permanent misconfiguration.
  //
  // Fixing the door that was reported and not the other door onto the same rule
  // is the class this branch kept repeating; this pins both shut.
  const base = {
    epic: "numeric-epic",
    workspace: { root: "/tmp/n", sourceRepo: sharedRepo(), baseRef: "main" },
  };

  it("refuses every numeric option a timer would reject later", async () => {
    const { conductorFlow } = await import("../src/flow");
    for (const bad of [Number.NaN, -1, 1.5, 0, 2_147_483_648]) {
      expect(() => conductorFlow({ ...base, runTimeoutMs: bad }), `runTimeoutMs ${bad}`)
        .toThrow(/positive whole number/);
      expect(() => conductorFlow({ ...base, maxAttempts: bad }), `maxAttempts ${bad}`)
        .toThrow(/positive whole number/);
      expect(
        () =>
          conductorFlow({
            ...base,
            workspace: { ...base.workspace, provisionTimeoutMs: bad },
          }),
        `provisionTimeoutMs ${bad}`,
      ).toThrow(/positive whole number/);
    }
  });

  it("refuses a bad ownership bound, which reaches the same timers", async () => {
    const { conductorFlow } = await import("../src/flow");
    expect(() =>
      conductorFlow({
        ...base,
        ownership: { waitMs: Number.NaN, pollMs: 10, staleAfterMs: 5_000_000 },
      }),
    ).toThrow(/ownership\.waitMs/);
  });

  it("still builds on the values a host legitimately passes", async () => {
    // The guard must leave the product working.
    const { conductorFlow } = await import("../src/flow");
    expect(() =>
      conductorFlow({ ...base, runTimeoutMs: 60_000, maxAttempts: 2 }),
    ).not.toThrow();
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
        sourceRepo: sharedRepo(),
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

  it("refuses a wait that merely EQUALS the stale window", async () => {
    // **This assertion is the inverse of the one it replaces, and the old one
    // was the defect.** `acquireCheckout` tests `age > staleAfterMs`, so a
    // waiter whose wait equals the window reaches its deadline at the exact
    // moment the lock becomes eligible and times out instead of taking over —
    // charging a coding retry for a dead holder it was about to be allowed to
    // reclaim. The previous version of this test asserted that configuration was
    // ACCEPTED, and the production defaults were equal too, so this was the
    // ordinary path rather than an exotic override.
    expect(() =>
      createConductorHarness({
        resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
        runTimeoutMs: 30_000,
        provisionTimeoutMs: 1_000,
        ownership: { waitMs: 90_000, staleAfterMs: 90_000, pollMs: 25 },
      }),
    ).toThrow(/by at least one poll interval/);

    // One poll short is still short — the boundary is where this went wrong, so
    // the boundary is what is pinned.
    expect(() =>
      createConductorHarness({
        resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
        runTimeoutMs: 30_000,
        provisionTimeoutMs: 1_000,
        ownership: { waitMs: 90_024, staleAfterMs: 90_000, pollMs: 25 },
      }),
    ).toThrow(/by at least one poll interval/);
  });

  it("accepts a wait one poll past the stale window", async () => {
    // The guard must not become an outage: exactly one poll of headroom is the
    // rule, so exactly one poll of headroom has to be legal.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    const h = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      runTimeoutMs: 30_000,
      provisionTimeoutMs: 1_000,
      ownership: { waitMs: 90_025, staleAfterMs: 90_000, pollMs: 25 },
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
        const taskId = conductorTaskId(ISSUE, PHASE);
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

describe("status finds the row seeding would have reused", () => {
  it("matches an issue filter that differs only in case", async () => {
    // Identity derivation folds case, so `seed({ issue: "fix-1219" })` returns
    // the SAME row as `seed({ issue: "FIX-1219" })` — deliberately, because the
    // filesystem cannot tell those two apart either. The status filter compared
    // raw strings, so the row seeding kept reusing was invisible to a status
    // call spelled the other way: an empty listing for a task that exists and
    // is running, which is the silent partial answer this lab exists to remove.
    const seen = { prompts: [] as string[], cwds: [] as (string | undefined)[] };
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
    });
    await seedAndDrain(live);

    const asSeeded = (await live.call("status", { issue: ISSUE })) as { rows: unknown[] };
    const otherCase = (await live.call("status", {
      issue: ISSUE.toLowerCase(),
    })) as { rows: unknown[] };

    expect(asSeeded.rows).toHaveLength(1);
    // The property: the two spellings are one row, exactly as seeding treats them.
    expect(otherCase.rows).toHaveLength(asSeeded.rows.length);
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
    workspace: { root: "/tmp/conductor-tenants", sourceRepo: sharedRepo(), baseRef: "main" },
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
    // `""` is deliberately NOT in this list. It is refused a few describes up,
    // and for a reason that has nothing to do with encoding: `tenantSegment`
    // already spends `undefined` on untenanted, so an empty tenant is the one
    // value the encoding cannot express. The ENCODER still handles it, and
    // `workspace.spec.ts` asserts that where it belongs.
    for (const bad of ["../escape", "a/b", "..", "with space"]) {
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
      expect(taskId).toBe(conductorTaskId(ISSUE, PHASE));
    });
  });
});

describe("the completion check is bounded", () => {
  it("gives up on a hook that never answers, and leaves no timer behind", async () => {
    const { withDeadline } = await import("../src/manager");

    // The gap this closes: `conductorDrainBudgetMs` sums four terms and spends
    // `NETWORK_CALL_TIMEOUT_MS` on the completion check — a number taken from the
    // built-in probe, which bounds its own `gh` call. `isDone` is a public seam,
    // so any other phase's check was unbounded and could outlive the budget a
    // host sized its shutdown from, leaving the row `in_progress` with nothing
    // left to settle it.
    await expect(withDeadline(() => new Promise(() => {}), 20, "the check")).rejects.toThrow(
      /did not answer within 20ms/,
    );

    // **And the timer is cleared on the winning path.** A bare `Promise.race`
    // leaks one pending timer per call; this runs on every settled attempt of
    // every row, so on a long-lived dispatcher the handles accumulate and hold
    // the event loop open past a shutdown that is otherwise finished. Asserted
    // by racing the process's own emptiness: a leaked 60s timer would keep this
    // `setImmediate` chain alive well past the resolve.
    const before = process.getActiveResourcesInfo?.().filter((r) => r === "Timeout").length ?? 0;
    await withDeadline(async () => "fast", 60_000, "the check");
    const after = process.getActiveResourcesInfo?.().filter((r) => r === "Timeout").length ?? 0;
    expect(after).toBeLessThanOrEqual(before);
  });
});

describe("status attributes a run record to the row that owns it", () => {
  it("reports no run for a row whose id does not derive from its payload", async () => {
    // The board capability can file a row under any id. The manager refuses to
    // EXECUTE one whose id and payload disagree — which is what makes this
    // reachable rather than theoretical: the malformed row sits there
    // permanently, and `status` derived the run topic from the payload alone.
    // So a row filed under a junk id while carrying a real task's
    // `{ issue, phase }` was narrated with that task's session, cost, checkout
    // and outcome. Every field real, every field attributed to the wrong task.
    let planted = false;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      isDone: async (run) => {
        if (!planted) {
          const ledger = (run.ctx as unknown as {
            resources: Record<string, { upsert(k: string, u: unknown): Promise<unknown> }>;
          }).resources[COLLECTION_ID];
          // A second row, under a NON-canonical id, carrying the real task's
          // payload. `status` filters by issue, so it comes back in the listing
          // beside the genuine one.
          await ledger.upsert("not-the-canonical-id", {
            id: "not-the-canonical-id",
            goal: "a row filed under an id its payload does not derive",
            input: { issue: ISSUE, phase: PHASE },
            status: "pending",
            attempts: 0,
            assignee: "harness",
            createdAt: 1,
            updatedAt: 1,
          });
          planted = true;
        }
        return true;
      },
    });

    // Not `seedAndDrain`: its helper reads `rows[0]`, and planting a second row
    // for this issue makes that ambiguous. Waited on the genuine row by id.
    await live.call("seed", { issue: ISSUE, phase: PHASE });
    const canonical = conductorTaskId(ISSUE, PHASE);
    const deadline = Date.now() + 10_000;
    let rows: StatusRow[] = [];
    for (;;) {
      ({ rows } = await live.call<{ rows: StatusRow[] }>("status", { issue: ISSUE }));
      const mine = rows.find((r) => r.taskId === canonical);
      // Polled to `completed` rather than to "not in_progress": right after
      // `seed` returns the row is briefly `pending` and unclaimed, which a
      // not-in_progress test reads as a settlement that has not happened.
      if (mine?.status === "completed") break;
      if (mine !== undefined && mine.status !== "pending" && mine.status !== "in_progress") {
        throw new Error(`settled unexpectedly: ${JSON.stringify(mine)}`);
      }
      if (Date.now() >= deadline) throw new Error(`never settled: ${JSON.stringify(rows)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(rows.find((r) => r.taskId === canonical)?.status).toBe("completed");
    const impostor = rows.find((r) => r.taskId === "not-the-canonical-id");
    expect(impostor, "the planted row should be listed").toBeDefined();
    // Listed — a caller asking what is on the board should see it exists — but
    // carrying nothing about a run it does not own.
    expect(impostor?.run).toBeNull();

    // And the genuine row is unaffected: this must not become a blanket refusal
    // that hides real records.
    expect(rows.find((r) => r.taskId === conductorTaskId(ISSUE, PHASE))?.run?.sessionId).toBe(
      "sess_stub",
    );
  }, 20_000);
});

describe("status survives a row whose identity cannot be derived at all", () => {
  it("returns the listing instead of throwing on one malformed neighbour", async () => {
    // `conductorTaskId` VALIDATES the owned-segment grammar and raises on a
    // violation. The identity predicate checked the field types and stopped
    // there — so a persisted row carrying `{ issue: "FIX.1" }` did not fail the
    // predicate, it failed the whole `status` call, hiding every valid row
    // behind one bad neighbour on the surface whose job is to say what is on the
    // board.
    //
    // Enumerating one way the derivation can fail and missing the other is the
    // same shape as the defects this predicate was extracted to prevent.
    let planted = false;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      isDone: async (run) => {
        if (!planted) {
          const ledger = (run.ctx as unknown as {
            resources: Record<string, { upsert(k: string, u: unknown): Promise<unknown> }>;
          }).resources[COLLECTION_ID];
          await ledger.upsert("malformed-identity-row", {
            id: "malformed-identity-row",
            goal: "a row whose payload violates the owned-segment grammar",
            // A dot is legal in the schema (it is just a string) and illegal in
            // the grammar, which is precisely the gap.
            input: { issue: ISSUE, phase: "imp.lement" },
            status: "pending",
            attempts: 0,
            assignee: "harness",
            createdAt: 1,
            updatedAt: 1,
          });
          planted = true;
        }
        return true;
      },
    });

    await live.call("seed", { issue: ISSUE, phase: PHASE });
    const canonical = conductorTaskId(ISSUE, PHASE);
    const deadline = Date.now() + 10_000;
    let rows: StatusRow[] = [];
    for (;;) {
      // The unfiltered read is the one that broke: it visits every row, so the
      // malformed one is reached whatever the caller asked about.
      ({ rows } = await live.call<{ rows: StatusRow[] }>("status", {}));
      if (rows.find((r) => r.taskId === canonical)?.status === "completed") break;
      if (Date.now() >= deadline) throw new Error(`never settled: ${JSON.stringify(rows)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // The malformed row is listed, with nothing claimed about a run it cannot
    // be shown to own — and the valid row beside it is unaffected.
    expect(rows.find((r) => r.taskId === "malformed-identity-row")?.run).toBeNull();
    expect(rows.find((r) => r.taskId === canonical)?.run?.sessionId).toBe("sess_stub");
  }, 20_000);
});

describe("a phase spelled differently is the same phase", () => {
  it("does not charge a durable row for a casing change in the config", async () => {
    // A row is durable and outlives the process that filed it. Restart the
    // conductor with the phase spelled `IMPLEMENT` and it meets rows already on
    // the board carrying `implement` — and `conductorTaskId` FOLDS case, so
    // those are the same task, the same checkout and the same branch.
    //
    // A raw comparison in the guard called them different, and did so after
    // `wake` had claimed the row: the attempt is charged, once per wake, until a
    // valid task's budget is gone, for a mismatch its own identity says does not
    // exist. That is the exact failure class this lab was built to remove,
    // arriving through a guard.
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      isDone: () => true,
    });
    await live.call("seed", { issue: ISSUE, phase: PHASE });
    await settle(live);
    live.dispose();

    // The restart: same board, same durable rows, phase spelled in caps.
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      isDone: () => true,
      phaseName: PHASE.toUpperCase(),
    });

    // Seeding the lower-case spelling is accepted, not refused as a foreign
    // phase — the guard at the seed door is the sibling of the one reported,
    // and it was raw too.
    await expect(live.call("seed", { issue: ISSUE, phase: PHASE })).resolves.toBeDefined();
    const row = await settle(live);
    expect(row.status).toBe("completed");
  }, 20_000);
});

describe("the phase's own precondition is refused at the same door", () => {
  it("refuses a source repo the completion probe could not read a remote from", async () => {
    // The implement phase's probe runs `git remote get-url origin` AFTER the
    // paid agent run. A repository whose GitHub remote is called `upstream` is
    // perfectly valid and fails it — and the rescue re-pends the row, so the
    // next attempt runs the agent again and fails identically, until the retry
    // budget is gone. A permanent configuration error charged once per retry is
    // what every other guard at this door exists to stop; this one could not use
    // that door, because only the phase knows what it needs.
    const { conductorFlow } = await import("../src/flow");
    const { implementPhase } = await import("../src/implement");

    const noOrigin = mkdtempSync(join(tmpdir(), "conductor-no-origin-"));
    seedRepo(noOrigin);
    execFileSync("git", ["remote", "remove", "origin"], { cwd: noOrigin, stdio: "pipe" });
    execFileSync(
      "git",
      ["remote", "add", "upstream", "https://github.com/fixpoint-labs/x.git"],
      { cwd: noOrigin, stdio: "pipe" },
    );

    expect(() =>
      conductorFlow({
        epic: "remote-epic",
        workspace: { root: "/tmp/remote-epic", sourceRepo: noOrigin, baseRef: "main" },
        phase: implementPhase(),
      }),
    ).toThrow(/has no "origin" remote/);

    // **And the guard is scoped to the probe that needs it.** A caller who
    // supplies `prExists` has replaced the thing that reads `origin`, so
    // demanding one would refuse a configuration that works.
    expect(() =>
      conductorFlow({
        epic: "remote-epic",
        workspace: { root: "/tmp/remote-epic", sourceRepo: noOrigin, baseRef: "main" },
        phase: implementPhase({ prExists: () => true }),
      }),
    ).not.toThrow();
  });

  it("refuses an origin it could not name a repository from", async () => {
    // Same cost, later and more confusingly: a remote that parses to nothing is
    // a listing the probe cannot pin, so it fails after the run just as a
    // missing one does.
    const { conductorFlow } = await import("../src/flow");
    const { implementPhase } = await import("../src/implement");

    const localRemote = mkdtempSync(join(tmpdir(), "conductor-local-remote-"));
    seedRepo(localRemote);
    execFileSync("git", ["remote", "set-url", "origin", "/srv/git/mirror"], {
      cwd: localRemote,
      stdio: "pipe",
    });

    expect(() =>
      conductorFlow({
        epic: "remote-epic",
        workspace: { root: "/tmp/remote-epic", sourceRepo: localRemote, baseRef: "main" },
        phase: implementPhase(),
      }),
    ).toThrow(/does not name a host and repository/);
  });

  it("does not follow the caller's workspace object after construction", async () => {
    // **A guard that can be walked around after the fact is not a guard.** The
    // caller's `workspace` object was retained by reference, so a host could
    // repoint `sourceRepo` — at the dispatcher's own repository, say — once
    // `conductorFlow` had returned, and every later attempt would run against a
    // location `assertDistinctRepository` never saw.
    //
    // **Observed through `phase.validate`,** which is handed the exact object
    // the conductor retains. An earlier version of this test asserted that a
    // second construction from the mutated object throws — which it does either
    // way, because that call re-validates from scratch. It passed against the
    // defect. This one reads the retained object directly.
    const { conductorFlow } = await import("../src/flow");

    const repo = mkdtempSync(join(tmpdir(), "conductor-snapshot-"));
    seedRepo(repo);
    const root = mkdtempSync(join(tmpdir(), "conductor-snapshot-root-"));
    const mutable = { root, sourceRepo: repo, baseRef: "main" };

    let retained: { root: string; sourceRepo: string; baseRef: string } | undefined;
    conductorFlow({
      epic: "snapshot-epic",
      workspace: mutable,
      phase: {
        phase: "implement",
        readable: {},
        buildPrompt: () => "p",
        isDone: () => true,
        validate: (w) => {
          retained = w as { root: string; sourceRepo: string; baseRef: string };
        },
      },
    });
    expect(retained, "validate was never called").toBeDefined();

    // The host mutates its own object afterwards.
    mutable.sourceRepo = "/definitely/not/a/repository";
    mutable.root = "/tmp/somewhere-else";

    // The conductor's copy is untouched by that.
    expect(retained!.sourceRepo).toBe(repo);
    expect(retained!.root).toBe(root);
    // And frozen, so the same hole cannot be reopened from inside the module.
    expect(Object.isFrozen(retained)).toBe(true);
  });

  it("refuses a host where `gh` cannot be run", async () => {
    // The probe's OTHER unstated precondition. A valid `origin` gets the
    // conductor all the way to a paid coding run on a host with no `gh`, and
    // only the completion listing afterwards discovers it — so the rescue
    // re-pends and the next attempt buys the same failure again, until the
    // retry budget is spent. Same shape as the missing remote, same door.
    const { conductorFlow } = await import("../src/flow");
    const { implementPhase } = await import("../src/implement");

    const repo = mkdtempSync(join(tmpdir(), "conductor-no-gh-"));
    seedRepo(repo);

    // **`PATH` is set in BOTH directions rather than read.** A test that just
    // asserted the throw would pass here (this sandbox has no `gh`) and fail on
    // a developer machine that does — a fixture whose answer depends on the host
    // is not a fixture. A directory holding `git` and nothing else makes "no
    // `gh`" true everywhere, and the suite-wide shim in `test/setup.ts` makes
    // the opposite true everywhere.
    //
    // `git` has to stay reachable: the guards ahead of this one shell out to it
    // to check the repository and the base ref, so a genuinely empty `PATH`
    // fails earlier and the assertion below would be reading the wrong refusal.
    const gitOnly = mkdtempSync(join(tmpdir(), "conductor-git-only-path-"));
    symlinkSync(
      execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
      join(gitOnly, "git"),
    );
    const realPath = process.env["PATH"];
    process.env["PATH"] = gitOnly;
    try {
      expect(() =>
        conductorFlow({
          epic: "gh-epic",
          workspace: { root: "/tmp/gh-epic", sourceRepo: repo, baseRef: "main" },
          phase: implementPhase(),
        }),
      ).toThrow(/`gh` CLI could not be run/);
    } finally {
      process.env["PATH"] = realPath;
    }

    // And the positive arm, on the same repository, so the refusal above is
    // attributable to `gh` and not to anything else about this configuration.
    expect(() =>
      conductorFlow({
        epic: "gh-epic",
        workspace: { root: "/tmp/gh-epic", sourceRepo: repo, baseRef: "main" },
        phase: implementPhase(),
      }),
    ).not.toThrow();

    // **And the guard is scoped to the probe that needs it**, as the remote
    // guard beside it is: a caller who supplies `prExists` never shells out to
    // `gh`, so demanding it would refuse a configuration that works.
    process.env["PATH"] = gitOnly;
    try {
      expect(() =>
        conductorFlow({
          epic: "gh-epic",
          workspace: { root: "/tmp/gh-epic", sourceRepo: repo, baseRef: "main" },
          phase: implementPhase({ prExists: () => true }),
        }),
      ).not.toThrow();
    } finally {
      process.env["PATH"] = realPath;
    }
  });
});

describe("a row is only ours if its routing is ours too", () => {
  it("refuses an existing row at this id that is assigned elsewhere", async () => {
    // The id/payload check answers "is this the same task". It does not answer
    // "would we have filed this row" — `assignee` is a separate immutable
    // routing input, so a pre-created row with the right payload under another
    // assignee passed as an idempotent seed. The board claim charges an attempt
    // before dispatch, and dispatch then finds no worker declared for that
    // assignee: the requested coding run is billed or stranded without ever
    // launching, and the seed reported success.
    let planted = false;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      isDone: async (run) => {
        if (!planted) {
          const ledger = (run.ctx as unknown as {
            resources: Record<string, { upsert(k: string, u: unknown): Promise<unknown> }>;
          }).resources[COLLECTION_ID];
          await ledger.upsert(conductorTaskId("FIX-OTHER", PHASE), {
            id: conductorTaskId("FIX-OTHER", PHASE),
            goal: "filed by somebody else's worker",
            input: { issue: "FIX-OTHER", phase: PHASE },
            status: "pending",
            attempts: 0,
            // Everything correct except the routing.
            assignee: "someone-else",
            createdAt: 1,
            updatedAt: 1,
          });
          planted = true;
        }
        return true;
      },
    });

    await live.call("seed", { issue: ISSUE, phase: PHASE });
    const deadline = Date.now() + 8_000;
    while (!planted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(planted, "the drain never reached the completion check").toBe(true);

    // Seeding the planted issue must NOT report it as filed: the id and payload
    // agree, and the row still is not one this conductor can run.
    await expect(live.call("seed", { issue: "FIX-OTHER", phase: PHASE })).rejects.toThrow(
      /assignee other than "harness"/,
    );
  }, 20_000);
});

describe("a row is only ours if its retry budget is ours too", () => {
  it("refuses an existing row filed without the configured retry budget", async () => {
    // `maxAttempts` is not decoration and its ABSENCE is not "the default": the
    // substrate is single-attempt without it. A row pre-created with the right
    // id, payload and assignee but no budget is accepted as an idempotent seed
    // and drained under a retry policy the conductor never configured — the
    // first failed coding run goes terminal on a board built for retries, which
    // is the exact economics decision 1 is priced on.
    //
    // Unlike `assignee`, this one really is immutable through `updateTask`
    // (which patches priority, metadata, assignee and labels), so checking it
    // says something about the row for its whole life.
    let planted = false;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      isDone: async (run) => {
        if (!planted) {
          const ledger = (run.ctx as unknown as {
            resources: Record<string, { upsert(k: string, u: unknown): Promise<unknown> }>;
          }).resources[COLLECTION_ID];
          await ledger.upsert(conductorTaskId("FIX-NOBUDGET", PHASE), {
            id: conductorTaskId("FIX-NOBUDGET", PHASE),
            goal: "filed with no retry budget",
            input: { issue: "FIX-NOBUDGET", phase: PHASE },
            status: "pending",
            attempts: 0,
            assignee: "harness",
            // `maxAttempts` deliberately absent — everything else is correct.
            createdAt: 1,
            updatedAt: 1,
          });
          planted = true;
        }
        return true;
      },
    });

    await live.call("seed", { issue: ISSUE, phase: PHASE });
    const deadline = Date.now() + 8_000;
    while (!planted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(planted, "the drain never reached the completion check").toBe(true);

    await expect(
      live.call("seed", { issue: "FIX-NOBUDGET", phase: PHASE }),
    ).rejects.toThrow(/retry budget|not one this conductor filed|did not file/);
  }, 20_000);

  it("reuses a FINISHED row whose retry budget is not the configured one", async () => {
    // **The other side of the same rule, and the ordering is what makes it
    // true.** Every admission check asks whether a drain could run this row the
    // way the seed promises. No drain will ever run a terminal row — so a retry
    // policy that can never be applied to it is not grounds for refusing it.
    //
    // Checking policy before the terminal case meant a durable board restarted
    // under a different `maxAttempts` threw on re-seeding an issue it had
    // already finished, which contradicts the documented idempotency and the
    // public promise that a second seed returns the existing row. A host cannot
    // re-seed its way out of it either: the budget on a finished row is history.
    let planted = false;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      isDone: async (run) => {
        if (!planted) {
          const ledger = (run.ctx as unknown as {
            resources: Record<string, { upsert(k: string, u: unknown): Promise<unknown> }>;
          }).resources[COLLECTION_ID];
          await ledger.upsert(conductorTaskId("FIX-FINISHED", PHASE), {
            id: conductorTaskId("FIX-FINISHED", PHASE),
            goal: "finished under another budget",
            input: { issue: "FIX-FINISHED", phase: PHASE },
            // Terminal, and filed under a budget this conductor is not running.
            status: "completed",
            attempts: 1,
            assignee: "harness",
            maxAttempts: 99,
            createdAt: 1,
            updatedAt: 1,
          });
          planted = true;
        }
        return true;
      },
    });

    await live.call("seed", { issue: ISSUE, phase: PHASE });
    const deadline = Date.now() + 8_000;
    while (!planted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(planted, "the drain never reached the completion check").toBe(true);

    // Reused, not refused, and it is the same row rather than a new one.
    await expect(
      live.call("seed", { issue: "FIX-FINISHED", phase: PHASE }),
    ).resolves.toMatchObject({ taskId: conductorTaskId("FIX-FINISHED", PHASE) });
  }, 20_000);
});

describe("status attribution does not depend on the retry policy", () => {
  it("keeps reporting a run for a row whose retry budget is not the configured one", async () => {
    // A durable board outlives the process that filed its rows, so a host
    // restarted with a different `maxAttempts` meets rows still carrying the
    // budget they were filed with — while their id, payload and run topic are
    // unchanged. Attribution has nothing to do with retry policy, so a `status`
    // that compares it hides the session, checkout, cost and outcome of every
    // pre-restart run behind `run: null`.
    //
    // That is not hypothetical: it is what broadening the shared predicate for
    // SEED ADMISSION did to this read-only join, one commit after the goal check
    // argued the same separation in the other direction.
    //
    // Staged by moving the budget on a settled row rather than by restarting the
    // harness — each harness builds its own store, so a "restart" would lose the
    // durable rows this is about. The property under test is the same either
    // way: identity unchanged, policy different, record still attributed.
    let moved = false;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      maxAttempts: 3,
      isDone: async (run) => {
        if (!moved) {
          const ledger = (run.ctx as unknown as {
            resources: Record<string, { upsert(k: string, u: unknown): Promise<unknown> }>;
          }).resources[COLLECTION_ID];
          await ledger.upsert(conductorTaskId(ISSUE, PHASE), { maxAttempts: 5 });
          moved = true;
        }
        return true;
      },
    });

    await live.call("seed", { issue: ISSUE, phase: PHASE });
    const deadline = Date.now() + 10_000;
    let rows: StatusRow[] = [];
    for (;;) {
      ({ rows } = await live.call<{ rows: StatusRow[] }>("status", { issue: ISSUE }));
      const mine = rows.find((r) => r.taskId === conductorTaskId(ISSUE, PHASE));
      if (moved && mine !== undefined && mine.status !== "in_progress") break;
      if (Date.now() >= deadline) throw new Error(`never settled: ${JSON.stringify(rows)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const mine = rows.find((r) => r.taskId === conductorTaskId(ISSUE, PHASE));
    expect(mine?.attempts, "the budget really did move off the configured one").toBeDefined();
    // The record is still attributed: the identity never moved, only the policy.
    expect(mine?.run?.sessionId).toBe("sess_stub");
  }, 20_000);
});

describe("the phase name is an identity segment, refused at construction", () => {
  it("refuses a phase name that cannot become a task id, path or branch", async () => {
    // `epic` was validated where the board id is built; the phase name was
    // validated nowhere. Both feed `conductorTaskId`, the checkout path and the
    // branch — so a conductor configured with `review.v2` constructed without
    // complaint and then threw from every `seed`.
    //
    // The expensive door is the other one: a matching row written straight to
    // the shared board is CLAIMED and charged before the manager reaches the
    // same failure. A permanent configuration error, paid once per retry.
    const { conductorFlow } = await import("../src/flow");
    const { implementPhase } = await import("../src/implement");
    const base = implementPhase({ prExists: () => true });
    const workspace = { root: "/tmp/phase-name", sourceRepo: sharedRepo(), baseRef: "main" };

    for (const bad of ["review.v2", "", "a/b", "..", "with space", "ends-in.lock"]) {
      expect(() =>
        conductorFlow({ epic: "phase-name-epic", workspace, phase: { ...base, phase: bad } }),
      ).toThrow(/not a usable identity segment/);
    }

    // And a legal one still builds — the guard must not become an outage, and
    // case is folded rather than refused (see the casing test above).
    expect(() =>
      conductorFlow({
        epic: "phase-name-epic",
        workspace,
        phase: { ...base, phase: "REVIEW_v2" },
      }),
    ).not.toThrow();
  });
});

describe("a reused row must be one a drain can actually claim", () => {
  it("refuses an existing row carrying an unresolved dependency", async () => {
    // The row is correct in every field `seed` SETS — id, payload, assignee,
    // retry budget — and carries a `deps` entry `seed` never sets at all.
    // `depsSatisfied` then keeps it permanently unclaimable, so `seed` reports
    // filed and the coding run simply never happens: no error, no attempt, no
    // work, and nothing on the board says why.
    //
    // This is the field that showed the previous framing was wrong. Checking
    // against "the `addTask` call this mirrors" can only ever see fields seed
    // writes, and is blind by construction to ones it leaves at their default
    // for a foreign writer to fill in.
    let planted = false;
    live = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      isDone: async (run) => {
        if (!planted) {
          const ledger = (run.ctx as unknown as {
            resources: Record<string, { upsert(k: string, u: unknown): Promise<unknown> }>;
          }).resources[COLLECTION_ID];
          await ledger.upsert(conductorTaskId("FIX-BLOCKED", PHASE), {
            id: conductorTaskId("FIX-BLOCKED", PHASE),
            goal: "filed with a dependency this conductor never sets",
            input: { issue: "FIX-BLOCKED", phase: PHASE },
            status: "pending",
            attempts: 0,
            assignee: "harness",
            maxAttempts: 3,
            deps: ["something-that-was-never-filed"],
            createdAt: 1,
            updatedAt: 1,
          });
          planted = true;
        }
        return true;
      },
    });

    await live.call("seed", { issue: ISSUE, phase: PHASE });
    const deadline = Date.now() + 8_000;
    while (!planted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(planted, "the drain never reached the completion check").toBe(true);

    await expect(
      live.call("seed", { issue: "FIX-BLOCKED", phase: PHASE }),
    ).rejects.toThrow(/dependencies that would keep it unclaimable/);
  }, 20_000);
});
