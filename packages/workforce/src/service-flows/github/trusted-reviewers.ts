// FIX-2789; FIX-2873 (D1 the default, D2 who is heard). The screen after the list screen: FIX-2880.
/**
 * Who may steer a coding session through GitHub: one stored list of trusted
 * reviewers, its custom screen, and the follow that lists it.
 *
 * - **The list** is the org's `github-reviewers` document. `GITHUB_REVIEWERS`
 *   (comma-separated logins, a bot as `name[bot]`) is its definition content:
 *   the default until the list is first saved. After that the stored row wins,
 *   an emptied list included, so emptying it trusts nobody. The
 *   only writer is the coordinator's tool (`./reviewers-tool`); no HTTP action
 *   writes it.
 * - **The screen** passes a `check` that failed, whoever ran it: CI is the app's report on a
 *   commit, not a reviewer steering the run, and a check carries only its name, outcome, head
 *   commit and link, never text the workflow wrote (see `./normalize`). A check that passed, was
 *   skipped or was cancelled is refused, so only red CI wakes the run. Any other event passes
 *   only when its sender is on the list, read
 *   for each event so an edit applies to the next comment with no restart. A
 *   listed bot passes as it is. A listed user must also be able to write to
 *   the repository, asked of GitHub when the event arrives
 *   (`GET /repos/{owner}/{repo}/collaborators/{login}/permission`): `admin`,
 *   `maintain` and `write` pass, and anything else, a sender GitHub doesn't
 *   know as a collaborator included, is refused. When GitHub can't be
 *   asked (no token, a failed call), the screen throws, which refuses the
 *   event as failed rather than on its content. Users and bots stay apart: a
 *   bot's id is its app slug, the same form as a user's login, so a user who
 *   registers a listed bot's name is not that bot.
 * - **The follow** is `followPullRequest` listing that screen first, taking
 *   outsiders, and handing bots on to the screen (`botsScreenedBy`), so a
 *   listed bot is heard on the run's own follow and on no other subscription.
 *   A later screen goes after the list screen and sees only senders it passed
 *   (an injection evaluator, when it lands).
 */
import { defineCapability, defineResource, type DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext, DeclaredResourceEntry } from "@flow-state-dev/core/types";
import type { PullRequestFollower } from "@flow-state-dev/core/harness";
import { z } from "zod";
import type { IndexEntry } from "../../subscriptions/rows";
import type { CustomScreen } from "../../subscriptions/screens";
import type { SubscriptionProvider } from "../../subscriptions/subscribe";
import type { WorkerInstallation } from "../../workers/installation";
import { followPullRequest } from "./follow-pull-request";
import { githubCheckFailed } from "./normalize";
import { githubRepositoryOf } from "./provider";
import { GITHUB_REVIEWERS_DOC, GITHUB_REVIEWERS_SCREEN, githubLoginsListed, githubReviewersDocument, isListedBot, reviewersDocumentOf, reviewersRender } from "./reviewers-document";
import { githubReviewersTool } from "./reviewers-tool";

export { GITHUB_REVIEWERS_SCREEN };
/** The capability a worker picks the tool through (`capabilities: { githubReviewers: [tool] }`). */
const GITHUB_REVIEWERS_CAPABILITY = "githubReviewers";

/** The permissions that can push to a repository. */
const WRITES = new Set(["admin", "maintain", "write"]);

/** What {@link githubTrustedReviewersScreen} is built with. */
export interface GitHubTrustedReviewersScreenOptions {
  /** The trusted accounts (`login`, or `name[bot]` for a bot), read when each event arrives. */
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
 * The accounts one setting lists: comma-separated, a bot by its login
 * (`greptile-apps[bot]`), each once, as {@link githubLoginsListed} reads them.
 */
function settingLogins(value: string | undefined): string[] {
  const items = (value ?? "").split(",").map((login) => `- ${login.trim()}`);
  return [...new Set(githubLoginsListed(items.join("\n")))];
}

/** Build the screen. */
export function githubTrustedReviewersScreen(options: GitHubTrustedReviewersScreenOptions): CustomScreen {
  const api = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  return {
    describe: "a failed check, or the sender is a listed bot, or a listed user who can write to the repository",
    ...(options.resources === undefined ? {} : { resources: options.resources }),
    async screen(event, entry, ctx) {
      // CI by type, whoever ran it: a check carries only its name, outcome, commit and link (normalize). A red one passes.
      if (event.kind === "check") return githubCheckFailed(event) ? undefined : "a check that didn't fail";
      // As GitHub sends a sender's id: lower-cased, a bot keeping its `[bot]` here to tell it apart.
      const listed = (await options.reviewers(ctx)).map((login) => login.toLowerCase());
      // A bot is matched only against listed bots, and anyone else only against listed people.
      if (event.sender.role === "bot") {
        return listed.includes(`${event.sender.id}[bot]`) ? undefined : `bot "${event.sender.id}" isn't a trusted reviewer`;
      }
      if (!listed.filter((login) => !isListedBot(login)).includes(event.sender.id)) return `"${event.sender.id}" isn't a trusted reviewer`;
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

/** What {@link githubTrustedReviewers} is built with. */
export interface GitHubTrustedReviewersOptions {
  /** The one user who may change the list: the host's operator, as the session's server-set user. */
  readonly operator: string;
  /** The evaluation model the tool's judge reads the operator's message on. */
  readonly judgeModel: string;
  /**
   * The workers that may use the tool (`worker id`s): the host's coordinator. Any other worker that
   * reaches it, a hired one that picked its capability or named it in `tools:`, is refused.
   */
  readonly holders: readonly string[];
  /** Where `GITHUB_REVIEWERS` is read from, once, when this is called. Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The trusted reviewers, as a host installs them: {@link githubTrustedReviewers}. */
export interface GitHubTrustedReviewers {
  /** The `github-reviewers` document, its definition content built from `GITHUB_REVIEWERS`. */
  readonly document: DeclaredResourceEntry;
  /** `{ [GITHUB_REVIEWERS_DOC]: document }`, for a block or flow that declares it. */
  readonly resources: Readonly<Record<string, DeclaredResourceEntry>>;
  /** The listed accounts, read from the document for this request: the stored row, else the default. */
  read(ctx: BlockContext): Promise<string[]>;
  /**
   * The coordinator's `setGitHubReviewers` tool: the list's only writer, on the
   * operator's own typed word, judged, and approved in Inbox. A worker holds it
   * by naming it in its `tools:` line.
   */
  readonly tool: ReturnType<typeof githubReviewersTool>;
  /**
   * The same tool as a capability, `githubReviewers`, with the document: for a worker
   * that writes no `tools:` line, which picks it under `capabilities:`
   * (`githubReviewers: [tool]`). Picked by no worker, it grants nothing.
   */
  readonly capability: DefinedCapability;
  /**
   * The follower a coding run's pull request is followed through: `followPullRequest`
   * listing the list screen first, taking outsiders, and handing bots on to it.
   * `github` must declare the screen (`operatorGitHub({ reviewers })` does).
   */
  follow(github: SubscriptionProvider): (installation: WorkerInstallation) => PullRequestFollower;
}

/**
 * The trusted GitHub reviewers: the one stored list, its default read from
 * `GITHUB_REVIEWERS` now, at host start, its tool and its follow.
 */
export function githubTrustedReviewers(options: GitHubTrustedReviewersOptions): GitHubTrustedReviewers {
  const env = options.env ?? (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  // Definition content, never a template: a template renders on every read and would hide a save.
  const document = defineResource({
    ref: GITHUB_REVIEWERS_DOC,
    scope: "org",
    stateSchema: z.object({}).passthrough(),
    default: {},
    content: githubReviewersDocument(settingLogins(env.GITHUB_REVIEWERS), { unsaved: true }),
    render: reviewersRender,
    description: "The GitHub accounts trusted to steer a coding run through comments on its pull request. Only the operator changes it.",
    llmReadable: true,
    llmWritable: false,
    client: { content: { read: true } }
  } as never) as DeclaredResourceEntry;
  const resources = { [GITHUB_REVIEWERS_DOC]: document };
  // The stored row whenever one exists, an emptied list included; the default only with none. No fallback here.
  const read = (ctx: BlockContext) => reviewersDocumentOf(ctx).read();
  const tool = githubReviewersTool({ operator: options.operator, judgeModel: options.judgeModel, holders: options.holders, document });
  return {
    document,
    resources,
    read,
    tool,
    capability: defineCapability({ name: GITHUB_REVIEWERS_CAPABILITY, resources, presets: { tool: { tools: [tool] } } }),
    follow: (github) => (installation) =>
      followPullRequest({
        providers: [github],
        installation,
        // The list screen first: a later screen (FIX-2880's evaluator) goes after it, and sees only senders it passed.
        screens: [{ screen: "custom", name: GITHUB_REVIEWERS_SCREEN }],
        // The list screen decides who outside the project is heard, and which bots: no one it doesn't list.
        outsiders: true,
        botsScreenedBy: GITHUB_REVIEWERS_SCREEN
      })
  };
}
