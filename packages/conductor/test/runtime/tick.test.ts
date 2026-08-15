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

import type { ResolvedConductor, ResolvedGoalCheck } from "../../src/config/define";
import { decide } from "../../src/driver/decide";
import type { Dispatcher } from "../../src/dispatch/types";
import { localObserver } from "../../src/local/observe";
import { openSubmission, submissionDir, writeCheck } from "../../src/local/store";
import type { DispatchState, LedgerEntryState } from "../../src/model/entities";
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
let originPath: string | null = null;

afterEach(async () => {
  await repo?.cleanup();
  if (statePath) await fs.rm(statePath, { recursive: true, force: true });
  if (originPath) await fs.rm(originPath, { recursive: true, force: true });
  originPath = null;
});

/**
 * Give the test checkout a real `origin` — a bare repository it can push to and
 * be provisioned from.
 *
 * Every other test in this file runs against a checkout with no remote, which is
 * why they all use `remote` isolation: conductor provisions nothing, and the git
 * half of a dispatch is never exercised. A test that wants to assert what a
 * workspace actually ends up on needs the real thing.
 */
async function addOrigin(): Promise<string> {
  const bare = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-origin-"));
  const init = await repo.git(["init", "--bare", "-q", "-b", "main"], bare);
  if (init.code !== 0) throw new Error(`git init --bare failed: ${init.stderr}`);
  await repo.run("remote", "add", "origin", bare);
  await repo.run("push", "-q", "origin", "main");
  originPath = bare;
  return bare;
}

/** A resolved config pointing at the test repo, with a given dispatcher. */
function configFor(
  dispatcher: Dispatcher,
  policy: ConductorPolicy = DEFAULT_POLICY,
  goalCheck: ResolvedGoalCheck | null = null,
): ResolvedConductor {
  return {
    repoRoot: repo.root,
    repo: { host: "github.com", owner: "fixpoint-labs", repo: "flow-state-dev" },
    remote: "origin",
    remoteUrl: null,
    baseBranch: "main",
    token: "",
    dispatcher,
    guidance: ["docs/philosophy.md"],
    goalCheck,
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
  /** The project's goal command. Defaults to none declared. */
  readonly goalCheck?: ResolvedGoalCheck | null;
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
    config: configFor(dispatcher, overrides.policy, overrides.goalCheck ?? null),
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

/**
 * A dispatch that ran, settled `completed`, and left nothing behind.
 *
 * The shape is not a vendor failure and not a crash: the harness authenticated,
 * ran, hit ambiguity — or decided the task was underspecified, or asked its
 * question into a final message nobody reads — and exited cleanly having
 * produced nothing conductor can observe. `outcome` is `"completed"`.
 *
 * What that leaves behind is an entity **no gate describes**. Every gate in the
 * phase turns on a submission, so with no submission not one of them *applies*;
 * `completedWhen` is false; the entry work has settled, so nothing re-dispatches;
 * and nothing failed, so nothing escalates. The entity sits there forever and
 * every tick is a no-op. From outside it looks healthy — which is the whole
 * defect, and the general form of the bug where conductor opened a PR it could
 * not see and idled beside it.
 *
 * **The dispatcher below is the shipped one's shape, not a scripted convenience.**
 * `claudeCodeDispatcher` reports `{ branch }` and nothing else, on purpose, and
 * the default `fakeDispatcher` reports exactly that. Scripting a `pullNumber` is
 * what no real vendor here says, and it is what hid this class: every tick test
 * once handed conductor a submission the vendor had announced, so the world in
 * which the vendor announces nothing was never reached.
 */
describe("a dispatch that completed and produced nothing", () => {
  /** Manage an issue at IMPLEMENTATION and run the entry dispatch. Nothing opens a PR. */
  async function ranAndProducedNothing(dispatcher: FakeDispatcher) {
    repo = await createTestRepo();
    await freshState();
    const session = await open(dispatcher);
    await manageIssue(session);

    const dispatched = await session.tick(ENTITY);
    expect(dispatcher.actionsRun()).toEqual(["implement"]);
    expect(dispatcher.results[0]?.outcome).toBe("completed");
    return { session, dispatched };
  }

  it("escalates on the tick that first observes the nothing, and says what to look at", async () => {
    // The shipped report: a branch name, and no claim at all about a submission.
    const dispatcher = fakeDispatcher({ isolation: "remote" });
    const { session, dispatched } = await ranAndProducedNothing(dispatcher);
    expect(dispatcher.results[0]?.produced).toEqual({ branch: `fix/${ENTITY}` });

    // Not on the tick that ran it. The dispatch record is read once, at the top
    // of a tick, so the tick that buys the work never judges it — which is what
    // leaves room for the *next* one to go looking for a submission on the
    // branch the agent pushed, the recovery an agent-opened PR depends on.
    expect(dispatched.ledger.map((row) => row.actionKind)).toEqual(["implement"]);

    const stalled = await session.tick(ENTITY);

    expect(stalled.ledger.map((row) => row.actionKind)).toEqual(["implement", "escalate"]);
    const row = stalled.ledger.at(-1)!;
    expect(row).toMatchObject({
      signalKind: "progress_stalled",
      phaseBefore: "IMPLEMENTATION",
      phaseAfter: "IMPLEMENTATION",
      gate: null,
    });

    // Actionable, not "entity is stuck": the reason names the phase, what the
    // phase was supposed to leave behind, and where to go looking.
    const reason = decide(
      { id: ENTITY, kind: "issue", phase: "IMPLEMENTATION" },
      row.signal!,
      row.world!,
    ).flatMap((action) => (action.kind === "escalate" ? [action.reason] : []));
    expect(reason).toHaveLength(1);
    expect(reason[0]).toContain("IMPLEMENTATION");
    expect(reason[0]).toContain("no implementation artifact");
    expect(reason[0]).toContain(ENTITY);

    // And it is a real transition, replayable like any other.
    expect(replayFailures(stalled.ledger)).toEqual([]);
    expect(ledgerFailures(stalled.ledger, "IMPLEMENTATION", stalled.entity.phase)).toEqual([]);
  });

  it("asks once, not once per tick", async () => {
    const dispatcher = fakeDispatcher({ isolation: "remote" });
    const { session } = await ranAndProducedNothing(dispatcher);

    const stalled = await session.tick(ENTITY);
    expect(stalled.ledger.map((row) => row.actionKind)).toEqual(["implement", "escalate"]);

    // The row the escalation wrote is what stops it — the same convergence the
    // `dispatch_failed` recovery uses. A stuck entity that also spams is worse
    // than a stuck entity.
    const again = await session.tick(ENTITY);
    const andAgain = await session.tick(ENTITY);

    expect(again.ledger).toHaveLength(stalled.ledger.length);
    expect(andAgain.ledger).toHaveLength(stalled.ledger.length);
    expect(dispatcher.actionsRun()).toEqual(["implement"]);
  });

  it("does not retry the work that produced nothing", async () => {
    // Escalate, never retry. The agent has already demonstrated it cannot make
    // progress here, so another turn is unbounded paid work in exactly the
    // situation that earned the escalation.
    const dispatcher = fakeDispatcher({ isolation: "remote" });
    const { session } = await ranAndProducedNothing(dispatcher);

    const stalled = await session.tick(ENTITY);

    expect(stalled.dispatchCount).toBe(1);
    expect(dispatcher.briefs).toHaveLength(1);
  });

  it("reads a vendor that reported nothing at all the same way", async () => {
    // `{}` and `{ branch }` are one situation to conductor: neither names a host
    // an artifact could be recorded at, so neither is progress. The distinction
    // that matters is structural — is there something a gate can read — not what
    // the vendor chose to mention.
    const dispatcher = fakeDispatcher({ isolation: "remote", results: [{ produced: {} }] });
    const { session } = await ranAndProducedNothing(dispatcher);

    const stalled = await session.tick(ENTITY);
    expect(stalled.ledger.map((row) => row.actionKind)).toEqual(["implement", "escalate"]);
  });

  it("escalates a spec dispatch that wrote a file instead of opening a submission", async () => {
    // The other shape of the same nothing, and the one an artifact-existence
    // test would call progress: the vendor really did produce something, and it
    // is somewhere no gate can read. A spec lives on its spec PR (BP-037); a
    // spec artifact sitting at a path has no reviews, no approval, and no way to
    // complete the phase.
    repo = await createTestRepo();
    await freshState();

    const dispatcher = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { artifactPath: `spec/${ENTITY}.md` } }],
    });
    const session = await open(dispatcher);
    await manageFeature(session);
    await session.tick(ENTITY);

    const stalled = await session.tick(ENTITY);

    expect(stalled.ledger.map((row) => row.actionKind)).toEqual(["draftSpec", "escalate"]);
    expect(stalled.ledger.at(-1)?.signalKind).toBe("progress_stalled");
    expect(replayFailures(stalled.ledger)).toEqual([]);
  });

  describe("the states that must not read as stuck", () => {
    it("stays quiet while an entity waits at a gate somebody else releases", async () => {
      // The positive control that keeps the predicate honest. This entity is
      // just as idle — tick after tick appends nothing — and it is waiting on a
      // human, which is the process working. A predicate that fired on "nothing
      // happened" rather than on "nothing *can* happen" reports it.
      const dispatcher = harness();
      const { session, observed } = await drive(dispatcher);
      expect(observed.gate).toBe("awaiting_review");

      for (let n = 0; n < 3; n += 1) await session.tick(ENTITY);
      const quiet = await session.tick(ENTITY);

      expect(quiet.ledger.map((row) => row.actionKind)).toEqual(["implement"]);
      expect(quiet.gate).toBe("awaiting_review");
    });

    it("stays quiet at a gate that applies and is already released", async () => {
      // The sharper control, and the reason the predicate reads `appliesWhen`
      // rather than the derived gate. An approved implementation PR whose goal
      // was never proved derives **no** gate — `awaiting_merge` refuses to apply
      // on unproved work — so a predicate keyed on "the derived gate is null"
      // escalates the ordinary end of a review. The gate table still describes
      // this entity: `awaiting_review` applies to it, and is satisfied.
      const { session, submission } = await drive(harness());
      await review(submission.number, "alice", "APPROVED", submission.head);

      const approved = await session.tick(ENTITY);
      expect(approved.gate).toBeNull();
      expect(approved.ledger.map((row) => row.actionKind)).toEqual([
        "implement",
        "recordApproval",
      ]);

      const again = await session.tick(ENTITY);
      expect(again.ledger).toHaveLength(approved.ledger.length);
    });

    it("stays quiet once the issue has settled", async () => {
      // A terminal entity has nowhere to go, so "nothing will move it" is what
      // being finished *means*. Its phase holds no gates and completes nothing,
      // which is the exact shape of the stuck world one phase earlier.
      repo = await createTestRepo();
      await freshState();
      const submission = await submit(`fix/${ENTITY}`);

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
      await repo.run("merge", "--no-ff", "-m", `merge fix/${ENTITY}`, `fix/${ENTITY}`);
      const settled = await session.tick(ENTITY);
      expect(settled.entity.phase).toBe("SETTLED");

      const after = await session.tick(ENTITY);
      const later = await session.tick(ENTITY);

      expect(after.ledger).toHaveLength(settled.ledger.length);
      expect(later.ledger).toHaveLength(settled.ledger.length);
      expect(later.ledger.filter((row) => row.actionKind === "escalate")).toEqual([]);
    });

    it("stays quiet while the entry dispatch is still unsettled", async () => {
      // Mid-dispatch looks identical to stuck from the world's side — no
      // submission, no gate — and the two must not be confused: the recovery for
      // an unsettled entry is to run it, not to file a report. The store stops
      // accepting writes the instant the dispatch record lands, which
      // `runDispatch` writes *before* the run, so what is left is a dispatch that
      // started and never settled.
      repo = await createTestRepo();
      await freshState();

      const first = fakeDispatcher({ isolation: "remote" });
      const session = await open(first, {
        store: storeDyingAfter(fileStateStore(statePath), (key) =>
          key.startsWith("dispatches/"),
        ),
      });
      await manageIssue(session);
      await expect(session.tick(ENTITY)).rejects.toThrow(/the process died/);

      const second = fakeDispatcher({ isolation: "remote" });
      const resumed = await open(second);
      const ticked = await resumed.tick(ENTITY);

      // The entry is re-derived and re-run; nothing is escalated on the tick
      // that runs it.
      expect(second.actionsRun()).toEqual(["implement"]);
      expect(ticked.ledger.filter((row) => row.actionKind === "escalate")).toEqual([]);
    });

    it("still reports a stall in the phase after the one that was escalated", async () => {
      // The ask is scoped to the phase it was made in, and this is the world
      // that proves it has to be. An escalation the *spec* earned is answered —
      // the human approved the spec anyway — and the issue moved on. Reading
      // "this entity has been escalated at some point" as "somebody is already
      // looking" silences the implementation stall permanently, which is the
      // original defect with an extra step in front of it.
      repo = await createTestRepo();
      await freshState();
      const spec = await submit(`spec/${ENTITY}`);

      const dispatcher = fakeDispatcher({
        isolation: "remote",
        results: [{ produced: { pullNumber: spec.number } }],
      });
      const session = await open(dispatcher, {
        policy: { ...DEFAULT_POLICY, specReviewRoundBudget: 1 },
      });

      await manageFeature(session);
      await session.tick(ENTITY);
      await session.tick(ENTITY);

      // One pass spends the budget; the next is escalated, in SPEC.
      await comment(spec.number, "alice.1.md", "This needs a decision record.\n");
      await session.tick(ENTITY);
      await comment(spec.number, "alice.2.md", "And a rollback plan.\n");
      const escalated = await session.tick(ENTITY);
      expect(escalated.ledger.at(-1)).toMatchObject({
        actionKind: "escalate",
        phaseBefore: "SPEC",
      });

      // The human answers it by approving anyway, and the issue moves on. The
      // implementation then produces nothing — no submission on its branch.
      await review(spec.number, "alice", "APPROVED", spec.head);
      const implementing = await session.tick(ENTITY);
      expect(implementing.entity.phase).toBe("IMPLEMENTATION");
      expect(dispatcher.actionsRun()).toEqual(["draftSpec", "reviseSpec", "implement"]);

      const stalled = await session.tick(ENTITY);

      expect(stalled.ledger.at(-1)).toMatchObject({
        actionKind: "escalate",
        signalKind: "progress_stalled",
        phaseBefore: "IMPLEMENTATION",
      });
      expect(replayFailures(stalled.ledger)).toEqual([]);
      expect(ledgerFailures(stalled.ledger, "SPEC", stalled.entity.phase)).toEqual([]);
    });

    it("does not file a second report beside the one a failed dispatch already earned", async () => {
      // A failed harness and a harness that produced nothing are the same idle
      // entity, and only one of them is news. `decide` has already escalated the
      // failure, so the stall must read the ask as outstanding rather than
      // stacking a second report on it.
      repo = await createTestRepo();
      await freshState();

      // `cwd` isolation provisions for real against a checkout with no `origin`,
      // so the dispatch settles as a failure without a vendor being involved.
      const dispatcher = fakeDispatcher({ isolation: "cwd" });
      const session = await open(dispatcher);
      await manageIssue(session);

      const failed = await session.tick(ENTITY);
      expect(failed.ledger.map((row) => row.actionKind)).toEqual(["implement", "escalate"]);
      expect(failed.ledger.at(-1)?.signalKind).toBe("dispatch_failed");

      const again = await session.tick(ENTITY);
      expect(again.ledger).toHaveLength(failed.ledger.length);
    });
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

/**
 * A round is one handled feedback pass, and a pass is one revision dispatch.
 *
 * Two properties pull against each other and both are wanted, so each has its
 * own test below and the pair is the rule:
 *
 * - Comments arriving in **one poll** coalesce into one dispatch and one round.
 * - A **second, later** pass on the same head still counts, because it is a
 *   second dispatch somebody paid for.
 *
 * Every test here drives a dispatcher that pushes nothing, so the head never
 * moves. That is not a contrivance — it is the shape a vendor takes when it
 * decides the feedback needs no code change, and it is the shape under which a
 * head-keyed counter sat at one forever while the loop ran.
 */
describe("the review-round budget", () => {
  /** Drive to an open submission under review, with a budget and a mute vendor. */
  async function underReview(budget: number) {
    repo = await createTestRepo();
    await freshState();
    const submission = await submit(`fix/${ENTITY}`);

    const dispatcher = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: submission.number } }],
    });
    const session = await open(dispatcher, {
      policy: { ...DEFAULT_POLICY, implementationReviewRoundBudget: budget },
    });

    await manageIssue(session);
    await session.tick(ENTITY);
    await session.tick(ENTITY);
    return { session, dispatcher, submission };
  }

  /**
   * The round count as the *next* tick reads it.
   *
   * Taken off the world the row carries rather than out of the store: a row's
   * world is the snapshot the reduction was made against, so this is the number
   * the budget was actually spent against, not a field a test went looking for.
   */
  const roundsIn = (work: { ledger: readonly LedgerEntryState[] }): number | undefined =>
    work.ledger.at(-1)?.world?.artifacts.at(-1)?.reviewRounds;

  it("counts a round per pass, so feedback past the budget escalates", async () => {
    const { session, submission } = await underReview(1);

    await comment(submission.number, "alice.1.md", "This needs a test.\n");
    const first = await session.tick(ENTITY);
    expect(first.ledger.at(-1)?.actionKind).toBe("addressFeedback");

    await comment(submission.number, "alice.2.md", "And a doc line.\n");
    const second = await session.tick(ENTITY);
    expect(second.ledger.at(-1)?.actionKind).toBe("escalate");

    expect(replayFailures(second.ledger)).toEqual([]);
  });

  // The finding. A pass that pushes nothing leaves the head where it was, so a
  // counter keyed on the head recorded ZERO for it — while a paid dispatch ran.
  // The counter could sit at one indefinitely, and the cap that is meant to park
  // a stuck loop at twelve rounds never fired however many passes were handled.
  it("counts a second, later pass on an unchanged head", async () => {
    const { session, dispatcher, submission } = await underReview(2);

    await comment(submission.number, "alice.1.md", "This needs a test.\n");
    await session.tick(ENTITY);

    // A separate poll, and a separate paid dispatch: the vendor answered the
    // first pass without writing a commit, so this is the same head again.
    await comment(submission.number, "alice.2.md", "And a doc line.\n");
    const second = await session.tick(ENTITY);
    expect(second.ledger.at(-1)?.actionKind).toBe("addressFeedback");

    await comment(submission.number, "alice.3.md", "Rename the helper.\n");
    const third = await session.tick(ENTITY);

    // Two passes were handled, so two rounds were spent, so the third is past a
    // budget of two. With the head as the key this stays at one forever and the
    // loop never parks.
    expect(roundsIn(third)).toBe(2);
    expect(third.ledger.at(-1)?.actionKind).toBe("escalate");

    // And the head really did not move — which is what makes the count above the
    // count of *passes* rather than of commits.
    expect(third.ledger.at(-1)?.world?.pullRequests[submission.number]?.headSha).toBe(
      submission.head,
    );
    expect(dispatcher.actionsRun()).toEqual([
      "implement",
      "addressFeedback",
      "addressFeedback",
    ]);
    expect(replayFailures(third.ledger)).toEqual([]);
  });

  // The other half, and the one that must not be traded away for the fix above:
  // a human leaving three comments in one review pass is one pass. `runTick`'s
  // dispatch coalescing is what makes it one, and the round is counted inside
  // that guard.
  it("counts one poll's worth of comments as a single pass", async () => {
    const { session, dispatcher, submission } = await underReview(2);

    await comment(submission.number, "alice.1.md", "This needs a test.\n");
    await comment(submission.number, "alice.2.md", "And a doc line.\n");
    await comment(submission.number, "alice.3.md", "Rename the helper.\n");
    const batched = await session.tick(ENTITY);
    expect(batched.ledger.filter((row) => row.actionKind === "addressFeedback")).toHaveLength(3);
    expect(batched.dispatchCount).toBe(2);

    // One round for the batch, read off the next reduction's own snapshot. Three
    // would have spent the budget of two here, and this next pass would escalate
    // instead of being handled.
    await comment(submission.number, "alice.4.md", "One more thought.\n");
    const later = await session.tick(ENTITY);

    expect(roundsIn(later)).toBe(1);
    expect(later.ledger.at(-1)?.actionKind).toBe("addressFeedback");
    expect(dispatcher.actionsRun()).toEqual([
      "implement",
      "addressFeedback",
      "addressFeedback",
    ]);
    expect(replayFailures(later.ledger)).toEqual([]);
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
    //
    // The verdict itself comes from conductor rather than from this dispatcher —
    // it runs the goal check itself, and with no goal command declared here it
    // has nothing to prove and says so. What this case is about is the *reducing*
    // of a verdict that arrives with nothing left to observe; the verdict's own
    // provenance is pinned against a real program in the block below.
    const dispatcher = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: submission.number } }],
    });
    const session = await open(dispatcher);

    await manageIssue(session);
    await session.tick(ENTITY);
    await session.tick(ENTITY);
    await review(submission.number, "alice", "APPROVED", submission.head);
    await session.tick(ENTITY);

    await mergeIntoMain(`fix/${ENTITY}`);
    const settled = await session.tick(ENTITY);

    expect(dispatcher.actionsRun()).toEqual(["implement"]);
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

  /*
   * Two cases used to sit here, asserting *the brief handed to a vendor* for a
   * `runGoalCheck` — that it named no branch, and that the workspace it carried
   * stood on the base. Conductor no longer hands that action to a vendor at all:
   * a verdict must come from an exit status, so conductor runs the goal command
   * itself and there is no brief to inspect. Both properties they pinned are
   * asserted in the block below, from inside the goal runner, which is a
   * stronger place to ask from — it answers where the check *actually* stood
   * rather than where the workspace was said to be.
   */

  /**
   * **A merge gate never opens on unproved work.** `awaiting_merge` refuses to
   * apply until the goal has passed, so a verdict that outlives the code it was
   * taken against is conductor inviting a human to merge a change it never
   * proved — while its ledger says it did.
   *
   * Every case below asserts **the gate** rather than the stored field. The
   * field is an implementation of the rule and the gate is the rule; a test
   * reading the field would pass on a clear that never reached storage. The
   * read-back is the second half — a verdict invalidated only in the tick's own
   * snapshot is one the next process finds standing.
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

  describe("a dispatch that lands on the code the proof was taken against", () => {
    /**
     * The cases split by where their dispatch is actually reachable, which is
     * not a detail: feedback reduces to nothing under `awaiting_merge` (the gate
     * is a human's, and conductor waits), so a revision can only arrive while
     * the PR is still under review, and it is the *approval afterwards* that
     * would open the merge gate on the stale proof.
     */

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

    /**
     * The same harness, except that its revisions really write code: every
     * dispatch after the first commits to the branch before it reports.
     *
     * The other cases in this block are named for code a dispatch wrote and are
     * driven by fakes that write none — which is exactly right for them, since
     * what they pin is conductor's own handling of a dispatch it ran. The case
     * below is about the *revision* a dispatch left behind, so the head has to
     * actually move for it to be pinning anything.
     */
    function agentThatPushes(
      ...verdicts: readonly ("passed" | "failed")[]
    ): AgentDispatcher {
      const inner = agentProvingItsGoal(...verdicts);
      let revisions = 0;
      return {
        ...inner,
        async run(brief) {
          const result = await inner.run(brief);
          if (brief.action !== "implement") {
            revisions += 1;
            await repo.run("checkout", "-q", brief.branch!);
            await repo.commit(
              "operations.ts",
              `// revision ${revisions}\n`,
              `revision ${revisions}`,
              "2026-08-03T00:00:00Z",
            );
            await repo.run("checkout", "-q", "main");
          }
          return result;
        },
      };
    }

    it("binds a re-proof to the code the dispatch wrote, not the head it started from", async () => {
      // A tick's snapshot was read *before* its dispatch ran, so the head in it
      // predates whatever the agent has just pushed. Recording a fresh verdict
      // against that head would name a revision the check never saw — and the
      // next observation, finding a different head, would throw the live proof
      // away and send the work back for a check it had already passed. So the
      // revision is recorded as unknown and resolved by the observation that can
      // actually answer it.
      const { session, dispatcher, submission } = await proved(
        agentThatPushes("passed", "passed"),
      );

      await comment(submission.number, "alice.1.md", "This needs a test.\n");
      await session.tick(ENTITY);

      const rewritten = await repo.sha(`fix/${ENTITY}`);
      expect(rewritten).not.toBe(submission.head);

      await review(submission.number, "alice", "APPROVED", rewritten);
      const approved = await session.tick(ENTITY);

      expect(dispatcher.actionsRun()).toEqual(["implement", "addressFeedback"]);
      expect(approved.gate).toBe("awaiting_merge");
      expect((await session.read(ENTITY)).gate).toBe("awaiting_merge");
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

  describe("a head that moved with no dispatch behind it", () => {
    /**
     * **The list of dispatch kinds cannot be the guarantee, because a head can
     * change with no dispatch at all.** A human — or any automation conductor is
     * not driving — pushes another commit to the implementation PR. The next
     * observation reads the new head and records it as a divergence, which is
     * the correct handling of a fact the source owns; no action is produced, so
     * nothing ever consults the dispatch table, and the stored verdict stands.
     * Green CI and a fresh approval on that new head then open `awaiting_merge`
     * on proof of code that is no longer there.
     *
     * What closes it is not a longer list of causes but binding the verdict to
     * the revision it proved. A push nobody dispatched then fails the gate's
     * question — *does this verdict describe the current head?* — by the same
     * mechanism a revision does, and so does a cause nobody has thought of yet.
     */

    /** A human pushing another commit to the PR, with conductor nowhere in the loop. */
    async function pushToBranch(branch: string): Promise<string> {
      await repo.run("checkout", "-q", branch);
      const head = await repo.commit(
        "operations.ts",
        "// a human's own edit\n",
        "a human pushes to the open PR",
        "2026-08-03T00:00:00Z",
      );
      await repo.run("checkout", "-q", "main");
      return head;
    }

    it("never opens the merge gate on a proof the push left behind", async () => {
      const { session, dispatcher, submission } = await proved();

      // Nothing conductor did is in this sequence. A human pushes, CI goes
      // green on the commit they pushed, and they approve it.
      const pushed = await pushToBranch(`fix/${ENTITY}`);
      expect(pushed).not.toBe(submission.head);
      await writeCheck(repo.root, pushed, { conclusion: "success", at: T1 });
      await review(submission.number, "alice", "APPROVED", pushed);

      const ticked = await session.tick(ENTITY);

      // No dispatch ran, which is the whole point: the invalidation cannot have
      // come from the dispatch table.
      expect(dispatcher.actionsRun()).toEqual(["implement"]);
      expect(ticked.gate).not.toBe("awaiting_merge");
      expect((await session.read(ENTITY)).gate).not.toBe("awaiting_merge");
      // And it does not settle either — completion rests on the same proof, so
      // a gate that merely stopped being *derived* would still finish the issue.
      expect(ticked.entity.phase).toBe("IMPLEMENTATION");
      expect(replayFailures(ticked.ledger)).toEqual([]);
    });

    it("opens it when the head the proof describes is still the head", async () => {
      const { session, dispatcher, submission } = await proved();

      // The same green CI and the same fresh approval as above. The only
      // difference is that nobody pushed — so a fix that simply never opened the
      // gate passes the case above and fails here.
      await writeCheck(repo.root, submission.head, { conclusion: "success", at: T1 });
      await review(submission.number, "alice", "APPROVED", submission.head);

      const ticked = await session.tick(ENTITY);

      expect(dispatcher.actionsRun()).toEqual(["implement"]);
      expect(ticked.gate).toBe("awaiting_merge");
      expect((await session.read(ENTITY)).gate).toBe("awaiting_merge");
      expect(replayFailures(ticked.ledger)).toEqual([]);
    });
  });
});

/**
 * The goal check conductor runs itself.
 *
 * **Not one assertion in this block is made against a scripted verdict.** The
 * block above it drives `DispatchResult.goalCheck` through a fake, which is the
 * seam's contract and is worth pinning — but no dispatcher shipped today can
 * populate that field, because a coding harness returns the terminal subtype of
 * its own agent loop rather than the exit status of anything the agent ran
 * inside it. So the field was never set on a real run, `awaiting_goal_check` was
 * a gate nothing could release, and every merged issue waited at it forever
 * while a fake made the path look exercised. That is the failure mode this block
 * exists to make impossible: the verdicts below come from a **real program on
 * disk, whose exit status conductor read**, and the dispatcher is asserted to
 * have run nothing but the implementation.
 */
describe("the goal check, run by conductor against the repo's own goal command", () => {
  let goalDir: string;

  afterEach(async () => {
    if (goalDir) await fs.rm(goalDir, { recursive: true, force: true });
  });

  /** One call the goal runner recorded about itself. */
  interface GoalCall {
    /** Where it ran — the workspace conductor provisioned for it. */
    readonly cwd: string;
    /** The final argument, which is the only thing conductor appends. */
    readonly argument: string | undefined;
    /** The revision its working directory was standing on. */
    readonly head: string;
    /** Its own process id, so a test can ask whether it is still alive. */
    readonly pid: number;
  }

  /**
   * A real goal runner: a program on disk that records how it was called and
   * exits with the code it was built for.
   *
   * Deliberately **not** a fake, an injected seam, or a scripted result. The
   * verdict conductor records has to come from a process it spawned and an exit
   * status it read, and the only way to test that is to make it do exactly that.
   */
  async function goalRunner(
    exitCode: number,
    options: { readonly hang?: boolean; readonly timeoutMs?: number } = {},
  ): Promise<{
    goalCheck: ResolvedGoalCheck;
    /** Every invocation, as the runner itself recorded it. */
    calls(): Promise<GoalCall[]>;
  }> {
    goalDir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-goal-"));
    const log = path.join(goalDir, "calls.ndjson");
    const script = path.join(goalDir, "run.mjs");
    await fs.writeFile(
      script,
      [
        `import fs from "node:fs";`,
        `import { execFileSync } from "node:child_process";`,
        `const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })`,
        `  .toString().trim();`,
        `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({`,
        `  cwd: process.cwd(), argument: process.argv[2], head, pid: process.pid,`,
        `}) + "\\n");`,
        options.hang ? `setInterval(() => {}, 1000);` : `process.exit(${exitCode});`,
      ].join("\n"),
    );
    return {
      goalCheck: {
        command: [process.execPath, script],
        timeoutMs: options.timeoutMs ?? 60_000,
      },
      calls: async () => {
        const raw = await fs.readFile(log, "utf8").catch(() => "");
        return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as GoalCall);
      },
    };
  }

  /**
   * Every dispatch record on disk, read the way an operator would — the store
   * is one file per record, so nothing needs to expose an accessor for a test.
   */
  async function dispatchRecords(): Promise<DispatchState[]> {
    const rows: DispatchState[] = [];
    const walk = async (dir: string, inside: boolean): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, inside || entry.name === "dispatches");
        else if (inside && entry.name.endsWith(".json")) {
          rows.push(JSON.parse(await fs.readFile(full, "utf8")) as DispatchState);
        }
      }
    };
    await walk(statePath, false);
    return rows;
  }

  /** The record of the one execution conductor performed itself. */
  async function goalCheckRecord(): Promise<DispatchState | undefined> {
    return (await dispatchRecords()).find((row) => row.action === "runGoalCheck");
  }

  /**
   * Whether a process is gone, polled briefly. `kill(pid, 0)` sends no signal
   * and answers whether the process exists; a kill is asynchronous, so the
   * honest test waits a moment for it rather than sampling once.
   */
  async function stopped(pid: number): Promise<boolean> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  /** A goal command naming a program that is not there. */
  async function missingGoalRunner(): Promise<ResolvedGoalCheck> {
    goalDir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-goal-"));
    return { command: [path.join(goalDir, "no-such-runner")], timeoutMs: 60_000 };
  }

  /**
   * Drive one issue to the moment the post-merge check is dispatched: the work
   * is implemented, submitted, approved by a human, and merged, and the base has
   * moved on afterwards the way a real base does.
   *
   * The dispatcher declares `worktree` isolation — what the shipped one
   * declares — and there is a real `origin` to fetch from, because the check is
   * provisioned from the remote's base and a stand-in for that would be a
   * stand-in for the thing under test.
   */
  async function merged(overrides: OpenOverrides = {}): Promise<{
    session: ConductorSession;
    dispatcher: FakeDispatcher;
    /** The revision on the base after the merge — what a reader of it now gets. */
    base: string;
    submission: { number: number; head: string };
  }> {
    repo = await createTestRepo();
    await freshState();
    await addOrigin();

    const submission = await submit(`fix/${ENTITY}`);
    await repo.run("push", "-q", "origin", `fix/${ENTITY}`);

    // A branch on the remote with the name a branch-shaped goal check would
    // have used. It is left there on purpose: under a plan keyed on a branch
    // name, a ref a vendor pushed is what flips the next provision onto the
    // re-entry plan and stands it on the previous run's commits instead of the
    // base. The detached plan has no name for that to attach to.
    await repo.run("push", "-q", "origin", `fix/${ENTITY}:goal-check/${ENTITY}`);

    const dispatcher = fakeDispatcher({
      isolation: "worktree",
      results: [{ produced: { pullNumber: submission.number } }],
    });
    const session = await open(dispatcher, overrides);

    await manageIssue(session);
    await session.tick(ENTITY);
    await session.tick(ENTITY);
    await review(submission.number, "alice", "APPROVED", submission.head);
    await session.tick(ENTITY);

    await repo.run("merge", "--no-ff", "-m", `merge fix/${ENTITY}`, `fix/${ENTITY}`);
    await repo.commit("later.ts", "// landed after\n", "someone else's merge", "2026-08-04T00:00:00Z");
    await repo.run("push", "-q", "origin", "main");

    return { session, dispatcher, base: await repo.sha("main"), submission };
  }

  it("settles the issue on a goal command that exited 0, with no scripted verdict anywhere", async () => {
    const goal = await goalRunner(0);
    const { session, dispatcher } = await merged({ goalCheck: goal.goalCheck });

    const settled = await session.tick(ENTITY);

    // The milestone: an issue reaching SETTLED because a program exited 0.
    expect(settled.entity.phase).toBe("SETTLED");
    expect(settled.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "recordApproval",
      "runGoalCheck",
      "enterPhase",
    ]);
    expect(settled.ledger.at(-1)?.signalKind).toBe("goal_check_passed");

    // And it came from a process, not from a harness: the goal ran once, and the
    // only thing the dispatcher was ever asked for was the implementation.
    expect(await goal.calls()).toHaveLength(1);
    expect(dispatcher.actionsRun()).toEqual(["implement"]);

    expect(replayFailures(settled.ledger)).toEqual([]);
    expect(ledgerFailures(settled.ledger, "IMPLEMENTATION", settled.entity.phase)).toEqual([]);
  });

  it("does not settle the issue on a goal command that exited non-zero", async () => {
    const goal = await goalRunner(1);
    const { session } = await merged({ goalCheck: goal.goalCheck });

    const checked = await session.tick(ENTITY);

    // The work goes back rather than forward. After a merge there is no open PR
    // left to push a fix to, so back means a human — which is a different answer
    // from the pre-merge one and the same refusal to settle.
    expect(checked.entity.phase).toBe("IMPLEMENTATION");
    expect(checked.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "recordApproval",
      "runGoalCheck",
      "escalate",
    ]);
    expect(checked.ledger.at(-1)?.signalKind).toBe("goal_check_failed");
    expect(await goal.calls()).toHaveLength(1);
    expect(replayFailures(checked.ledger)).toEqual([]);
  });

  /**
   * **What was proved is what landed, not the branch still sitting there.**
   * `awaiting_goal_check` applies while the entity is still in `IMPLEMENTATION`,
   * whose branch is `fix/<id>` — which still exists and still passes, and is not
   * what a reader of the base gets once the merge squashed, resolved a conflict,
   * or somebody else's change landed on top. Asserted from inside the runner,
   * which is the only place that can answer where it actually stood.
   */
  it("runs the command detached on the base at the revision the remote has now", async () => {
    const goal = await goalRunner(0);
    const { session, base, submission } = await merged({ goalCheck: goal.goalCheck });

    await session.tick(ENTITY);

    const [call] = await goal.calls();
    expect(call.head).toBe(base);
    expect(call.head).not.toBe(submission.head);

    // Detached, not on a branch: `--abbrev-ref HEAD` answers with the literal
    // "HEAD" when nothing is checked out, which is what keeps a pushed
    // `goal-check/<id>` from ever being what a later run stands on.
    const branch = (await repo.git(["rev-parse", "--abbrev-ref", "HEAD"], call.cwd)).stdout.trim();
    expect(branch).toBe("HEAD");

    // And the code really is there — the commit that landed after the merge is
    // in the tree the check ran against. `fix/<id>` does not contain it.
    const later = (await repo.git(["show", "HEAD:later.ts"], call.cwd)).stdout.trim();
    expect(later).toBe("// landed after");
  });

  it("tells the command which work item it is proving, and nothing else", async () => {
    const goal = await goalRunner(0);
    const { session } = await merged({ goalCheck: goal.goalCheck });

    await session.tick(ENTITY);

    // The one thing conductor appends, and it comes from its own registry. The
    // command itself is the project's declaration, verbatim — nothing a
    // dispatched agent writes can add to it or replace it.
    const [call] = await goal.calls();
    expect(call.argument).toBe(ENTITY);
  });

  /**
   * **An issue with no goal to run cannot be held on proving one.**
   *
   * `awaiting_goal_check` is released by a verdict and by nothing else, so a
   * project that declares no goal command would otherwise strand every issue it
   * merges — the same forever-wait, arrived at from the other direction. So
   * conductor records a pass, and the dispatch record says in as many words that
   * nothing ran, which is what keeps it distinguishable from a real one.
   */
  it("settles an issue whose project declares no goal command, and says nothing ran", async () => {
    const { session, dispatcher } = await merged();

    const settled = await session.tick(ENTITY);

    expect(settled.entity.phase).toBe("SETTLED");
    expect(settled.ledger.at(-1)?.signalKind).toBe("goal_check_passed");
    expect(dispatcher.actionsRun()).toEqual(["implement"]);

    const record = await goalCheckRecord();
    expect(record?.vendor).toBe("conductor");
    expect(record?.detail).toContain("No goal command is declared");
  });

  /**
   * **A runner that cannot be executed is conductor's failure, not the work's.**
   *
   * The two are opposite asks: a failed goal sends somebody to read the diff, a
   * missing runner sends somebody to fix the configuration. Reporting the second
   * as the first tells an engineer their change did not do what the issue asked
   * because a program was not installed — so it claims **no verdict at all**,
   * settles the dispatch as failed, and escalates with the reason.
   */
  it("escalates a goal command that cannot be executed, and claims no verdict", async () => {
    const { session } = await merged({ goalCheck: await missingGoalRunner() });

    const checked = await session.tick(ENTITY);

    expect(checked.entity.phase).toBe("IMPLEMENTATION");
    expect(checked.ledger.map((row) => row.actionKind)).toEqual([
      "implement",
      "recordApproval",
      "runGoalCheck",
      "escalate",
    ]);
    expect(checked.ledger.at(-1)?.signalKind).toBe("dispatch_failed");

    // No verdict, either way. A "failed" here would settle nothing and would
    // read, everywhere it matters, as *the change did not do what was asked*.
    expect((await session.read(ENTITY)).gate).toBe("awaiting_goal_check");

    const record = await goalCheckRecord();
    expect(record?.outcome).toBe("failed");
    expect(record?.detail).toContain("could not be executed");
  });

  it("kills a goal command that hangs, and reports it as a run that never happened", async () => {
    const goal = await goalRunner(0, { hang: true, timeoutMs: 250 });
    const { session } = await merged({ goalCheck: goal.goalCheck });

    const checked = await session.tick(ENTITY);

    // It started — the runner recorded itself before hanging — and it still
    // proved nothing. "It ran" is not the question; "it reported a status" is.
    const [call] = await goal.calls();
    expect(checked.ledger.at(-1)?.signalKind).toBe("dispatch_failed");
    expect((await session.read(ENTITY)).gate).toBe("awaiting_goal_check");
    expect((await goalCheckRecord())?.detail).toContain("did not finish within");

    // And it is actually gone. Giving up on a runner without killing it leaves
    // one orphaned process per timed-out check, holding whatever the check had
    // open, for the life of the machine — a leak that is invisible from the
    // ledger, which is exactly why it is asserted against the process table.
    expect(await stopped(call.pid)).toBe(true);
  });
});
