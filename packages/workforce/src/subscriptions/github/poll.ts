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
 * Check runs change in place rather than by append, so each of their pages is
 * asked every poll under its own ETag, within the same bound.
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

/** The resolution of GitHub's timestamps, in ms: whole seconds. */
const GITHUB_TIME_RESOLUTION_MS = 1_000;

/** The most pages one list is read to in one poll, its first included. */
const MAX_PAGES = 5;

/** Where the head commit of the pull request is kept between polls, beside the ETags. */
const HEAD_KEY = "#head";

/** Where a list's last page and its count are kept between polls, beside the ETags. */
const LAST_PREFIX = "#last:";

/** Items on a full page: every list is asked `per_page=100`. */
const PAGE = 100;

/** A request's validator key: its path without `since`, which moves with the mark. */
const validatorKey = (path: string) => path.replace(/&since=[^&]*/, "");

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
  // GitHub stamps times to the second: an event later in the mark's own second reads as before it. Asked and
  // filtered from the start of that second, so the overlap re-reads it; seen versions drop the repeats.
  const since = cursor.since === undefined ? undefined : Math.floor(cursor.since / GITHUB_TIME_RESOLUTION_MS) * GITHUB_TIME_RESOLUTION_MS;
  const sinceParam = since === undefined ? "" : `&since=${encodeURIComponent(new Date(since).toISOString())}`;
  const etags: Record<string, string> = {};
  let moved = false;
  let incomplete = false;

  /**
   * GET `path`, conditional on its last ETag unless `full`: the body and its
   * `Link`, or `undefined` when unchanged. A validator is kept by the path
   * without its `since`, which moves with the mark every poll: an unchanged
   * answer still comes back `304`.
   */
  const get = async (path: string, full = false): Promise<{ body: unknown; link: string | null } | undefined> => {
    const key = validatorKey(path);
    const res = await call(ctx, path, full ? undefined : cursor.etags?.[key]);
    if (res === undefined) throw new Error("no GitHub token for the polling user");
    if (res.status === 304) {
      if (cursor.etags?.[key] !== undefined) etags[key] = cursor.etags[key]!;
      return undefined;
    }
    if (!res.ok) throw new Error(`GitHub ${path} answered ${res.status}`);
    const etag = res.headers.get("etag");
    if (etag !== null) etags[key] = etag;
    return { body: await res.json(), link: res.headers.get("link") };
  };

  /**
   * A list's items since the mark, read one of two ways by how the list
   * changes.
   *
   * **Append-only lists** (timeline, comments, reviews, issues). GitHub
   * lists them oldest first, so an append lands on the last page and leaves
   * the first unchanged:
   *
   * - **First page moved:** read it, then from its last page back until a
   *   page starts before the mark.
   * - **First page `304`:** read the last page the previous poll knew, under
   *   its own ETag, and forward while a page comes back full or names a later
   *   last page (an append that rolled onto a new page).
   *
   * **Lists that change in place** (`inPlace`: check runs, where a run on any
   * page completes). A `304` on the first page says nothing about the rest,
   * so every page is asked, each under its own ETag, within
   * {@link MAX_PAGES}; a page that comes back `304` is unchanged and adds
   * nothing. A list with more pages than that marks the poll `incomplete`.
   *
   * Each list's last page and how full it was are kept beside the ETags, as
   * `#last:<path>` = `<page>:<count>`. A quiet append-only list costs one
   * `304` on its first page, and one on its last when it has more than one;
   * a quiet list that changes in place, one `304` per page.
   */
  const pages = async (
    path: string,
    timeOf: (item: Json) => number | undefined,
    itemsOf: (body: unknown) => Json[] = list,
    inPlace = false
  ): Promise<Json[]> => {
    const lastKey = `${LAST_PREFIX}${validatorKey(path)}`;
    const [knownLast, knownCount] = (cursor.etags?.[lastKey] ?? "1:0").split(":").map(Number) as [number, number];
    const remember = (page: number, count: number) => (etags[lastKey] = `${page}:${count}`);
    const first = await get(path);

    if (inPlace) {
      const out: Json[] = [];
      let last = knownLast;
      if (first !== undefined) {
        moved = true;
        out.push(...itemsOf(first.body));
        last = lastPageOf(first.link) ?? 1;
      }
      for (let page = 2; page <= last; page += 1) {
        if (page > MAX_PAGES) {
          incomplete = true;
          break;
        }
        const read = await get(`${path}&page=${page}`);
        if (read === undefined) continue;
        moved = true;
        out.push(...itemsOf(read.body));
        last = Math.max(last, lastPageOf(read.link) ?? last);
      }
      remember(last, 0);
      return out;
    }

    if (first === undefined) {
      remember(knownLast, knownCount);
      // The only page, not full: nothing was appended.
      if (knownLast <= 1 && knownCount < PAGE) return [];
      const out: Json[] = [];
      let page = knownLast <= 1 ? 2 : knownLast;
      let count = knownLast <= 1 ? 0 : knownCount;
      for (let reads = 0; ; reads += 1) {
        if (reads >= MAX_PAGES - 1) {
          incomplete = true;
          break;
        }
        const read = await get(`${path}&page=${page}`);
        if (read !== undefined) {
          moved = true;
          const got = itemsOf(read.body);
          out.push(...got);
          count = got.length;
          const named = lastPageOf(read.link);
          if (named !== undefined && named > page) {
            remember(page, count);
            page += 1;
            continue;
          }
        }
        remember(page, count);
        // Not full: the list ends on this page. Full: the next may have begun.
        if (count < PAGE) break;
        page += 1;
        count = 0;
      }
      return out;
    }

    moved = true;
    const items = itemsOf(first.body);
    const last = lastPageOf(first.link);
    if (last === undefined || last <= 1) {
      remember(1, items.length);
      return items;
    }
    const later: Json[][] = [];
    let page = last;
    let reachedMark = false;
    while (page > 1 && later.length < MAX_PAGES - 1) {
      const got = itemsOf((await get(`${path}&page=${page}`, true))?.body);
      if (page === last) remember(last, got.length);
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
    // Each comment is rebuilt with its issue, as the webhook carries it, so its labels and title reach the screens:
    // from the issues this poll already read (a new comment moves its issue), else one read per issue still missing.
    const issuesByNumber = new Map(issues.flatMap((i) => (typeof i.number === "number" ? [[i.number, i] as const] : [])));
    for (const comment of comments) {
      const number = Number(String(comment.issue_url ?? "").split("/").pop());
      if (!Number.isInteger(number)) continue;
      if (!issuesByNumber.has(number)) {
        const read = obj((await get(`${repo}/issues/${number}`, true))?.body);
        issuesByNumber.set(number, read ?? { number });
      }
      push("issue_comment", { action: "created", comment, issue: issuesByNumber.get(number)!, repository: repoPayload, sender: comment.user });
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
  // Asked every poll, paged like the rest: a finished run changes neither the issue nor the pull request.
  const runs =
    isPr && sha !== undefined
      ? await pages(`${repo}/commits/${sha}/check-runs?per_page=100`, (r) => ms(r.completed_at) ?? ms(r.started_at), (body) => list(obj(body)?.check_runs), true)
      : [];

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
