// FIX-2831.
/**
 * The one poster a coding run's review replies go through, built beside the
 * operator's GitHub (`operatorGitHub(…).reviewReplies`). A coding run never
 * posts on GitHub itself: it writes each reply as a draft, and when its turn
 * ends the harness manager hands the drafts here. Each draft is checked, in
 * this order, and posts only when every check passes:
 *
 * 1. **The operator's session.** The token serves only the operator, as every
 *    GitHub routine's does (`reads(ctx)`); in anyone else's session nothing is
 *    asked of GitHub.
 * 2. **The task's pull request.** The draft's link names a pull request the
 *    task's run opened or landed on, or one the operator linked.
 * 3. **A comment on it.** The comment is read from that pull request on
 *    GitHub now (one paged read per pull request); an id it doesn't hold is
 *    refused.
 * 4. **A trusted author.** A listed bot, or a listed user who can push (the
 *    trusted reviewers' rule, `canWriteTo`), unless the operator linked the
 *    comment.
 * 5. **The body as data.** It goes as a JSON field, never through a shell.
 *
 * "The operator linked it" is a link in a message the operator typed: the one
 * that started the filing turn (stamped as `OPERATOR_LINKS`), or a steer the
 * session's own user sent (`from: "user"`, `by` the session's user). A link in
 * a delivered comment, a brief, or a service's or the filer's steer grants
 * nothing. Nothing in a draft but its link and its body is believed.
 *
 * An inline review comment gets its reply right under it, as GitHub's reply
 * to that comment. GitHub takes a reply only to a top-level review comment,
 * so a link to a comment that is itself a reply posts to the top-level
 * comment its `in_reply_to_id` names, still checked as the linked comment. A conversation comment or a review's summary can't take a
 * reply of its own on GitHub, so it gets one
 * comment on the same pull request that links the one it answers.
 */
import type { BlockContext, DeclaredResourceEntry } from "@flow-state-dev/core/types";
import { operatorLinked, parseCommentLink, prKey, type CommentLink } from "../../conversation-board/operator-links";
import { isListedBot } from "./reviewers-document";
import { canWriteTo } from "./trusted-reviewers";

/** One reply a run drafted: the link to the comment it answers, and what it says. */
export interface ReviewReplyDraft {
  /** The draft's file name, for the session's line. */
  readonly file: string;
  /** The comment's link, as GitHub gives it (`…/pull/7#discussion_r123`). */
  readonly link: string;
  /** The reply, as written. */
  readonly body: string;
}

/** A pull request the task's run opened or landed on. */
export interface ReviewReplyPullRequest {
  /** `owner/name`. */
  readonly repository: string;
  readonly number: number;
}

/** What the poster reads off the task: the filing's stamp and its steers. */
export interface ReviewReplyTask {
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  readonly steers?: readonly { readonly from: string; readonly by?: string; readonly message: string }[] | null;
}

/** What became of one draft: the reply's link, or why it wasn't posted. */
export interface ReviewReplyOutcome {
  readonly file: string;
  readonly link: string;
  /** The reply's link on GitHub. */
  readonly posted?: string;
  /** Why nothing was posted. */
  readonly refused?: string;
}

/** The poster, as a host hands it to the harness manager (`harnessManager({ replies })`). */
export interface ReviewReplies {
  /** Check and post each draft; never throws, each draft ends posted or refused. */
  post(
    ctx: BlockContext,
    drafts: readonly ReviewReplyDraft[],
    scope: { readonly pullRequests: readonly ReviewReplyPullRequest[]; readonly task?: ReviewReplyTask }
  ): Promise<ReviewReplyOutcome[]>;
  /** The resources `post` reads (the trusted reviewers' list), declared on the step that runs it. */
  readonly resources?: Readonly<Record<string, DeclaredResourceEntry>>;
}

/** What {@link reviewReplies} is built with: what `operatorGitHub` holds. */
export interface ReviewRepliesOptions {
  readonly operator: string;
  readonly token: string | undefined;
  readonly apiUrl?: string;
  /** The trusted accounts, read for each post. Absent: only comments the operator linked are answered. */
  readonly reviewers?: (ctx: BlockContext) => readonly string[] | Promise<readonly string[]>;
  readonly resources?: Readonly<Record<string, DeclaredResourceEntry>>;
}

/** The most pages of comments read for one pull request. */
const MAX_PAGES = 20;
const PER_PAGE = 100;

/** A comment as read from GitHub: its author, and the top-level comment it replies to, if any. */
interface ReadComment {
  readonly login: string;
  readonly bot: boolean;
  readonly root?: number;
}

/** One pull request's comments on one surface, and whether the read stopped at {@link MAX_PAGES}. */
interface PullRequestComments {
  readonly found: Map<number, ReadComment>;
  readonly capped: boolean;
}

/** Build the poster. */
export function reviewReplies(options: ReviewRepliesOptions): ReviewReplies {
  const api = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const { operator, token } = options;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

  return {
    ...(options.resources === undefined ? {} : { resources: options.resources }),
    async post(ctx, drafts, scope) {
      const user = ctx.session.identity.userId;
      if (token === undefined || token === "") {
        return drafts.map((d) => ({ file: d.file, link: d.link, refused: "replies need GITHUB_TOKEN: set it, or sign in with `gh auth login`, and start the lab again" }));
      }
      if (user !== operator) {
        return drafts.map((d) => ({ file: d.file, link: d.link, refused: `replies post only in ${operator}'s session, with this lab's GITHUB_TOKEN` }));
      }
      const signal = ctx.signal;
      const ask = async (path: string, init?: RequestInit) => {
        const res = await fetch(`${api}${path}`, { ...init, headers: { ...headers, ...(init?.body === undefined ? {} : { "content-type": "application/json" }) }, ...(signal === undefined ? {} : { signal }) });
        if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${init?.method ?? "GET"} ${path.split("?")[0]}`);
        return (await res.json()) as unknown;
      };
      // One paged read per pull request and surface, and one permission read per author, for the whole call.
      const hydrated = new Map<string, Promise<PullRequestComments>>();
      const comments = (link: CommentLink) => {
        const key = `${prKey(link.repository, link.number)}:${link.surface}`;
        let read = hydrated.get(key);
        if (read === undefined) {
          const path =
            link.surface === "inline"
              ? `/repos/${link.repository}/pulls/${link.number}/comments`
              : link.surface === "conversation"
                ? `/repos/${link.repository}/issues/${link.number}/comments`
                : `/repos/${link.repository}/pulls/${link.number}/reviews`;
          read = (async () => {
            const found = new Map<number, ReadComment>();
            for (let page = 1; page <= MAX_PAGES; page += 1) {
              const batch = (await ask(`${path}?per_page=${PER_PAGE}&page=${page}`)) as { id?: unknown; in_reply_to_id?: unknown; user?: { login?: unknown; type?: unknown } | null }[];
              for (const entry of batch) {
                if (typeof entry.id === "number" && typeof entry.user?.login === "string") {
                  found.set(entry.id, { login: entry.user.login, bot: entry.user.type === "Bot", ...(typeof entry.in_reply_to_id === "number" ? { root: entry.in_reply_to_id } : {}) });
                }
              }
              if (batch.length < PER_PAGE) return { found, capped: false };
            }
            return { found, capped: true };
          })();
          hydrated.set(key, read);
        }
        return read;
      };
      const writers = new Map<string, Promise<boolean>>();
      const canWrite = (repository: string, login: string) => {
        const key = `${repository}:${login.toLowerCase()}`;
        let can = writers.get(key);
        if (can === undefined) {
          can = canWriteTo({ api, token, repository, login, ...(signal === undefined ? {} : { signal }) });
          writers.set(key, can);
        }
        return can;
      };
      let listed: string[] | undefined;
      const reviewers = async () => (listed ??= ((await options.reviewers?.(ctx)) ?? []).map((login) => login.toLowerCase()));
      const linked = operatorLinked(scope.task, user);
      const own = new Set(scope.pullRequests.map((pr) => prKey(pr.repository, pr.number)));

      /** Why this draft can't be posted, or `undefined` when it may. */
      const refusal = async (draft: ReviewReplyDraft, link: CommentLink | undefined): Promise<string | undefined> => {
        if (link === undefined) return `${draft.link} isn't a link to a comment on a GitHub pull request`;
        const pr = prKey(link.repository, link.number);
        if (!own.has(pr) && !linked.prs.has(pr)) return `${link.repository}#${link.number} isn't this task's pull request, and the operator didn't link it`;
        const read = await comments(link);
        const comment = read.found.get(link.id);
        if (comment === undefined) {
          return read.capped
            ? `comment ${link.id} wasn't found on ${link.repository}#${link.number}: the read stopped after ${MAX_PAGES} pages of ${PER_PAGE} comments`
            : `comment ${link.id} isn't on ${link.repository}#${link.number}`;
        }
        if (linked.comments.has(`${pr}:${link.surface}:${link.id}`)) return undefined;
        const login = comment.login.toLowerCase();
        const list = await reviewers();
        if (comment.bot || login.endsWith("[bot]")) {
          const bot = login.endsWith("[bot]") ? login : `${login}[bot]`;
          return list.includes(bot) ? undefined : `${comment.login} isn't a trusted reviewer; link the comment in a message to the task to answer it`;
        }
        if (!list.filter((entry) => !isListedBot(entry)).includes(login)) {
          return `${comment.login} isn't a trusted reviewer; link the comment in a message to the task to answer it`;
        }
        return (await canWrite(link.repository, comment.login)) ? undefined : `${comment.login} can't push to ${link.repository}, so isn't a trusted reviewer here`;
      };

      const outcomes: ReviewReplyOutcome[] = [];
      for (const draft of drafts) {
        const done = (outcome: { posted: string } | { refused: string }) => outcomes.push({ file: draft.file, link: draft.link, ...outcome });
        try {
          if (draft.body.trim() === "") {
            done({ refused: "the reply is empty" });
            continue;
          }
          const link = parseCommentLink(draft.link);
          const why = await refusal(draft, link);
          if (why !== undefined || link === undefined) {
            done({ refused: why ?? "unreadable link" });
            continue;
          }
          // A comment that is itself a reply is answered on its top-level comment: GitHub takes a reply to no other.
          const root = link.surface === "inline" ? ((await comments(link)).found.get(link.id)?.root ?? link.id) : link.id;
          // The body is a JSON field, as written: nothing in it reaches a shell.
          const posted =
            link.surface === "inline"
              ? await ask(`/repos/${link.repository}/pulls/${link.number}/comments/${root}/replies`, { method: "POST", body: JSON.stringify({ body: draft.body }) })
              : await ask(`/repos/${link.repository}/issues/${link.number}/comments`, { method: "POST", body: JSON.stringify({ body: `In reply to ${draft.link}:\n\n${draft.body}` }) });
          const url = (posted as { html_url?: unknown }).html_url;
          done({ posted: typeof url === "string" ? url : draft.link });
        } catch (error) {
          done({ refused: error instanceof Error ? error.message : String(error) });
        }
      }
      return outcomes;
    }
  };
}
