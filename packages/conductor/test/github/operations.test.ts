/**
 * Outbound PR operations — and the pending-review rule above all.
 *
 * GitHub allows one pending (unsubmitted) review per pull request per user.
 * Getting that wrong does not raise anything a caller notices: conductor
 * believes it answered the reviewer, the reviewer sees nothing, and the
 * feedback round never closes. So the double these tests run against enforces
 * the rule, and the tests below are written to fail if the implementation ever
 * leaves a review pending.
 */

import { describe, expect, it } from "vitest";
import { createGitHubClient, GitHubApiError } from "../../src/github/client";
import {
  commentOnPullRequest,
  openPullRequest,
  replyToReviewThreads,
  setLabels,
  submitReview,
} from "../../src/github/operations";
import { BASE_URL, OWNER, REPO, SELF_LOGIN, createFakeGitHub } from "./fixtures";

function setup(options: { readonly labels?: readonly string[] } = {}) {
  const github = createFakeGitHub(options);
  const client = createGitHubClient({
    owner: OWNER,
    repo: REPO,
    token: "t",
    baseUrl: BASE_URL,
    fetch: github.fetch,
    selfLogin: SELF_LOGIN,
  });
  return { github, client };
}

describe("the pending-review rule", () => {
  it("answers every review thread in one pass without opening a review", async () => {
    const { github, client } = setup();

    const result = await replyToReviewThreads(client, {
      pullNumber: 7,
      replies: [
        { inReplyTo: "901", body: "renamed" },
        { inReplyTo: "902", body: "extracted the helper" },
        { inReplyTo: "903", body: "covered by a test now" },
      ],
    });

    // Three replies posted. Under a per-reply pending review the second call
    // would have failed with 422 and the third would never have been made.
    expect(result.commentIds).toHaveLength(3);
    expect(github.comments()).toEqual([
      "renamed",
      "extracted the helper",
      "covered by a test now",
    ]);
    expect(github.reviews()).toEqual([]);
  });

  it("submits each review on creation, so two in a row both land", async () => {
    const { github, client } = setup();

    const first = await submitReview(client, {
      pullNumber: 7,
      event: "COMMENT",
      body: "round one",
    });
    const second = await submitReview(client, {
      pullNumber: 7,
      event: "COMMENT",
      body: "round two",
    });

    expect(first.reviewId).not.toBe(second.reviewId);
    // Nothing left pending after either call — that is what makes the second
    // possible at all.
    expect(github.reviews().some((review) => review.state === "PENDING")).toBe(false);
    expect(github.reviews().map((review) => review.state)).toEqual(["COMMENTED", "COMMENTED"]);
  });

  it("recovers from a pending review left behind by something else", async () => {
    const { github, client } = setup();

    // A crashed earlier run — or a human mid-review — leaves the slot taken.
    // Every subsequent review write 422s until it is submitted.
    await client.request("POST", client.path("pulls", 7, "reviews"), { body: "half-written" });
    expect(github.reviews()[0]!.state).toBe("PENDING");

    const result = await submitReview(client, {
      pullNumber: 7,
      event: "COMMENT",
      body: "addressed",
    });

    expect(result.reviewId).toBeTruthy();
    expect(github.reviews().some((review) => review.state === "PENDING")).toBe(false);
    expect(github.comments()).toContain("addressed");
  });

  it("surfaces a 422 that is not about a pending review, without hunting for one", async () => {
    const calls: string[] = [];
    const client = createGitHubClient({
      owner: OWNER,
      repo: REPO,
      token: "t",
      baseUrl: BASE_URL,
      selfLogin: SELF_LOGIN,
      fetch: async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url.replace(BASE_URL, "").split("?")[0]}`);
        return new Response(JSON.stringify({ message: "Review comment path is invalid" }), {
          status: 422,
        });
      },
    });

    // The recovery path is scoped to the one failure it understands. Anything
    // else propagates rather than triggering a review-draining detour.
    await expect(
      submitReview(client, { pullNumber: 7, event: "COMMENT", body: "x" }),
    ).rejects.toBeInstanceOf(GitHubApiError);
    expect(calls).toEqual([`POST /repos/${OWNER}/${REPO}/pulls/7/reviews`]);
  });
});

describe("ordinary operations", () => {
  it("opens a pull request", async () => {
    const { client } = setup();
    const pr = await openPullRequest(client, {
      title: "FIX-1: the thing",
      head: "fix/FIX-1",
      base: "main",
      body: "why",
    });
    expect(pr).toEqual({
      number: 7,
      url: "https://github.com/acme/widgets/pull/7",
      headSha: "sha-head",
    });
  });

  it("comments on the conversation without submitting a review", async () => {
    const { github, client } = setup();
    const result = await commentOnPullRequest(client, { pullNumber: 7, body: "status update" });
    expect(result.commentId).toBeTruthy();
    expect(github.comments()).toEqual(["status update"]);
    expect(github.reviews()).toEqual([]);
  });

  it("adds and removes labels, tolerating a label that is not there", async () => {
    const { client } = setup({ labels: ["conductor:spec"] });
    const result = await setLabels(client, {
      pullNumber: 7,
      add: ["conductor:implementation"],
      remove: ["conductor:spec", "never-applied"],
    });
    expect(result.labels).toEqual(["conductor:implementation"]);
  });
});

describe("conductor never merges", () => {
  it("has no operation that reaches the merge endpoint", async () => {
    const { github, client } = setup();

    await openPullRequest(client, { title: "t", head: "h", base: "main" });
    await commentOnPullRequest(client, { pullNumber: 7, body: "hi" });
    await replyToReviewThreads(client, { pullNumber: 7, replies: [{ inReplyTo: "1", body: "ok" }] });
    await submitReview(client, { pullNumber: 7, event: "COMMENT", body: "done" });
    await setLabels(client, { pullNumber: 7, add: ["ready"] });

    // The double throws outright on a merge, so this asserts the whole exported
    // surface can be exercised without one being reachable.
    expect(github.calls.some((call) => call.includes("/merge"))).toBe(false);
  });
});
