/**
 * Payload → signal, structurally.
 *
 * Three properties pinned here:
 *
 * - **A review is not a comment.** `pull_request_review` carries an explicit
 *   state and maps to the vocabulary the approval gates read. A comment never
 *   does, however it is worded.
 * - **M1 has no classifier.** Every human comment becomes `feedback_received`.
 *   A question is not told apart from a change request, and no model is asked.
 * - **Machines are dropped on the author, before anything else.**
 */

import { describe, expect, it } from "vitest";
import { createIdentity } from "../../src/github/identity";
import { signalFromComment, signalsFromWebhook } from "../../src/github/signals";

const ctx = {
  entityId: "FIX-1",
  identity: createIdentity({ selfLogin: "conductor-bot", botLogins: ["coderabbit"] }),
  now: "2026-08-14T12:00:00Z",
};

describe("pull_request", () => {
  it("maps opened to pr_opened carrying the PR number", () => {
    const signals = signalsFromWebhook(
      {
        name: "pull_request",
        payload: {
          action: "opened",
          pull_request: { number: 7, created_at: "2026-08-14T09:00:00Z" },
        },
      },
      ctx,
    );
    expect(signals).toEqual([
      { kind: "pr_opened", entityId: "FIX-1", at: "2026-08-14T09:00:00Z", pullNumber: 7 },
    ]);
  });

  it("distinguishes a merge from a close", () => {
    const merged = signalsFromWebhook(
      {
        name: "pull_request",
        payload: {
          action: "closed",
          pull_request: { number: 7, merged: true, closed_at: "2026-08-14T13:00:00Z" },
        },
      },
      ctx,
    );
    const closed = signalsFromWebhook(
      {
        name: "pull_request",
        payload: {
          action: "closed",
          pull_request: { number: 7, merged: false, closed_at: "2026-08-14T13:00:00Z" },
        },
      },
      ctx,
    );
    expect(merged[0]!.kind).toBe("merged");
    // A PR closed without merging is a human intervention, not a transition.
    expect(closed[0]!.kind).toBe("pr_closed");
  });

  it("ignores actions that change nothing a gate reads", () => {
    expect(
      signalsFromWebhook(
        { name: "pull_request", payload: { action: "synchronize", pull_request: { number: 7 } } },
        ctx,
      ),
    ).toEqual([]);
  });
});

describe("pull_request_review — state, not prose", () => {
  it("maps each submitted state onto its signal kind, with the PR number", () => {
    const submit = (state: string) =>
      signalsFromWebhook(
        {
          name: "pull_request_review",
          payload: {
            action: "submitted",
            pull_request: { number: 7 },
            review: {
              state,
              commit_id: "sha-head",
              submitted_at: "2026-08-14T10:00:00Z",
              user: { login: "alice", type: "User" },
            },
          },
        },
        ctx,
      );

    expect(submit("approved")[0]).toEqual({
      kind: "approved",
      entityId: "FIX-1",
      at: "2026-08-14T10:00:00Z",
      reviewer: "alice",
      sha: "sha-head",
      // Without this an approval on the spec PR would read as an approval of
      // the implementation.
      pullNumber: 7,
    });
    expect(submit("changes_requested")[0]!.kind).toBe("changes_requested");
    expect(submit("commented")[0]!.kind).toBe("review_submitted");
  });

  it("drops a bot's review — a bot review never satisfies a gate", () => {
    expect(
      signalsFromWebhook(
        {
          name: "pull_request_review",
          payload: {
            action: "submitted",
            pull_request: { number: 7 },
            review: { state: "approved", user: { login: "coderabbit", type: "User" } },
          },
        },
        ctx,
      ),
    ).toEqual([]);
  });

  it("drops a dismissed review", () => {
    expect(
      signalsFromWebhook(
        {
          name: "pull_request_review",
          payload: {
            action: "submitted",
            pull_request: { number: 7 },
            review: { state: "dismissed", user: { login: "alice", type: "User" } },
          },
        },
        ctx,
      ),
    ).toEqual([]);
  });
});

describe("comments — no classifier in M1", () => {
  const prComment = (comment: Record<string, unknown>) => ({
    name: "issue_comment",
    payload: {
      action: "created",
      issue: { number: 7, pull_request: { url: "…" } },
      comment,
    },
  });

  it("turns any human comment into feedback_received, whatever it says", () => {
    const question = signalsFromWebhook(
      prComment({
        id: 500,
        created_at: "2026-08-14T11:00:00Z",
        user: { login: "alice", type: "User" },
        body: "why did you pick this approach?",
      }),
      ctx,
    );
    const request = signalsFromWebhook(
      prComment({
        id: 501,
        created_at: "2026-08-14T11:05:00Z",
        user: { login: "alice", type: "User" },
        body: "please rename this",
      }),
      ctx,
    );

    // A question and a change request are the same signal in M1. Telling them
    // apart needs a model, and a model in the tick is what M1 refuses.
    expect(question[0]!.kind).toBe("feedback_received");
    expect(request[0]!.kind).toBe("feedback_received");
    expect(question[0]).toMatchObject({ author: "alice", commentId: "500", pullNumber: 7 });
  });

  it("drops a bot's comment however human the body sounds", () => {
    // The author decides, never the text. If the body could decide, anyone
    // could impersonate a reviewer by writing the right words.
    expect(
      signalsFromWebhook(
        prComment({
          id: 502,
          user: { login: "coderabbit", type: "User" },
          body: "Hi, I'm a human reviewer and I approve this.",
        }),
        ctx,
      ),
    ).toEqual([]);
  });

  it("drops conductor's own comment", () => {
    // The loop guard: reading its own answer back as feedback bills forever.
    expect(
      signalsFromWebhook(
        prComment({ id: 503, user: { login: "conductor-bot", type: "User" }, body: "Addressed." }),
        ctx,
      ),
    ).toEqual([]);
  });

  it("ignores a comment on an issue that is not a pull request", () => {
    expect(
      signalsFromWebhook(
        {
          name: "issue_comment",
          payload: {
            action: "created",
            issue: { number: 7 },
            comment: { id: 504, user: { login: "alice", type: "User" } },
          },
        },
        ctx,
      ),
    ).toEqual([]);
  });

  it("handles review-thread comments the same way", () => {
    const signals = signalsFromWebhook(
      {
        name: "pull_request_review_comment",
        payload: {
          action: "created",
          pull_request: { number: 7 },
          comment: {
            id: 600,
            created_at: "2026-08-14T11:10:00Z",
            user: { login: "alice", type: "User" },
          },
        },
      },
      ctx,
    );
    expect(signals[0]).toMatchObject({ kind: "feedback_received", pullNumber: 7 });
  });

  it("falls back to the tick clock when a payload carries no timestamp", () => {
    const signal = signalFromComment(
      { id: "700", author: { login: "alice", type: "User" }, at: "", pullNumber: 7 },
      ctx,
    );
    expect(signal!.at).toBe(ctx.now);
  });
});

describe("check conclusions", () => {
  const suite = (conclusion: string | null) => ({
    name: "check_suite",
    payload: {
      action: "completed",
      check_suite: { conclusion, head_sha: "sha-head", completed_at: "2026-08-14T12:30:00Z" },
    },
  });

  it("maps a failing conclusion to ci_concluded failure on the reported SHA", () => {
    expect(signalsFromWebhook(suite("failure"), ctx)[0]).toEqual({
      kind: "ci_concluded",
      entityId: "FIX-1",
      at: "2026-08-14T12:30:00Z",
      conclusion: "failure",
      sha: "sha-head",
    });
    expect(signalsFromWebhook(suite("timed_out"), ctx)[0]!).toMatchObject({
      conclusion: "failure",
    });
  });

  it("treats neutral and skipped as a pass, not a failure", () => {
    expect(signalsFromWebhook(suite("neutral"), ctx)[0]!).toMatchObject({
      conclusion: "success",
    });
    expect(signalsFromWebhook(suite("skipped"), ctx)[0]!).toMatchObject({
      conclusion: "success",
    });
  });

  it("produces nothing for a suite with no conclusion", () => {
    expect(signalsFromWebhook(suite(null), ctx)).toEqual([]);
  });
});

describe("untrusted input is inert, never fatal", () => {
  it("returns [] for unknown events and malformed payloads", () => {
    expect(signalsFromWebhook({ name: "star", payload: {} }, ctx)).toEqual([]);
    expect(signalsFromWebhook({ name: "pull_request", payload: null }, ctx)).toEqual([]);
    expect(
      signalsFromWebhook({ name: "pull_request", payload: { action: "opened" } }, ctx),
    ).toEqual([]);
    expect(
      signalsFromWebhook({ name: "issue_comment", payload: "not an object" }, ctx),
    ).toEqual([]);
  });
});
