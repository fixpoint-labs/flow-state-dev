/**
 * The local observer, against a repository that actually exists.
 *
 * Every test here creates a real git repository, makes real commits, and writes
 * the review files a human would write. Nothing is stubbed, and that is the
 * claim under test: the local source is a second *implementation* of the
 * observer seam, not a second fake. `../testing/replay` is handed its answers;
 * this one has to go and find them, and a test that fed it answers would prove
 * nothing about whether it can.
 *
 * The properties that matter, in order of how badly getting them wrong would
 * hurt:
 *
 * - **A merged branch is merged because git says it is** — ancestry, not a flag.
 * - **An approval goes stale when a commit lands after it**, without the
 *   reviewer having to write down which commit they were looking at.
 * - **A check conclusion is never invented.** No record means no CI, which the
 *   gate already reads as "nothing to wait for" rather than as a failure.
 * - **A phase reads only what its gates declared**, the same contract the
 *   GitHub reader holds.
 */

import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decide } from "../../src/driver/decide";
import { deriveGate } from "../../src/driver/derive-gate";
import { localObserver, LOCAL_SOURCE } from "../../src/local/observe";
import { openSubmission, submissionDir, writeCheck } from "../../src/local/store";
import type { ArtifactFacts, World } from "../../src/model/world";
import { hasFreshHumanApproval } from "../../src/model/world";
import { EMPTY_OBSERVATION_CURSOR, type ObservationCursor } from "../../src/observe/types";
import { createTestRepo, type TestRepo } from "./repo";

const ENTITY_ID = "FIX-1";
const NOW = "2026-08-20T12:00:00Z";
const T1 = "2026-08-02T00:00:00Z";
const T2 = "2026-08-04T00:00:00Z";
const T3 = "2026-08-06T00:00:00Z";

let repo: TestRepo;

afterEach(async () => {
  await repo?.cleanup();
});

/** A submission opened on a branch that already has a commit of its own. */
async function submitBranch(
  branch: string,
  file = "spec.md",
  content = "draft\n",
  date = T1,
): Promise<{ number: number; head: string }> {
  await repo.run("checkout", "-q", "-b", branch, "main");
  const head = await repo.commit(file, content, `work on ${branch}`, date);
  await repo.run("checkout", "-q", "main");
  const submission = await openSubmission(repo.root, branch, "main", T1);
  return { number: submission.number, head };
}

function artifactAt(number: number, kind: ArtifactFacts["kind"] = "spec"): ArtifactFacts {
  return { id: `art-${kind}`, kind, hostedAt: { type: "pr", number }, reviewRounds: 0 };
}

function observeWith(
  artifacts: readonly ArtifactFacts[],
  cursor: ObservationCursor = EMPTY_OBSERVATION_CURSOR,
  phase: "SPEC" | "IMPLEMENTATION" = "SPEC",
) {
  return localObserver({ repoRoot: repo.root, baseBranch: "main", git: repo.git }).observe({
    entityId: ENTITY_ID,
    entity: { kind: "issue", phase },
    artifacts,
    cursor,
    now: NOW,
  });
}

/** A path inside a submission's directory, relative to the repo root. */
function inbox(number: number, ...parts: string[]): string {
  return path.relative(repo.root, path.join(submissionDir(repo.root, number), ...parts));
}

/** Write the file a reviewer writes, and date it. */
async function fileReview(
  number: number,
  name: string,
  payload: Record<string, unknown>,
  at: string,
): Promise<void> {
  const relative = inbox(number, "reviews", name);
  await repo.write(relative, `${JSON.stringify(payload, null, 2)}\n`);
  await repo.touch(relative, at);
}

describe("the observer itself", () => {
  it("declares which source an observation came from", async () => {
    repo = await createTestRepo();
    expect(localObserver({ repoRoot: repo.root, git: repo.git }).source).toBe(LOCAL_SOURCE);
  });
});

describe("a branch submitted for review", () => {
  it("is read from git: real head, real mergeability, and no invented CI", async () => {
    repo = await createTestRepo();
    const { number, head } = await submitBranch("spec/FIX-1");

    const observation = await observeWith([artifactAt(number)]);
    const pr = observation.world.pullRequests[number]!;

    expect(pr.state).toBe("open");
    expect(pr.headSha).toBe(head);
    expect(pr.mergeable).toBe(true);
    // Nothing has run checks against this commit, and the observer does not
    // pretend otherwise.
    expect(pr.checks).toBeNull();
    expect(pr.reviews).toEqual([]);
  });

  it("produces the opening signal the first time conductor sees it", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");

    const observation = await observeWith([artifactAt(number)]);

    expect(observation.signals.map((signal) => signal.kind)).toEqual(["pr_opened"]);
    expect(observation.signals[0]).toMatchObject({
      kind: "pr_opened",
      entityId: ENTITY_ID,
      pullNumber: number,
      synthesized: true,
    });
  });

  it("produces nothing the second time, so a per-tick read does not re-dispatch", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");

    const first = await observeWith([artifactAt(number)]);
    const second = await observeWith([artifactAt(number)], first.cursor);

    expect(second.signals).toEqual([]);
  });

  it("reports a conflict when one appears, by trying the merge for real", async () => {
    repo = await createTestRepo();
    await repo.run("checkout", "-q", "-b", "spec/FIX-1", "main");
    await repo.commit("shared.txt", "branch side\n", "branch edit", T1);
    await repo.run("checkout", "-q", "main");
    const { number } = await openSubmission(repo.root, "spec/FIX-1", "main", T1);

    const clean = await observeWith([artifactAt(number)]);
    expect(clean.world.pullRequests[number]!.mergeable).toBe(true);

    // The base moves under the branch and touches the same line.
    await repo.commit("shared.txt", "main side\n", "main edit", T2);

    const conflicted = await observeWith([artifactAt(number)], clean.cursor);

    expect(conflicted.world.pullRequests[number]!.mergeable).toBe(false);
    expect(conflicted.signals.map((s) => s.kind)).toContain("merge_conflict");
  });
});

describe("a review a human wrote as a file", () => {
  it("becomes a review fact dated to the head it was written against", async () => {
    repo = await createTestRepo();
    const { number, head } = await submitBranch("spec/FIX-1");
    await fileReview(number, "alice.json", { reviewer: "alice", state: "APPROVED" }, T2);

    const observation = await observeWith([artifactAt(number)]);
    const pr = observation.world.pullRequests[number]!;

    expect(pr.reviews).toEqual([
      {
        // Not the file name: a reviewer editing this file in place files a
        // second review, and an id that ignored the edit would be reduced over
        // once and never again. See "changing their mind" below.
        id: `alice.json@${T2}#APPROVED`,
        reviewer: "alice",
        isHuman: true,
        state: "APPROVED",
        sha: head,
        at: T2,
      },
    ]);
    expect(hasFreshHumanApproval(pr)).toBe(true);
  });

  it("goes stale when a commit lands after it, with no SHA written down anywhere", async () => {
    repo = await createTestRepo();
    const { number, head: firstHead } = await submitBranch("spec/FIX-1");
    await fileReview(number, "alice.json", { reviewer: "alice", state: "APPROVED" }, T2);

    // The author pushes a revision after the approval.
    await repo.run("checkout", "-q", "spec/FIX-1");
    const secondHead = await repo.commit("spec.md", "revised\n", "revision", T3);
    await repo.run("checkout", "-q", "main");

    const observation = await observeWith([artifactAt(number)]);
    const pr = observation.world.pullRequests[number]!;

    expect(pr.headSha).toBe(secondHead);
    expect(pr.reviews[0]!.sha).toBe(firstHead);
    expect(hasFreshHumanApproval(pr)).toBe(false);
  });

  it("does not follow the branch onto a commit that landed in the same second", async () => {
    repo = await createTestRepo();
    // The branch's commit and alice's file land in the same wall-clock second,
    // which is all `isoSeconds` and git's commit times can tell apart.
    const { number, head: reviewedHead } = await submitBranch(
      "spec/FIX-1",
      "spec.md",
      "draft\n",
      T2,
    );
    const artifacts = [artifactAt(number)];
    const entity = { id: ENTITY_ID, kind: "issue", phase: "SPEC" } as const;

    await fileReview(number, "alice.json", { reviewer: "alice", state: "APPROVED" }, T2);

    const first = await observeWith(artifacts);
    expect(first.world.pullRequests[number]!.reviews[0]!.sha).toBe(reviewedHead);
    expect(hasFreshHumanApproval(first.world.pullRequests[number]!)).toBe(true);

    // The author pushes inside that same second. `rev-list -1 --before=<second>`
    // answers with this commit just as readily as with the one alice read, so a
    // verdict re-resolved on every poll silently moves onto a head nobody
    // reviewed — and the approval gate it releases was never given.
    await repo.run("checkout", "-q", "spec/FIX-1");
    const unreviewedHead = await repo.commit("spec.md", "revised\n", "revision", T2);
    await repo.run("checkout", "-q", "main");
    expect(unreviewedHead).not.toBe(reviewedHead);

    const second = await observeWith(artifacts, first.cursor);
    const pr = second.world.pullRequests[number]!;

    expect(pr.headSha).toBe(unreviewedHead);
    expect(pr.reviews[0]!.sha).toBe(reviewedHead);
    expect(hasFreshHumanApproval(pr)).toBe(false);
    expect(deriveGate(entity, second.world)).toBe("awaiting_spec_review");
  });

  it("honours an explicit SHA when the reviewer wrote one", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    await fileReview(
      number,
      "alice.json",
      { reviewer: "alice", state: "APPROVED", sha: "deadbeef" },
      T2,
    );

    const observation = await observeWith([artifactAt(number)]);

    expect(observation.world.pullRequests[number]!.reviews[0]!.sha).toBe("deadbeef");
  });

  it("ignores a file that carries no verdict anyone stands behind", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    await fileReview(number, "alice.json", { reviewer: "alice", state: "PENDING" }, T2);
    await repo.write(inbox(number, "reviews", "notes.txt"), "hi");

    const observation = await observeWith([artifactAt(number)]);

    expect(observation.world.pullRequests[number]!.reviews).toEqual([]);
  });

  it("skips a half-written verdict rather than wedging the tick on it", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    await repo.write(inbox(number, "reviews", "bob.json"), '{ "reviewer": "bob", "state": "APP');
    await fileReview(number, "alice.json", { reviewer: "alice", state: "APPROVED" }, T2);

    const observation = await observeWith([artifactAt(number)]);

    expect(observation.world.pullRequests[number]!.reviews.map((r) => r.reviewer)).toEqual([
      "alice",
    ]);
  });

  it("skips a verdict whose fields are the wrong type, and still reads the good one beside it", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    // Valid JSON carrying a number where a verdict belongs — the case a syntax
    // check waves through. Named to sort first, so a fix that merely stops
    // throwing but abandons the read still fails here: what matters is that
    // alice's approval survives bob's typo, not that nothing raised.
    await repo.write(
      inbox(number, "reviews", "aaron.json"),
      `${JSON.stringify({ reviewer: "aaron", state: 1 })}\n`,
    );
    await fileReview(number, "alice.json", { reviewer: "alice", state: "APPROVED" }, T2);

    const observation = await observeWith([artifactAt(number)]);
    const pr = observation.world.pullRequests[number]!;

    expect(pr.reviews.map((r) => r.reviewer)).toEqual(["alice"]);
    expect(hasFreshHumanApproval(pr)).toBe(true);
    expect(observation.signals.map((s) => s.kind)).toEqual(["pr_opened", "approved"]);
  });

  it("becomes the signal the approval gate reads", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    await fileReview(number, "alice.json", { reviewer: "alice", state: "APPROVED" }, T2);

    const first = await observeWith([artifactAt(number)]);
    // The first observation replays the opening and the review that was already
    // on it; the review's own signal is what a later tick would receive live.
    expect(first.signals.map((s) => s.kind)).toEqual(["pr_opened", "approved"]);
  });
});

describe("a reviewer changing their mind in the same file", () => {
  it("fires the new verdict as a signal, which a name-keyed identity would swallow", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    const artifacts = [artifactAt(number)];

    await fileReview(number, "alice.json", { reviewer: "alice", state: "CHANGES_REQUESTED" }, T2);
    const first = await observeWith(artifacts);
    expect(first.signals.map((s) => s.kind)).toEqual(["pr_opened", "changes_requested"]);

    // The author addresses it and alice edits her verdict in place — the same
    // two fields she wrote the first time, with one of them changed. Nothing in
    // this file tells conductor it is a new review; the observer works that out.
    await fileReview(number, "alice.json", { reviewer: "alice", state: "APPROVED" }, T3);

    const second = await observeWith(artifacts, first.cursor);

    expect(second.signals.map((s) => s.kind)).toEqual(["approved"]);
    expect(second.world.pullRequests[number]!.reviews.map((r) => r.state)).toEqual(["APPROVED"]);
    expect(hasFreshHumanApproval(second.world.pullRequests[number]!)).toBe(true);

    // And it settles: the approval is reduced over once, not on every tick.
    const third = await observeWith(artifacts, second.cursor);
    expect(third.signals).toEqual([]);
  });

  it("re-fires the same verdict when it was re-filed against a newer head", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    const artifacts = [artifactAt(number)];

    await fileReview(number, "alice.json", { reviewer: "alice", state: "APPROVED" }, T2);
    const first = await observeWith(artifacts);
    expect(first.signals.map((s) => s.kind)).toContain("approved");

    // A commit lands, which makes the approval stale.
    await repo.run("checkout", "-q", "spec/FIX-1");
    await repo.commit("spec.md", "revised\n", "revision", T3);
    await repo.run("checkout", "-q", "main");

    const stale = await observeWith(artifacts, first.cursor);
    expect(hasFreshHumanApproval(stale.world.pullRequests[number]!)).toBe(false);

    // Alice re-reads and saves the same verdict. Her file's content has not
    // changed, but a save is how she says "I looked at this head too" — it is
    // already what decides which commit the approval points at, so it is a
    // review the driver has to hear about.
    await repo.touch(inbox(number, "reviews", "alice.json"), "2026-08-08T00:00:00Z");

    const refreshed = await observeWith(artifacts, stale.cursor);

    expect(refreshed.signals.map((s) => s.kind)).toEqual(["approved"]);
    expect(hasFreshHumanApproval(refreshed.world.pullRequests[number]!)).toBe(true);
  });
});

describe("a comment a human wrote as a file", () => {
  it("becomes feedback once, and the cursor keeps it from arriving twice", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    const relative = inbox(number, "comments", "alice.1.md");
    await repo.write(relative, "please rename this\n");
    await repo.touch(relative, T2);

    const first = await observeWith([artifactAt(number)]);
    expect(first.signals).toContainEqual({
      kind: "feedback_received",
      entityId: ENTITY_ID,
      at: T2,
      author: "alice",
      commentId: "alice.1.md",
      pullNumber: number,
    });

    const second = await observeWith([artifactAt(number)], first.cursor);
    expect(second.signals.filter((s) => s.kind === "feedback_received")).toEqual([]);
  });
});

describe("what git alone decides", () => {
  it("reports a merged branch as merged, from ancestry rather than a flag", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    const first = await observeWith([artifactAt(number)]);

    await repo.run("merge", "--no-ff", "-m", "merge spec", "spec/FIX-1");

    const second = await observeWith([artifactAt(number)], first.cursor);

    expect(second.world.pullRequests[number]!.state).toBe("merged");
    expect(second.signals.map((s) => s.kind)).toContain("merged");
  });

  it("still reports merged after the branch is deleted, the usual way a local merge ends", async () => {
    repo = await createTestRepo();
    const { number, head } = await submitBranch("spec/FIX-1");
    const first = await observeWith([artifactAt(number)]);

    await repo.run("merge", "--no-ff", "-m", "merge spec", "spec/FIX-1");
    await repo.run("branch", "-D", "spec/FIX-1");

    const second = await observeWith([artifactAt(number)], first.cursor);

    expect(second.world.pullRequests[number]!.state).toBe("merged");
    expect(second.world.pullRequests[number]!.headSha).toBe(head);
  });

  it("reports a branch abandoned without merging as closed", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    const first = await observeWith([artifactAt(number)]);

    await repo.run("branch", "-D", "spec/FIX-1");

    const second = await observeWith([artifactAt(number)], first.cursor);

    expect(second.world.pullRequests[number]!.state).toBe("closed");
    expect(second.signals.map((s) => s.kind)).toContain("pr_closed");
  });
});

describe("checks", () => {
  it("come from what a real run recorded, and are absent until one has", async () => {
    repo = await createTestRepo();
    const { number, head } = await submitBranch("fix/FIX-1");
    const artifacts = [artifactAt(number, "implementation")];

    const before = await observeWith(artifacts, EMPTY_OBSERVATION_CURSOR, "IMPLEMENTATION");
    expect(before.world.pullRequests[number]!.checks).toBeNull();

    await writeCheck(repo.root, head, {
      conclusion: "failure",
      at: T2,
      command: "pnpm test",
    });

    const after = await observeWith(artifacts, before.cursor, "IMPLEMENTATION");
    expect(after.world.pullRequests[number]!.checks).toBe("failure");
    expect(after.signals.map((s) => s.kind)).toContain("ci_concluded");
  });

  it("refuse a conclusion nothing can act on, rather than stranding the submission", async () => {
    repo = await createTestRepo();
    const { number, head } = await submitBranch("fix/FIX-1");
    const artifacts = [artifactAt(number, "implementation")];

    // A typo in a file a check runner wrote. Cast straight through it is
    // non-null, so `awaiting_ci` applies — and no gate can ever be satisfied by
    // it, so the entity waits on a conclusion that will never arrive.
    await repo.write(
      `.conductor/local/checks/${head}.json`,
      `${JSON.stringify({ conclusion: "sucess", at: T2 })}\n`,
    );

    await expect(
      observeWith(artifacts, EMPTY_OBSERVATION_CURSOR, "IMPLEMENTATION"),
    ).rejects.toThrow(/sucess/);
  });

  it("mark the base red when the base's own head failed", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("fix/FIX-1");
    const baseHead = await repo.sha("main");
    await writeCheck(repo.root, baseHead, { conclusion: "failure", at: T2 });

    const observation = await observeWith(
      [artifactAt(number, "implementation")],
      EMPTY_OBSERVATION_CURSOR,
      "IMPLEMENTATION",
    );

    expect(observation.world.pullRequests[number]!.baseRed).toBe(true);
  });

  it("are not read at all by a phase whose gates never declared them", async () => {
    repo = await createTestRepo();
    const { number, head } = await submitBranch("spec/FIX-1");
    const baseHead = await repo.sha("main");
    await writeCheck(repo.root, head, { conclusion: "failure", at: T2 });
    await writeCheck(repo.root, baseHead, { conclusion: "failure", at: T2 });

    // SPEC declares pr.state, artifact.reviews and artifact.rounds — no CI.
    const observation = await observeWith([artifactAt(number)]);

    expect(observation.facts).not.toContain("pr.checkRuns");
    expect(observation.world.pullRequests[number]!.checks).toBeNull();
    expect(observation.world.pullRequests[number]!.baseRed).toBe(false);
  });
});

describe("an artifact naming a submission that was never opened", () => {
  it("is skipped rather than raised, the way a hand-edited ledger is everywhere else", async () => {
    repo = await createTestRepo();

    const observation = await observeWith([artifactAt(99)]);

    expect(observation.world.pullRequests).toEqual({});
    expect(observation.signals).toEqual([]);
  });
});

describe("driving the real driver from a real checkout", () => {
  it("carries an issue from SPEC into IMPLEMENTATION on a human's approval file", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    const artifacts = [artifactAt(number)];

    const entity = { id: ENTITY_ID, kind: "issue", phase: "SPEC" } as const;

    // Unreviewed: the entity waits where the gate table says it should.
    const unreviewed = await observeWith(artifacts);
    expect(deriveGate(entity, unreviewed.world)).toBe("awaiting_spec_review");

    // A human writes their verdict into the repository.
    await fileReview(number, "alice.json", { reviewer: "alice", state: "APPROVED" }, T2);

    const approved = await observeWith(artifacts, unreviewed.cursor);
    const signal = approved.signals.find((s) => s.kind === "approved");
    expect(signal).toBeDefined();

    const actions = decide(entity, signal!, approved.world);
    expect(actions.map((action) => action.kind)).toEqual(["recordApproval", "enterPhase"]);
  });

  it("re-derives the same gate after a restart that keeps nothing", async () => {
    repo = await createTestRepo();
    const { number } = await submitBranch("spec/FIX-1");
    const artifacts = [artifactAt(number)];
    const entity = { id: ENTITY_ID, kind: "issue", phase: "SPEC" } as const;

    const before = await observeWith(artifacts);
    const gateBefore = deriveGate(entity, before.world);

    // The process dies mid-gate: no cursor, no world, nothing in memory. The
    // only thing that survives is the entity's stored phase and the checkout.
    const after = await observeWith(artifacts, EMPTY_OBSERVATION_CURSOR);

    expect(deriveGate(entity, after.world)).toBe(gateBefore);
    expect(worldFacts(after.world)).toEqual(worldFacts(before.world));
  });
});

/** The parts of a world two observations of an unchanged checkout must agree on. */
function worldFacts(world: World) {
  return {
    pullRequests: world.pullRequests,
    goalCheck: world.goalCheck,
  };
}
