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
 * **Conditional requests.** Each list's first page is asked with the ETag the
 * last poll got for it; when every one answers `304`, the poll is
 * `unchanged`. The repository, the issue and the pull request are asked
 * conditionally too, and asked again in full only when a list moved, so an
 * event rebuilt from them carries their labels, title and privacy. The head
 * commit is kept from the last read of the pull request: a `304` there means
 * the head didn't move, and its check runs are still asked every poll, since
 * a finished run doesn't change the pull request.
 *
 * **Long lists.** GitHub lists oldest first. A list with more than one page
 * is read from its last page back toward the mark, until a page starts before
 * it, at most {@link MAX_PAGES} pages a list. A walk that stops at the bound
 * marks the poll `incomplete`, so the fire can say so in the session rather
 * than drop what it didn't reach. Extra pages cost only on a thread that moved.
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

/** The timeline events a poll rebuilds, by GitHub's own names. */
const TIMELINE_ACTIONS = new Set(["assigned", "review_requested", "closed", "reopened"]);

/** The most pages one list is read to in one poll, its first included. */
const MAX_PAGES = 5;

/** Where the head commit of the pull request is kept between polls, beside the ETags. */
const HEAD_KEY = "#head";

/** The last page a `Link` header names, or `undefined`. */
function lastPageOf(link: string | null): number | undefined {
  const match = link === null ? null : /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return match === null ? undefined : Number(match[1]);
}

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
  let moved = false;
  let incomplete = false;

  /** GET `path`, conditional on its last ETag unless `full`: the body and its `Link`, or `undefined` when unchanged. */
  const get = async (path: string, full = false): Promise<{ body: unknown; link: string | null } | undefined> => {
    const res = await call(ctx, path, full ? undefined : cursor.etags?.[path]);
    if (res === undefined) throw new Error("no GitHub token for the polling user");
    if (res.status === 304) {
      if (cursor.etags?.[path] !== undefined) etags[path] = cursor.etags[path]!;
      return undefined;
    }
    if (!res.ok) throw new Error(`GitHub ${path} answered ${res.status}`);
    const etag = res.headers.get("etag");
    if (etag !== null) etags[path] = etag;
    return { body: await res.json(), link: res.headers.get("link") };
  };

  /**
   * A list's items since the mark: its first page conditionally, then, when
   * it has more, from its last page back until a page starts before the mark.
   */
  const pages = async (path: string, timeOf: (item: Json) => number | undefined): Promise<Json[]> => {
    const first = await get(path);
    if (first === undefined) return [];
    moved = true;
    const items = list(first.body);
    const last = lastPageOf(first.link);
    if (last === undefined || last <= 1) return items;
    const later: Json[][] = [];
    let page = last;
    let reachedMark = false;
    while (page > 1 && later.length < MAX_PAGES - 1) {
      const got = list((await get(`${path}&page=${page}`, true))?.body);
      later.unshift(got);
      page -= 1;
      const oldest = got.map(timeOf).find((t) => t !== undefined);
      if (since !== undefined && oldest !== undefined && oldest < since) {
        reachedMark = true;
        break;
      }
    }
    // Pages left unread between the first and the walk, after the mark: the poll didn't see everything.
    if (!reachedMark && page > 1) incomplete = true;
    return [...items, ...later.flat()];
  };
  const after = (time: number | undefined) => time !== undefined && (since === undefined || time >= since);
  const events: SubscriptionEvent[] = [];
  const push = (eventType: string, payload: Json) => events.push(...normalizeGitHubEvent({ eventType, payload, received: through }, normalize));
  const result = (own: SubscriptionEvent[]): SubscriptionPollResult =>
    moved ? { events: own, through, etags, ...(incomplete ? { incomplete: true as const } : {}) } : { unchanged: true };

  // The subjects, conditionally; asked again in full below when a list moved and one came back unchanged.
  let repository = obj((await get(repo))?.body);

  if (n === undefined) {
    const issues = await pages(`${repo}/issues?state=all&per_page=100${sinceParam}`, (i) => ms(i.updated_at));
    const comments = await pages(`${repo}/issues/comments?per_page=100${sinceParam}`, (c) => ms(c.updated_at));
    if (moved && repository === undefined) repository = obj((await get(repo, true))?.body);
    const repoPayload: Json = repository ?? { full_name: `${owner}/${name}` };
    for (const issue of issues) {
      const eventType = issue.pull_request === undefined ? "issues" : "pull_request";
      const key = eventType === "issues" ? "issue" : "pull_request";
      if (after(ms(issue.created_at))) push(eventType, { action: "opened", [key]: issue, repository: repoPayload, sender: issue.user });
      if (issue.state === "closed" && after(ms(issue.closed_at))) {
        push(eventType, { action: "closed", [key]: issue, repository: repoPayload, sender: issue.closed_by ?? issue.user });
      }
    }
    for (const comment of comments) {
      const number = Number(String(comment.issue_url ?? "").split("/").pop());
      if (Number.isInteger(number)) push("issue_comment", { action: "created", comment, issue: { number }, repository: repoPayload, sender: comment.user });
    }
    return result(events);
  }

  let issue = obj((await get(`${repo}/issues/${n}`))?.body);
  if (issue !== undefined) moved = true;
  // A pull request is known by its issue, or by the head the last poll kept.
  const knownPr = cursor.etags?.[HEAD_KEY] !== undefined;
  const isPr = issue === undefined ? knownPr : issue.pull_request !== undefined;
  let pr = isPr ? obj((await get(`${repo}/pulls/${n}`))?.body) : undefined;
  const sha = (typeof obj(pr?.head)?.sha === "string" ? (obj(pr?.head)!.sha as string) : undefined) ?? cursor.etags?.[HEAD_KEY];
  if (isPr && sha !== undefined) etags[HEAD_KEY] = sha;

  const timeline = await pages(`${repo}/issues/${n}/timeline?per_page=100`, (s) => ms(s.created_at));
  const issueComments = await pages(`${repo}/issues/${n}/comments?per_page=100${sinceParam}`, (c) => ms(c.updated_at));
  const reviews = isPr ? await pages(`${repo}/pulls/${n}/reviews?per_page=100`, (r) => ms(r.submitted_at)) : [];
  const reviewComments = isPr ? await pages(`${repo}/pulls/${n}/comments?per_page=100${sinceParam}`, (c) => ms(c.updated_at)) : [];
  // Asked every poll under its own ETag: a finished run changes neither the issue nor the pull request.
  const runsRead = isPr && sha !== undefined ? await get(`${repo}/commits/${sha}/check-runs?per_page=100`) : undefined;
  if (runsRead !== undefined) moved = true;
  const runs = list(obj(runsRead?.body)?.check_runs);

  // Something moved: the subjects an event is rebuilt from are read in full, so it carries their labels, title and privacy.
  if (moved) {
    repository ??= obj((await get(repo, true))?.body);
    issue ??= obj((await get(`${repo}/issues/${n}`, true))?.body);
    if (isPr) pr ??= obj((await get(`${repo}/pulls/${n}`, true))?.body);
  }
  const repoPayload: Json = repository ?? { full_name: `${owner}/${name}` };
  const subject: Json = { ...(issue ?? {}), ...(pr ?? {}), number: Number(n) };
  const eventType = isPr ? "pull_request" : "issues";
  const key = isPr ? "pull_request" : "issue";
  if (issue !== undefined && after(ms(issue.created_at))) push(eventType, { action: "opened", [key]: subject, repository: repoPayload, sender: issue.user });
  for (const step of timeline) {
    const action = String(step.event ?? "");
    const at = step.created_at;
    if (!after(ms(at)) || !TIMELINE_ACTIONS.has(action)) continue;
    push(eventType, {
      action,
      [key]: { ...subject, updated_at: at, ...(action === "closed" ? { closed_at: at } : {}) },
      repository: repoPayload,
      sender: step.actor,
      ...(action === "assigned" ? { assignee: step.assignee } : {}),
      ...(action === "review_requested" ? { requested_reviewer: step.requested_reviewer, requested_team: step.requested_team } : {})
    });
  }
  for (const comment of issueComments) push("issue_comment", { action: "created", comment, issue: subject, repository: repoPayload, sender: comment.user });
  for (const review of reviews) {
    if (after(ms(review.submitted_at))) push("pull_request_review", { action: "submitted", review, pull_request: subject, repository: repoPayload, sender: review.user });
  }
  for (const comment of reviewComments) push("pull_request_review_comment", { action: "created", comment, pull_request: subject, repository: repoPayload, sender: comment.user });
  for (const run of runs) {
    if (run.status === "completed" && after(ms(run.completed_at))) {
      push("check_run", { action: "completed", check_run: { ...run, pull_requests: [{ number: Number(n) }] }, repository: repoPayload, sender: obj(run.app) });
    }
  }
  // Only this thread's events: a repository-wide object (a check on no pull request) isn't this poll's.
  return result(events.filter((e) => e.threads.includes(thread.toLowerCase())));
}
