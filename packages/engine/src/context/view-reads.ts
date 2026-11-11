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
 * on today, so no topic is added. Narrowing to the rows that changed is a
 * later step.
 */
import type { WireTopic } from "@flow-state-dev/core";
import { wireTopicKey } from "@flow-state-dev/core/internal";
import type { ModelResolver } from "@flow-state-dev/core/types";
import type { RequestHost } from "@flow-state-dev/core/internal";
import { NoSessionError } from "./no-session";

/** One read a view's run made: a scope's state, or one of its resources by accessor. */
export type RecordedRead =
  | { scope: "session"; sessionId: string; what: "state" | { resource: string } }
  | { scope: "user" | "org"; what: "state" | { resource: string } };

/** A recorder for one run: what it read, and the topics that hear a change to it. */
export type ReadRecorder = {
  record(read: RecordedRead): void;
  /** Every distinct read, in the order first made. */
  reads(): readonly RecordedRead[];
  /** The topics the reads fall under: deduped and sorted, so an unchanged set compares equal. */
  topics(): WireTopic[];
};

const readKey = (read: RecordedRead): string =>
  [read.scope, read.scope === "session" ? read.sessionId : "", read.what === "state" ? "state" : `r:${read.what.resource}`].join("\u0000");

/** A fresh recorder for one view run. */
export function createReadRecorder(): ReadRecorder {
  const seen = new Map<string, RecordedRead>();
  return {
    record(read) {
      const key = readKey(read);
      if (!seen.has(key)) seen.set(key, read);
    },
    reads: () => [...seen.values()],
    topics() {
      const topics = new Map<string, WireTopic>();
      for (const read of seen.values()) {
        const topic: WireTopic = read.scope === "session" ? { scope: "session", id: read.sessionId } : { scope: read.scope };
        topics.set(wireTopicKey(topic), topic);
      }
      return [...topics.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, topic]) => topic);
    }
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
 *   the org's);
 * - a lineage-shared session resource is also heard on the owner's user
 *   topic, where a write from another lineage member publishes;
 * - another session's read is heard on that session's topic.
 *
 * `views-dependency-matrix.test.ts` runs every read path against every scope;
 * a new read path is a new row there and calls in here.
 */
export type ViewDependencies = {
  state(scope: "session" | "user" | "org"): void;
  resource(scope: "session" | "user" | "org", name: string, options?: { lineageShared?: boolean }): void;
  session(sessionId: string): void;
};

/** The dependency surface over one run's recorder, for the running session `sessionId`. */
export function createViewDependencies(record: (read: RecordedRead) => void, sessionId: string): ViewDependencies {
  return {
    state(scope) {
      record(scope === "session" ? { scope, sessionId, what: "state" } : { scope, what: "state" });
    },
    resource(scope, name, options) {
      record(scope === "session" ? { scope, sessionId, what: { resource: name } } : { scope, what: { resource: name } });
      if (scope === "session" && options?.lineageShared === true) record({ scope: "user", what: { resource: name } });
    },
    session(id) {
      record({ scope: "session", sessionId: id, what: "state" });
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
