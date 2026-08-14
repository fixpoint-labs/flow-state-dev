/**
 * The PR operations as FSD handler blocks.
 *
 * Ordinary blocks over the functions in `./operations` — schemas in, schemas
 * out, one block per operation. Nothing here adds behaviour; the blocks exist
 * so a phase's outbound work composes the way every other piece of FSD work
 * does, and so the arguments are validated at the block boundary.
 *
 * A factory rather than module-level blocks because only the *identity* varies
 * — the client (repo, token, conductor's own login) — while the body is fixed
 * (BP-024). The client is closed over rather than passed as input: a live HTTP
 * client is not schema-describable data, and putting one in a block's input
 * would make the block's contract a lie.
 *
 * > **There is no merge block.** Conductor never merges.
 */

import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { GitHubClient } from "./client";
import {
  commentOnPullRequest,
  openPullRequest,
  replyToReviewThreads,
  setLabels,
  submitReview,
} from "./operations";

const pullNumberSchema = z.number().int().positive();

const openPullRequestInputSchema = z.object({
  title: z.string().min(1),
  /** Branch the change is on. */
  head: z.string().min(1),
  /** Branch it targets. */
  base: z.string().min(1),
  body: z.string().optional(),
  draft: z.boolean().optional(),
});

const openPullRequestOutputSchema = z.object({
  number: pullNumberSchema,
  url: z.string(),
  headSha: z.string(),
});

const commentInputSchema = z.object({
  pullNumber: pullNumberSchema,
  body: z.string().min(1),
});

const commentOutputSchema = z.object({ commentId: z.string() });

const replyInputSchema = z.object({
  pullNumber: pullNumberSchema,
  /** One entry per thread being answered; all of them go out in a single pass. */
  replies: z
    .array(z.object({ inReplyTo: z.string().min(1), body: z.string().min(1) }))
    .min(1),
});

const replyOutputSchema = z.object({ commentIds: z.array(z.string()) });

const submitReviewInputSchema = z.object({
  pullNumber: pullNumberSchema,
  /** Required — a review with no event is a pending review, which blocks the PR. */
  event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
  body: z.string().optional(),
  comments: z
    .array(z.object({ path: z.string(), line: z.number().int(), body: z.string() }))
    .optional(),
});

const submitReviewOutputSchema = z.object({ reviewId: z.string() });

const labelsInputSchema = z.object({
  pullNumber: pullNumberSchema,
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
});

const labelsOutputSchema = z.object({ labels: z.array(z.string()) });

/**
 * Build the PR operation blocks for one repository.
 *
 * @param client The GitHub client the blocks act through.
 * @returns One handler block per outbound operation.
 */
export function createGitHubPrBlocks(client: GitHubClient) {
  return {
    /** Open a pull request. */
    openPullRequest: handler({
      name: "githubOpenPullRequest",
      description: "Open a pull request on the configured repository.",
      inputSchema: openPullRequestInputSchema,
      outputSchema: openPullRequestOutputSchema,
      execute: (input) => openPullRequest(client, input),
    }),

    /** Comment on a pull request's conversation. */
    commentOnPullRequest: handler({
      name: "githubCommentOnPullRequest",
      description: "Post a comment on a pull request's conversation.",
      inputSchema: commentInputSchema,
      outputSchema: commentOutputSchema,
      execute: (input) => commentOnPullRequest(client, input),
    }),

    /** Answer every review thread in one pass, leaving no pending review. */
    replyToReviewThreads: handler({
      name: "githubReplyToReviewThreads",
      description:
        "Reply to one or more pull request review threads in a single pass, without opening a pending review.",
      inputSchema: replyInputSchema,
      outputSchema: replyOutputSchema,
      execute: (input) => replyToReviewThreads(client, input),
    }),

    /** Submit a review. Always submitted on creation — never left pending. */
    submitReview: handler({
      name: "githubSubmitReview",
      description: "Submit a review on a pull request. Always submitted, never left pending.",
      inputSchema: submitReviewInputSchema,
      outputSchema: submitReviewOutputSchema,
      execute: (input) => submitReview(client, input),
    }),

    /** Add and remove labels. */
    setLabels: handler({
      name: "githubSetLabels",
      description: "Add and remove labels on a pull request.",
      inputSchema: labelsInputSchema,
      outputSchema: labelsOutputSchema,
      execute: (input) => setLabels(client, input),
    }),
  };
}

/** The block set `createGitHubPrBlocks` returns. */
export type GitHubPrBlocks = ReturnType<typeof createGitHubPrBlocks>;
