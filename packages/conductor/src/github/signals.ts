/**
 * GitHub payloads → `Signal[]`. Structural only.
 *
 * **M1 has no classifier, deliberately.** Any human comment becomes
 * `feedback_received` without asking a model what kind of comment it is. That
 * is crude — a question and a change request reduce to the same signal — and it
 * is correct for the one case M1 has, because it is what keeps a tick free of
 * a generator call. `question_asked` and `approval_expressed` arrive with the
 * classifier in M3. **Nothing in this file may read a comment body.**
 *
 * The two shapes GitHub reports are not interchangeable and are not treated as
 * such here:
 *
 * - **A comment is prose.** It becomes `feedback_received`, and only if a human
 *   wrote it.
 * - **A review is state.** `pull_request_review` carries an explicit
 *   `APPROVED` / `CHANGES_REQUESTED` / `COMMENTED`, which maps to `approved` /
 *   `changes_requested` / `review_submitted`. This is the vocabulary the
 *   approval gates actually read, and it never comes from prose.
 *
 * Every PR-bound signal carries its `pullNumber`. That is load-bearing rather
 * than bookkeeping: an issue in `IMPLEMENTATION` still has its spec PR sitting
 * there, and without the number a late approval on the spec would read as an
 * approval of the implementation.
 */

import type { CiConcludedSignal, ProseSignal, ReviewStateSignal, Signal } from "../model/signals";
import { isHumanActor, type ConductorIdentity, type GitHubActor } from "./identity";

/** Context every parse needs: who the signals are for, and who conductor is. */
export interface SignalParseContext {
  /** The entity every produced signal is addressed to. */
  readonly entityId: string;
  /** Conductor's own login and the configured bot list. */
  readonly identity: ConductorIdentity;
  /** Fallback timestamp for a payload that carries none, ISO-8601. */
  readonly now: string;
}

/**
 * One comment, normalized across the two REST endpoints that produce them
 * (`issues/{n}/comments` and `pulls/{n}/comments`) and the two webhook events
 * that mirror them.
 */
export interface CommentFacts {
  readonly id: string;
  readonly author: GitHubActor | null;
  readonly at: string;
  readonly pullNumber: number;
  /** Set when a GitHub App acted. Structural evidence, not text. */
  readonly viaGitHubApp?: boolean;
}

/**
 * Turn one comment into a signal, or drop it.
 *
 * The author check runs **first and structurally**, before anything else looks
 * at the comment at all. A bot's comment and conductor's own comment are not
 * "low-priority signals" — they are not signals.
 *
 * @returns `feedback_received`, or `null` when the author is not a human.
 */
export function signalFromComment(
  comment: CommentFacts,
  ctx: SignalParseContext,
): ProseSignal | null {
  if (!isHumanActor(comment.author, ctx.identity, { viaGitHubApp: comment.viaGitHubApp })) {
    return null;
  }
  return {
    kind: "feedback_received",
    entityId: ctx.entityId,
    at: comment.at || ctx.now,
    author: comment.author?.login ?? "",
    commentId: comment.id,
    pullNumber: comment.pullNumber,
  };
}

/** Map a submitted review state onto the signal kind it produces. */
function reviewSignalKind(state: string): ReviewStateSignal["kind"] | null {
  switch (state.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "review_submitted";
    default:
      // `DISMISSED` and `PENDING` are not submissions anyone stands behind.
      return null;
  }
}

/** CI conclusions that mean the run did not pass. Anything else is a pass. */
const FAILING_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);

/** Map a check conclusion onto `ci_concluded`, or `null` when it is not a conclusion. */
function ciConclusion(conclusion: unknown): CiConcludedSignal["conclusion"] | null {
  if (typeof conclusion !== "string") return null;
  if (FAILING_CONCLUSIONS.has(conclusion)) return "failure";
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
    return "success";
  }
  return null;
}

/** A webhook delivery: the `X-GitHub-Event` header value and its JSON body. */
export interface WebhookDelivery {
  readonly name: string;
  readonly payload: unknown;
}

/** Read a nested property off an untrusted payload without throwing. */
function pick(source: unknown, ...keys: readonly string[]): unknown {
  let current = source;
  for (const key of keys) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** A string field off an untrusted payload, or `""`. */
function str(source: unknown, ...keys: readonly string[]): string {
  const value = pick(source, ...keys);
  return typeof value === "string" ? value : "";
}

/** A positive integer field off an untrusted payload, or `null`. */
function num(source: unknown, ...keys: readonly string[]): number | null {
  const value = pick(source, ...keys);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The author record off an untrusted payload. */
function actor(source: unknown, ...keys: readonly string[]): GitHubActor | null {
  const value = pick(source, ...keys);
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    login: typeof record.login === "string" ? record.login : null,
    type: typeof record.type === "string" ? record.type : null,
  };
}

/**
 * Parse one webhook delivery into the signals it carries.
 *
 * Webhooks are M3; this exists in M1 so the poll path and the event path
 * produce the *same* vocabulary from the *same* rules, rather than the event
 * path arriving later with its own interpretation of what a comment means.
 *
 * Unrecognized events, unrecognized actions, and comments from machines all
 * produce `[]`. An untrusted payload never throws and never partially applies.
 *
 * @param delivery The event name and its raw JSON body.
 * @param ctx The entity to address, conductor's identity, and a fallback clock.
 * @returns Zero or more signals, in payload order.
 */
export function signalsFromWebhook(
  delivery: WebhookDelivery,
  ctx: SignalParseContext,
): Signal[] {
  const { name, payload } = delivery;
  const action = str(payload, "action");

  switch (name) {
    case "pull_request": {
      const pullNumber = num(payload, "pull_request", "number");
      if (pullNumber === null) return [];
      if (action === "opened" || action === "reopened") {
        return [
          {
            kind: "pr_opened",
            entityId: ctx.entityId,
            at: str(payload, "pull_request", "created_at") || ctx.now,
            pullNumber,
          },
        ];
      }
      if (action === "closed") {
        const merged = pick(payload, "pull_request", "merged") === true;
        return [
          {
            kind: merged ? "merged" : "pr_closed",
            entityId: ctx.entityId,
            at: str(payload, "pull_request", "closed_at") || ctx.now,
            pullNumber,
          },
        ];
      }
      return [];
    }

    case "pull_request_review": {
      if (action !== "submitted") return [];
      const pullNumber = num(payload, "pull_request", "number");
      if (pullNumber === null) return [];
      const reviewer = actor(payload, "review", "user");
      // A bot review never satisfies a gate, so it never becomes a signal.
      if (!isHumanActor(reviewer, ctx.identity)) return [];
      const kind = reviewSignalKind(str(payload, "review", "state"));
      if (!kind) return [];
      return [
        {
          kind,
          entityId: ctx.entityId,
          at: str(payload, "review", "submitted_at") || ctx.now,
          reviewer: reviewer?.login ?? "",
          sha: str(payload, "review", "commit_id"),
          pullNumber,
        },
      ];
    }

    case "issue_comment": {
      if (action !== "created") return [];
      // Only comments on pull requests. An issue comment has no `pull_request`
      // key, and M1's signals are all PR-bound.
      if (pick(payload, "issue", "pull_request") === undefined) return [];
      const pullNumber = num(payload, "issue", "number");
      if (pullNumber === null) return [];
      const signal = signalFromComment(
        {
          id: String(num(payload, "comment", "id") ?? str(payload, "comment", "id")),
          author: actor(payload, "comment", "user"),
          at: str(payload, "comment", "created_at"),
          pullNumber,
          viaGitHubApp: pick(payload, "comment", "performed_via_github_app") != null,
        },
        ctx,
      );
      return signal ? [signal] : [];
    }

    case "pull_request_review_comment": {
      if (action !== "created") return [];
      const pullNumber = num(payload, "pull_request", "number");
      if (pullNumber === null) return [];
      const signal = signalFromComment(
        {
          id: String(num(payload, "comment", "id") ?? str(payload, "comment", "id")),
          author: actor(payload, "comment", "user"),
          at: str(payload, "comment", "created_at"),
          pullNumber,
          viaGitHubApp: pick(payload, "comment", "performed_via_github_app") != null,
        },
        ctx,
      );
      return signal ? [signal] : [];
    }

    case "check_suite":
    case "check_run": {
      if (action !== "completed") return [];
      const root = name === "check_suite" ? "check_suite" : "check_run";
      const conclusion = ciConclusion(pick(payload, root, "conclusion"));
      if (!conclusion) return [];
      const sha = str(payload, root, "head_sha");
      if (!sha) return [];
      return [
        {
          kind: "ci_concluded",
          entityId: ctx.entityId,
          at: str(payload, root, "completed_at") || ctx.now,
          conclusion,
          sha,
        },
      ];
    }

    default:
      return [];
  }
}
