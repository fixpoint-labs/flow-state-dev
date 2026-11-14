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
 * and its ledger's resource notices are not heard at all: every write to the
 * ledger publishes the board notice, which names the task.
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

// FIX-2625.
/** A task board read through its task collection: heard on its board notices, which cover its ledger's accessor. */
type BoardReadRecord = { board: string; covers: string };

/** One read a view's run made: a scope's state, one of its resources by accessor, or a task board. */
export type RecordedRead =
  | { scope: "session"; sessionId: string; what: "state" | ResourceRead | BoardReadRecord }
  | { scope: "user" | "org"; what: "state" | ResourceRead };

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
    read.what === "state" ? "state" : "board" in read.what ? `b:${read.what.board}:${read.what.covers}` : `r:${read.what.resource}`
  ].join("\u0000");

/** The kinds a state read hears: a session's every change but its resources and boards; a user's or org's state. */
const STATE_KINDS: Record<RecordedRead["scope"], readonly ChangeKind[]> = {
  session: ["items", "request", "run", "state"],
  user: ["state"],
  org: ["state"]
};

/** What one run hears under one topic, built up read by read. */
type Hearing = { topic: WireTopic; kinds: Set<ChangeKind>; paths: Set<string> };

/** Every read's hearing, merged per topic and sorted by topic, leaving out resource reads a board read covers. */
function hearingsOf(reads: Iterable<RecordedRead>): Hearing[] {
  const all = [...reads];
  const covered = new Set(all.flatMap((read) => (read.what !== "state" && "board" in read.what ? [read.what.covers] : [])));
  const byTopic = new Map<string, Hearing>();
  const at = (topic: WireTopic): Hearing => {
    const key = wireTopicKey(topic);
    let hearing = byTopic.get(key);
    if (hearing === undefined) byTopic.set(key, (hearing = { topic, kinds: new Set(), paths: new Set() }));
    return hearing;
  };
  for (const read of all) {
    const scopeTopic: WireTopic = read.scope === "session" ? { scope: "session", id: read.sessionId } : { scope: read.scope };
    if (read.what === "state") {
      for (const kind of STATE_KINDS[read.scope]) at(scopeTopic).kinds.add(kind);
    } else if ("board" in read.what) {
      at({ ...scopeTopic, resource: read.what.board }).kinds.add("board");
    } else if (!covered.has(read.what.resource)) {
      const hearing = at(scopeTopic);
      hearing.kinds.add("resource");
      hearing.paths.add(read.what.root);
    }
  }
  return [...byTopic.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, hearing]) => hearing);
}

/** The order a hearing lists its kinds in: as `ChangeKind` names them, so an unchanged set compares equal. */
const KIND_ORDER: readonly ChangeKind[] = ["items", "request", "run", "state", "resource", "board", "resync"];

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
        ...(hearing.kinds.has("resource") ? { paths: [...hearing.paths].sort() } : {})
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
 * - a board read through its task collection is heard on each session's
 *   topic narrowed to the board, and its ledger's resource read is not heard.
 *
 * `views-dependency-matrix.test.ts` runs every read path against every scope;
 * a new read path is a new row there and calls in here.
 */
export type ViewDependencies = {
  state(scope: "session" | "user" | "org"): void;
  /**
   * A resource read, by name, and the storage it can reach: one key, or every
   * key under a prefix. Whether any of that storage is lineage-shared is
   * worked out here, from storage ownership, never from the handle that read it.
   */
  resource(scope: "session" | "user" | "org", name: string, reach: StorageReach): void;
  session(sessionId: string): void;
  // FIX-2625.
  /**
   * A task board read through its task collection: heard on `sessionIds`'
   * topics narrowed to `board`, in place of the ledger at accessor `covers`.
   * No session: nothing is recorded, and the ledger's read stays heard.
   */
  board(board: string, sessionIds: readonly string[], covers: string): void;
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
      record({ scope: "session", sessionId: id, what: "state" });
    },
    board(board, sessionIds, covers) {
      for (const id of new Set(sessionIds)) record({ scope: "session", sessionId: id, what: { board, covers } });
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

/**
 * Make a view's request host record or refuse each read it offers. A session
 * read records the session it read; with no session, it refuses. Liveness
 * reads the active-request registry, which no topic covers, so it refuses,
 * whether or not the host offered it.
 * The other verbs read nothing outside the run (`parentTask` has no task in a
 * view) or write, and writes already refuse.
 */
export function guardViewRequestHost(host: RequestHost, dependencies: ViewDependencies, noSession: boolean): void {
  const mutable = host as { -readonly [K in keyof RequestHost]: RequestHost[K] };
  const sessions = host.sessions;
  if (sessions !== undefined) {
    mutable.sessions = noSession
      ? {
          read: async () => {
            throw new NoSessionError("read a session");
          },
          history: async () => {
            throw new NoSessionError("read a session's history");
          }
        }
      : {
          read: async (sessionId) => {
            dependencies.session(sessionId);
            return sessions.read(sessionId);
          },
          history: async (sessionId, query) => {
            dependencies.session(sessionId);
            return sessions.history(sessionId, query);
          }
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
