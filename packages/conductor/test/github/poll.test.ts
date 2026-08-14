/**
 * The poll path — M1's only way of learning what happened.
 *
 * The claim under test is that polling plus reconciliation is *authoritative*,
 * not best-effort: a tick that never saw an event still produces the signal for
 * it, and a tick that has already reduced over something produces nothing the
 * second time. Both halves matter — the first is why nothing is lost, the
 * second is why a per-tick poll does not re-dispatch the same work forever.
 */

import { describe, expect, it } from "vitest";
import { createGitHubClient } from "../../src/github/client";
import { EMPTY_POLL_CURSOR, pollGitHub, type PollCursor } from "../../src/github/poll";
import type { ArtifactFacts } from "../../src/model/world";
import {
  BASE_URL,
  OWNER,
  REPO,
  SELF_LOGIN,
  checkRun,
  checkRuns,
  commentPayload,
  pullPayload,
  reviewPayload,
  stubFetch,
  type StubRoute,
} from "./fixtures";

const P = `/repos/${OWNER}/${REPO}`;
const NOW = "2026-08-14T12:00:00Z";

const artifact: ArtifactFacts = {
  id: "art-impl",
  kind: "implementation",
  hostedAt: { type: "pr", number: 7 },
  reviewRounds: 0,
};

function githubWith(overrides: Record<string, StubRoute> = {}) {
  const routes: Record<string, StubRoute> = {
    [`GET ${P}/pulls/7`]: pullPayload(),
    [`GET ${P}/pulls/7/reviews`]: [],
    [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(checkRun("completed", "success")),
    [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    [`GET ${P}/issues/7/comments`]: [],
    [`GET ${P}/pulls/7/comments`]: [],
    ...overrides,
  };
  return createGitHubClient({
    owner: OWNER,
    repo: REPO,
    token: "t",
    baseUrl: BASE_URL,
    fetch: stubFetch(routes),
    selfLogin: SELF_LOGIN,
    botLogins: ["coderabbit"],
  });
}

function poll(client: ReturnType<typeof githubWith>, cursor: PollCursor = EMPTY_POLL_CURSOR) {
  return pollGitHub(client, {
    entityId: "FIX-1",
    entity: { kind: "issue", phase: "IMPLEMENTATION" },
    artifacts: [artifact],
    cursor,
    now: NOW,
  });
}

describe("the first poll of a PR conductor has no record of", () => {
  it("replays the opening, every review, and every human comment, in order", async () => {
    const client = githubWith({
      [`GET ${P}/pulls/7/reviews`]: [
        reviewPayload({ id: 1, state: "CHANGES_REQUESTED", submitted_at: "2026-08-14T10:00:00Z" }),
      ],
      [`GET ${P}/issues/7/comments`]: [
        commentPayload({ id: 500, created_at: "2026-08-14T11:00:00Z" }),
      ],
    });

    const result = await poll(client);

    expect(result.signals.map((signal) => signal.kind)).toEqual([
      "pr_opened",
      "changes_requested",
      "feedback_received",
    ]);
    // The synthesized opening reduces ahead of what revealed the gap.
    expect(result.signals[0]!.at <= result.signals[1]!.at).toBe(true);
  });
});

describe("the second poll", () => {
  it("produces nothing when the world has not moved", async () => {
    const client = githubWith({
      [`GET ${P}/pulls/7/reviews`]: [reviewPayload({ id: 1 })],
      [`GET ${P}/issues/7/comments`]: [commentPayload({ id: 500 })],
    });

    const first = await poll(client);
    expect(first.signals.length).toBeGreaterThan(0);

    // A per-tick poll that re-emitted its own history would re-dispatch the
    // same work on every tick, forever.
    const second = await poll(client, first.cursor);
    expect(second.signals).toEqual([]);
  });

  it("emits exactly one signal for a comment that is new since the cursor", async () => {
    const before = githubWith({
      [`GET ${P}/issues/7/comments`]: [commentPayload({ id: 500 })],
    });
    const first = await poll(before);

    const after = githubWith({
      [`GET ${P}/issues/7/comments`]: [
        commentPayload({ id: 500 }),
        commentPayload({ id: 501, created_at: "2026-08-14T11:30:00Z" }),
      ],
    });
    const second = await poll(after, first.cursor);

    expect(second.signals).toHaveLength(1);
    expect(second.signals[0]).toMatchObject({
      kind: "feedback_received",
      commentId: "501",
      pullNumber: 7,
    });
  });

  it("namespaces the two comment endpoints so their ids cannot collide", async () => {
    // Both endpoints number independently; a bare id would make the review
    // comment look already-seen and silently drop it.
    const client = githubWith({
      [`GET ${P}/issues/7/comments`]: [commentPayload({ id: 500 })],
      [`GET ${P}/pulls/7/comments`]: [
        commentPayload({ id: 500, created_at: "2026-08-14T11:15:00Z" }),
      ],
    });

    const result = await poll(client);
    expect(result.signals.filter((signal) => signal.kind === "feedback_received")).toHaveLength(2);
    expect([...result.cursor.commentKeys].sort()).toEqual(["issue:500", "review:500"]);
  });
});

describe("machines never become signals, on any tick", () => {
  it("drops bot and conductor comments and does not carry them as pending work", async () => {
    const client = githubWith({
      [`GET ${P}/issues/7/comments`]: [
        commentPayload({ id: 500, user: { login: "coderabbit", type: "User" } }),
        commentPayload({ id: 501, user: { login: SELF_LOGIN, type: "User" } }),
        commentPayload({ id: 502, user: { login: "renovate", type: "Bot" } }),
      ],
    });

    const first = await poll(client);
    expect(first.signals).toEqual([expect.objectContaining({ kind: "pr_opened" })]);

    // They are recorded as seen so a later identity change cannot resurrect
    // them as a flood of feedback.
    expect(first.cursor.commentKeys).toHaveLength(3);
    expect((await poll(client, first.cursor)).signals).toEqual([]);
  });
});

describe("state that moved while conductor was not listening", () => {
  it("synthesizes the CI conclusion and the merge from the diff alone", async () => {
    const client = githubWith({
      [`GET ${P}/pulls/7`]: pullPayload({ state: "closed", merged: true }),
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(checkRun("completed", "failure")),
    });

    const cursor: PollCursor = {
      pullRequests: [
        {
          number: 7,
          state: "open",
          headSha: "sha-head",
          checks: "pending",
          mergeable: true,
          baseRed: false,
          knownReviewIds: [],
          observedAt: "2026-08-14T09:00:00Z",
        },
      ],
      commentKeys: [],
    };

    const result = await poll(client, cursor);
    expect(result.signals.map((signal) => signal.kind).sort()).toEqual([
      "ci_concluded",
      "merged",
    ]);
  });

  it("records a head-SHA divergence rather than inventing a transition for it", async () => {
    const client = githubWith({
      [`GET ${P}/pulls/7`]: pullPayload({ head: { sha: "sha-new" } }),
      [`GET ${P}/commits/sha-new/check-runs`]: checkRuns(),
    });

    const result = await poll(client, {
      pullRequests: [
        {
          number: 7,
          state: "open",
          headSha: "sha-old",
          checks: null,
          mergeable: true,
          baseRed: false,
          knownReviewIds: [],
          observedAt: "2026-08-14T09:00:00Z",
        },
      ],
      commentKeys: [],
    });

    expect(result.divergences).toEqual([
      { pullNumber: 7, fact: "headSha", observed: "sha-old", fresh: "sha-new" },
    ]);
  });
});

describe("the cursor", () => {
  it("carries the fresh facts forward so the next tick has something to diff", async () => {
    const client = githubWith({
      [`GET ${P}/pulls/7/reviews`]: [reviewPayload({ id: 1 })],
    });

    const result = await poll(client);
    expect(result.cursor.pullRequests).toEqual([
      {
        number: 7,
        state: "open",
        headSha: "sha-head",
        checks: "success",
        mergeable: true,
        baseRed: false,
        knownReviewIds: ["1"],
        observedAt: NOW,
      },
    ]);
  });
});
