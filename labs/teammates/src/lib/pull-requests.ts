/**
 * A teammate's pull requests: the ones the runs of the tasks its conversation
 * filed recorded opening. So a coordinator's are the pull requests of the
 * coding tasks it handed out, and a coding worker's are those of the tasks its
 * own conversation filed. Read through harness-manager's
 * `readSessionPullRequests`, one read per run session, never GitHub itself:
 * each row is the run session's own record, its state as last seen there.
 */
import { useEffect, useMemo, useState } from "react";
import { readSessionPullRequests, type CodingBoardTask, type SessionPullRequest } from "@flow-state-dev/harness-manager/browser";
import { useAppClient } from "../app";
import { holdOf } from "./task";

/** One pull request a teammate's task opened, with the task. */
export interface TeammatePullRequest {
  number: number;
  /** Its link: only an `https://github.com/…` address, else `null` (see {@link safePullRequestUrl}). */
  url: string | null;
  title: string | null;
  repository: string | null;
  /** `open`, `draft`, `merged` or `closed`: the record's last sighting, `open` when none named one. */
  state: string;
  /** The task whose run recorded it. */
  task: CodingBoardTask;
  /** Its task waits on you. */
  attention: boolean;
}

/** The one host a pull request links to: the lab configures no other GitHub host. */
const GITHUB_HOST = "github.com";

/**
 * `url` when it is an `https:` address on github.com, else `null`. The record's
 * link comes from what a run's tools returned, which an agent can steer, so a
 * `javascript:` link or another site's never reaches an `href`.
 */
export function safePullRequestUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === GITHUB_HOST ? parsed.href : null;
  } catch {
    return null;
  }
}

/** A state that ended the pull request. */
const ENDED = new Set(["merged", "closed"]);

/** Whether `pr` is still open (a draft included). */
export const isOpenPullRequest = (pr: Pick<TeammatePullRequest, "state">): boolean => !ENDED.has(pr.state);

/**
 * The pull requests for `tasks` (newest first) from what each run session recorded:
 * one per pull request, kept with the newest task whose run recorded it: open
 * ones first (those whose task waits on you leading), then merged or closed
 * ones, each group in its tasks' order.
 */
export function teammatePullRequests(tasks: readonly CodingBoardTask[], recorded: ReadonlyMap<string, readonly SessionPullRequest[]>): TeammatePullRequest[] {
  const seen = new Set<string>();
  const found: TeammatePullRequest[] = [];
  for (const task of tasks) {
    const session = task.run?.sessionId;
    if (session === undefined) continue;
    for (const pr of recorded.get(session) ?? []) {
      const key = `${pr.repository ?? ""}#${pr.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ number: pr.number, url: safePullRequestUrl(pr.url), title: pr.title, repository: pr.repository, state: pr.state ?? "open", task, attention: holdOf(task) !== undefined });
    }
  }
  const open = found.filter(isOpenPullRequest);
  return [...open.filter((r) => r.attention), ...open.filter((r) => !r.attention), ...found.filter((r) => !isOpenPullRequest(r))];
}

/**
 * {@link teammatePullRequests} for `tasks`, read again when a task's run or
 * status changes. `undefined` until the first reads settle. A run session that
 * can't be read counts as recording none.
 */
export function useTeammatePullRequests(tasks: readonly CodingBoardTask[]): TeammatePullRequest[] | undefined {
  const { client } = useAppClient();
  const sessions = [...new Set(tasks.flatMap((t) => (t.run?.sessionId === undefined ? [] : [t.run.sessionId])))];
  // What a re-read keys on: each run session, and every task's status (a merge ends a wait, a new run opens one).
  const key = `${sessions.join("\n")}|${tasks.map((t) => `${t.id}:${t.status}`).join(",")}`;
  const [recorded, setRecorded] = useState<ReadonlyMap<string, readonly SessionPullRequest[]>>();
  useEffect(() => {
    let current = true;
    const ids = key.slice(0, key.indexOf("|")).split("\n").filter((id) => id !== "");
    void Promise.all(
      ids.map((id) =>
        readSessionPullRequests(client, id).then(
          (opened): [string, readonly SessionPullRequest[]] => [id, opened],
          (error): [string, readonly SessionPullRequest[]] => {
            console.warn(`teammates: the pull requests of run session ${id} couldn't be read`, error);
            return [id, []];
          },
        ),
      ),
    ).then((read) => current && setRecorded(new Map(read)));
    return () => {
      current = false;
    };
  }, [client, key]);
  return useMemo(() => (recorded === undefined ? undefined : teammatePullRequests(tasks, recorded)), [tasks, recorded]);
}
