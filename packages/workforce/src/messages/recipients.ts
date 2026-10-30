/**
 * Who a worker can reach (FIX-2334): the one list `sendMessage`'s description
 * and the worker's identity prompt both read, so the two can't disagree.
 *
 * It is the roster minus what a send by name refuses (`recipientRefusal`),
 * split by how each worker hears: `messageable` takes a message by name,
 * `taskOnly` hears only in its tasks' sessions, so it is reached by filing it a
 * task. Each formatter (the tool's, the prompt's) words it its own way.
 *
 * Read once per request: the tool's description and the prompt both resolve
 * before every step of the tool loop, and the roster is a collection list.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { RosterWorker, WorkerInstallation } from "../workers/installation";
import { parseDeclaredWorkerId } from "../worker-references";
import { recipientRefusal } from "./send-message";

/** The most workers either list carries. */
export const MAX_LISTED_RECIPIENTS = 25;

/** Who a worker can reach, by how it hears. */
export interface WorkerRecipients {
  /** Workers a message by name reaches. */
  readonly messageable: readonly RosterWorker[];
  /** Workers that hear only in their tasks' sessions: reached by filing a task. */
  readonly taskOnly: readonly RosterWorker[];
}

const TASK_SESSIONS_ONLY = "task_sessions_only:";

/** One read per request, by request id. Bounded: a request's entry is only read during it. */
const byRequest = new Map<string, { installation: WorkerInstallation; self: string; list: Promise<WorkerRecipients> }>();

async function readRecipients(ctx: BlockContext, installation: WorkerInstallation, self: string): Promise<WorkerRecipients> {
  const messageable: RosterWorker[] = [];
  const taskOnly: RosterWorker[] = [];
  for (const worker of await installation.roster(ctx as never)) {
    if (worker.id === self) continue;
    const refusal = recipientRefusal(installation, self, worker.id, worker);
    if (refusal === undefined) {
      if (messageable.length < MAX_LISTED_RECIPIENTS) messageable.push(worker);
    } else if (refusal.startsWith(TASK_SESSIONS_ONLY)) {
      if (taskOnly.length < MAX_LISTED_RECIPIENTS) taskOnly.push(worker);
    }
  }
  return { messageable, taskOnly };
}

/**
 * The workers `self` can reach, read from the roster once per request.
 *
 * @param self The running worker's id. Never listed.
 */
export function workerRecipients(ctx: BlockContext, installation: WorkerInstallation, self: string): Promise<WorkerRecipients> {
  const requestId = (ctx as { request?: { identity?: { id?: unknown } } }).request?.identity?.id;
  if (typeof requestId !== "string") return readRecipients(ctx, installation, self);
  const known = byRequest.get(requestId);
  if (known !== undefined && known.installation === installation && known.self === self) return known.list;
  if (byRequest.size > 256) byRequest.clear();
  const list = readRecipients(ctx, installation, self);
  byRequest.set(requestId, { installation, self, list });
  // A failed read is not kept: the next step reads again.
  list.catch(() => byRequest.delete(requestId));
  return list;
}

/** A worker's name as a user reads it: its file's `name:`, else its id's worker segment. */
export function rosterDisplayName(worker: Pick<RosterWorker, "id" | "name">): string {
  if (worker.name !== null && worker.name.trim().length > 0) return worker.name;
  return parseDeclaredWorkerId(worker.id)?.name ?? worker.id;
}

/** A worker's team as a user reads it: its `TEAM.md` `name:`, else its id's team segment, else none. */
export function rosterTeamName(worker: Pick<RosterWorker, "id" | "teamName">): string | undefined {
  if (worker.teamName !== null && worker.teamName.trim().length > 0) return worker.teamName;
  return parseDeclaredWorkerId(worker.id)?.team;
}
