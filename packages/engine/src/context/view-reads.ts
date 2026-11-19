// FIX-2623.
/**
 * What a view's run read, and the topics a watcher listens to because of it.
 *
 * The engine records each scope state and resource a view's blocks reach,
 * where it builds their context (the state getters and the resource
 * registry every block shares), so a read by a child block, a step or a
 * capability's block is recorded as the view's own block's is. Recorded per
 * run, the watch list is right on whatever branch the run took; nothing is
 * declared (D1).
 *
 * A read becomes the bare topic of its scope: the session's, the caller's
 * user's or the caller's org's. Those are the topics every write publishes
 * on today, so no topic is added. Beside the topics, the run says what it
 * hears under each (`ViewHearing`): the kinds of notice that may change what
 * it read and, for a resource, the roots a notice's path must fall under, so
 * a write to another resource of the scope wakes no watcher. A
 * board read through its task collection is heard on its board's own topic,
 * and, on a session or user ledger, its ledger's resource notices are not
 * heard at all: every write to the ledger publishes the board notice, which
 * names the task. An org board hears its ledger on the org topic instead (see
 * `ViewDependencies.board`).
 */
import type { ViewHearing, WireTopic } from "@flow-state-dev/core";
import type { ChangeKind } from "@flow-state-dev/core/internal";
import { wireTopicKey } from "@flow-state-dev/core/internal";
import type { ModelResolver } from "@flow-state-dev/core/types";
import type { RequestHost } from "@flow-state-dev/core/internal";
import { NoSessionError } from "./no-session";
import type { StorageReach } from "../resources/lineage-scope";

/**
 * A resource read: by accessor, and the storage root a change to it is
 * published at (its storage key, or a collection's static prefix; `""` for a
 * pattern with none, which rules no path out).
 */
type ResourceRead = { resource: string; root: string };

// FIX-2625; FIX-2750 (the partition).
/**
 * A task board read through its task collection: heard on its board notices,
 * which cover its ledger's accessor when `covers` is set. With none (an org
 * board's), the ledger's own notices stay heard beside it. A partitioned
 * ledger's read names its `partition`: a board notice naming another one
 * is not heard.
 */
type BoardReadRecord = { board: string; covers?: string; partition?: string };

/**
 * One read a view's run made: a scope's state, one of its resources by
 * accessor, or a task board; for a session, also the session itself
 * (`"session"`: its items, metadata, window, journal or record), which flow
 * and lineage it is (`"identity"`), or its requests' statuses (`"turns"`);
 * for the user, the list of their sessions (`"sessions"`) or their pending
 * suspensions (`"suspensions"`).
 */
export type RecordedRead =
  | { scope: "session"; sessionId: string; what: "state" | "session" | "identity" | "turns" | ResourceRead | BoardReadRecord }
  | { scope: "user" | "org"; what: "state" | "sessions" | "suspensions" | ResourceRead | BoardReadRecord };

/** A recorder for one run: what it read, and the topics that hear a change to it. */
export type ReadRecorder = {
  record(read: RecordedRead): void;
  /** Every distinct read, in the order first made. */
  reads(): readonly RecordedRead[];
  /** The topics the reads fall under: deduped and sorted, so an unchanged set compares equal. */
  topics(): WireTopic[];
  /** What the run hears under each topic, in the topics' order (`ViewHearing`). */
  hears(): ViewHearing[];
};

const readKey = (read: RecordedRead): string =>
  [
    read.scope,
    read.scope === "session" ? read.sessionId : "",
    typeof read.what === "string"
      ? read.what
      : "board" in read.what
        ? `b:${read.what.board}:${read.what.covers ?? ""}:${read.what.partition ?? ""}`
        : `r:${read.what.resource}`
  ].join("\u0000");

/**
 * The kinds a state read hears: the scope's state, written only in a run,
 * which publishes `state` once the write lands. On a session that leaves out
 * what moves no state: a reply streaming in it (`items`, `request`), and its
 * record's other writes (`run`: each request stamping itself the latest, a title).
 */
const STATE_KINDS: Record<RecordedRead["scope"], readonly ChangeKind[]> = {
  session: ["state"],
  user: ["state"],
  org: ["state"]
};

/** The kinds a read of the session itself hears: its every change but its resources and boards. */
const SESSION_KINDS: readonly ChangeKind[] = ["items", "request", "run", "state"];

// FIX-2725 D1; FIX-2773 moved identity off `run`.
/**
 * The kinds each read of another session, or of the user's sessions, hears.
 * A session's flow and lineage change only when it is deleted or recreated
 * under its id, both of which publish `state` on it (not `run`, which every
 * turn starting or ending publishes there, so a board view that names its
 * conversation would read again on each reply). Its requests' statuses
 * change on a request write, which publishes `request` on it; they vanish
 * with the session, whose delete (and a recreate) publishes `state` on it but
 * leaves its requests in the store. `state`, not `run`: a busy turn's session
 * field deltas and its child sessions' writes publish `run`. The user's
 * session list changes on a session written whole (made, titled, deleted) or
 * a request's status written, each of which publishes `run` on their user
 * topic. None hears `items`, which a reply publishes once per stored chunk.
 * The user's pending suspensions change only on a suspension written or
 * deleted, which publishes `suspension` on their user topic:
 * never on a turn starting or finishing, which publishes `run` there.
 */
const PEER_KINDS: Record<"identity" | "turns" | "sessions" | "suspensions", readonly ChangeKind[]> = {
  identity: ["state"],
  turns: ["request", "state"],
  sessions: ["run"],
  suspensions: ["suspension"]
};

// FIX-2750 (the partitions).
/**
 * What one run hears under one topic, built up read by read. `partitions` are
 * the board partitions read there; `whole` is set once a board was read whole
 * there, which hears every partition.
 */
type Hearing = { topic: WireTopic; kinds: Set<ChangeKind>; paths: Set<string>; partitions: Set<string>; whole: boolean };

/** Every read's hearing, merged per topic and sorted by topic, leaving out resource reads a board read covers. */
function hearingsOf(reads: Iterable<RecordedRead>): Hearing[] {
  const all = [...reads];
  const covered = new Set(
    all.flatMap((read) => (typeof read.what !== "string" && "board" in read.what && read.what.covers !== undefined ? [read.what.covers] : []))
  );
  const byTopic = new Map<string, Hearing>();
  const at = (topic: WireTopic): Hearing => {
    const key = wireTopicKey(topic);
    let hearing = byTopic.get(key);
    if (hearing === undefined) byTopic.set(key, (hearing = { topic, kinds: new Set(), paths: new Set(), partitions: new Set(), whole: false }));
    return hearing;
  };
  for (const read of all) {
    const scopeTopic: WireTopic = read.scope === "session" ? { scope: "session", id: read.sessionId } : { scope: read.scope };
    if (read.what === "state") {
      for (const kind of STATE_KINDS[read.scope]) at(scopeTopic).kinds.add(kind);
    } else if (read.what === "session") {
      for (const kind of SESSION_KINDS) at(scopeTopic).kinds.add(kind);
    } else if (read.what === "identity" || read.what === "turns" || read.what === "sessions" || read.what === "suspensions") {
      for (const kind of PEER_KINDS[read.what]) at(scopeTopic).kinds.add(kind);
    } else if ("board" in read.what) {
      const hearing = at({ ...scopeTopic, resource: read.what.board });
      hearing.kinds.add("board");
      // Read whole, it hears every partition: the ones listed no longer narrow it.
      if (read.what.partition === undefined) {
        hearing.whole = true;
        hearing.partitions.clear();
      } else if (!hearing.whole) hearing.partitions.add(read.what.partition);
    } else if (!covered.has(read.what.resource)) {
      const hearing = at(scopeTopic);
      hearing.kinds.add("resource");
      hearing.paths.add(read.what.root);
    }
  }
  return [...byTopic.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, hearing]) => hearing);
}

/** The order a hearing lists its kinds in: as `ChangeKind` names them, so an unchanged set compares equal. */
const KIND_ORDER: readonly ChangeKind[] = ["items", "request", "run", "state", "resource", "board", "suspension", "resync"];

/** A fresh recorder for one view run. */
export function createReadRecorder(): ReadRecorder {
  const seen = new Map<string, RecordedRead>();
  return {
    record(read) {
      const key = readKey(read);
      if (!seen.has(key)) seen.set(key, read);
    },
    reads: () => [...seen.values()],
    topics: () => hearingsOf(seen.values()).map((hearing) => hearing.topic),
    hears: () =>
      hearingsOf(seen.values()).map((hearing) => ({
        topic: hearing.topic,
        kinds: KIND_ORDER.filter((kind) => hearing.kinds.has(kind)),
        ...(hearing.kinds.has("resource") ? { paths: [...hearing.paths].sort() } : {}),
        ...(!hearing.whole && hearing.partitions.size > 0 ? { partitions: [...hearing.partitions].sort() } : {})
      }))
  };
}

/**
 * The one way a view's run records a dependency. Every read path the engine
 * offers a view calls one of these, never the raw recorder: a scope's state,
 * a resource (reached through `ctx.resources` or resolved as a template), and
 * another session. The rules for which topics a read is heard on live here
 * and nowhere else:
 *
 * - a read is heard on its scope's topic (the running session's, the user's,
 *   the org's), a resource read under its storage root;
 * - a lineage-shared session resource is also heard on the owner's user
 *   topic, where a write from another lineage member publishes;
 * - another session's read is heard on that session's topic;
 * - a board read through its task collection is heard as its ledger's scope
 *   allows (`board`).
 *
 * `views-dependency-matrix.test.ts` runs every read path against every scope;
 * a new read path is a new row there and calls in here.
 */
export type ViewDependencies = {
  /** A scope's state read: heard on its state's notices only. */
  state(scope: "session" | "user" | "org"): void;
  /**
   * A resource read, by name, and the storage it can reach: one key, or every
   * key under a prefix. Whether any of that storage is lineage-shared is
   * worked out here, from storage ownership, never from the handle that read it.
   */
  resource(scope: "session" | "user" | "org", name: string, reach: StorageReach): void;
  /** A session itself read (its items, metadata, window, journal or record): heard on its every change. */
  session(sessionId: string): void;
  // FIX-2725 D1, amended by FIX-2773.
  /** Which flow and lineage another session is: heard on its `state` only, which its birth and its delete publish. */
  sessionIdentity(sessionId: string): void;
  /** Another session's readonly state: heard on its `state`. */
  sessionState(sessionId: string): void;
  /** Another session's requests' statuses: heard on its `request` only. */
  sessionTurns(sessionId: string): void;
  /** The caller's sessions listed: heard on their user topic's `run`. */
  sessionList(): void;
  // FIX-2770.
  /** The caller's pending suspensions read: heard on their user topic's `suspension` only. */
  userSuspensions(): void;
  // FIX-2625.
  /**
   * A task board read through its task collection, whose ledger is at
   * accessor `covers` and lives at `scope`. Every board hears its insert
   * notices on its scope topic narrowed to `board` (a row filed from a
   * session no answer named). Beyond that:
   *
   * - **session or user ledger:** heard on `sessionIds`' topics narrowed to
   *   `board` (the filers', which name the task that changed), in place of
   *   the ledger's resource read. No session: nothing is recorded, and the
   *   ledger's read stays heard. A session ledger whose storage (`reach`) is
   *   lineage-shared is also heard on the owner's user topic narrowed to
   *   `board`, where another lineage member's filing publishes, as a
   *   lineage-shared resource read is.
   * - **org ledger:** no session is heard. A filer is another member's
   *   session, which no client payload names; the ledger's own notices on
   *   the org topic carry a change to a row, so its read stays heard.
   *
   * A partitioned ledger's read names its `partition`: each
   * hearing it records lists it, so a board notice naming another partition
   * wakes no watcher. With none, the board was read whole and hears them all.
   */
  board(
    board: string,
    scope: "session" | "user" | "org",
    sessionIds: readonly string[],
    covers: string,
    reach: StorageReach,
    partition?: string
  ): void;
};

/**
 * The dependency surface over one run's recorder, for the running session
 * `sessionId`. `sharesLineage` says whether a session reach touches any
 * lineage-shared storage (`reachHasFlag` over the session buckets).
 */
export function createViewDependencies(
  record: (read: RecordedRead) => void,
  sessionId: string,
  sharesLineage: (reach: StorageReach) => boolean
): ViewDependencies {
  return {
    state(scope) {
      record(scope === "session" ? { scope, sessionId, what: "state" } : { scope, what: "state" });
    },
    resource(scope, name, reach) {
      // A collection's root is its prefix with no trailing slash, as a notice names it.
      const what = { resource: name, root: "key" in reach ? reach.key : reach.prefix.replace(/\/+$/, "") };
      record(scope === "session" ? { scope, sessionId, what } : { scope, what });
      if (scope === "session" && sharesLineage(reach)) record({ scope: "user", what });
    },
    session(id) {
      record({ scope: "session", sessionId: id, what: "session" });
    },
    sessionIdentity(id) {
      record({ scope: "session", sessionId: id, what: "identity" });
    },
    sessionState(id) {
      record({ scope: "session", sessionId: id, what: "state" });
    },
    sessionTurns(id) {
      record({ scope: "session", sessionId: id, what: "turns" });
    },
    sessionList() {
      record({ scope: "user", what: "sessions" });
    },
    userSuspensions() {
      record({ scope: "user", what: "suspensions" });
    },
    board(board, scope, sessionIds, covers, reach, partition) {
      const at = partition !== undefined ? { partition } : {};
      if (scope === "org") {
        record({ scope: "org", what: { board, ...at } });
        return;
      }
      if (sessionIds.length === 0) return;
      for (const id of new Set(sessionIds)) record({ scope: "session", sessionId: id, what: { board, covers, ...at } });
      // A session ledger's scope topic is the running session's, which `sessionIds` names first.
      if (scope === "user" || sharesLineage(reach)) record({ scope: "user", what: { board, covers, ...at } });
    }
  };
}

/** A view tried to call a model (D2). An action computes the answer once and stores it; the view reads it. */
export class ViewModelCallError extends Error {
  constructor(readonly blockName?: string) {
    super(
      `A view can't call a model${blockName !== undefined ? ` (block "${blockName}")` : ""}: it runs for every ` +
        "watcher on every change. Compute the answer in an action, store it, and read it in the view."
    );
    this.name = "ViewModelCallError";
  }
}

/**
 * A view tried a read the engine can't record: no topic covers what it reads,
 * so its watchers would never hear a change to it.
 */
export class UnrecordedReadError extends Error {
  constructor(what: string) {
    super(`A view can't ${what}: no change topic covers it, so the view's watchers would never hear it change.`);
    this.name = "UnrecordedReadError";
  }
}

// FIX-2725 D1.
/**
 * What a view's session reads record, read by read: the request host's
 * `sessions` verbs call it where they answer a session (`request-sessions.ts`),
 * so a session the owner rule or the view's admission refuses never has its
 * topic named. A `read`, `turns` or `history` that leaves an asked-for session
 * unanswered (a `turns` batch member included) records the caller's list.
 */
export type SessionReadObserver = {
  /** `read` answered the session: its flow and lineage. */
  identity(sessionId: string): void;
  /** The state of a session `read` answered was read. */
  state(sessionId: string): void;
  /** `history` answered the session. */
  history(sessionId: string): void;
  /** `turns` answered the session. */
  turns(sessionId: string): void;
  /** `list` ran, or a one-session verb answered nothing: the caller's sessions, as a whole. */
  list(): void;
  /** `userSuspensions` ran: the caller's pending suspensions, as a whole. */
  suspensions(): void;
};

/** The observer a view run's session reads record through: the dependency surface's rules, never the raw recorder. */
export function sessionReadObserver(dependencies: ViewDependencies): SessionReadObserver {
  return {
    identity: (id) => dependencies.sessionIdentity(id),
    state: (id) => dependencies.sessionState(id),
    history: (id) => dependencies.session(id),
    turns: (id) => dependencies.sessionTurns(id),
    list: () => dependencies.sessionList(),
    suspensions: () => dependencies.userSuspensions()
  };
}

/**
 * Make a view's request host refuse what it can't record. A session or user
 * view reads the caller's sessions, recorded where each read answers
 * ({@link SessionReadObserver}); an org view reads no session, so each
 * session verb refuses. Liveness reads the active-request registry, which no
 * topic covers, so it refuses, whether or not the host offered it.
 * The other verbs read nothing outside the run (`parentTask` has no task in a
 * view) or write, and writes already refuse.
 */
export function guardViewRequestHost(host: RequestHost, scope: "session" | "user" | "org"): void {
  const mutable = host as { -readonly [K in keyof RequestHost]: RequestHost[K] };
  if (host.sessions !== undefined && scope === "org") {
    const refuse = (what: string) => async (): Promise<never> => {
      throw new NoSessionError(what);
    };
    mutable.sessions = {
      read: refuse("read a session"),
      history: refuse("read a session's history"),
      list: refuse("list sessions"),
      turns: refuse("read a session's turns"),
      userSuspensions: refuse("read pending suspensions")
    };
  }
  mutable.livenessOf = async () => {
    throw new UnrecordedReadError("read requests' liveness");
  };
}

/** Record `record` on each read of a session handle's items, metadata, window and journal. */
export function recordSessionReads(handle: object, record: () => void): void {
  for (const prop of ["items", "metadata", "window"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(handle, prop);
    if (descriptor === undefined) continue;
    Object.defineProperty(handle, prop, {
      enumerable: descriptor.enumerable ?? true,
      configurable: true,
      get: () => {
        record();
        return descriptor.get !== undefined ? descriptor.get.call(handle) : descriptor.value;
      }
    });
  }
  const getJournal = (handle as { getJournal?: (...args: unknown[]) => unknown }).getJournal;
  if (typeof getJournal === "function") {
    (handle as { getJournal: (...args: unknown[]) => unknown }).getJournal = (...args: unknown[]) => {
      record();
      return getJournal.apply(handle, args);
    };
  }
}

/** A model resolver whose every call refuses with {@link ViewModelCallError}. */
export function refusingModelResolver(): ModelResolver {
  const refuse = (_modelId?: string, blockName?: string): never => {
    throw new ViewModelCallError(blockName);
  };
  const resolver = ((modelId: string, blockName?: string) => refuse(modelId, blockName)) as unknown as ModelResolver;
  resolver.resolveId = (modelId: string) => refuse(modelId);
  resolver.resolveEvaluationModel = (modelId: string, blockName?: string) => refuse(modelId, blockName);
  return resolver;
}
