/**
 * Outbound pull-request operations.
 *
 * Plain functions over the GitHub API, one per thing conductor does to a PR.
 * There is no connector abstraction here on purpose: a layer whose only job is
 * to forward five calls to five endpoints is bloat, and it would make the one
 * genuinely tricky operation below harder to see rather than easier.
 *
 * > **Conductor never merges.** There is no merge operation in this file and
 * > there must not be one. Merging is one of the three human gates.
 *
 * ## The pending-review rule
 *
 * GitHub allows **one pending (unsubmitted) review per pull request per user**.
 * Creating a review without an `event` leaves one pending, and the *next*
 * review write on that PR then fails with `422 — one pending review per pull
 * request`. In a feedback loop that failure is invisible: conductor believes it
 * answered the reviewer, the reviewer sees nothing, and the round never closes.
 *
 * Two rules keep it from happening, and both are enforced here rather than
 * remembered by callers:
 *
 * 1. **Every review is submitted as it is created.** `submitReview` always
 *    sends an `event`, so it never leaves a pending review behind.
 * 2. **Thread replies batch into one pass and never open a review at all.**
 *    `replyToReviewThreads` posts through the replies endpoint, which creates
 *    standalone comments.
 *
 * A pending review left by something else — an earlier crashed run, a human
 * mid-review — still blocks writes, so `submitReview` recovers: it submits the
 * dangling review and retries once. Failing loudly after that is fine; failing
 * silently is the thing that is not.
 */

import type { GitHubClient } from "./client";
import { isPendingReviewConflict } from "./client";

/** A newly opened pull request. */
export interface OpenedPullRequest {
  readonly number: number;
  readonly url: string;
  readonly headSha: string;
}

export interface OpenPullRequestInput {
  readonly title: string;
  /** Branch the change is on. */
  readonly head: string;
  /** Branch it targets. */
  readonly base: string;
  readonly body?: string;
  readonly draft?: boolean;
}

/**
 * Open a pull request.
 *
 * @returns The new PR's number, URL, and head SHA — the number is what every
 *   subsequent signal is scoped by.
 */
export async function openPullRequest(
  client: GitHubClient,
  input: OpenPullRequestInput,
): Promise<OpenedPullRequest> {
  const payload = await client.request<{
    number: number;
    html_url?: string;
    head?: { sha?: string };
  }>("POST", client.path("pulls"), {
    title: input.title,
    head: input.head,
    base: input.base,
    body: input.body ?? "",
    draft: input.draft ?? false,
  });

  return {
    number: payload.number,
    url: payload.html_url ?? "",
    headSha: payload.head?.sha ?? "",
  };
}

/**
 * Comment on a pull request's conversation.
 *
 * This is the issue-comment endpoint, not a review — it carries no state and
 * cannot satisfy or block a gate.
 *
 * @returns The new comment's id.
 */
export async function commentOnPullRequest(
  client: GitHubClient,
  input: { readonly pullNumber: number; readonly body: string },
): Promise<{ readonly commentId: string }> {
  const payload = await client.request<{ id: number | string }>(
    "POST",
    client.path("issues", input.pullNumber, "comments"),
    { body: input.body },
  );
  return { commentId: String(payload.id) };
}

/** One reply, addressed to the review comment that started the thread. */
export interface ReviewThreadReply {
  /** Id of the comment being replied to. */
  readonly inReplyTo: string;
  readonly body: string;
}

/**
 * Reply to review threads — the operation the pending-review rule exists for.
 *
 * Each reply goes through `POST /pulls/{n}/comments/{id}/replies`, which posts
 * a standalone comment into the thread. It does **not** open a review, so N
 * replies in one pass are N ordinary writes rather than N attempts to hold the
 * PR's single pending-review slot.
 *
 * @param replies One entry per thread being answered. Order is preserved.
 * @returns The created comment ids, in the order the replies were given.
 */
export async function replyToReviewThreads(
  client: GitHubClient,
  input: { readonly pullNumber: number; readonly replies: readonly ReviewThreadReply[] },
): Promise<{ readonly commentIds: readonly string[] }> {
  const commentIds: string[] = [];
  for (const reply of input.replies) {
    const payload = await client.request<{ id: number | string }>(
      "POST",
      client.path("pulls", input.pullNumber, "comments", reply.inReplyTo, "replies"),
      { body: reply.body },
    );
    commentIds.push(String(payload.id));
  }
  return { commentIds };
}

/** A line comment carried by a review submission. */
export interface ReviewLineComment {
  readonly path: string;
  readonly line: number;
  readonly body: string;
}

export interface SubmitReviewInput {
  readonly pullNumber: number;
  /**
   * Always required. Omitting it is what leaves a pending review, so this type
   * does not allow omitting it.
   */
  readonly event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  readonly body?: string;
  readonly comments?: readonly ReviewLineComment[];
}

/** A review as GitHub reports it, narrowed to what recovery needs. */
interface ReviewPayload {
  id: number | string;
  state?: string | null;
}

/**
 * Submit the dangling pending review blocking writes on this PR, if there is
 * one. Pending reviews are visible only to their author, so anything this finds
 * belongs to the token conductor is using.
 *
 * @returns True when a pending review was found and submitted.
 */
async function drainPendingReview(
  client: GitHubClient,
  pullNumber: number,
): Promise<boolean> {
  const reviews = await client.paginate<ReviewPayload>(
    client.path("pulls", pullNumber, "reviews"),
  );
  const pending = reviews.find((review) => (review.state ?? "").toUpperCase() === "PENDING");
  if (!pending) return false;

  await client.request(
    "POST",
    client.path("pulls", pullNumber, "reviews", String(pending.id), "events"),
    { event: "COMMENT" },
  );
  return true;
}

/**
 * Submit a review in one call.
 *
 * The `event` is always sent, so GitHub submits the review immediately and no
 * pending review is left behind — two `submitReview` calls in a row both
 * succeed, which is the property the feedback loop depends on.
 *
 * When a pending review from elsewhere is already blocking the PR, this submits
 * it and retries once rather than surfacing a 422 the caller would have to know
 * how to interpret.
 *
 * @returns The submitted review's id.
 */
export async function submitReview(
  client: GitHubClient,
  input: SubmitReviewInput,
): Promise<{ readonly reviewId: string }> {
  const body = {
    event: input.event,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.comments === undefined ? {} : { comments: input.comments }),
  };
  const path = client.path("pulls", input.pullNumber, "reviews");

  try {
    const payload = await client.request<{ id: number | string }>("POST", path, body);
    return { reviewId: String(payload.id) };
  } catch (error) {
    if (!isPendingReviewConflict(error)) throw error;
    // Someone left a pending review on this PR. Submitting it clears the slot;
    // its contents were meant to be posted anyway.
    if (!(await drainPendingReview(client, input.pullNumber))) throw error;
    const payload = await client.request<{ id: number | string }>("POST", path, body);
    return { reviewId: String(payload.id) };
  }
}

/**
 * Add and remove labels on a pull request.
 *
 * Adds are one call; each removal is its own, because GitHub has no batch
 * delete. A label that is not present deletes as a 404, which is not an error
 * here — the requested end state is what matters.
 *
 * @returns The labels present after the change.
 */
export async function setLabels(
  client: GitHubClient,
  input: {
    readonly pullNumber: number;
    readonly add?: readonly string[];
    readonly remove?: readonly string[];
  },
): Promise<{ readonly labels: readonly string[] }> {
  for (const label of input.remove ?? []) {
    await client
      .request(
        "DELETE",
        client.path("issues", input.pullNumber, "labels", encodeURIComponent(label)),
      )
      .catch(() => undefined);
  }

  if ((input.add ?? []).length > 0) {
    await client.request("POST", client.path("issues", input.pullNumber, "labels"), {
      labels: input.add,
    });
  }

  const current = await client.paginate<{ name?: string }>(
    client.path("issues", input.pullNumber, "labels"),
  );
  return { labels: current.map((label) => label.name ?? "").filter(Boolean) };
}
