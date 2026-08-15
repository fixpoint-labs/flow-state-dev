/**
 * World builders for driver tests.
 *
 * `decide` is pure over a snapshot, so every test here is a literal in and an
 * assertion out — no mocks, no clock, no I/O. That is the property M0 exists to
 * establish, and these helpers exist to keep it obvious rather than buried in
 * setup.
 */

import type { ConductorEntity } from "../src/driver/derive-gate";
import type { Phase } from "../src/model/phases";
import type { Signal, SignalKind } from "../src/model/signals";
import type {
  ArtifactFacts,
  ArtifactKind,
  PullRequestFacts,
  ReviewFacts,
  World,
} from "../src/model/world";
import { DEFAULT_POLICY } from "../src/model/world";

export const ENTITY_ID = "FIX-1";
export const HEAD = "sha-head";

/** An issue entity in the given phase. */
export function issue(phase: Phase, id = ENTITY_ID): ConductorEntity {
  return { id, kind: "issue", phase };
}

/** An epic entity in the given phase. */
export function epic(phase: Phase, id = ENTITY_ID): ConductorEntity {
  return { id, kind: "epic", phase };
}

export function review(overrides: Partial<ReviewFacts> = {}): ReviewFacts {
  return {
    id: "rev-1",
    reviewer: "alice",
    isHuman: true,
    state: "COMMENTED",
    sha: HEAD,
    at: "2026-08-14T10:00:00Z",
    ...overrides,
  };
}

export function pr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    number: 10,
    state: "open",
    headSha: HEAD,
    mergeable: true,
    checks: null,
    baseRed: false,
    reviews: [],
    ...overrides,
  };
}

export function artifact(
  kind: ArtifactKind,
  pullNumber = 10,
  overrides: Partial<ArtifactFacts> = {},
): ArtifactFacts {
  return {
    id: `art-${kind}`,
    kind,
    hostedAt: { type: "pr", number: pullNumber },
    reviewRounds: 0,
    ...overrides,
  };
}

/** A world with the given artifacts and PRs, and everything else at its default. */
export function world(overrides: Partial<World> = {}): World {
  return {
    artifacts: [],
    pullRequests: {},
    goalCheck: null,
    goalCheckSha: null,
    childIssues: [],
    guidanceHashes: {},
    policy: DEFAULT_POLICY,
    ...overrides,
  };
}

/** Shorthand: a world holding one artifact hosted on one PR. */
export function worldWith(
  kind: ArtifactKind,
  prFacts: PullRequestFacts,
  artifactOverrides: Partial<ArtifactFacts> = {},
  rest: Partial<World> = {},
): World {
  return world({
    artifacts: [artifact(kind, prFacts.number, artifactOverrides)],
    pullRequests: { [prFacts.number]: prFacts },
    ...rest,
  });
}

/**
 * A goal verdict together with the revision it was taken against — the pair
 * every gate actually reads (`model/world`'s `goalCheckFor`).
 *
 * Spelled as one helper because the two halves are one fact: a world carrying a
 * verdict and no revision is not "proved", it is a proof of code nobody can
 * point at, and the gates treat it as unproved. A test that means *this work has
 * been proved* has to say which revision, and {@link HEAD} is what the default
 * {@link pr} sits at.
 */
export function proved(
  verdict: "passed" | "failed",
  sha: string | null = HEAD,
): Pick<World, "goalCheck" | "goalCheckSha"> {
  return { goalCheck: verdict, goalCheckSha: sha };
}

/** An approving human review at the PR's current head. */
export function freshApproval(sha = HEAD): ReviewFacts {
  return review({ id: "rev-approve", state: "APPROVED", sha });
}

export const SIGNAL_AT = "2026-08-14T12:00:00Z";

/** Build a signal with the right payload shape for its kind. */
export function signal(kind: SignalKind, overrides: Record<string, unknown> = {}): Signal {
  const base = { entityId: ENTITY_ID, at: SIGNAL_AT };
  const payloads: Partial<Record<SignalKind, Record<string, unknown>>> = {
    pr_opened: { pullNumber: 10 },
    merged: { pullNumber: 10 },
    pr_closed: { pullNumber: 10 },
    merge_conflict: { pullNumber: 10 },
    base_recovered: { pullNumber: 10 },
    review_submitted: { reviewer: "alice", sha: HEAD, pullNumber: 10 },
    changes_requested: { reviewer: "alice", sha: HEAD, pullNumber: 10 },
    approved: { reviewer: "alice", sha: HEAD, pullNumber: 10 },
    ci_concluded: { conclusion: "failure", sha: HEAD },
    feedback_received: { author: "alice", commentId: "c1", pullNumber: 10 },
    question_asked: { author: "alice", commentId: "c1", pullNumber: 10 },
    approval_expressed: { author: "alice", commentId: "c1", pullNumber: 10 },
    dispatch_completed: { dispatchId: "d1" },
    dispatch_failed: { dispatchId: "d1" },
    guidance_changed: { path: "docs/philosophy.md" },
    issue_settled: { childId: "FIX-2" },
  };
  return { kind, ...base, ...payloads[kind], ...overrides } as Signal;
}

/** Every signal kind, for totality sweeps. */
export const SIGNAL_KINDS: readonly SignalKind[] = [
  "pr_opened",
  "review_submitted",
  "changes_requested",
  "approved",
  "ci_concluded",
  "merge_conflict",
  "base_recovered",
  "merged",
  "pr_closed",
  "feedback_received",
  "question_asked",
  "approval_expressed",
  "phase_entered",
  "dispatch_completed",
  "dispatch_failed",
  "goal_check_passed",
  "goal_check_failed",
  "guidance_changed",
  "external_status_changed",
  "objective_approved",
  "issue_settled",
];
