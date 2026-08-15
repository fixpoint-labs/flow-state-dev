/**
 * The observer seam.
 *
 * Two things are worth asserting about a seam and nothing else is: that the
 * shipped implementations satisfy it, and that adopting it changed nothing about
 * the path that already worked. Everything about *what* an observation says is
 * tested against the source that produces it — `test/github/poll.test.ts` for
 * GitHub, `test/local/observe.test.ts` for a real checkout.
 */

import { describe, expect, it } from "vitest";

import { createGitHubClient } from "../../src/github/client";
import { githubObserver, GITHUB_SOURCE } from "../../src/github/observe";
import { pollGitHub } from "../../src/github/poll";
import { localObserver } from "../../src/local/observe";
import type { Observer } from "../../src/observe/types";
import { EMPTY_OBSERVATION_CURSOR } from "../../src/observe/types";
import type { ArtifactFacts } from "../../src/model/world";
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
} from "../github/fixtures";

const P = `/repos/${OWNER}/${REPO}`;
const NOW = "2026-08-14T12:00:00Z";

const artifact: ArtifactFacts = {
  id: "art-impl",
  kind: "implementation",
  hostedAt: { type: "pr", number: 7 },
  reviewRounds: 0,
};

function client() {
  return createGitHubClient({
    owner: OWNER,
    repo: REPO,
    token: "t",
    baseUrl: BASE_URL,
    fetch: stubFetch({
      [`GET ${P}/pulls/7`]: pullPayload(),
      [`GET ${P}/pulls/7/reviews`]: [reviewPayload({ id: 1, state: "APPROVED" })],
      [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(checkRun("completed", "success")),
      [`GET ${P}/commits/main/check-runs`]: checkRuns(),
      [`GET ${P}/issues/7/comments`]: [],
      [`GET ${P}/pulls/7/comments`]: [],
    }),
    selfLogin: SELF_LOGIN,
    botLogins: ["coderabbit"],
  });
}

const request = {
  entityId: "FIX-1",
  entity: { kind: "issue", phase: "IMPLEMENTATION" },
  artifacts: [artifact],
  cursor: EMPTY_OBSERVATION_CURSOR,
  now: NOW,
} as const;

describe("the shipped observers", () => {
  it("both satisfy the seam and say which source they are", () => {
    const observers: readonly Observer[] = [
      githubObserver(client()),
      localObserver({ repoRoot: "/repo" }),
    ];

    expect(observers.map((observer) => observer.source)).toEqual(["github", "local"]);
    expect(GITHUB_SOURCE).toBe("github");
  });
});

describe("adopting the seam", () => {
  it("left the GitHub read path producing exactly what it produced before", async () => {
    const direct = await pollGitHub(client(), request);
    const throughSeam = await githubObserver(client()).observe(request);

    expect(throughSeam).toEqual(direct);
  });
});
