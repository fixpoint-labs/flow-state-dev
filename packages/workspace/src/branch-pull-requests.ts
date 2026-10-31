/**
 * The host's turn-end check for pull requests: ask GitHub, through the host's
 * signed-in `gh`, which pull requests a checkout's branch has, and write the
 * ones the session's record lacks.
 *
 * It is the backstop for core's in-turn recorder, which reads only create
 * calls it understands. A pull request an agent opened another way (a raw API
 * call, an unfamiliar tool) is still on the session's branch, and the session's
 * own branch is by construction the session's work. Rows go through core's one
 * writer, `writePullRequests`, as `source: "branch"`, so a row the recorder
 * already wrote stays one row and keeps the turn that opened it.
 *
 * Only a pull request opened since `openedSince` counts, when the host passes
 * it: a branch an agent switched to may carry pull requests from before the
 * turn, and those are not the turn's.
 *
 * `pullRequestHead` is the other question asked here: which branch a pull
 * request's work is on, so a run can be started on it.
 *
 * Host-side only: this is where the framework talks to GitHub. It never throws.
 * A missing or signed-out `gh`, a checkout with no GitHub remote, or a store
 * that fails comes back as `unavailable` with the reason, for the host to show
 * as a note; it never fails the turn it runs after.
 */
import {
  OBSERVED_PULL_REQUESTS,
  pullRequestRefFromUrl,
  pullRequestWritesSettled,
  writePullRequests,
  type PullRequestCollection,
  type PullRequestRef,
} from "@flow-state-dev/core";
import { run } from "./exec";
import { WorkspaceRefusedError } from "./refused";

/** How long the whole check may take, by default: every command it runs shares this one deadline. */
export const BRANCH_PULL_REQUESTS_TIMEOUT_MS = 30_000;

/** Options for {@link recordBranchPullRequests}. */
export interface RecordBranchPullRequestsOptions {
  /** The checkout whose current branch is checked. */
  readonly cwd: string;
  /**
   * More branches to check beside the checkout's current one: the branch the
   * host made for the session, which an agent may have left with
   * `git checkout -b`.
   */
  readonly branches?: readonly string[];
  /** The request the rows are stamped with when new. Default: the context's. */
  readonly requestId?: string | null;
  /**
   * Only pull requests GitHub says were created at or after this time (epoch
   * ms) are written; older ones on the branch are left out. Pass the start of
   * the turn or run the check follows. Unset, every pull request on the
   * branches is written.
   */
  readonly openedSince?: number;
  /** The whole check's wall clock, shared by every command it runs. Its own budget, never the turn's abort signal. */
  readonly timeoutMs?: number;
  /** The `gh` to run. Default `"gh"` on `PATH`. */
  readonly gh?: string;
}

/** How a {@link recordBranchPullRequests} call ended. */
export type BranchPullRequestsResult =
  | { readonly status: "recorded"; readonly branches: readonly string[]; readonly pullRequests: readonly PullRequestRef[] }
  | { readonly status: "unavailable"; readonly reason: string };

/** What the check reads off a block's context. */
export interface BranchPullRequestsContext {
  readonly resources?: unknown;
  readonly request?: { readonly identity: { readonly id: string } };
  /** The request's response: the check waits for its in-turn recorder's writes before writing. */
  readonly response?: unknown;
}

/** One pull request as GitHub's REST list returns it; only what is read. */
interface ListedPullRequest {
  number?: unknown;
  html_url?: unknown;
  title?: unknown;
  state?: unknown;
  draft?: unknown;
  created_at?: unknown;
  merged_at?: unknown;
  head?: { ref?: unknown };
}

/** How far GitHub's clock may run behind this host's before a pull request opened in the turn reads as older. */
const CLOCK_SLACK_MS = 60_000;

function reasonOf(err: unknown): string {
  const stderr = (err as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim().split("\n")[0] ?? stderr.trim();
  return err instanceof Error ? err.message : String(err);
}

/** A listed pull request as a ref, or `null` when its link is not a pull request's. */
function refOf(listed: ListedPullRequest): PullRequestRef | null {
  const link = typeof listed.html_url === "string" ? pullRequestRefFromUrl(listed.html_url) : null;
  if (link === null) return null;
  const state =
    typeof listed.merged_at === "string" ? "merged" : listed.draft === true && listed.state === "open" ? "draft" : listed.state;
  return {
    ...link,
    title: typeof listed.title === "string" ? listed.title : null,
    state: typeof state === "string" ? state : null,
    branch: typeof listed.head?.ref === "string" ? listed.head.ref : null,
  };
}

/**
 * Find the pull requests on a checkout's branches and write the ones the
 * session's record lacks.
 *
 * The branches are the checkout's current one (unless it is detached) and
 * `options.branches`. Each is asked of GitHub's REST API through `gh api`,
 * in the repository `gh` resolves from the checkout's remote, open or closed,
 * all at once. Before writing, it waits for the request's in-turn recorder to
 * finish its writes, so a pull request seen in a create call keeps
 * `source: "tool"`.
 *
 * ```ts
 * const result = await recordBranchPullRequests(ctx, { cwd: worktree, branches: [sessionBranch] });
 * if (result.status === "unavailable") ctx.emit.status(`Pull requests on the branch were not checked: ${result.reason}`);
 * ```
 */
export async function recordBranchPullRequests(
  ctx: BranchPullRequestsContext,
  options: RecordBranchPullRequestsOptions,
): Promise<BranchPullRequestsResult> {
  const collection = (ctx.resources as Record<string, unknown> | undefined)?.[OBSERVED_PULL_REQUESTS] as
    | PullRequestCollection
    | undefined;
  if (typeof collection?.upsert !== "function" || typeof collection.getOptional !== "function") {
    return { status: "unavailable", reason: `the "${OBSERVED_PULL_REQUESTS}" collection is not registered on this flow` };
  }
  const deadline = Date.now() + (options.timeoutMs ?? BRANCH_PULL_REQUESTS_TIMEOUT_MS);
  // What is left of the one budget, for the next command.
  const left = () => Math.max(1, deadline - Date.now());
  const gh = options.gh ?? "gh";

  const branches = new Set<string>();
  try {
    const head = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: options.cwd, timeoutMs: left() })).stdout.trim();
    if (head !== "" && head !== "HEAD") branches.add(head);
  } catch (err) {
    return { status: "unavailable", reason: `the checkout's branch can't be read: ${reasonOf(err)}` };
  }
  for (const branch of options.branches ?? []) if (branch !== "") branches.add(branch);
  if (branches.size === 0) return { status: "recorded", branches: [], pullRequests: [] };

  const asked = await Promise.all(
    [...branches].map(async (branch) => {
      try {
        const { stdout } = await run(
          gh,
          // `gh` fills `{owner}` and `{repo}` from the checkout's remote.
          ["api", `repos/{owner}/{repo}/pulls?head={owner}:${encodeURIComponent(branch)}&state=all&per_page=20`],
          { cwd: options.cwd, timeoutMs: left(), env: { GH_PROMPT_DISABLED: "1" } },
        );
        return { branch, listed: JSON.parse(stdout) as unknown };
      } catch (err) {
        return { branch, error: reasonOf(err) };
      }
    }),
  );
  const found: PullRequestRef[] = [];
  for (const answer of asked) {
    if ("error" in answer) {
      return { status: "unavailable", reason: `GitHub could not be asked about branch ${answer.branch}: ${answer.error}` };
    }
    if (!Array.isArray(answer.listed)) continue;
    for (const entry of answer.listed as ListedPullRequest[]) {
      const created = typeof entry.created_at === "string" ? Date.parse(entry.created_at) : Number.NaN;
      if (options.openedSince !== undefined && !(created >= options.openedSince - CLOCK_SLACK_MS)) continue;
      const ref = refOf(entry);
      if (ref !== null) found.push(ref);
    }
  }

  await pullRequestWritesSettled(ctx.response);
  try {
    await writePullRequests(collection, found, {
      source: "branch",
      requestId: options.requestId === undefined ? (ctx.request?.identity.id ?? null) : options.requestId,
    });
  } catch (err) {
    return { status: "unavailable", reason: `the pull requests could not be recorded: ${reasonOf(err)}` };
  }
  return { status: "recorded", branches: [...branches], pullRequests: found };
}

/** Options for {@link pullRequestHead}. */
export interface PullRequestHeadOptions {
  /** A checkout of the repository the pull request is in; `gh` resolves the repository from its remote. */
  readonly cwd: string;
  /** The pull request's number. */
  readonly number: number;
  /** The wall clock for the one `gh` call. Default {@link BRANCH_PULL_REQUESTS_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** The `gh` to run. Default `"gh"` on `PATH`. */
  readonly gh?: string;
}

/** A pull request's head, as {@link pullRequestHead} resolves it. */
export interface PullRequestHead {
  /** The branch the pull request's work is on, in the same repository. */
  readonly branch: string;
  /** The commit at its head when asked. */
  readonly commit: string | null;
  readonly url: string | null;
}

/**
 * The branch a pull request's work is on, asked of GitHub through the host's
 * `gh`, so a run can work on it (`PlaceRequest.existing`) and its commits land
 * where the pull request sees them once pushed.
 *
 * Unlike the turn-end check, this one throws: the run cannot start without
 * an answer. Refused, `pull-request-unreadable`, when `gh` can't say, and
 * `pull-request-from-fork` when the head is in another repository, whose
 * branch is not on this one's remote.
 */
export async function pullRequestHead(options: PullRequestHeadOptions): Promise<PullRequestHead> {
  if (!Number.isInteger(options.number) || options.number < 1) {
    throw new WorkspaceRefusedError("pull-request-unreadable", `${JSON.stringify(options.number)} is not a pull request number.`);
  }
  let answer: {
    html_url?: unknown;
    head?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } | null };
    base?: { repo?: { full_name?: unknown } | null };
  };
  try {
    const { stdout } = await run(options.gh ?? "gh", ["api", `repos/{owner}/{repo}/pulls/${options.number}`], {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? BRANCH_PULL_REQUESTS_TIMEOUT_MS,
      env: { GH_PROMPT_DISABLED: "1" },
    });
    answer = JSON.parse(stdout) as typeof answer;
  } catch (err) {
    throw new WorkspaceRefusedError("pull-request-unreadable", `GitHub could not be asked about pull request #${options.number}: ${reasonOf(err)}`);
  }
  const branch = answer.head?.ref;
  if (typeof branch !== "string" || branch === "") {
    throw new WorkspaceRefusedError("pull-request-unreadable", `GitHub named no head branch for pull request #${options.number}.`);
  }
  const head = answer.head?.repo?.full_name;
  const base = answer.base?.repo?.full_name;
  if (typeof head !== "string" || head !== base) {
    throw new WorkspaceRefusedError(
      "pull-request-from-fork",
      `pull request #${options.number} comes from ${typeof head === "string" ? head : "a repository that no longer exists"}, ` +
        `not ${String(base)}: its branch "${branch}" is not on this repository's remote, so a run can't work on it here.`,
    );
  }
  return {
    branch,
    commit: typeof answer.head?.sha === "string" ? answer.head.sha : null,
    url: typeof answer.html_url === "string" ? answer.html_url : null,
  };
}
