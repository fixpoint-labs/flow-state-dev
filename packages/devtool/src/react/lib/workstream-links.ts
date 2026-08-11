/**
 * Reading a Workstream's two server-stamped labels, and matching a Workstream
 * to the board tasks it is doing (FIX-1071).
 *
 * A Workstream is a session first. It carries a `topic` and a `coordinate`, both
 * display-only, both optional, and neither of them a task reference — a
 * Workstream started by anything other than a task board has no task at all, and
 * a legacy record has no labels either. Everything here therefore *derives* an
 * association where one is visible and returns nothing where it is not; nothing
 * in the panel is gated on a match existing.
 *
 * ## What the labels contain
 *
 * The task board's routing seed (`orchestration/task-board/coordinate.ts`) is
 * the writer:
 *
 * - `topic` is the claimed task's own `metadata.topic`, falling back to the
 *   **task id** when the task declared none. That fallback is the whole of the
 *   association: an unlabelled task's Workstream is named after it.
 * - `coordinate` is `framed(boardId)|framed(coordinateKey)`, where `framed(v)`
 *   is `` `${v.length}:${v}` `` and `coordinateKey` is `assignee|framed(name)`,
 *   `uniform`, or `floor`.
 *
 * Both are decoded here rather than rendered raw, because a hashed `ws_…` id
 * beside `10:issue-work|20:assignee|9:implement` tells a developer nothing.
 *
 * ## Why the match starts at the topic
 *
 * `boardId` and a collection's `collectionId` are deliberately different strings
 * (`taskBoard` documents that they "are not always the same"), and only
 * `collectionId` reaches the item stream the Tasks panel reads. So the board id
 * decoded from a coordinate cannot be joined against a rendered board, which
 * leaves the topic as the only value both sides can be INDEXED on. The worker is
 * comparable once a candidate is in hand, but it cannot key the lookup.
 *
 * ## A Workstream's identity has three parts, so the match checks three
 *
 * `deriveChildSessionId` hashes the topic together with the routing seed's
 * `key`, and `workstreamRoutingSeed` builds that key as
 * `framed(boardId)|framed(coordinateKey)`. So a child session is identified by
 * **(board, worker coordinate, topic)** — and a match that indexes on one part
 * and checks another leaves the third as a defect waiting to be reported. This
 * file therefore takes each part in turn rather than special-casing the shapes
 * that happen to have been noticed:
 *
 * - **Topic** — the index key. Both sides carry it (a task's `metadata.topic`,
 *   else its id, which is the fallback the routing seed itself applies).
 * - **Worker** — comparable. The coordinate decodes to `assignee:<name>` and a
 *   task carries `assignee`, so a disagreement is visible and disqualifying.
 * - **Board** — NOT comparable, in either direction of the data. The coordinate
 *   carries `boardId`, but nothing on the task side does: `task-change` and
 *   `task-board-meta` emit `collectionId`, which `taskBoard` documents as a
 *   deliberately different string. Its disagreement is therefore detected
 *   rather than checked — see `linkWorkstreamsToTasks`'s second pass.
 *
 * One rule spans all three: a part that DECODES AND DISAGREES disqualifies a
 * candidate; a part that cannot be read at all is "cannot tell" and leaves the
 * candidate eligible. Those are deliberately not the same. Collapsing them
 * would drop the ordinary lone unlabelled Workstream, which carries no
 * coordinate and still pairs correctly with its task.
 *
 * The two sides are not symmetric about what counts as unreadable, and that is
 * the easy thing to get wrong. A COORDINATE that names no worker is ignorance.
 * A TASK with no assignee, against a coordinate that names one, is a
 * DISAGREEMENT — `coordinateForTask` cannot route an unassigned row to an
 * assignee coordinate, so the absence rules the pairing out rather than leaving
 * it open. See `couldRun`.
 *
 * A link is drawn only when exactly one candidate survives, and only when no
 * second board is contending for it.
 *
 * That uniqueness is PAGE-LOCAL. The panel reads one page of the Workstream
 * listing (a budget fixed in `docs/architecture/server-and-client.md`), so
 * "exactly one candidate" means exactly one among the rows loaded — an older
 * unlisted Workstream sharing the topic and a compatible worker would fit too.
 * Nothing here can see that, and nothing here tries to: the caller knows how
 * much of the index it holds, and the Tasks tab marks both a match and an
 * absence as unverified whenever that is less than all of it. Withholding
 * matches instead would delete the feature on any session large enough to
 * page.
 *
 * ## The bound: this pairing is best-effort, and cannot be made otherwise here
 *
 * Board ownership is not verifiable from what the server sends, so the match is
 * as strong as the data permits and no stronger. Contention between claimants is
 * detected and refused, but a SINGLE claimant is taken as the owner — and a
 * single *wrong* claimant is undetectable.
 *
 * The scenario that produces one: a task's topic is changed after its work was
 * dispatched (`patchMetadata`). Its own board stops contributing a candidate,
 * and an unrelated collection holding a task with the original topic and
 * assignee becomes the sole claimant, so it gets the link.
 *
 * Read a link accordingly: it is a **navigation affordance, not an assertion of
 * provenance**. It says "this is probably the session doing this work, go look",
 * not "this session provably owns this task".
 *
 * That bound is about identity, and it is separate from FRESHNESS. Everything
 * here resolves against whatever snapshot of a task `groupCollections` produced,
 * and that fold used to land on the OLDEST one — so a task reassigned or
 * re-topiced across two requests was matched on state it no longer had. The
 * fold now keeps the newest change per task (see `task-collection-state`), which
 * removes two effects that looked like this bound and were not: a wrong link
 * drawn against a superseded assignee, and a CORRECT link suppressed because a
 * stale topic made a second collection appear to contend. Neither retires the
 * bound — an unverifiable board is unverifiable however fresh the row is — but
 * ambiguity now reflects a real gap in the data rather than a stale read of it.
 *
 * Refusing to link without verified attribution is not an option that leaves the
 * feature standing — attribution is not merely absent from the payload, it is
 * inexpressible from it, so that rule would draw no link ever. The fix belongs
 * in the substrate: **FIX-1088** tracks emitting the owning board's id on task
 * events. Once attribution is verifiable the rules here get SIMPLER, and the
 * contention pass above is retired rather than extended.
 *
 * Two consequences, both real and both correct to show:
 *
 * - **Several tasks can share one Workstream.** That is the substrate's own
 *   behaviour — a second task on the same board, worker and topic lands in the
 *   same child session and continues its history — not an artifact of matching
 *   this way.
 * - **A `uniform` or `floor` board cannot be disambiguated by worker.** Its
 *   coordinate names no assignee, so a topic with two such Workstreams links to
 *   neither. Tightening it needs the routing key itself on the wire.
 */
import type { WorkstreamSummary } from "@flow-state-dev/client";
import type { CollectionView, Task } from "./task-collection-state";

/** A Workstream's `coordinate` label, decoded into the two strings it frames. */
export type WorkstreamCoordinate = {
  /** The declaring board's stable id. */
  boardId: string;
  /** Which worker on that board, as `assignee:<name>` / `uniform` / `floor`. */
  worker: string;
};

/**
 * Read one length-framed field (`` `${length}:${value}` ``) starting at `at`.
 *
 * Returns the value and where the next field begins, or `null` when the input
 * does not have that shape — a label written by some other producer, or a
 * future encoding. Callers fall back to showing the raw label.
 */
function readFramed(
  input: string,
  at: number
): { value: string; next: number } | null {
  const separator = input.indexOf(":", at);
  if (separator === -1) return null;
  const digits = input.slice(at, separator);
  if (!/^\d+$/.test(digits)) return null;
  const length = Number.parseInt(digits, 10);
  const start = separator + 1;
  const end = start + length;
  if (end > input.length) return null;
  return { value: input.slice(start, end), next: end };
}

/**
 * Decode a `coordinate` label into its board and worker.
 *
 * `null` for an absent label, and for any value that is not the task board's
 * encoding — a Workstream started by another writer may put anything here, and
 * guessing at a half-parsed value would name a board that does not exist.
 */
export function decodeWorkstreamCoordinate(
  coordinate: string | undefined | null
): WorkstreamCoordinate | null {
  // `== null` rather than a truthiness check: a store that nulls absent keys
  // hands back `null`, an older record `undefined`, and both mean unlabelled
  // (BP-030).
  if (coordinate == null || coordinate.length === 0) return null;

  const board = readFramed(coordinate, 0);
  if (board === null) return null;
  if (coordinate[board.next] !== "|") return null;

  const key = readFramed(coordinate, board.next + 1);
  if (key === null || key.next !== coordinate.length) return null;

  return { boardId: board.value, worker: describeCoordinateKey(key.value) };
}

/**
 * Render a `coordinateKey` the way the board's own diagnostics spell it.
 *
 * Mirrors `coordinateLabel` in `orchestration/task-board/coordinate.ts`. An
 * unrecognised key is returned as-is: it is still the most specific thing we
 * know about that worker.
 */
function describeCoordinateKey(key: string): string {
  if (key === "uniform" || key === "floor") return key;
  if (key.startsWith("assignee|")) {
    const name = readFramed(key, "assignee|".length);
    if (name !== null && name.next === key.length) {
      return `assignee:${name.value}`;
    }
  }
  return key;
}

/** The topic a task would be addressed by, if a Workstream ran it. */
function topicOf(task: Task): string {
  const declared = task.metadata?.["topic"];
  if (typeof declared === "string") {
    const trimmed = declared.trim();
    // A blank topic is normalized to absent by the routing seed, so it falls
    // back to the id here for the same reason it does there.
    if (trimmed.length > 0) return trimmed;
  }
  return task.id;
}

/** A task and the board it was rendered under, so a link can name both. */
export type LinkedTask = {
  /** The board's `collectionId`, as the Tasks panel shows it. */
  collectionId: string;
  task: Task;
};

/**
 * Could this Workstream be running this task?
 *
 * `false` on a positive contradiction. The subtlety is which absences count as
 * one, and the two sides are not symmetric:
 *
 * - **An unreadable coordinate is ignorance.** No coordinate at all, a label the
 *   decoder cannot parse, or a `uniform`/`floor` key names no worker, so there
 *   is nothing to compare and the candidate stays eligible. This is what lets a
 *   lone unlabelled Workstream pair with its task.
 * - **An absent assignee is not.** When the coordinate DOES name an assignee,
 *   a task without one could not have produced it: `coordinateForTask`
 *   (`task-board/detached-runner.ts`) reaches its `assignee` branch only via
 *   `task.assignee !== undefined && declared.has(task.assignee)`, and routes an
 *   unassigned row to `uniform`, to `floor`, or to a refusal. The absence is
 *   therefore a statement about where the task can have gone, not a gap in what
 *   we know — treating it as ignorance discards that.
 *
 * So the asymmetry is deliberate: the coordinate's silence is unknown, the
 * task's silence is informative, because only one of them is governed by a
 * routing rule that forbids the pairing.
 */
function couldRun(workstream: WorkstreamSummary, task: Task): boolean {
  const worker = decodeWorkstreamCoordinate(workstream.coordinate)?.worker;
  if (worker === undefined || !worker.startsWith("assignee:")) return true;
  const assignee = task.assignee;
  // `== null` and nothing more. The absence that routes a row away from an
  // assignee coordinate is `undefined` (and `null` from a store that writes
  // one, BP-030) — NOT the empty string, which is a name like any other:
  // registry keys come from `Object.entries` with no length check, `assignee`
  // is a bare `z.string()`, and `coordinate.ts` says in as many words that
  // assignee names are unrestricted. `boardId` is length-checked where it is
  // declared; this deliberately is not.
  //
  // So a board declaring `workers: { "": … }` routes a row carrying
  // `assignee: ""` to `{ kind: "assignee", name: "" }`, which frames to
  // `assignee|0:` and decodes back to `assignee:`. Rejecting that on length
  // called a real route impossible and blanked the link in both directions.
  if (assignee == null) return false;
  return worker === `assignee:${assignee}`;
}

/**
 * The one Workstream a task is addressed by, or `undefined` when that cannot be
 * decided.
 *
 * A topic alone does not identify a child session. The routing seed carries a
 * `key` beside the topic — `framed(boardId)|framed(coordinateKey)` — and the
 * seam hashes BOTH into the child's id, so one topic routed to two different
 * workers is two different sessions rather than one. Matching on topic alone
 * pointed every such task at whichever arrived first and left the other
 * Workstream looking taskless.
 *
 * The coordinate is the half of that key which reaches the client, and a task's
 * `assignee` is what the board turns into it, so the two are compared —
 * **always, not only when the topic is contested**. A single candidate is the
 * ordinary shape of the same defect: two tasks share a topic but target
 * different workers and only one has spawned (the other is inline, or has not
 * started), so the lone Workstream is the only candidate for BOTH and a
 * count-gated check waves the wrong one through.
 *
 * Where the comparison still does not name exactly one — a `uniform` or `floor`
 * board, a label the decoder cannot read, two candidates wearing the same
 * coordinate — this returns nothing. A wrong link on a debugging surface is
 * worse than no link, which is the call the decoder already makes for a label
 * it cannot parse.
 */
function resolveWorkstream(
  candidates: readonly WorkstreamSummary[],
  task: Task
): WorkstreamSummary | undefined {
  const matched = candidates.filter((candidate) => couldRun(candidate, task));
  return matched.length === 1 ? matched[0] : undefined;
}

/**
 * Pair the session's Workstreams with the board tasks they are addressed by.
 *
 * Both directions come out of one pass because both panels need one of them and
 * neither should re-derive the other's.
 */
export function linkWorkstreamsToTasks(
  workstreams: readonly WorkstreamSummary[],
  collections: readonly CollectionView[]
): {
  /** Workstream for a task, keyed `${collectionId}<NUL>${taskId}`. */
  byTask: Map<string, WorkstreamSummary>;
  /** Every task one Workstream covers, keyed by workstream id. */
  byWorkstream: Map<string, LinkedTask[]>;
} {
  // Every Workstream on a topic, not just the first — which of them a given
  // task belongs to is decided per task, by `resolveWorkstream`.
  const byTopic = new Map<string, WorkstreamSummary[]>();
  for (const workstream of workstreams) {
    if (workstream.topic == null || workstream.topic.length === 0) continue;
    const bucket = byTopic.get(workstream.topic);
    if (bucket === undefined) byTopic.set(workstream.topic, [workstream]);
    else bucket.push(workstream);
  }

  // Pass 1 — resolve the two identity parts that CAN be compared: the topic
  // (the index key) and the worker (assignee against the decoded coordinate).
  const claims: Array<{ collectionId: string; task: Task; workstream: WorkstreamSummary }> = [];
  for (const collection of collections) {
    for (const entry of collection.tasks) {
      const workstream = resolveWorkstream(
        byTopic.get(topicOf(entry.task)) ?? [],
        entry.task
      );
      if (workstream === undefined) continue;
      claims.push({ collectionId: collection.id, task: entry.task, workstream });
    }
  }

  // Pass 2 — the BOARD leg, which cannot be compared and so is detected instead.
  //
  // A Workstream belongs to exactly one board: `deriveChildSessionId` hashes the
  // topic together with a key built from `boardId|coordinateKey`. The board id
  // is on the Workstream's coordinate, but NOTHING on the task side carries one
  // — `task-change` and `task-board-meta` emit `collectionId`, and `taskBoard`
  // documents that as a deliberately different string from `boardId`. So board
  // equality can never be verified the way the worker can.
  //
  // What is observable is CONTENTION. If tasks in more than one collection each
  // resolve to the same Workstream, at most one of those boards owns it and
  // nothing on the wire says which — so none of them gets a link. That is the
  // same rule the other two legs follow (a part that cannot decide is ambiguous,
  // and ambiguity draws nothing), applied to the only part whose disagreement is
  // invisible.
  const claimants = new Map<string, Set<string>>();
  for (const claim of claims) {
    const owners = claimants.get(claim.workstream.id);
    if (owners === undefined) claimants.set(claim.workstream.id, new Set([claim.collectionId]));
    else owners.add(claim.collectionId);
  }

  const byTask = new Map<string, WorkstreamSummary>();
  const byWorkstream = new Map<string, LinkedTask[]>();
  for (const claim of claims) {
    if ((claimants.get(claim.workstream.id)?.size ?? 0) > 1) continue;
    byTask.set(taskLinkKey(claim.collectionId, claim.task.id), claim.workstream);
    const linked = byWorkstream.get(claim.workstream.id);
    const value: LinkedTask = { collectionId: claim.collectionId, task: claim.task };
    if (linked === undefined) byWorkstream.set(claim.workstream.id, [value]);
    else linked.push(value);
  }

  return { byTask, byWorkstream };
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

