/**
 * The pure and host-side halves of a task waiting on its pull requests
 * (FIX-2578, `awaitPullRequests`): which pull requests are the task's, what
 * GitHub says of each, and what that means for the task.
 *
 * The manager decides when (`./manager`, its settle and the wake its wait
 * owes); this module holds the pieces both call, so the two read and decide
 * one way:
 *
 * - {@link taskPullRequests}: the session's pull-request record's rows
 *   stamped with one of the task's requests, in any state.
 * - {@link waitedPullRequests}: the rows a wait names, by key.
 * - {@link readPullRequestStates}: each read from GitHub through the host's
 *   `gh` (`readPullRequest`), inside one deadline, its live state written
 *   back to the record; unreadable when any one can't be read.
 * - {@link pullRequestsVerdict}: hold, complete, or cancel.
 */
import {
  OBSERVED_PULL_REQUESTS,
  pullRequestKey,
  writePullRequests,
  type PullRequestCollection,
} from "@flow-state-dev/core/harness";
import type { BlockContext } from "@flow-state-dev/core/types";
import { readPullRequest } from "@flow-state-dev/workspace";

/** The reason a task whose pull requests all closed without merging is cancelled with (D2). */
export const CLOSED_WITHOUT_MERGING = "its pull request was closed without merging";

/** One pull request a task opened, as the session's record keeps it. */
export interface TaskPullRequest {
  /** Its key in the record (`pullRequestKey`). */
  readonly key: string;
  readonly host: string;
  /** `owner/name`. */
  readonly repository: string;
  readonly number: number;
  readonly url: string | null;
  readonly title: string | null;
}

/** A task's pull request as GitHub has it now. */
export interface PullRequestRead extends TaskPullRequest {
  readonly state: "open" | "merged" | "closed";
}

/** What the record's collection ref offers here: the write path's slice, and a listing. */
type RecordCollection = PullRequestCollection & {
  list(prefix?: string): Promise<ReadonlyArray<{ readonly state: Record<string, unknown> }>>;
};

function recordOf(ctx: Pick<BlockContext, "resources">): RecordCollection | undefined {
  const collection = (ctx.resources as Record<string, unknown> | undefined)?.[OBSERVED_PULL_REQUESTS] as RecordCollection | undefined;
  return typeof collection?.list === "function" && typeof collection.getOptional === "function" ? collection : undefined;
}

/** A record row as a task pull request, or `undefined` when it names no host, repository or number. */
function pullRequestOf(state: Record<string, unknown>): TaskPullRequest | undefined {
  const { host, repository, number, url, title } = state;
  if (typeof host !== "string" || typeof repository !== "string" || typeof number !== "number") return undefined;
  const [owner, name] = repository.split("/");
  if (owner === undefined || name === undefined || owner === "" || name === "") return undefined;
  return {
    key: pullRequestKey({ host, owner, name, number }),
    host,
    repository,
    number,
    url: typeof url === "string" ? url : null,
    title: typeof title === "string" ? title : null,
  };
}

/**
 * The task's pull requests: every row of the session's record stamped with
 * one of `requestIds`, whatever state it was seen in, oldest first. A
 * session is shared by a task and its follow-ups, so the stamp, not the
 * session, says whose a pull request is. `[]` when the record isn't
 * registered.
 */
export async function taskPullRequests(ctx: Pick<BlockContext, "resources">, requestIds: readonly string[]): Promise<TaskPullRequest[]> {
  const record = recordOf(ctx);
  if (record === undefined || requestIds.length === 0) return [];
  const mine = new Set(requestIds);
  // The record is the session's and small; it has no index by request to read through.
  const rows = (await record.list())
    .map((ref) => ref.state)
    .filter((state) => typeof state.requestId === "string" && mine.has(state.requestId))
    .sort((a, b) => Number(a.firstSeenAt ?? 0) - Number(b.firstSeenAt ?? 0));
  return rows.map(pullRequestOf).filter((pr): pr is TaskPullRequest => pr !== undefined);
}

/** The record's rows for `keys`, the pull requests a wait names, in its order; a key with no row is left out. */
export async function waitedPullRequests(ctx: Pick<BlockContext, "resources">, keys: readonly string[]): Promise<TaskPullRequest[]> {
  const record = recordOf(ctx);
  if (record === undefined) return [];
  const found: TaskPullRequest[] = [];
  for (const key of keys) {
    const state = (await record.getOptional(key))?.state;
    const pr = state === undefined ? undefined : pullRequestOf(state);
    if (pr !== undefined) found.push(pr);
  }
  return found;
}

/**
 * Read each of `prs` from GitHub, through the host's `gh`, inside one
 * deadline of `timeoutMs`. Each read state is written back to the record, so a
 * screen shows *merged* once it was read merged. Any one that can't be read
 * makes the whole read `unreadable`: a task never settles on part of its
 * pull requests.
 */
export async function readPullRequestStates(
  ctx: Pick<BlockContext, "resources">,
  prs: readonly TaskPullRequest[],
  options: { readonly cwd: string; readonly timeoutMs: number },
): Promise<{ readonly read: PullRequestRead[] } | { readonly unreadable: string }> {
  const deadline = Date.now() + options.timeoutMs;
  const read: PullRequestRead[] = [];
  for (const pr of prs) {
    try {
      const now = await readPullRequest({
        cwd: options.cwd,
        number: pr.number,
        repository: pr.repository,
        host: pr.host,
        timeoutMs: Math.max(1, deadline - Date.now()),
      });
      read.push({ ...pr, url: now.url ?? pr.url, title: now.title ?? pr.title, state: now.merged ? "merged" : now.state });
    } catch (error) {
      return { unreadable: error instanceof Error ? error.message : String(error) };
    }
  }
  const record = recordOf(ctx);
  if (record !== undefined) {
    const refs = read.map((pr) => {
      const [owner, name] = pr.repository.split("/") as [string, string];
      return { host: pr.host, owner, name, number: pr.number, url: pr.url ?? `https://${pr.host}/${pr.repository}/pull/${pr.number}`, state: pr.state };
    });
    // Bookkeeping: a record that fails to take the state never changes what the read decided.
    await writePullRequests(record, refs, { source: "branch", requestId: null }).catch(() => undefined);
  }
  return { read };
}

/**
 * What a task's pull requests, as read, mean for it (FIX-2578): `hold` while
 * any is open; `complete` when none is open and at least one merged (a closed
 * one beside it is noted on the output); `cancel` when every one closed
 * without merging (D2). Never called on an empty list.
 */
export function pullRequestsVerdict(read: readonly PullRequestRead[]): "hold" | "complete" | "cancel" {
  if (read.some((pr) => pr.state === "open")) return "hold";
  return read.some((pr) => pr.state === "merged") ? "complete" : "cancel";
}

/** The words a task's wait on `prs` is shown with: on its row, and as a status note. */
export function pullRequestWaitPrompt(prs: readonly TaskPullRequest[]): string {
  const named = prs.map((pr) => `#${pr.number}`).join(", ");
  return `Waiting for pull request${prs.length === 1 ? "" : "s"} ${named} to merge or close. A message in this task's thread wakes it to check.`;
}
