/**
 * A coding task waiting on its pull requests (FIX-2578, `awaitPullRequests`),
 * as a screen reads it: the one shape both the manager's wait and a task
 * view share.
 *
 * The manager holds a task whose run opened a pull request on one external
 * wait on its row (`actor: "system"`, kind `external`), with one
 * `{ by: "event", event: "pull-request", key }` releaser per pull request,
 * each `key` the session's pull-request record's key (`pullRequestKey`).
 * {@link pullRequestWait} reads that wait back with the record's rows, so a
 * card or a thread draws one line: *PR open · #7*, with the link.
 *
 * Browser-safe: no Node built-in on this module's graph (`./browser`).
 */
import { pullRequestKey } from "@flow-state-dev/core/harness";

/** The event an external wait on a pull request names on each releaser. */
export const PULL_REQUEST_EVENT = "pull-request";

/** The parts of a task row {@link pullRequestWait} reads. */
export interface PullRequestWaitRow {
  readonly status: string;
  readonly holds?: ReadonlyArray<{
    readonly id: string;
    readonly openedAt: number;
    readonly source: { readonly kind: string; readonly closedBy?: ReadonlyArray<{ readonly by: string; readonly event?: string; readonly key?: string }> };
    readonly ask: { readonly kind: string; readonly prompt: string };
  }> | null;
  readonly steers?: ReadonlyArray<{ readonly answers?: string }> | null;
}

/** One row of the session's pull-request record, as a screen holds it (`observed-pull-requests`). */
export interface PullRequestRecordRow {
  readonly host?: string | null;
  readonly repository?: string | null;
  readonly number?: number | null;
  readonly url?: string | null;
  readonly title?: string | null;
  readonly state?: string | null;
}

/** One pull request a task waits on. */
export interface WaitedPullRequest {
  /** Its key in the session's record. */
  readonly key: string;
  /** Its number, from the record, else from the key. `null` when neither says. */
  readonly number: number | null;
  /** Its link, when the record has the row. */
  readonly url: string | null;
  readonly title: string | null;
}

/** What a task waits on while its pull requests are open. */
export interface PullRequestWait {
  /** The wait's hold id on the row. */
  readonly holdId: string;
  /** When the wait opened, epoch ms. */
  readonly since: number;
  /** The words the wait was opened with. */
  readonly prompt: string;
  readonly pullRequests: readonly WaitedPullRequest[];
}

/** A record row's key, when it names its host, repository and number. */
function keyOfRecord(row: PullRequestRecordRow): string | undefined {
  const [owner, name] = (row.repository ?? "").split("/");
  if (row.host == null || owner === undefined || name === undefined || owner === "" || name === "" || row.number == null) return undefined;
  return pullRequestKey({ host: row.host, owner, name, number: row.number });
}

/**
 * The open pull-request wait on a task `row`, with each pull request it waits
 * on read from the session's record `records` (number, link, title), or
 * `null` when the row waits on none: not running, no open wait, or a wait on
 * something else.
 *
 * ```tsx
 * const wait = pullRequestWait(task, recordRows);
 * if (wait !== null) return <span>PR open · {wait.pullRequests.map((pr) => `#${pr.number}`).join(", ")}</span>;
 * ```
 */
export function pullRequestWait(row: PullRequestWaitRow, records: readonly PullRequestRecordRow[] = []): PullRequestWait | null {
  if (row.status !== "in_progress") return null;
  const answered = new Set((row.steers ?? []).map((steer) => steer.answers).filter((id): id is string => id !== undefined));
  const hold = (row.holds ?? []).find(
    (h) =>
      h.source.kind === "row" &&
      h.ask.kind === "external" &&
      !answered.has(h.id) &&
      (h.source.closedBy ?? []).some((releaser) => releaser.by === "event" && releaser.event === PULL_REQUEST_EVENT),
  );
  if (hold === undefined) return null;
  const byKey = new Map<string, PullRequestRecordRow>();
  for (const record of records) {
    const key = keyOfRecord(record);
    if (key !== undefined) byKey.set(key, record);
  }
  const pullRequests = (hold.source.closedBy ?? [])
    .filter((releaser) => releaser.by === "event" && releaser.event === PULL_REQUEST_EVENT && typeof releaser.key === "string")
    .map((releaser): WaitedPullRequest => {
      const key = releaser.key!;
      const record = byKey.get(key);
      const fromKey = Number(key.slice(key.lastIndexOf("/") + 1));
      return {
        key,
        number: record?.number ?? (Number.isInteger(fromKey) && fromKey > 0 ? fromKey : null),
        url: record?.url ?? null,
        title: record?.title ?? null,
      };
    });
  return { holdId: hold.id, since: hold.openedAt, prompt: hold.ask.prompt, pullRequests };
}
