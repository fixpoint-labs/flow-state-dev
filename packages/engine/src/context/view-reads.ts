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
