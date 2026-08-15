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
import { openSubmission, submissionDir, writeCheck } from "../../src/local/store";
import type { LedgerEntryState } from "../../src/model/entities";
import type { Phase } from "../../src/model/phases";
import type { Signal } from "../../src/model/signals";
import { DEFAULT_POLICY, type ConductorPolicy } from "../../src/model/world";
import type { Observer } from "../../src/observe/types";
import { openConductor, type ConductorSession } from "../../src/runtime/session";
import {
  fileStateStore,
  type StateRecord,
  type StateStore,
} from "../../src/runtime/store";
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

/** Seams a test wants to substitute when it opens a session. */
interface OpenOverrides {
  readonly policy?: ConductorPolicy;
  /** The durable store. Defaults to a real directory under `statePath`. */
  readonly store?: StateStore;
  /** Wraps the local observer, for a test that needs the read to take time. */
  readonly observer?: (inner: Observer) => Observer;
}

/** Open a session over the shared state directory, reading the test checkout. */
async function open(
  dispatcher: Dispatcher,
  overrides: OpenOverrides = {},
): Promise<ConductorSession> {
  const observer = localObserver({ repoRoot: repo.root, baseBranch: "main", git: repo.git });
  return openConductor({
    config: configFor(dispatcher, overrides.policy),
    statePath,
    observer: overrides.observer ? overrides.observer(observer) : observer,
    store: overrides.store,
    git: repo.git,
    now: testClock(),
  });
}

/**
 * A store that stops accepting writes the instant one of them matches.
 *
 * The process dying at a chosen point in a tick, rather than a crash the code
 * under test is told about: everything written before the match is on disk, and
 * nothing after it is.
 */
function storeDyingAfter(
  inner: StateStore,
  matches: (key: string, state: StateRecord) => boolean,
): StateStore {
  let dead = false;
  return {
    ...inner,
    async write(address, key, state) {
      if (dead) throw new Error(`the process died before it could write ${key}`);
      await inner.write(address, key, state);
      if (matches(key, state)) dead = true;
    },
  };
}

/** The observer with a yield in it, so two overlapping ticks really do overlap. */
function slowObserver(inner: Observer): Observer {
  return {
    ...inner,
    async observe(request) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return inner.observe(request);
    },
  };
}

/**
 * An observer that reports one extra signal, on the next observation only.
 *
 * Two signal kinds this file needs have no producer yet and are not pretending
 * otherwise: `guidance_changed` has none at all (see `model/phases` on why
 * `guidance` is declared by no gate), and `question_asked` arrives with the
 * classifier — `github/signals` says so in as many words. Both are in the
 * vocabulary `decide` reduces and both name an action conductor dispatches, so
 * the honest stand-in for the missing producer is **the signal, injected at the
 * seam that will one day emit it**. That is a different thing from scripting a
 * dispatcher result no vendor produces, which is how a defect hid in this file
 * for weeks: nothing here invents what the *world* looks like, and every
 * assertion below is still made against a real checkout.
 *
 * One-shot, because an observer that re-reported it every tick would be a world
 * where a guidance document changes forever.
 */
function signalInjector(): {
  send(signal: Signal): void;
  wrap(inner: Observer): Observer;
} {
  let pending: Signal | null = null;
  return {
    send(signal) {
      pending = signal;
    },
    wrap: (inner) => ({
      ...inner,
      async observe(request) {
        const observation = await inner.observe(request);
        if (pending === null) return observation;
        const extra = pending;
        pending = null;
        return { ...observation, signals: [...observation.signals, extra] };
      },
    }),
  };
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

/** Put the one work item under management at spec, as a feature would enter. */
async function manageFeature(session: ConductorSession) {
  return session.manage({
    id: ENTITY,
    kind: "issue",
    issueType: "Feature",
    phase: "SPEC",
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

/** A recording dispatcher that also opened a submission, and what it opened. */
interface AgentDispatcher extends FakeDispatcher {
  /** The submission the agent opened during its run, or `null` before it ran. */
  submission(): { number: number; head: string } | null;
}

/**
 * A harness that behaves the way the shipped one does.
 *
 * It pushes a branch and opens the submission itself, and reports **only the
 * branch** — `claudeCodeDispatcher` deliberately reports nothing else, because
 * whether a pull request exists is a structural fact conductor reads and an
 * agent's prose is not an authority on it. Every other dispatcher in this file
 * is scripted with a `pullNumber`, which is a thing no real vendor here says.
 */
function agentOpeningItsOwnPr(): AgentDispatcher {
  const inner = fakeDispatcher({ isolation: "remote" });
  let opened: { number: number; head: string } | null = null;
  return {
    ...inner,
    submission: () => opened,
    async run(brief) {
      const result = await inner.run(brief);
      opened = await submit(brief.branch!);
      return result;
    },
  };
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

describe("a submission conductor was never told about", () => {
  it("enters the world from the phase's branch, so a gate exists at all", async () => {
    repo = await createTestRepo();
    await freshState();

    const dispatcher = agentOpeningItsOwnPr();
    const session = await open(dispatcher);
    await manageIssue(session);

    const dispatched = await session.tick(ENTITY);

    // What the real harness reports, and no more. Nothing in this result names a
    // pull request, so nothing on the recording path can create the artifact the
    // read is driven by.
    expect(dispatcher.results[0]?.produced).toEqual({ branch: `fix/${ENTITY}` });
    expect(dispatched.gate).toBeNull();

    const observed = await session.tick(ENTITY);

    // The assertion that matters is the gate rather than the fetch: with the
    // submission outside the world every IMPLEMENTATION gate stops applying, the
    // phase completes nothing, and the entity is idle for good after one
    // dispatch — which is the whole drive, unreachable.
    expect(observed.gate).toBe("awaiting_review");

    // And the gate is operable, not merely named: a human's approval on that
    // submission reduces against it.
    const submission = dispatcher.submission()!;
    await review(submission.number, "alice", "APPROVED", submission.head);
    const approved = await session.tick(ENTITY);

    expect(approved.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "recordApproval",
    ]);
    expect(replayFailures(approved.ledger)).toEqual([]);
    expect(ledgerFailures(approved.ledger, "IMPLEMENTATION", approved.entity.phase)).toEqual(
      [],
    );
  });

  it("finds the one a human opened for the branch the agent pushed", async () => {
    repo = await createTestRepo();
    await freshState();

    // The vendor said nothing at all about what it produced — which is the whole
    // shape when the human is the one who opens the pull request.
    const dispatcher = fakeDispatcher({ isolation: "remote", results: [{ produced: {} }] });
    const session = await open(dispatcher);
    await manageIssue(session);
    await session.tick(ENTITY);
    expect(dispatcher.results[0]?.produced).toEqual({});

    // A human, afterwards, with conductor nowhere in the loop.
    const submission = await submit(`fix/${ENTITY}`);
    const observed = await session.tick(ENTITY);

    expect(observed.gate).toBe("awaiting_review");

    await review(submission.number, "alice", "APPROVED", submission.head);
    const approved = await session.tick(ENTITY);
    expect(approved.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "recordApproval",
    ]);
  });

  it("does not go looking once the phase already holds an artifact", async () => {
    // The lookup is a fallback for the window before an artifact exists, not a
    // second authority over the one conductor recorded. Once the phase holds an
    // artifact of its kind, the source is not asked.
    repo = await createTestRepo();
    await freshState();
    await submit(`fix/${ENTITY}`);

    const asked: string[] = [];
    const session = await open(harness(), {
      observer: (inner) => ({
        ...inner,
        submissionForBranch(branch) {
          asked.push(branch);
          return inner.submissionForBranch(branch);
        },
      }),
    });

    await manageIssue(session);
    await session.tick(ENTITY);
    await session.tick(ENTITY);
    await session.tick(ENTITY);

    // Once — on the first tick, before the dispatch recorded the artifact.
    expect(asked).toEqual([`fix/${ENTITY}`]);
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

  it("dispatches the entry work of a phase it advanced into but never entered", async () => {
    repo = await createTestRepo();
    await freshState();
    const spec = await submit(`spec/${ENTITY}`);

    // The interleaving, constructed rather than asserted about: the store stops
    // accepting writes the instant the `enterPhase` row is on disk. The phase
    // has durably advanced to IMPLEMENTATION, and the `phase_entered` that
    // dispatches its opening work was still in the tick's own in-memory queue.
    const first = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: spec.number } }],
    });
    const session = await open(first, {
      store: storeDyingAfter(
        fileStateStore(statePath),
        (key, state) => key.startsWith("ledger/") && state.actionKind === "enterPhase",
      ),
    });

    await manageFeature(session);
    await session.tick(ENTITY);
    await review(spec.number, "alice", "APPROVED", spec.head);
    await expect(session.tick(ENTITY)).rejects.toThrow(/the process died/);
    expect(first.actionsRun()).toEqual(["draftSpec"]);

    // The restart, over a healthy store and a dispatcher that has run nothing.
    // Nothing in the world can produce a signal that starts an implementation:
    // there is no implementation PR, and there never will be until the phase's
    // entry is dispatched. If it is lost here, it is lost permanently.
    const second = fakeDispatcher({ isolation: "remote" });
    const resumed = await open(second);
    const ticked = await resumed.tick(ENTITY);

    expect(ticked.entity.phase).toBe("IMPLEMENTATION");
    expect(second.actionsRun()).toEqual(["implement"]);
    expect(ticked.ledger.filter((row) => row.actionKind === "implement")).toHaveLength(1);
    expect(replayFailures(ticked.ledger)).toEqual([]);

    // And once, not once per tick: the row the recovery wrote is what stops it.
    await resumed.tick(ENTITY);
    expect(second.actionsRun()).toEqual(["implement"]);
  });

  it("dispatches the entry work again when the dispatch died with the process", async () => {
    repo = await createTestRepo();
    await freshState();

    // The window beside the one above, and the reason a row is not enough: the
    // `phase_entered → implement` row is durably on disk and the dispatch it
    // records is still in flight when the process dies. The store stops
    // accepting writes the instant the dispatch record is written, and
    // `runDispatch` writes that record *before* the run — so what is left behind
    // is a dispatch that started and never settled, which is exactly what a
    // killed process leaves. An in-process agent cannot report back after its
    // parent dies, so nothing will ever settle it.
    const first = fakeDispatcher({ isolation: "remote" });
    const session = await open(first, {
      store: storeDyingAfter(fileStateStore(statePath), (key) =>
        key.startsWith("dispatches/"),
      ),
    });

    await manageIssue(session);
    await expect(session.tick(ENTITY)).rejects.toThrow(/the process died/);
    expect(first.actionsRun()).toEqual(["implement"]);

    // The restart, over a healthy store and a dispatcher that has run nothing.
    // Nothing in the world can start an implementation: no submission exists,
    // and none will until this phase's entry work actually runs. If it is
    // suppressed here it is suppressed forever.
    const second = fakeDispatcher({ isolation: "remote" });
    const resumed = await open(second);
    const ticked = await resumed.tick(ENTITY);

    expect(second.actionsRun()).toEqual(["implement"]);
    expect(ticked.entity.phase).toBe("IMPLEMENTATION");
    expect(replayFailures(ticked.ledger)).toEqual([]);

    // And once. The settled record the recovery wrote is what stops it — the
    // unsettled one from the dead process is still sitting there beside it, so
    // "a settled dispatch exists" has to be the test rather than "no unsettled
    // one does", or this loops every tick.
    await resumed.tick(ENTITY);
    expect(second.actionsRun()).toEqual(["implement"]);
  });

  it("escalates a failure it recorded and never got to reduce", async () => {
    repo = await createTestRepo();
    await freshState();

    // The third window on the same seam, and the one no predicate over the
    // dispatch record can see: `runDispatch` persists the *failed* outcome, and
    // the process dies before the `dispatch_failed` that outcome produces has
    // been reduced into the escalation. The store stops accepting writes the
    // instant the settling write lands — the record says "failed", the ledger
    // says nothing, and no observer can help, because the failure was
    // conductor's own fact and no source ever knew it.
    //
    // `cwd` isolation provisions for real and this checkout has no `origin`, so
    // the dispatch settles as a failure without a vendor being involved.
    const first = fakeDispatcher({ isolation: "cwd" });
    const session = await open(first, {
      store: storeDyingAfter(
        fileStateStore(statePath),
        (key, state) => key.startsWith("dispatches/") && state.outcome !== null,
      ),
    });

    await manageIssue(session);
    await expect(session.tick(ENTITY)).rejects.toThrow(/the process died/);

    // The restart, over a healthy store and a dispatcher that has run nothing.
    // `remote` isolation so a re-dispatch would actually reach it — with `cwd`
    // the provisioning failure would hide one.
    const second = fakeDispatcher({ isolation: "remote" });
    const resumed = await open(second);
    const ticked = await resumed.tick(ENTITY);

    // The lost thing was the *signal*, not the run, so the recovery is to
    // reduce it — not to buy the dispatch a second time.
    expect(second.briefs).toHaveLength(0);
    expect(ticked.dispatchCount).toBe(1);
    expect(ticked.ledger.map((row) => row.actionKind)).toEqual(["implement", "escalate"]);
    expect(ticked.ledger.at(-1)).toMatchObject({ signalKind: "dispatch_failed" });
    expect(replayFailures(ticked.ledger)).toEqual([]);
    expect(ledgerFailures(ticked.ledger, "IMPLEMENTATION", ticked.entity.phase)).toEqual([]);

    // And once. The escalation the recovery wrote is the consequence that
    // stops it; the failed dispatch record is still sitting there beside it.
    const again = await resumed.tick(ENTITY);
    expect(again.ledger).toHaveLength(ticked.ledger.length);
    expect(second.briefs).toHaveLength(0);
  });

  it("still enters a phase that dispatches nothing on entry", async () => {
    repo = await createTestRepo();
    await freshState();

    // The other half of the entry proof, and the half a dispatch record cannot
    // carry: an epic phase with no `onEnter` produces no dispatch to settle, so
    // "every entry action has settled" is vacuously true for it. Only the
    // ledger's own `phase_entered` row separates *entered* from *not yet*, and
    // without it nothing ever queues the signal that lets the phase complete —
    // the epic sits in a finished phase with no signal left to move it.
    const dispatcher = fakeDispatcher({ isolation: "remote" });
    const session = await open(dispatcher);
    await session.manage({
      id: "EPIC-1",
      kind: "epic",
      phase: "CROSS_SPEC_REVIEW",
      summary: "One issue, so there is no spec set to be incoherent with.",
    });

    const ticked = await session.tick("EPIC-1");

    expect(ticked.ledger.map((row) => row.actionKind)).toEqual(["enterPhase"]);
    expect(ticked.entity.phase).toBe("ISSUES");
    expect(dispatcher.briefs).toHaveLength(0);
  });

  it("enters a phase with no entry work, on a ledger whose entry dispatch belongs to the phase before", async () => {
    repo = await createTestRepo();
    await freshState();
    const spec = await submit("spec/EPIC-1");

    // The world that pins the *first* clause of `entryCompleted` — a
    // `phase_entered` row **for the phase being entered** — rather than merely
    // exercising it. The two worlds that already existed both let something else
    // do the work: the restart above still has an unsettled dispatch for its own
    // phase, and the epic that dispatches nothing on entry has an empty ledger,
    // so "the ledger is nonempty" is false there for free. Here the ledger is
    // nonempty *and* every entry action of the current phase has settled
    // (vacuously — `CROSS_SPEC_REVIEW` declares none), and the settled entry
    // dispatch on record belongs to `FRAMING`. Nothing but the phase the row was
    // reduced against separates "entered" from "not yet entered".
    const first = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: spec.number } }],
    });
    const session = await open(first, {
      store: storeDyingAfter(
        fileStateStore(statePath),
        (key, state) => key.startsWith("ledger/") && state.actionKind === "enterPhase",
      ),
    });

    await session.manage({
      id: "EPIC-1",
      kind: "epic",
      phase: "FRAMING",
      summary: "One issue, so there is no spec set to be incoherent with.",
    });
    await session.tick("EPIC-1");
    await review(spec.number, "alice", "APPROVED", spec.head);
    await expect(session.tick("EPIC-1")).rejects.toThrow(/the process died/);
    expect(first.actionsRun()).toEqual(["draftSpec"]);

    const second = fakeDispatcher({ isolation: "remote" });
    const resumed = await open(second);
    const ticked = await resumed.tick("EPIC-1");

    // Nothing observable can move this epic: its spec PR is unchanged and its
    // reviews are not even read in the phase it woke up in. If the entry is
    // suppressed here the epic sits in a finished phase for good — which is the
    // failure the whole predicate exists to prevent, reached through the clause
    // no existing world could reach it through.
    expect(ticked.entity.phase).toBe("ISSUES");
    expect(ticked.ledger.map((row) => row.actionKind)).toEqual([
      "draftSpec",
      "recordApproval",
      "enterPhase",
      "enterPhase",
    ]);
    expect(ledgerFailures(ticked.ledger, "FRAMING", ticked.entity.phase)).toEqual([]);
    expect(replayFailures(ticked.ledger)).toEqual([]);

    // And the recovery is a re-derived *entry*, not a re-bought dispatch: the
    // one on record settled, and it was for the phase before.
    expect(second.briefs).toHaveLength(0);
    expect(ticked.dispatchCount).toBe(1);
  });

  it("does not re-run entry work that settled, however it settled", async () => {
    repo = await createTestRepo();
    await freshState();

    // `cwd` isolation provisions for real and this checkout has no `origin`, so
    // the dispatch settles as a failure. Settled is settled: `decide` has
    // already escalated it, and re-deriving the entry would grind out the same
    // failure on every tick.
    const dispatcher = fakeDispatcher({ isolation: "cwd" });
    const session = await open(dispatcher);
    await manageIssue(session);

    const failed = await session.tick(ENTITY);
    expect(failed.ledger.map((row) => row.actionKind)).toEqual(["implement", "escalate"]);

    const again = await session.tick(ENTITY);
    expect(again.dispatchCount).toBe(1);
    expect(again.ledger).toHaveLength(failed.ledger.length);
  });

  it("does not re-enter a phase whose entry work already ran", async () => {
    repo = await createTestRepo();
    await freshState();
    const spec = await submit(`spec/${ENTITY}`);

    const first = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: spec.number } }],
    });
    const session = await open(first);
    await manageFeature(session);
    await session.tick(ENTITY);
    await review(spec.number, "alice", "APPROVED", spec.head);
    const advanced = await session.tick(ENTITY);

    expect(advanced.entity.phase).toBe("IMPLEMENTATION");
    expect(first.actionsRun()).toEqual(["draftSpec", "implement"]);

    // The other half of the property, and the failure a recovery gets wrong by
    // re-seeding unconditionally: an entry that completed must never run twice.
    const second = fakeDispatcher({ isolation: "remote" });
    const resumed = await open(second);
    const ticked = await resumed.tick(ENTITY);

    expect(second.briefs).toHaveLength(0);
    expect(ticked.dispatchCount).toBe(advanced.dispatchCount);
    expect(ticked.ledger.filter((row) => row.actionKind === "implement")).toHaveLength(1);
  });
});

describe("two ticks that overlap", () => {
  it("runs the paid dispatch once, not once per tick", async () => {
    repo = await createTestRepo();
    await freshState();
    await submit(`fix/${ENTITY}`);

    // A cron sweep and a webhook arriving at the same entity at the same time,
    // which is how conductor is meant to be driven. The observer takes a moment
    // so the overlap is the test's rather than the scheduler's: both ticks are
    // past their ledger and cursor reads before either has written anything.
    const dispatcher = harness();
    const session = await open(dispatcher, { observer: slowObserver });
    await manageIssue(session);

    const [cron] = await Promise.all([session.tick(ENTITY), session.tick(ENTITY)]);

    // The dispatcher is the only witness that matters. Both ticks derived the
    // same ledger key and the same dispatch id, so the last atomic rename wrote
    // one record over the other — the counts below agree whether the work ran
    // once or twice, which is exactly why they are not the assertion.
    expect(dispatcher.actionsRun()).toEqual(["implement"]);
    expect(cron.dispatchCount).toBe(1);
    expect(cron.ledger.filter((row) => row.actionKind === "implement")).toHaveLength(1);
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

describe("one review pass's worth of comments", () => {
  it("dispatches one revision for the batch, and still records every comment", async () => {
    const dispatcher = harness();
    const { session, submission } = await drive(dispatcher);

    // A human leaving several comments in one pass — the ordinary shape of a
    // review, not an edge case. One poll discovers all three.
    await comment(submission.number, "alice.1.md", "This needs a test.\n");
    await comment(submission.number, "alice.2.md", "And a doc line.\n");
    await comment(submission.number, "alice.3.md", "Rename the helper.\n");

    const ticked = await session.tick(ENTITY);

    // One pass over the outstanding batch: the brief the first comment produces
    // already asks the agent to address everything outstanding, so the other two
    // are the same work bought again. `countReviewRound` already counts them as
    // one round — this is the dispatcher agreeing with the round accounting.
    expect(dispatcher.actionsRun()).toEqual(["implement", "addressFeedback"]);
    expect(ticked.dispatchCount).toBe(2);

    // And the saving is a saving on *dispatch* only. Every comment still reduced
    // and every reduction still has its row, or the replay invariant has been
    // traded away for the money.
    expect(ticked.ledger.filter((row) => row.signalKind === "feedback_received")).toHaveLength(3);
    expect(ticked.ledger.filter((row) => row.actionKind === "addressFeedback")).toHaveLength(3);
    expect(replayFailures(ticked.ledger)).toEqual([]);
    expect(ledgerFailures(ticked.ledger, "IMPLEMENTATION", ticked.entity.phase)).toEqual([]);
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
    const session = await open(dispatcher, {
      policy: { ...DEFAULT_POLICY, implementationReviewRoundBudget: 1 },
    });

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

describe("the goal check, from the dispatch that proves it to SETTLED", () => {
  /**
   * **Every dispatcher shipped today reports no verdict at all**, so the
   * `goalCheck` these fakes report is scripting a field no real vendor
   * populates yet — the seam's contract rather than an observed behaviour. It is
   * called out here because a fake that reports something no vendor produces is
   * how an entire class of bug hid in this file for weeks. What the fakes below
   * copy faithfully is everything else: `agentProvingItsGoal` reports the branch
   * and the verdict and nothing more, exactly as `claudeCodeDispatcher` reports
   * the branch and nothing more, and it opens its own submission on disk rather
   * than being handed a `pullNumber` conductor would otherwise never learn.
   */

  /** Merge a branch into `main` the way a human ending a review does. */
  async function mergeIntoMain(branch: string): Promise<void> {
    await repo.run("merge", "--no-ff", "-m", `merge ${branch}`, branch);
  }

  /**
   * A harness that pushes a branch, opens its own submission, and reports a goal
   * verdict — the single-PR shape, where the goal is proved at implementation
   * completion, *before* the submission exists.
   *
   * One verdict per dispatch, in order. Past the end of the list a dispatch
   * reports none, which is what every shipped dispatcher does today — so a test
   * that wants a *second* dispatch to re-prove the goal has to say so.
   */
  function agentProvingItsGoal(
    ...verdicts: readonly ("passed" | "failed")[]
  ): AgentDispatcher {
    const inner = fakeDispatcher({
      isolation: "remote",
      results: verdicts.map((goalCheck) => ({ goalCheck })),
    });
    let opened: { number: number; head: string } | null = null;
    return {
      ...inner,
      submission: () => opened,
      async run(brief) {
        const result = await inner.run(brief);
        if (opened === null) opened = await submit(brief.branch!);
        return result;
      },
    };
  }

  it("opens awaiting_merge on a proof taken before the PR, and settles on the merge", async () => {
    repo = await createTestRepo();
    await freshState();

    const dispatcher = agentProvingItsGoal("passed");
    const session = await open(dispatcher);
    await manageIssue(session);

    // The dispatch proves the goal, and the tick that ran it must *not* act on
    // that proof: the submission it went into is seconds old and conductor has
    // not adopted it, so completion would read "no open PR" as "nothing left to
    // merge" and settle an issue that has had no CI, no review and no merge.
    const dispatched = await session.tick(ENTITY);
    expect(dispatched.entity.phase).toBe("IMPLEMENTATION");
    expect(dispatched.ledger.map((row) => row.actionKind)).toEqual(["implement"]);

    const observed = await session.tick(ENTITY);
    expect(observed.entity.phase).toBe("IMPLEMENTATION");
    expect(observed.gate).toBe("awaiting_review");

    // The gate that was unreachable. `awaiting_merge` refuses to apply until the
    // goal has passed, so with the verdict lost between the dispatch that
    // produced it and the snapshot the next tick reduces, an approved PR waits
    // on nothing and conductor never invites anyone to merge.
    const submission = dispatcher.submission()!;
    await review(submission.number, "alice", "APPROVED", submission.head);
    const approved = await session.tick(ENTITY);
    expect(approved.gate).toBe("awaiting_merge");

    // And the phase completes on the human's merge, with no second dispatch:
    // the goal was proved before the PR opened, which is what `awaiting_merge`
    // was waiting for.
    await mergeIntoMain(`fix/${ENTITY}`);
    const settled = await session.tick(ENTITY);

    expect(settled.entity.phase).toBe("SETTLED");
    expect(dispatcher.actionsRun()).toEqual(["implement"]);
    expect(settled.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "recordApproval",
      "enterPhase",
    ]);
    expect(replayFailures(settled.ledger)).toEqual([]);
    expect(ledgerFailures(settled.ledger, "IMPLEMENTATION", settled.entity.phase)).toEqual([]);
  });

  it("settles on the tick the post-merge check passes, since nothing else will move it", async () => {
    repo = await createTestRepo();
    await freshState();
    const submission = await submit(`fix/${ENTITY}`);

    // The other route to a verdict: a human merged ahead of the gate, so
    // `awaiting_goal_check` dispatches `runGoalCheck` and the verdict arrives
    // with the work already on the base. Nothing observable changes afterwards —
    // a merged PR produces no further signal — so a verdict this tick does not
    // reduce is a verdict nothing ever reduces, and the issue sits one step from
    // SETTLED for good.
    const dispatcher = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: submission.number } }, { goalCheck: "passed" }],
    });
    const session = await open(dispatcher);

    await manageIssue(session);
    await session.tick(ENTITY);
    await session.tick(ENTITY);
    await review(submission.number, "alice", "APPROVED", submission.head);
    await session.tick(ENTITY);

    await mergeIntoMain(`fix/${ENTITY}`);
    const settled = await session.tick(ENTITY);

    expect(dispatcher.actionsRun()).toEqual(["implement", "runGoalCheck"]);
    expect(settled.entity.phase).toBe("SETTLED");
    expect(settled.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "recordApproval",
      "runGoalCheck",
      "enterPhase",
    ]);
    expect(settled.ledger.at(-1)?.signalKind).toBe("goal_check_passed");
    expect(replayFailures(settled.ledger)).toEqual([]);
    expect(ledgerFailures(settled.ledger, "IMPLEMENTATION", settled.entity.phase)).toEqual([]);
  });

  it("sends the work back on a failed verdict, rather than escalating an open PR", async () => {
    repo = await createTestRepo();
    await freshState();

    const dispatcher = agentProvingItsGoal("failed");
    const session = await open(dispatcher);
    await manageIssue(session);

    const ticked = await session.tick(ENTITY);

    // A goal that is not met yet is the ordinary state of work in progress, not
    // a human-intervention report — there is a branch and an open submission to
    // push the fix to. Escalating here filed one against the happy path.
    expect(ticked.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "addressFeedback",
    ]);
    expect(dispatcher.actionsRun()).toEqual(["implement", "addressFeedback"]);
    expect(replayFailures(ticked.ledger)).toEqual([]);
  });

  it("runs the post-merge check against what landed, not the branch still sitting there", async () => {
    repo = await createTestRepo();
    await freshState();
    const submission = await submit(`fix/${ENTITY}`);

    // `awaiting_goal_check` applies only once the PR has merged, and it applies
    // while the entity is still in `IMPLEMENTATION` — so the *phase* answers
    // `fix/<id>`, the feature branch, which still exists and still passes. It is
    // not what landed whenever the merge squashed, resolved a conflict, or the
    // base moved on, and a proof taken there settles the issue on code that
    // never reached the base.
    const dispatcher = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: submission.number } }, { goalCheck: "passed" }],
    });
    const session = await open(dispatcher);

    await manageIssue(session);
    await session.tick(ENTITY);
    await session.tick(ENTITY);
    await review(submission.number, "alice", "APPROVED", submission.head);
    await session.tick(ENTITY);
    await mergeIntoMain(`fix/${ENTITY}`);
    await session.tick(ENTITY);

    const brief = dispatcher.briefs.find((b) => b.action === "runGoalCheck");
    expect(brief).toBeDefined();
    expect(brief?.branch).not.toBe(`fix/${ENTITY}`);

    // The name is the mechanism, not decoration: `dispatch/branch` cuts a branch
    // the remote does not have from `<remote>/<base>` and resets it there every
    // time (`branchPlan`'s creation plan, covered in `test/dispatch/branch`), so
    // "a branch conductor never pushes" is how this file says *the base, at the
    // revision that is on it now* with today's policy. What this test does not
    // prove is the git: the checkout has no remote to fetch from, so the
    // composition is asserted in two halves rather than one.
    expect(brief?.branch).toBe(`goal-check/${ENTITY}`);
  });

  describe("a dispatch that lands on the code the proof was taken against", () => {
    /**
     * **A merge gate never opens on unproved work.** `awaiting_merge` refuses to
     * apply until `goalCheck` is `"passed"`, so a verdict that outlives the code
     * it was taken against is conductor inviting a human to merge a change it
     * never proved — while its ledger says it did.
     *
     * Every case below asserts **the gate** rather than the stored field. The
     * field is an implementation of the rule and the gate is the rule; a test
     * reading the field would pass on a clear that never reached storage. The
     * read-back is the second half — a verdict cleared only in the tick's own
     * snapshot is one the next process finds standing.
     *
     * The cases split by where their dispatch is actually reachable, which is
     * not a detail: feedback reduces to nothing under `awaiting_merge` (the gate
     * is a human's, and conductor waits), so a revision can only arrive while
     * the PR is still under review, and it is the *approval afterwards* that
     * would open the merge gate on the stale proof.
     */
    async function proved(
      dispatcher: AgentDispatcher = agentProvingItsGoal("passed"),
      overrides: OpenOverrides = {},
    ): Promise<{
      session: ConductorSession;
      dispatcher: AgentDispatcher;
      submission: { number: number; head: string };
      /** A human approves, which is what opens `awaiting_merge` on a passing proof. */
      approve(): Promise<void>;
    }> {
      repo = await createTestRepo();
      await freshState();

      const session = await open(dispatcher, overrides);
      await manageIssue(session);
      await session.tick(ENTITY);
      expect((await session.tick(ENTITY)).gate).toBe("awaiting_review");

      const submission = dispatcher.submission()!;
      return {
        session,
        dispatcher,
        submission,
        approve: async () => {
          await review(submission.number, "alice", "APPROVED", submission.head);
          await session.tick(ENTITY);
        },
      };
    }

    /** Drive to the open merge gate: the proof stands and a human has approved. */
    async function atTheMergeGate(
      dispatcher: AgentDispatcher = agentProvingItsGoal("passed"),
      overrides: OpenOverrides = {},
    ) {
      const driven = await proved(dispatcher, overrides);
      await driven.approve();
      expect((await driven.session.read(ENTITY)).gate).toBe("awaiting_merge");
      return driven;
    }

    it("shuts it after a conflict resolution wrote different code", async () => {
      const { session, dispatcher } = await atTheMergeGate();

      // The base moves under the branch and touches the same file, so the
      // submission conflicts and an agent is sent to resolve it.
      await repo.commit("operations.ts", "// main side\n", "main edit", "2026-08-03T00:00:00Z");
      const resolved = await session.tick(ENTITY);

      expect(dispatcher.actionsRun()).toEqual(["implement", "resolveConflict"]);
      expect(resolved.gate).not.toBe("awaiting_merge");
      expect((await session.read(ENTITY)).gate).not.toBe("awaiting_merge");
    });

    it("shuts it after a rebase wrote different code", async () => {
      const { session, dispatcher } = await atTheMergeGate();
      const base = await repo.sha("main");

      // A red base is someone else's breakage and conductor waits rather than
      // dispatching. Its *recovery* is what sends an agent to rebase — which
      // replays the branch onto commits the proof never saw.
      await writeCheck(repo.root, base, { conclusion: "failure", at: T1 });
      expect((await session.tick(ENTITY)).gate).toBe("awaiting_merge");

      await writeCheck(repo.root, base, { conclusion: "success", at: T1 });
      const rebased = await session.tick(ENTITY);

      expect(dispatcher.actionsRun()).toEqual(["implement", "rebaseOnBase"]);
      expect(rebased.gate).not.toBe("awaiting_merge");
      expect((await session.read(ENTITY)).gate).not.toBe("awaiting_merge");
    });

    it("shuts it after a guidance re-examination wrote different code", async () => {
      const injected = signalInjector();
      const { session, dispatcher } = await atTheMergeGate(agentProvingItsGoal("passed"), {
        policy: { ...DEFAULT_POLICY, onGuidanceChanged: "reExamineOpenPrs" },
        observer: injected.wrap,
      });

      injected.send({
        kind: "guidance_changed",
        entityId: ENTITY,
        at: "2026-08-03T00:00:00Z",
        path: "docs/philosophy.md",
      });
      const reExamined = await session.tick(ENTITY);

      expect(dispatcher.actionsRun()).toEqual(["implement", "reExamineOpenPrs"]);
      expect(reExamined.gate).not.toBe("awaiting_merge");
      expect((await session.read(ENTITY)).gate).not.toBe("awaiting_merge");
    });

    it("never opens it after a revision wrote different code", async () => {
      const { session, dispatcher, submission, approve } = await proved();

      // Feedback arrives while the PR is still under review, and the revision
      // that answers it is new code — the proof was taken against the code it
      // replaces.
      await comment(submission.number, "alice.1.md", "This needs a test.\n");
      const revised = await session.tick(ENTITY);
      expect(revised.ledger.at(-1)?.actionKind).toBe("addressFeedback");

      // The approval is the moment it costs something: with the stale proof
      // standing, this gate is `awaiting_merge` and a human is invited to merge
      // on a proof that no longer describes the change.
      await approve();

      expect(dispatcher.actionsRun()).toEqual(["implement", "addressFeedback"]);
      expect((await session.read(ENTITY)).gate).not.toBe("awaiting_merge");
    });

    it("opens it when the dispatch re-proved the goal itself", async () => {
      // The one exception, and it is not an exception to the rule so much as the
      // rule read properly: a dispatch that ran the check on the code it just
      // wrote is a *fresh* proof, not a stale one. Clearing that would send the
      // work back for a check it had already passed.
      const { session, dispatcher, submission, approve } = await proved(
        agentProvingItsGoal("passed", "passed"),
      );

      await comment(submission.number, "alice.1.md", "This needs a test.\n");
      await session.tick(ENTITY);
      await approve();

      expect(dispatcher.actionsRun()).toEqual(["implement", "addressFeedback"]);
      expect((await session.read(ENTITY)).gate).toBe("awaiting_merge");
    });

    it("keeps the verdict standing when a dispatch that changed nothing makes no claim", async () => {
      repo = await createTestRepo();
      await freshState();

      // Absent is not "failed" and not "unknown" — it is *the vendor did not
      // say*, which is the rule the whole seam holds. What narrows it is that a
      // dispatch which only replied to a human has nothing to say: the code the
      // proof describes is still the code on the branch, so the merge gate is
      // still reachable. Without this the rule collapses into "every dispatch
      // clears", which throws away proofs and buys goal checks nobody needed.
      const injected = signalInjector();
      const dispatcher = agentProvingItsGoal("passed");
      const session = await open(dispatcher, { observer: injected.wrap });
      await manageIssue(session);
      await session.tick(ENTITY);
      expect((await session.tick(ENTITY)).gate).toBe("awaiting_review");

      const submission = dispatcher.submission()!;
      injected.send({
        kind: "question_asked",
        entityId: ENTITY,
        at: "2026-08-03T00:00:00Z",
        author: "alice",
        commentId: "q1",
        pullNumber: submission.number,
      });
      await session.tick(ENTITY);
      expect(dispatcher.actionsRun()).toEqual(["implement", "answerQuestion"]);

      await review(submission.number, "alice", "APPROVED", submission.head);
      expect((await session.tick(ENTITY)).gate).toBe("awaiting_merge");
    });
  });
});
