/**
 * The loop conductor must never enter: reading its own reply back as feedback.
 *
 * Conductor both posts on a pull request and polls it. If the poll cannot tell
 * conductor's own comment from a reviewer's, the tick that answers a reviewer
 * produces the very signal that dispatches another answer — and each turn of
 * that loop dispatches a coding agent, which costs money. `identity.ts` is the
 * guard, and it only works if the client knows which account its token belongs
 * to. A token on an ordinary `User` account — a personal access token, the
 * likely local setup — looks exactly like a human to that guard when no
 * `selfLogin` was configured.
 *
 * So the assertion here is the **dispatch**, not just the signal: a regression
 * has to report the cost, not a missing badge.
 */

import { describe, expect, it } from "vitest";
import { createGitHubClient, type FetchLike } from "../../src/github/client";
import { commentOnPullRequest } from "../../src/github/operations";
import { EMPTY_POLL_CURSOR, pollGitHub } from "../../src/github/poll";
import { decide } from "../../src/driver/decide";
import { deriveGate, type ConductorEntity } from "../../src/driver/derive-gate";
import type { ArtifactFacts } from "../../src/model/world";
import { BASE_URL, OWNER, REPO, checkRun, checkRuns, pullPayload } from "./fixtures";

/** The account the token belongs to. A PAT on a human account, not an App. */
const TOKEN_OWNER = "jake-the-maintainer";
const NOW = "2026-08-15T12:00:00Z";
const P = `/repos/${OWNER}/${REPO}`;

const artifact: ArtifactFacts = {
  id: "art-impl",
  kind: "implementation",
  hostedAt: { type: "pr", number: 7 },
  reviewRounds: 0,
};

const entity: ConductorEntity = { id: "FIX-1", kind: "issue", phase: "IMPLEMENTATION" };

interface StoredComment {
  id: number;
  user: { login: string; type: string };
  created_at: string;
}

/**
 * A GitHub that writes a comment down and then serves it back.
 *
 * This is the whole point of the double: a stub that accepted the POST and kept
 * returning an empty comment list would pass this file's assertions before the
 * fix and prove nothing. Every comment created here is attributed to the account
 * the token belongs to, exactly as GitHub attributes it.
 */
function fakeRepo(
  options: {
    /** How `GET /user` answers. `"ok"` returns the token owner. */
    readonly whoAmI?: "ok" | "installation-token" | "unauthorized";
  } = {},
) {
  const comments: StoredComment[] = [];
  const reviews: unknown[] = [];
  let nextId = 900;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace(BASE_URL, "").split("?")[0]!;

    if (method === "GET" && path === "/user") {
      switch (options.whoAmI ?? "ok") {
        case "installation-token":
          return json(403, { message: "Resource not accessible by integration" });
        case "unauthorized":
          return json(401, { message: "Bad credentials" });
        default:
          return json(200, { login: TOKEN_OWNER, type: "User" });
      }
    }

    if (method === "POST" && path === `${P}/issues/7/comments`) {
      const body = JSON.parse(init?.body ?? "{}") as { body?: string };
      const comment: StoredComment = {
        id: nextId++,
        user: { login: TOKEN_OWNER, type: "User" },
        created_at: "2026-08-15T11:00:00Z",
      };
      comments.push(comment);
      void body;
      return json(201, comment);
    }

    if (method === "GET" && path === `${P}/issues/7/comments`) return json(200, comments);
    if (method === "GET" && path === `${P}/pulls/7/comments`) return json(200, []);
    if (method === "GET" && path === `${P}/pulls/7`) return json(200, pullPayload());
    if (method === "GET" && path === `${P}/pulls/7/reviews`) return json(200, reviews);
    if (method === "GET" && path === `${P}/commits/sha-head/check-runs`) {
      return json(200, checkRuns(checkRun("completed", "success")));
    }
    if (method === "GET" && path === `${P}/commits/main/check-runs`) return json(200, checkRuns());

    return json(404, { message: "Not Found" });
  };

  return {
    fetch: fetchImpl,
    /** Who GitHub recorded as the author of each comment on the PR. */
    authors: () => comments.map((comment) => comment.user.login),
    /** Push a comment from someone who is not conductor. */
    humanComments(login: string) {
      comments.push({
        id: nextId++,
        user: { login, type: "User" },
        created_at: "2026-08-15T11:30:00Z",
      });
    },
    /** Put a submitted review on the PR. */
    approvedBy(login: string) {
      reviews.push({
        id: nextId++,
        user: { login, type: "User" },
        state: "APPROVED",
        commit_id: "sha-head",
        submitted_at: "2026-08-15T11:45:00Z",
      });
    },
  };
}

function clientFor(gh: ReturnType<typeof fakeRepo>, selfLogin?: string) {
  return createGitHubClient({
    owner: OWNER,
    repo: REPO,
    token: "t",
    baseUrl: BASE_URL,
    fetch: gh.fetch,
    ...(selfLogin === undefined ? {} : { selfLogin }),
  });
}

function poll(client: ReturnType<typeof clientFor>) {
  return pollGitHub(client, {
    entityId: entity.id,
    entity: { kind: entity.kind, phase: entity.phase },
    artifacts: [artifact],
    cursor: EMPTY_POLL_CURSOR,
    now: NOW,
  });
}

/** Every action the driver would take on what this poll reported. */
async function actionsFromPoll(client: ReturnType<typeof clientFor>) {
  const result = await poll(client);
  return {
    result,
    actions: result.signals.flatMap((signal) => decide(entity, signal, result.world)),
  };
}

describe("conductor answering a reviewer on a PR it also polls", () => {
  it("does not dispatch a feedback pass against its own reply", async () => {
    const gh = fakeRepo();
    const client = clientFor(gh);

    await commentOnPullRequest(client, { pullNumber: 7, body: "Fixed in abc123." });
    // The double really did record conductor's comment under the token owner.
    // Without this, an empty comment list would pass everything below.
    expect(gh.authors()).toEqual([TOKEN_OWNER]);

    const { result, actions } = await actionsFromPoll(client);

    // The cost, not the badge, and asserted first so a regression reports it:
    // a dispatch here runs a coding agent, which posts another reply, which
    // polls back as feedback, forever.
    expect(actions.filter((action) => action.kind === "addressFeedback")).toEqual([]);
    expect(result.signals.filter((signal) => signal.kind === "feedback_received")).toEqual([]);
    // Seen, so a later identity change cannot resurrect it as a flood.
    expect(result.cursor.commentKeys).toEqual(["issue:900"]);
  });

  it("still dispatches for a comment a human actually wrote", async () => {
    // The control. Without it, a poll path that produced no signals for any
    // reason at all would look like the guard working.
    const gh = fakeRepo();
    const client = clientFor(gh);
    gh.humanComments("alice");

    const { result, actions } = await actionsFromPoll(client);

    expect(result.signals.filter((signal) => signal.kind === "feedback_received")).toHaveLength(1);
    expect(actions.filter((action) => action.kind === "addressFeedback")).toHaveLength(1);
  });

  it("asks GitHub who it is only once, however many reads a tick makes", async () => {
    const gh = fakeRepo();
    const calls: string[] = [];
    const client = createGitHubClient({
      owner: OWNER,
      repo: REPO,
      token: "t",
      baseUrl: BASE_URL,
      fetch: (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url.replace(BASE_URL, "").split("?")[0]}`);
        return gh.fetch(url, init);
      },
    });

    await poll(client);
    await poll(client);

    expect(calls.filter((call) => call === "GET /user")).toHaveLength(1);
  });

  it("costs no request at all when the login was configured", async () => {
    const gh = fakeRepo({ whoAmI: "unauthorized" });
    const calls: string[] = [];
    const client = createGitHubClient({
      owner: OWNER,
      repo: REPO,
      token: "t",
      baseUrl: BASE_URL,
      selfLogin: TOKEN_OWNER,
      fetch: (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url.replace(BASE_URL, "").split("?")[0]}`);
        return gh.fetch(url, init);
      },
    });

    await commentOnPullRequest(client, { pullNumber: 7, body: "Fixed in abc123." });
    const { actions } = await actionsFromPoll(client);

    expect(calls).not.toContain("GET /user");
    expect(actions.filter((action) => action.kind === "addressFeedback")).toEqual([]);
  });
});

describe("conductor submitting a review on a PR it also polls", () => {
  it("does not let its own approval release the review gate", async () => {
    // The second symptom of the same missing fact. Conductor submits reviews as
    // well as reading them, and an approval it wrote satisfying
    // `awaiting_review` would walk the issue up to a human merge invitation
    // nobody approved.
    const gh = fakeRepo();
    const client = clientFor(gh);
    gh.approvedBy(TOKEN_OWNER);

    const { world } = await poll(client);
    expect(world.pullRequests[7]!.reviews).toEqual([
      expect.objectContaining({ reviewer: TOKEN_OWNER, isHuman: false }),
    ]);
    expect(deriveGate(entity, world)).toBe("awaiting_review");
  });

  it("still lets a human's approval release it", async () => {
    const gh = fakeRepo();
    const client = clientFor(gh);
    gh.approvedBy("alice");

    const { world } = await poll(client);
    expect(deriveGate(entity, world)).not.toBe("awaiting_review");
  });
});

describe("a token that cannot answer `GET /user`", () => {
  it("polls on for an installation token, whose writes are `[bot]` anyway", async () => {
    // A GitHub App's token — which is what Actions' own `GITHUB_TOKEN` is —
    // is refused by `/user`. It also cannot author a comment that looks human:
    // its writes are attributed to `<app>[bot]`, which the author check drops
    // on the login suffix. There is no self-login to learn and none is needed.
    const gh = fakeRepo({ whoAmI: "installation-token" });
    const client = clientFor(gh);
    gh.humanComments("alice");

    const { actions } = await actionsFromPoll(client);
    expect(actions.filter((action) => action.kind === "addressFeedback")).toHaveLength(1);
  });

  it("refuses to produce signals at all when the failure is not that", async () => {
    // A 401, a 5xx, a network fault: conductor does not know who it is, and a
    // poll that guesses is the loop. Failing the tick is the cheap outcome.
    const gh = fakeRepo({ whoAmI: "unauthorized" });
    const client = clientFor(gh);

    await expect(poll(client)).rejects.toThrow(/who .*token belongs to|selfLogin/i);
  });
});
