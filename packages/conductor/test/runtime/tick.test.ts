/**
 * The tick, against a repository that actually exists.
 *
 * The world here is read by the **local observer** from a real git checkout and
 * the review files a human would write, and the work is handed to a recording
 * dispatcher. Nothing is handed an answer about the world: a branch is a real
 * branch, an approval is a file somebody wrote, and an empty inbox means nobody
 * has reviewed anything.
 *
 * Three properties are what this file exists for, and each has its own
 * `describe` below. They are the whole reason the design is shaped the way it
 * is, so a test here failing should be read as the design having been broken
 * rather than as a fixture needing an update:
 *
 * 1. **A redundant tick costs nothing.** An unchanged world appends zero ledger
 *    rows and performs zero dispatches.
 * 2. **A restart resumes; it does not redo.** Dropping the session handle and
 *    opening a new one over the same state loses no gate, moves no phase, and
 *    repeats no dispatch — asserted against a *fresh* dispatcher, which has
 *    received nothing if nothing was dispatched.
 * 3. **Every transition is reproducible from the ledger.** Structurally (an
 *    unbroken `seq`/phase chain) and literally (`decide` re-run from each row's
 *    own recorded arguments produces that row's action).
 *
 * The two ledger checks mirror the goal check at
 * `goals/conductor/drives-one-issue-to-a-merge-ready-branch/run.mts`
 * deliberately: it is the definition of the invariant, and a fast test that
 * checks something weaker would let the slow one fail alone.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedConductor } from "../../src/config/define";
import { decide } from "../../src/driver/decide";
import type { Dispatcher } from "../../src/dispatch/types";
import { localObserver } from "../../src/local/observe";
import { openSubmission, submissionDir } from "../../src/local/store";
import type { LedgerEntryState } from "../../src/model/entities";
import type { Phase } from "../../src/model/phases";
import { DEFAULT_POLICY, type ConductorPolicy } from "../../src/model/world";
import { openConductor, type ConductorSession } from "../../src/runtime/session";
import { fakeDispatcher, type FakeDispatcher } from "../../src/testing/fake";
import { createTestRepo, type TestRepo } from "../local/repo";

const ENTITY = "FIX-1";
const SUMMARY = "Add a `reverse` operation to the registry.";
const T1 = "2026-08-02T00:00:00Z";

let repo: TestRepo;
let statePath: string;

afterEach(async () => {
  await repo?.cleanup();
  if (statePath) await fs.rm(statePath, { recursive: true, force: true });
});

/** A resolved config pointing at the test repo, with a given dispatcher. */
function configFor(dispatcher: Dispatcher, policy: ConductorPolicy = DEFAULT_POLICY): ResolvedConductor {
  return {
    repoRoot: repo.root,
    repo: { host: "github.com", owner: "fixpoint-labs", repo: "flow-state-dev" },
    remote: "origin",
    remoteUrl: null,
    baseBranch: "main",
    token: "",
    dispatcher,
    guidance: ["docs/philosophy.md"],
    policy,
    origins: {
      repoRoot: "discovered",
      repo: "discovered",
      baseBranch: "discovered",
      dispatcher: "discovered",
    },
  };
}

/** A clock that moves a second per read, so a tick's rows are ordered. */
function testClock(): () => Date {
  let millis = Date.parse("2026-08-20T12:00:00Z");
  return () => new Date((millis += 1000));
}

/** Open a session over the shared state directory, reading the test checkout. */
async function open(dispatcher: Dispatcher, policy?: ConductorPolicy): Promise<ConductorSession> {
  return openConductor({
    config: configFor(dispatcher, policy),
    statePath,
    observer: localObserver({ repoRoot: repo.root, baseBranch: "main", git: repo.git }),
    git: repo.git,
    now: testClock(),
  });
}

/** A branch with a commit on it, submitted for review the way a human would. */
async function submit(branch: string): Promise<{ number: number; head: string }> {
  await repo.run("checkout", "-q", "-b", branch, "main");
  const head = await repo.commit("operations.ts", "// work\n", `work on ${branch}`, T1);
  await repo.run("checkout", "-q", "main");
  const submission = await openSubmission(repo.root, branch, "main", T1);
  return { number: submission.number, head };
}

/** Write a reviewer's verdict file — the local equivalent of submitting a review. */
async function review(
  number: number,
  reviewer: string,
  state: "APPROVED" | "CHANGES_REQUESTED",
  sha: string,
): Promise<void> {
  const file = path.join(submissionDir(repo.root, number), "reviews", `${reviewer}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ reviewer, state, sha }, null, 2)}\n`);
}

/** Leave a comment in a submission's inbox. */
async function comment(number: number, name: string, body: string): Promise<void> {
  const file = path.join(submissionDir(repo.root, number), "comments", name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

/**
 * Nothing moved a phase outside a recorded action.
 *
 * Mirrors the goal check's structural half: contiguous `seq`, an unbroken
 * `phaseBefore`/`phaseAfter` chain, `enterPhase` as the only action a phase
 * change may ride on, and a stored phase that agrees with the last row.
 */
function ledgerFailures(
  ledger: readonly LedgerEntryState[],
  startPhase: Phase,
  storedPhase: Phase,
): string[] {
  const failures: string[] = [];
  let expectedSeq = 1;
  let expectedPhase: string = startPhase;

  for (const row of ledger) {
    if (row.seq !== expectedSeq) {
      failures.push(`seq is not contiguous: expected ${expectedSeq}, got ${row.seq}`);
    }
    expectedSeq = row.seq + 1;
    if (row.phaseBefore !== expectedPhase) {
      failures.push(
        `row ${row.seq} starts from "${row.phaseBefore}" but the previous row left the ` +
          `entity in "${expectedPhase}" — something moved the phase outside the ledger`,
      );
    }
    if (row.phaseBefore !== row.phaseAfter && row.actionKind !== "enterPhase") {
      failures.push(
        `row ${row.seq} moved the phase on action "${row.actionKind}" — only enterPhase may`,
      );
    }
    expectedPhase = row.phaseAfter;
  }

  if (ledger.length > 0 && expectedPhase !== storedPhase) {
    failures.push(
      `the stored phase is "${storedPhase}" but the ledger ends in "${expectedPhase}"`,
    );
  }
  return failures;
}

/**
 * Every row replays to the action it records.
 *
 * The literal reading of the invariant, and the reason a row carries `signal`
 * and `world` at all. Nothing is hand-built: the entity, the signal and the
 * world all come out of the row.
 */
function replayFailures(ledger: readonly LedgerEntryState[]): string[] {
  const failures: string[] = [];
  for (const row of ledger) {
    if (row.signal === null || row.world === null || row.entityKind === null) {
      failures.push(`row ${row.seq} carries no payload, so its transition cannot be re-run`);
      continue;
    }
    const produced = decide(
      { id: row.entityId, kind: row.entityKind, phase: row.phaseBefore as Phase },
      row.signal,
      row.world,
    ).map((action) => action.kind);
    if (!produced.includes(row.actionKind)) {
      failures.push(
        `replaying row ${row.seq} produced [${produced.join(", ") || "nothing"}] but the row ` +
          `records "${row.actionKind}"`,
      );
    }
  }
  return failures;
}

/** Put the one work item under management, at implementation, as a bug would enter. */
async function manageIssue(session: ConductorSession) {
  return session.manage({
    id: ENTITY,
    kind: "issue",
    issueType: "Bug",
    phase: "IMPLEMENTATION",
    summary: SUMMARY,
  });
}

/** A state directory of this test's own. */
async function freshState(): Promise<void> {
  statePath = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-tick-"));
}

/**
 * The ordinary drive: manage, dispatch the implementation, observe the
 * submission it produced. Returns everything a test needs to keep going.
 */
async function drive(dispatcher: FakeDispatcher) {
  repo = await createTestRepo();
  await freshState();
  const submission = await submit(`fix/${ENTITY}`);
  const session = await open(dispatcher);

  await manageIssue(session);
  const dispatched = await session.tick(ENTITY);
  const observed = await session.tick(ENTITY);
  return { session, submission, dispatched, observed };
}

/** A dispatcher that reports the submission the test already put on disk. */
function harness(): FakeDispatcher {
  return fakeDispatcher({
    // `remote` isolation: the vendor owns its environment, so conductor
    // provisions no worktree and this test needs no git remote to push to.
    isolation: "remote",
    results: [{ produced: { pullNumber: 1 } }],
  });
}

describe("putting one work item under management", () => {
  it("dispatches the phase's opening work on the first tick, and records it", async () => {
    const dispatcher = harness();
    const { dispatched } = await drive(dispatcher);

    expect(dispatcher.actionsRun()).toEqual(["implement"]);
    expect(dispatched.dispatchCount).toBe(1);
    expect(dispatched.ledger.map((row) => row.actionKind)).toEqual(["implement"]);
    expect(dispatched.ledger[0]).toMatchObject({
      entityId: ENTITY,
      entityKind: "issue",
      seq: 1,
      signalKind: "phase_entered",
      phaseBefore: "IMPLEMENTATION",
      phaseAfter: "IMPLEMENTATION",
    });
  });

  it("carries the work item's own words into the brief", async () => {
    const dispatcher = harness();
    await drive(dispatcher);

    // The summary is the entity's resource *content* — prose `decide` never
    // reads — and the brief is the only thing that consumes it.
    expect(dispatcher.briefs[0]?.summary).toBe(SUMMARY);
    expect(dispatcher.briefs[0]?.branch).toBe(`fix/${ENTITY}`);
    expect(dispatcher.briefs[0]?.guidancePaths).toEqual(["docs/philosophy.md"]);
  });

  it("is idempotent on the item's id", async () => {
    const dispatcher = harness();
    const { session } = await drive(dispatcher);

    // Managing it again must not rewind a running item to the phase the caller
    // first named, and must not put a second registry entry alongside it.
    const again = await manageIssue(session);
    expect(again.entity.phase).toBe("IMPLEMENTATION");
    expect(again.ledger).toHaveLength(1);
    expect(again.dispatchCount).toBe(1);
  });

  it("reads the world the dispatch produced, and waits on the gate it opened", async () => {
    const { observed } = await drive(harness());

    expect(observed.gate).toBe("awaiting_review");
    expect(observed.entity.phase).toBe("IMPLEMENTATION");
  });
});

describe("property 1: a redundant tick costs nothing", () => {
  it("appends no ledger row and performs no dispatch against an unchanged world", async () => {
    const dispatcher = harness();
    const { session, observed } = await drive(dispatcher);

    const again = await session.tick(ENTITY);

    expect(again.ledger).toHaveLength(observed.ledger.length);
    expect(again.dispatchCount).toBe(observed.dispatchCount);
    expect(dispatcher.briefs).toHaveLength(1);
    expect(again.gate).toBe(observed.gate);
  });

  it("does not re-record a review it has already reduced", async () => {
    // The half of the cursor `reconcile` diffs against. Without it every tick
    // re-emits the approval and appends another row for it.
    const { session, submission } = await drive(harness());
    await review(submission.number, "alice", "APPROVED", submission.head);

    const approved = await session.tick(ENTITY);
    const again = await session.tick(ENTITY);

    expect(approved.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "recordApproval",
    ]);
    expect(again.ledger).toHaveLength(approved.ledger.length);
  });

  it("does not re-dispatch against a comment it has already reduced", async () => {
    // The other half of the cursor — comments, which have no structural diff.
    // Without it every tick reads the same comment as new and hands the work
    // out again, which is the expensive failure of the two.
    const dispatcher = harness();
    const { session, submission } = await drive(dispatcher);

    await comment(submission.number, "alice.1.md", "This needs a test.\n");
    const answered = await session.tick(ENTITY);
    expect(answered.ledger.at(-1)?.actionKind).toBe("addressFeedback");
    expect(answered.dispatchCount).toBe(2);

    const again = await session.tick(ENTITY);
    expect(again.ledger).toHaveLength(answered.ledger.length);
    expect(again.dispatchCount).toBe(2);
    expect(dispatcher.briefs).toHaveLength(2);
  });

  it("stays quiet across many ticks, not just the second one", async () => {
    const dispatcher = harness();
    const { session, observed } = await drive(dispatcher);

    for (let n = 0; n < 4; n += 1) await session.tick(ENTITY);
    const settled = await session.tick(ENTITY);

    expect(settled.ledger).toHaveLength(observed.ledger.length);
    expect(settled.dispatchCount).toBe(1);
  });
});

describe("property 2: a restart resumes, it does not redo", () => {
  it("re-derives the gate, keeps the phase, and dispatches nothing again", async () => {
    const { session, observed } = await drive(harness());
    void session;

    // The restart: the handle is dropped and a new one opened over the same
    // durable state, with a dispatcher that has received nothing. Nothing
    // in-process carries over, which is the whole point.
    const restarted = fakeDispatcher({ isolation: "remote" });
    const resumed = await open(restarted);

    const reattached = await resumed.read(ENTITY);
    expect(reattached.gate).toBe(observed.gate);
    expect(reattached.entity.phase).toBe(observed.entity.phase);
    expect(reattached.dispatchCount).toBe(observed.dispatchCount);
    expect(reattached.ledger).toHaveLength(observed.ledger.length);

    const ticked = await resumed.tick(ENTITY);
    expect(ticked.dispatchCount).toBe(observed.dispatchCount);
    expect(ticked.gate).toBe(observed.gate);
    expect(ticked.ledger.filter((row) => row.actionKind === "enterPhase")).toHaveLength(0);
    // The hard proof: a dispatcher that never ran anything cannot have redone
    // work, whatever a count derived from storage says.
    expect(restarted.briefs).toHaveLength(0);
  });

  it("survives a restart taken before the world was ever observed", async () => {
    repo = await createTestRepo();
    await freshState();
    await submit(`fix/${ENTITY}`);

    const first = harness();
    const session = await open(first);
    await manageIssue(session);
    await session.tick(ENTITY);

    const second = fakeDispatcher({ isolation: "remote" });
    const resumed = await open(second);
    const ticked = await resumed.tick(ENTITY);

    // The entry that dispatched `implement` is derived from an empty ledger, so
    // the row it wrote is what stops it being derived a second time.
    expect(second.briefs).toHaveLength(0);
    expect(ticked.dispatchCount).toBe(1);
    expect(ticked.ledger.filter((row) => row.actionKind === "implement")).toHaveLength(1);
  });
});

describe("property 3: every transition is reproducible from the ledger", () => {
  it("holds across a drive that dispatches, observes, and records an approval", async () => {
    const dispatcher = harness();
    const { session, submission } = await drive(dispatcher);

    await review(submission.number, "alice", "APPROVED", submission.head);
    const approved = await session.tick(ENTITY);

    expect(approved.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "recordApproval",
    ]);
    expect(approved.ledger[1]).toMatchObject({
      signalKind: "approved",
      phaseBefore: "IMPLEMENTATION",
      phaseAfter: "IMPLEMENTATION",
      // A row's `gate` is what the entity was waiting on *in the world the row
      // carries*, and that world already holds the approval — so by the time
      // the signal reporting it is reduced, nothing is outstanding. Which gate
      // the approval released is recorded by the action, not by this column.
      gate: null,
    });
    const approvalAction = decide(
      { id: ENTITY, kind: "issue", phase: "IMPLEMENTATION" },
      approved.ledger[1]!.signal!,
      approved.ledger[1]!.world!,
    );
    expect(approvalAction).toEqual([
      {
        kind: "recordApproval",
        entityId: ENTITY,
        gate: "awaiting_review",
        reviewer: "alice",
        sha: submission.head,
      },
    ]);

    expect(ledgerFailures(approved.ledger, "IMPLEMENTATION", approved.entity.phase)).toEqual(
      [],
    );
    expect(replayFailures(approved.ledger)).toEqual([]);
  });

  it("stores decide's three arguments whole, not a summary of them", async () => {
    const { session, submission } = await drive(harness());
    await review(submission.number, "alice", "APPROVED", submission.head);
    const approved = await session.tick(ENTITY);

    const row = approved.ledger.at(-1)!;
    expect(row.entityKind).toBe("issue");
    expect(row.signal).toMatchObject({ kind: "approved", reviewer: "alice" });
    // The whole snapshot, including the parts no gate declared — `decide` reads
    // `policy` and `artifacts` and no gate declares either.
    expect(row.world?.policy).toEqual(DEFAULT_POLICY);
    expect(row.world?.artifacts).toHaveLength(1);
    expect(row.world?.pullRequests[submission.number]?.headSha).toBe(submission.head);
  });

  it("survives the round trip through storage, so a restart can still replay it", async () => {
    const { submission } = await drive(harness());
    await review(submission.number, "alice", "APPROVED", submission.head);

    const resumed = await open(fakeDispatcher({ isolation: "remote" }));
    await resumed.tick(ENTITY);
    const read = await resumed.read(ENTITY);

    expect(read.ledger).toHaveLength(2);
    expect(replayFailures(read.ledger)).toEqual([]);
  });
});

describe("a dispatch that could not be run", () => {
  it("settles as a failure and escalates, rather than throwing out of the tick", async () => {
    repo = await createTestRepo();
    await freshState();

    // `cwd` isolation provisions for real, and this checkout has no `origin` —
    // so the branch-existence probe fails, and provisioning refuses rather than
    // guessing (which would reset the branch). The tick must still record it.
    const dispatcher = fakeDispatcher({ isolation: "cwd" });
    const session = await open(dispatcher);
    await manageIssue(session);

    const ticked = await session.tick(ENTITY);

    expect(dispatcher.briefs).toHaveLength(0);
    expect(ticked.ledger.map((row) => row.actionKind)).toEqual(["implement", "escalate"]);
    expect(ticked.dispatchCount).toBe(1);
    expect(replayFailures(ticked.ledger)).toEqual([]);
  });
});

describe("the review-round budget", () => {
  it("counts a round per head, so feedback past the budget escalates", async () => {
    repo = await createTestRepo();
    await freshState();
    const submission = await submit(`fix/${ENTITY}`);

    const dispatcher = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: submission.number } }],
    });
    const session = await open(dispatcher, { ...DEFAULT_POLICY, implementationReviewRoundBudget: 1 });

    await manageIssue(session);
    await session.tick(ENTITY);
    await session.tick(ENTITY);

    await comment(submission.number, "alice.1.md", "This needs a test.\n");
    const first = await session.tick(ENTITY);
    expect(first.ledger.at(-1)?.actionKind).toBe("addressFeedback");

    // A second piece of feedback on the same head is the same round's; the
    // round already counted is what spends the budget.
    await comment(submission.number, "alice.2.md", "And a doc line.\n");
    const second = await session.tick(ENTITY);
    expect(second.ledger.at(-1)?.actionKind).toBe("escalate");

    expect(replayFailures(second.ledger)).toEqual([]);
  });
});
