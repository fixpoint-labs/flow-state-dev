/**
 * Reading a child session's two server-stamped labels, and matching a child
 * session to the board task it is doing (FIX-1071).
 *
 * A child session is a session first. It carries a `topic` and a `coordinate`,
 * both display-only, both optional, and neither of them a task reference — a
 * child session started by anything other than a task board has no task at
 * all, and one predating these labels has neither.
 *
 * ## What the labels contain
 *
 * The engine stamps both at child-session creation, straight off the values
 * the dispatch already consumed to derive the child
 * (`engine/context/create-request-host.ts`):
 *
 * - `topic` is the dispatch KEY the child was derived from. For a task-board
 *   hand-off under the default `"per-task"` session policy that key is
 *   `` `task|${boardId.length}:${boardId}|${taskId.length}:${taskId}` `` — the
 *   task id is embedded in it, length-prefixed. A custom `{ key }` session
 *   policy sets it to whatever the author's function returned, which may or
 *   may not carry the task id at all.
 * - `coordinate` is the entry address the child was spawned for:
 *   `` `task:${assignee}` `` for a board hand-off, `` `internal:${name}` ``
 *   for an internal dispatcher. Simple and literal — nothing here is framed or
 *   length-prefixed, unlike the labels this file used to decode.
 *
 * ## The authoritative link, and why this file does not read it
 *
 * The dispatched request itself — the child's own first request record —
 * carries `metadata.dispatch.taskId`, stamped server-side from the claim that
 * triggered the hand-off (`orchestration/task-board/blocks/hand-off.ts`). That
 * is an exact, server-verified link: no matching, no ambiguity. But it lives
 * on the child's own request history, not on the session-summary row
 * `useChildSessions` reads, and fetching it would mean one more request PER
 * child on screen — exactly what the one-page read budget
 * (`docs/architecture/server-and-client.md`) exists to forbid. So this file
 * works only from the two labels every child session already carries on the
 * summary row, and the match below is best-effort by construction, not a
 * stand-in for that stronger signal — a caller sitting on the stronger signal
 * (because it already fetched a child's requests for some other reason) should
 * prefer `metadata.dispatch.taskId === task.id` over anything here.
 *
 * ## The match
 *
 * A child belongs to a task when its `coordinate` names that task's assignee
 * (`` `task:${task.assignee}` ``) AND its `topic` either contains the task id
 * (the per-task key embeds it) or equals the task's own declared
 * `metadata.topic` (a custom key policy that chose to mirror it there). An
 * unassigned task never matches by this route: `` `task:${assignee}` `` cannot
 * be built without an assignee to compare against, mirroring the board's own
 * routing — a `uniform` or `floor` seat cannot be disambiguated by worker
 * either.
 *
 * ## The bound: still a navigation affordance, not proof of provenance
 *
 * Two different boards with a same-named seat, and two tasks that happen to
 * share a topic or an id-shaped substring, can both fit — nothing here can
 * tell them apart, because `coordinate` carries no board identity at all
 * (FIX-1088 tracks the fix: put verifiable attribution on the wire). A link is
 * drawn only when exactly one candidate survives; a task or child left
 * unlinked is the honest answer whenever more than one fits or none does.
 * Read a match as "this is probably the child doing this work, go look" — not
 * as a settled fact.
 */
import type { ChildSessionSummary } from "@flow-state-dev/client";
import type { CollectionView, Task } from "./task-collection-state";

/** A `coordinate` label split into the dispatch type and its target. */
export type ChildSessionCoordinate = {
  /** `"task"` for a board hand-off, `"internal"` for an internal dispatcher. */
  type: string;
  /** The assignee (for `"task"`) or dispatcher name (for `"internal"`). */
  target: string;
};

/**
 * Split a `coordinate` label into its type and target.
 *
 * `null` for an absent label, or one with no `:` at all — a child started by
 * some other writer may put anything here, and showing it raw beats guessing.
 */
export function decodeCoordinate(
  coordinate: string | undefined | null
): ChildSessionCoordinate | null {
  // `== null` rather than a truthiness check: a store that nulls absent keys
  // hands back `null`, an older record `undefined`, and both mean unlabelled
  // (BP-030).
  if (coordinate == null || coordinate.length === 0) return null;
  const separator = coordinate.indexOf(":");
  if (separator === -1) return null;
  return {
    type: coordinate.slice(0, separator),
    target: coordinate.slice(separator + 1),
  };
}

/** A task and the board it was rendered under, so a link can name both. */
export type LinkedTask = {
  /** The board's `collectionId`, as the Tasks panel shows it. */
  collectionId: string;
  task: Task;
};

/**
 * Could this child session be running this task?
 *
 * `false` whenever `coordinate` disagrees or is absent — including when the
 * task itself has no assignee, since `` `task:${assignee}` `` cannot be built
 * to compare against. Given a coordinate match, `topic` still has to carry
 * SOME evidence of the task: either the task id as a substring (the default
 * per-task key's shape) or an exact match against the task's own declared
 * topic (a custom key policy that chose to mirror it).
 */
function couldBeRunningTask(child: ChildSessionSummary, task: Task): boolean {
  if (task.assignee == null) return false;
  if (child.coordinate !== `task:${task.assignee}`) return false;
  if (child.topic == null || child.topic.length === 0) return false;
  if (child.topic.includes(task.id)) return true;
  const declaredTopic = task.metadata?.["topic"];
  return typeof declaredTopic === "string" && child.topic === declaredTopic;
}

/**
 * The one child session a task is addressed by, or `undefined` when that
 * cannot be decided.
 *
 * Requires EXACTLY one candidate. Two children both satisfying
 * {@link couldBeRunningTask} for the same task is the ordinary shape of the
 * ambiguity the file header describes — a wrong link on a debugging surface is
 * worse than no link, so neither is drawn.
 */
function resolveChildSession(
  candidates: readonly ChildSessionSummary[],
  task: Task
): ChildSessionSummary | undefined {
  const matched = candidates.filter((candidate) => couldBeRunningTask(candidate, task));
  return matched.length === 1 ? matched[0] : undefined;
}

/**
 * Pair the session's child sessions with the board tasks they are addressed
 * by.
 *
 * Both directions come out of one pass because both panels need one of them
 * and neither should re-derive the other's.
 */
export function linkChildSessionsToTasks(
  children: readonly ChildSessionSummary[],
  collections: readonly CollectionView[]
): {
  /** Child session for a task, keyed `${collectionId}<NUL>${taskId}`. */
  byTask: Map<string, ChildSessionSummary>;
  /** Every task one child session covers, keyed by child session id. */
  byChild: Map<string, LinkedTask[]>;
} {
  // Pass 1 — every task's own best-effort match, independent of any other
  // task's.
  const claims: Array<{ collectionId: string; task: Task; child: ChildSessionSummary }> = [];
  for (const collection of collections) {
    for (const entry of collection.tasks) {
      const child = resolveChildSession(children, entry.task);
      if (child === undefined) continue;
      claims.push({ collectionId: collection.id, task: entry.task, child });
    }
  }

  // Pass 2 — contention across boards. `coordinate` carries no board identity
  // (see the file header), so two collections independently claiming the same
  // child is the only sign that more than one board might own it — and
  // neither gets the link when that happens, the same rule
  // {@link resolveChildSession} applies to two tasks contending for one child.
  const claimants = new Map<string, Set<string>>();
  for (const claim of claims) {
    const owners = claimants.get(claim.child.id);
    if (owners === undefined) claimants.set(claim.child.id, new Set([claim.collectionId]));
    else owners.add(claim.collectionId);
  }

  const byTask = new Map<string, ChildSessionSummary>();
  const byChild = new Map<string, LinkedTask[]>();
  for (const claim of claims) {
    if ((claimants.get(claim.child.id)?.size ?? 0) > 1) continue;
    byTask.set(taskLinkKey(claim.collectionId, claim.task.id), claim.child);
    const linked = byChild.get(claim.child.id);
    const value: LinkedTask = { collectionId: claim.collectionId, task: claim.task };
    if (linked === undefined) byChild.set(claim.child.id, [value]);
    else linked.push(value);
  }

  return { byTask, byChild };
}

/**
 * The `byTask` key. A NUL join rather than `:` — a `collectionId` and a task id
 * are both free-form, so any printable separator can appear inside one of them.
 *
 * Written as the escape sequence, never, never as a literal NUL byte. Git sniffs the
 * first 8000 bytes of a file for one and renders the whole file as `Bin` if it
 * finds it, so a raw separator here silently costs every reviewer the diff of
 * this file — and does it intermittently, depending on whether the file has
 * grown enough to push the byte past the sniff window.
 */
export function taskLinkKey(collectionId: string, taskId: string): string {
  return `${collectionId}\u0000${taskId}`;
}
