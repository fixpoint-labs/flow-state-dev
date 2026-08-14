/**
 * GitHub → `World`.
 *
 * This is the step that lets `decide` be pure, so the tests assert against the
 * *gate predicates* wherever a mapping is load-bearing rather than against the
 * intermediate shape. A world that maps cleanly but releases the wrong gate is
 * not a correct world.
 */

import { describe, expect, it } from "vitest";
import { deriveGate } from "../../src/driver/derive-gate";
import { createGitHubClient } from "../../src/github/client";
import {
  aggregateChecks,
  readPullRequest,
  readWorld,
  toObservedPr,
} from "../../src/github/read-world";
import { hasFreshHumanApproval, type ArtifactFacts } from "../../src/model/world";
import {
  BASE_URL,
  OWNER,
  REPO,
  SELF_LOGIN,
  checkRun,
  checkRuns,
  pullPayload,
  reviewPayload,
  stubFetch,
  type StubRoute,
} from "./fixtures";

function client(routes: Record<string, StubRoute>) {
  const fetch = stubFetch(routes);
  return {
    client: createGitHubClient({
      owner: OWNER,
      repo: REPO,
      token: "t",
      baseUrl: BASE_URL,
      fetch,
      selfLogin: SELF_LOGIN,
      botLogins: ["coderabbit"],
    }),
    calls: fetch.calls,
  };
}

const P = `/repos/${OWNER}/${REPO}`;

const implArtifact: ArtifactFacts = {
  id: "art-impl",
  kind: "implementation",
  hostedAt: { type: "pr", number: 7 },
  reviewRounds: 0,
};

const specArtifact: ArtifactFacts = {
  id: "art-spec",
  kind: "spec",
  hostedAt: { type: "pr", number: 7 },
  reviewRounds: 0,
};

describe("aggregateChecks", () => {
  it("reports null when nothing has reported at all", () => {
    // Not a failure — the `awaiting_ci` gate reads it as "this PR has no CI".
    expect(aggregateChecks([])).toBeNull();
  });

  it("reports pending while any run is unfinished", () => {
    expect(aggregateChecks([checkRun("completed", "success"), checkRun("in_progress")])).toBe(
      "pending",
    );
  });

  it("lets a definitive failure outrank a run still in flight", () => {
    // A red check is actionable now, and the aggregate cannot go green again.
    expect(aggregateChecks([checkRun("in_progress"), checkRun("completed", "failure")])).toBe(
      "failure",
    );
  });

  it("counts neutral and skipped as a pass", () => {
    expect(
      aggregateChecks([checkRun("completed", "neutral"), checkRun("completed", "skipped")]),
    ).toBe("success");
  });
});

describe("pull request facts", () => {
  it("maps state, head, and mergeability", async () => {
    const { client: gh } = client({
      [`GET ${P}/pulls/7`]: pullPayload({ mergeable: false }),
      [`GET ${P}/pulls/7/reviews`]: [],
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    });

    const pr = await readPullRequest(gh, 7);
    expect(pr).toMatchObject({
      number: 7,
      state: "open",
      headSha: "sha-head",
      mergeable: false,
      checks: null,
      baseRed: false,
    });
  });

  it("reports merged for a closed-and-merged PR, closed otherwise", async () => {
    const read = async (overrides: Record<string, unknown>) => {
      const { client: gh } = client({
        [`GET ${P}/pulls/7`]: pullPayload({ state: "closed", ...overrides }),
        [`GET ${P}/pulls/7/reviews`]: [],
        [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(),
        [`GET ${P}/commits/main/check-runs`]: checkRuns(),
      });
      return (await readPullRequest(gh, 7)).state;
    };

    expect(await read({ merged: true })).toBe("merged");
    expect(await read({ merged: false, merged_at: "2026-08-14T13:00:00Z" })).toBe("merged");
    expect(await read({ merged: false })).toBe("closed");
  });

  it("aggregates checks for the current head SHA, not for a SHA since pushed over", async () => {
    const { client: gh, calls } = client({
      [`GET ${P}/pulls/7`]: pullPayload({ head: { sha: "sha-new" } }),
      [`GET ${P}/pulls/7/reviews`]: [],
      // The old SHA is green. If it were consulted, `awaiting_ci` would release
      // on a result that is not this PR's status.
      [`GET ${P}/commits/sha-old/check-runs`]: checkRuns(checkRun("completed", "success")),
      [`GET ${P}/commits/sha-new/check-runs`]: checkRuns(checkRun("completed", "failure")),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    });

    const pr = await readPullRequest(gh, 7);
    expect(pr.checks).toBe("failure");
    expect(calls).not.toContain(`GET ${P}/commits/sha-old/check-runs`);
  });

  it("reads the base branch separately, so someone else's breakage is visible", async () => {
    const { client: gh } = client({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [],
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(checkRun("completed", "failure")),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(checkRun("completed", "failure")),
    });

    const pr = await readPullRequest(gh, 7);
    expect(pr.baseRed).toBe(true);
  });
});

describe("reviews and the approval gate", () => {
  it("does not let a bot approval satisfy the approval gate", async () => {
    const { client: gh } = client({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [
        reviewPayload({ id: 1, state: "APPROVED", user: { login: "coderabbit", type: "User" } }),
        reviewPayload({ id: 2, state: "APPROVED", user: { login: "renovate", type: "Bot" } }),
      ],
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(checkRun("completed", "success")),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    });

    const { world } = await readWorld(gh, {
      entity: { kind: "issue", phase: "SPEC" },
      artifacts: [specArtifact],
    });

    expect(world.pullRequests[7]!.reviews.every((review) => !review.isHuman)).toBe(true);
    expect(hasFreshHumanApproval(world.pullRequests[7])).toBe(false);
    // Still waiting: two approvals on the PR, neither of them from a person.
    expect(deriveGate({ id: "FIX-1", kind: "issue", phase: "SPEC" }, world)).toBe(
      "awaiting_spec_review",
    );
  });

  it("drops dismissed and pending reviews rather than mapping them", async () => {
    const { client: gh } = client({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [
        reviewPayload({ id: 1, state: "APPROVED" }),
        reviewPayload({ id: 2, state: "DISMISSED" }),
        reviewPayload({ id: 3, state: "PENDING" }),
      ],
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    });

    const pr = await readPullRequest(gh, 7);
    // A withdrawn approval and an unsubmitted one are not approvals anyone
    // stands behind; carrying them would release the gate on nothing.
    expect(pr.reviews.map((review) => review.id)).toEqual(["1"]);
  });

  it("keeps a stale approval out of the fresh-approval check", async () => {
    const { client: gh } = client({
      [`GET ${P}/pulls/7`]: pullPayload({ head: { sha: "sha-new" } }),
      [`GET ${P}/pulls/7/reviews`]: [
        reviewPayload({ id: 1, state: "APPROVED", commit_id: "sha-old" }),
      ],
      [`GET ${P}/commits/sha-new/check-runs`]: checkRuns(),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    });

    const pr = await readPullRequest(gh, 7);
    expect(pr.reviews[0]!.isHuman).toBe(true);
    expect(hasFreshHumanApproval(pr)).toBe(false);
  });
});

describe("reads are driven by what the phase declared", () => {
  it("skips the head check-run fetch for a phase whose gates never read it", async () => {
    // SPEC declares pr.state and artifact.reviews. It does not declare
    // pr.checkRuns, so the spec PR's CI is not this phase's business.
    const { client: gh, calls } = client({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [],
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    });

    const { world, facts } = await readWorld(gh, {
      entity: { kind: "issue", phase: "SPEC" },
      artifacts: [specArtifact],
    });

    expect(facts).toContain("artifact.reviews");
    expect(facts).not.toContain("pr.checkRuns");
    expect(calls).not.toContain(`GET ${P}/commits/sha-head/check-runs`);
    expect(world.pullRequests[7]!.checks).toBeNull();
    // Nor the base's: `pr.baseStatus` belongs to awaiting_ci, and SPEC has no
    // such gate. Every fetch here follows from this phase's own table entry.
    expect(facts).not.toContain("pr.baseStatus");
    expect(calls).not.toContain(`GET ${P}/commits/main/check-runs`);
  });

  it("fetches the head check-runs for IMPLEMENTATION, which does declare them", async () => {
    const { client: gh, calls } = client({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [],
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(checkRun("completed", "success")),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    });

    const { world } = await readWorld(gh, {
      entity: { kind: "issue", phase: "IMPLEMENTATION" },
      artifacts: [implArtifact],
    });

    expect(calls).toContain(`GET ${P}/commits/sha-head/check-runs`);
    expect(world.pullRequests[7]!.checks).toBe("success");
  });

  it("reads the base status for IMPLEMENTATION, because awaiting_ci declares it", async () => {
    // `decide`'s awaiting_ci branch consults baseRed to avoid dispatching an
    // agent at someone else's breakage, and the gate declares pr.baseStatus so
    // the fetch follows from the table rather than from a second list.
    const { client: gh, calls } = client({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [],
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(checkRun("completed", "failure")),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(checkRun("completed", "failure")),
    });

    const { world, facts } = await readWorld(gh, {
      entity: { kind: "issue", phase: "IMPLEMENTATION" },
      artifacts: [implArtifact],
    });

    expect(facts).toContain("pr.baseStatus");
    expect(calls).toContain(`GET ${P}/commits/main/check-runs`);
    expect(world.pullRequests[7]!.baseRed).toBe(true);
  });

  it("hashes guidance only when a phase declares it", async () => {
    const { client: gh, calls } = client({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [],
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
      [`GET ${P}/contents/docs/philosophy.md`]: { sha: "blob-1" },
    });

    const { world } = await readWorld(gh, {
      entity: { kind: "issue", phase: "SPEC" },
      artifacts: [specArtifact],
      guidancePaths: ["docs/philosophy.md"],
    });

    // No gate in the table declares `guidance` today, so nothing is hashed and
    // no request is made for it.
    expect(world.guidanceHashes).toEqual({});
    expect(calls).not.toContain(`GET ${P}/contents/docs/philosophy.md`);
  });
});

describe("conductor-owned facts pass through rather than being fetched", () => {
  it("carries reviewRounds, goalCheck, childIssues, and policy from the caller", async () => {
    const { client: gh } = client({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [],
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    });

    const { world } = await readWorld(gh, {
      entity: { kind: "issue", phase: "IMPLEMENTATION" },
      artifacts: [{ ...implArtifact, reviewRounds: 12 }],
      goalCheck: "failed",
      childIssues: [{ id: "FIX-2", settled: true }],
    });

    // Nothing on GitHub has anywhere to put `reviewRounds: 12`.
    expect(world.artifacts[0]!.reviewRounds).toBe(12);
    expect(world.goalCheck).toBe("failed");
    expect(world.childIssues).toEqual([{ id: "FIX-2", settled: true }]);
    expect(world.policy.implementationReviewRoundBudget).toBe(12);
  });
});

describe("toObservedPr", () => {
  it("projects fresh facts into the copy the next tick diffs against", async () => {
    const { client: gh } = client({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [reviewPayload({ id: 1 }), reviewPayload({ id: 2 })],
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(checkRun("completed", "success")),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    });

    const observed = toObservedPr(await readPullRequest(gh, 7), "2026-08-14T12:00:00Z");
    expect(observed).toEqual({
      number: 7,
      state: "open",
      headSha: "sha-head",
      checks: "success",
      mergeable: true,
      baseRed: false,
      knownReviewIds: ["1", "2"],
      observedAt: "2026-08-14T12:00:00Z",
    });
  });
});
