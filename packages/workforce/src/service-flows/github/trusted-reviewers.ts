// FIX-2789.
/**
 * Who may steer a coding session through GitHub: a custom screen that passes
 * an event only when its sender is on a list the app keeps and can write to
 * the repository, asked of GitHub when the event arrives. A bot never passes.
 *
 * The list is read for each event (`reviewers`), so an edit applies to the
 * next comment with no restart. The write check reads the sender's permission
 * on the event's repository (`GET /repos/{owner}/{repo}/collaborators/{login}/permission`):
 * `admin`, `maintain` and `write` pass, and anything else, a sender GitHub
 * doesn't know as a collaborator included, is refused. When GitHub can't be
 * asked (no token, a failed call), the screen throws, which refuses the event
 * as failed rather than on its content.
 */
import type { BlockContext, DeclaredResourceEntry } from "@flow-state-dev/core/types";
import type { IndexEntry } from "../../subscriptions/rows";
import type { CustomScreen } from "../../subscriptions/screens";
import { githubRepositoryOf } from "./provider";
import { githubLoginId } from "./normalize";

/** The permissions that can push to a repository. */
const WRITES = new Set(["admin", "maintain", "write"]);

/** What {@link githubTrustedReviewersScreen} is built with. */
export interface GitHubTrustedReviewersOptions {
  /** The trusted GitHub logins, read when each event arrives. */
  reviewers(ctx: BlockContext): readonly string[] | Promise<readonly string[]>;
  /**
   * A token that can read the repository's collaborators, for the subscription
   * being screened (its owner is `entry.userId`, set by the server); none fails the screen.
   */
  token(ctx: BlockContext, entry: IndexEntry): string | undefined | Promise<string | undefined>;
  /** GitHub's REST API root. Default `https://api.github.com`. */
  readonly apiUrl?: string;
  /** The `fetch` it calls. Default the global one. */
  readonly fetch?: typeof fetch;
  /** The resources `reviewers` reads, declared on the steps that run the screen. */
  readonly resources?: Readonly<Record<string, DeclaredResourceEntry>>;
}

/**
 * The GitHub logins a document lists, one to a Markdown list item
 * (`- octocat`, `* @octocat`). Every other line, prose and headings included,
 * names nobody.
 */
export function githubLoginsListed(document: string | null | undefined): string[] {
  const logins: string[] = [];
  for (const line of (document ?? "").split("\n")) {
    const listed = /^\s*[-*]\s+@?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\s*$/.exec(line);
    if (listed !== null) logins.push(githubLoginId(listed[1]!));
  }
  return logins;
}

/** Build the screen. */
export function githubTrustedReviewersScreen(options: GitHubTrustedReviewersOptions): CustomScreen {
  const api = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  return {
    describe: "the sender is a trusted reviewer who can write to the repository",
    ...(options.resources === undefined ? {} : { resources: options.resources }),
    async screen(event, entry, ctx) {
      if (event.sender.role === "bot") return `bot "${event.sender.id}" is never a trusted reviewer`;
      const listed = (await options.reviewers(ctx)).map(githubLoginId);
      if (!listed.includes(event.sender.id)) return `"${event.sender.id}" isn't a trusted reviewer`;
      const repository = event.threads.map(githubRepositoryOf).find((repo) => repo !== undefined);
      if (repository === undefined) return "the event names no repository";
      const token = await options.token(ctx, entry);
      if (token === undefined || token.length === 0) throw new Error("no token to ask GitHub who can write");
      const res = await (options.fetch ?? fetch)(`${api}/repos/${repository}/collaborators/${encodeURIComponent(event.sender.id)}/permission`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
        // A cancelled request stops the lookup too.
        signal: ctx.signal
      });
      // GitHub answers 404 for a login that isn't a collaborator: no write access.
      if (res.status === 404) return `"${event.sender.id}" can't write to ${repository}`;
      if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${event.sender.id}'s permission`);
      const body = (await res.json()) as { permission?: unknown; role_name?: unknown };
      const can = [body.permission, body.role_name].some((p) => typeof p === "string" && WRITES.has(p));
      return can ? undefined : `"${event.sender.id}" can't write to ${repository}`;
    }
  };
}
