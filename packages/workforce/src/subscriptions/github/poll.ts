// FIX-2536; FIX-2535 (the normalizer it feeds).
/**
 * GitHub's poll: what happened on one thread since a time, read from GitHub's
 * REST API as the running user, and rebuilt as the webhook payloads
 * `normalizeGitHubEvent` reads, so a polled event and a pushed one name the
 * same object at the same version (ER-8) and pass the same screens.
 *
 * - **A pull request or issue** (`github:o/r#n`): its reviews, its review
 *   comments and issue comments, its head commit's completed check runs, and
 *   its timeline (`assigned`, `review_requested`, `closed`, `reopened`), plus
 *   its opening.
 * - **A repository** (`github:o/r`): the issues and pull requests that moved
 *   (their opening and closing) and the repository's issue comments.
 *
 * Each request is conditional on the ETag the last poll returned for it; when
 * every one answers `304`, the poll is `unchanged`. One page (100) per
 * endpoint and poll: a thread busier than that in one cadence is read across
 * polls only where the endpoint takes `since`.
 *
 * Versions an occurrence takes from its time: the timeline event's
 * `created_at` stands in for the `updated_at` a webhook payload carries for
 * `assigned`, `review_requested` and `reopened`.
 */
import type { BlockContext, SubscriptionEvent } from "@flow-state-dev/core/types";
import type { SubscriptionPollCursor, SubscriptionPollResult } from "../subscribe";
import { normalizeGitHubEvent, type GitHubNormalizeOptions } from "./normalize";

type Json = Record<string, unknown>;

/** One GET as the running user: the response, or `undefined` when there is no token. */
export type GitHubCall = (ctx: BlockContext, path: string, etag?: string) => Promise<Response | undefined>;

const obj = (value: unknown): Json | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.flatMap((v) => (obj(v) === undefined ? [] : [v as Json])) : []);
const ms = (value: unknown): number | undefined => (typeof value === "string" ? Date.parse(value) : undefined);

/** Poll one GitHub thread since the cursor. */
export async function pollGitHubThread(
  call: GitHubCall,
  thread: string,
  cursor: SubscriptionPollCursor,
  ctx: BlockContext,
  normalize: GitHubNormalizeOptions
): Promise<SubscriptionPollResult> {
  const match = /^github:([^/#\s]+)\/([^/#\s]+)(?:#(\d+))?$/.exec(thread);
  if (match === null) return { events: [], through: Date.now() };
  const [, owner, name, n] = match as unknown as [string, string, string, string | undefined];
  const repo = `/repos/${owner}/${name}`;
  const through = Date.now();
  const since = cursor.since;
  const sinceParam = since === undefined ? "" : `&since=${encodeURIComponent(new Date(since).toISOString())}`;
  const etags: Record<string, string> = {};
  let changed = false;

  /** GET `path`, conditional on its last ETag: the body, or `undefined` when unchanged or unreadable. */
  const get = async (path: string): Promise<unknown> => {
    const res = await call(ctx, path, cursor.etags?.[path]);
    if (res === undefined) throw new Error("no GitHub token for the polling user");
    const etag = res.headers.get("etag");
    if (res.status === 304) {
      if (cursor.etags?.[path] !== undefined) etags[path] = cursor.etags[path]!;
      return undefined;
    }
    if (!res.ok) throw new Error(`GitHub ${path} answered ${res.status}`);
    changed = true;
    if (etag !== null) etags[path] = etag;
    return res.json();
  };
  const after = (time: number | undefined) => time !== undefined && (since === undefined || time >= since);

  const repository = obj(await get(repo));
  const events: SubscriptionEvent[] = [];
  const push = (eventType: string, payload: Json) => events.push(...normalizeGitHubEvent({ eventType, payload, received: through }, normalize));

  // The repository object every payload carries: fetched afresh, or rebuilt from the thread when unchanged.
  const repoPayload: Json = repository ?? { full_name: `${owner}/${name}` };

  if (n === undefined) {
    for (const issue of list(await get(`${repo}/issues?state=all&per_page=100${sinceParam}`))) {
      const eventType = issue.pull_request === undefined ? "issues" : "pull_request";
      const key = eventType === "issues" ? "issue" : "pull_request";
      if (after(ms(issue.created_at))) push(eventType, { action: "opened", [key]: issue, repository: repoPayload, sender: issue.user });
      if (issue.state === "closed" && after(ms(issue.closed_at))) {
        push(eventType, { action: "closed", [key]: issue, repository: repoPayload, sender: issue.closed_by ?? issue.user });
      }
    }
    for (const comment of list(await get(`${repo}/issues/comments?per_page=100${sinceParam}`))) {
      const number = Number(String(comment.issue_url ?? "").split("/").pop());
      if (Number.isInteger(number)) push("issue_comment", { action: "created", comment, issue: { number }, repository: repoPayload, sender: comment.user });
    }
    return changed ? { events, through, etags } : { unchanged: true };
  }

  const issue = obj(await get(`${repo}/issues/${n}`));
  const isPr = issue === undefined ? cursor.etags?.[`${repo}/pulls/${n}`] !== undefined : issue.pull_request !== undefined;
  const pr = isPr ? obj(await get(`${repo}/pulls/${n}`)) : undefined;
  const subject: Json = { ...(issue ?? {}), ...(pr ?? {}), number: Number(n) };
  const eventType = isPr ? "pull_request" : "issues";
  const key = isPr ? "pull_request" : "issue";
  if (issue !== undefined && after(ms(issue.created_at))) push(eventType, { action: "opened", [key]: subject, repository: repoPayload, sender: issue.user });
  for (const step of list(await get(`${repo}/issues/${n}/timeline?per_page=100`))) {
    const action = String(step.event ?? "");
    const at = step.created_at;
    if (!after(ms(at)) || !["assigned", "review_requested", "closed", "reopened"].includes(action)) continue;
    push(eventType, {
      action,
      [key]: { ...subject, updated_at: at, ...(action === "closed" ? { closed_at: at } : {}) },
      repository: repoPayload,
      sender: step.actor,
      ...(action === "assigned" ? { assignee: step.assignee } : {}),
      ...(action === "review_requested" ? { requested_reviewer: step.requested_reviewer, requested_team: step.requested_team } : {})
    });
  }
  for (const comment of list(await get(`${repo}/issues/${n}/comments?per_page=100${sinceParam}`))) {
    push("issue_comment", { action: "created", comment, issue: subject, repository: repoPayload, sender: comment.user });
  }
  if (isPr) {
    for (const review of list(await get(`${repo}/pulls/${n}/reviews?per_page=100`))) {
      if (after(ms(review.submitted_at))) push("pull_request_review", { action: "submitted", review, pull_request: subject, repository: repoPayload, sender: review.user });
    }
    for (const comment of list(await get(`${repo}/pulls/${n}/comments?per_page=100${sinceParam}`))) {
      push("pull_request_review_comment", { action: "created", comment, pull_request: subject, repository: repoPayload, sender: comment.user });
    }
    const sha = obj(pr?.head)?.sha;
    if (typeof sha === "string") {
      const runs = obj(await get(`${repo}/commits/${sha}/check-runs?per_page=100`))?.check_runs;
      for (const run of list(runs)) {
        if (run.status === "completed" && after(ms(run.completed_at))) {
          push("check_run", { action: "completed", check_run: { ...run, pull_requests: [{ number: Number(n) }] }, repository: repoPayload, sender: obj(run.app) });
        }
      }
    }
  }
  // Only this thread's events: a repository-wide object (a check on no pull request) isn't this poll's.
  const own = events.filter((e) => e.threads.includes(thread.toLowerCase()));
  return changed ? { events: own, through, etags } : { unchanged: true };
}
