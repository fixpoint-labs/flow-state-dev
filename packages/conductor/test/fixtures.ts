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

/** An approving human review at the PR's current head. */
export function freshApproval(sha = HEAD): ReviewFacts {
  return review({ id: "rev-approve", state: "APPROVED", sha });
}
