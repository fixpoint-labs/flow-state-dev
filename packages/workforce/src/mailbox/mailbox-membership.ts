/**
 * Who is on a mailbox, and who works its task lists, as it changes while the
 * app runs.
 *
 * The mailbox's session is the one record of both. A file is where a mailbox
 * starts; after its first open, the subscribe and unsubscribe entries change
 * `members` and record, per task list, the workers they added to it and took
 * off it (`workersByList`). The inventory row and the membership rows follow
 * the session on each change; nothing here reads them.
 *
 * What changes is computed here, as plain functions of the current state, so
 * the entries can run them inside the session's versioned write and run them
 * again on the state a conflict hands back. A change that would leave the
 * state as it is comes back `undefined`, which is what makes a second
 * subscribe or unsubscribe a no-op.
 *
 * {@link taskListWorkers} is the one read of who works a list. Being a member
 * never counts, and neither does a board's declaration: a member may be a
 * reviewer or a person.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";

/** Per task list, the workers the entries added to it and took off it. */
export type WorkersByList = Record<string, { added: string[]; removed: string[] }>;

/** The two fields a membership change writes. */
export interface MembershipFields {
  members: string[];
  workersByList: WorkersByList | null;
}

function union(into: readonly string[], more: readonly string[]): string[] {
  return [...into, ...more.filter((name) => !into.includes(name))];
}

function without(from: readonly string[], less: readonly string[]): string[] {
  return from.filter((name) => !less.includes(name));
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/** Apply `change` to each of `lists`, or `undefined` when no list changed. */
function changeLists(
  current: WorkersByList | null,
  lists: readonly string[],
  change: (entry: { added: string[]; removed: string[] }) => { added: string[]; removed: string[] }
): WorkersByList | undefined {
  const next: WorkersByList = { ...(current ?? {}) };
  let changed = false;
  for (const list of lists) {
    const before = next[list] ?? { added: [], removed: [] };
    const after = change(before);
    if (sameList(before.added, after.added) && sameList(before.removed, after.removed)) continue;
    next[list] = after;
    changed = true;
  }
  return changed ? next : undefined;
}

/**
 * Add `workers` as members. With `worksTaskList`, also record each as working
 * every list in `lists` (and lift a removal recorded for it there).
 *
 * @returns The fields to write, or `undefined` when nothing changes.
 */
export function subscribedFields(
  current: MembershipFields,
  workers: readonly string[],
  worksTaskList: boolean,
  lists: readonly string[]
): MembershipFields | undefined {
  const members = union(current.members, workers);
  const byList = worksTaskList
    ? changeLists(current.workersByList, lists, (entry) => ({
        added: union(entry.added, workers),
        removed: without(entry.removed, workers)
      }))
    : undefined;
  if (members.length === current.members.length && byList === undefined) return undefined;
  return { members, workersByList: byList ?? current.workersByList };
}

/**
 * Take `workers` off the mailbox and off every list in `lists`, recording the
 * removal on each list so it holds against a file that names them there.
 *
 * @returns The fields to write, or `undefined` when nothing changes.
 */
export function unsubscribedFields(
  current: MembershipFields,
  workers: readonly string[],
  lists: readonly string[]
): MembershipFields | undefined {
  const members = without(current.members, workers);
  const byList = changeLists(current.workersByList, lists, (entry) => ({
    added: without(entry.added, workers),
    removed: union(entry.removed, workers)
  }));
  if (members.length === current.members.length && byList === undefined) return undefined;
  return { members, workersByList: byList ?? current.workersByList };
}

/** The one field {@link taskListWorkers} reads, parsed on its own so a mailbox without it reads as empty. */
const workersByListSchema = z
  .object({
    workersByList: z
      .record(z.string(), z.object({ added: z.array(z.string()), removed: z.array(z.string()) }))
      .nullable()
      .optional()
  })
  .passthrough();

/**
 * The workers who work one of a mailbox's task lists: those its file names
 * for the list, plus those subscribed to it with `worksTaskList`, minus those
 * unsubscribed since. One answer for a file's list and a run-time one.
 *
 * Being a member does not count, and neither does declaring the board.
 *
 * The file's term is empty today: a `MAILBOX.md` names no list's workers yet.
 * When it does, it joins the union here, and the recorded removals apply to
 * it too.
 *
 * Read from the mailbox's own session, so it runs in a block whose session is
 * that mailbox (its fan-out, or one of its actions).
 *
 * @param ctx      A block context running in the mailbox's session.
 * @param mailboxId The mailbox's id; must be the session's own.
 * @param list      The list's name, as the mailbox holds it.
 * @returns The workers' names, as a set with no order. Empty when nobody works it.
 * @throws When `ctx` is not running in that mailbox's session.
 */
export function taskListWorkers(ctx: BlockContext, mailboxId: string, list: string): ReadonlySet<string> {
  if (ctx.session.identity.id !== mailboxId) {
    throw new Error(
      `taskListWorkers("${mailboxId}", "${list}") ran in session "${ctx.session.identity.id}". ` +
        "Who works a list is read from the mailbox's own session, so call it from a block running there."
    );
  }
  const parsed = workersByListSchema.safeParse(ctx.session.state);
  const entry = parsed.success ? parsed.data.workersByList?.[list] : undefined;
  const fileWorkers: readonly string[] = [];
  const workers = new Set([...fileWorkers, ...(entry?.added ?? [])]);
  for (const removed of entry?.removed ?? []) workers.delete(removed);
  return workers;
}
