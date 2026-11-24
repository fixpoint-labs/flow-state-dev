// FIX-2630.
/**
 * Internal events' declared topics, and the names they travel under: the
 * provider key `internal`, thread keys `internal:<topic>`. A leaf module: the
 * service flow, its provider and the publish verb read them.
 */
import type { z } from "zod";

/** The provider key internal events carry, and their thread keys' prefix (`internal:<topic>`). */
export const INTERNAL_PROVIDER = "internal";

/** The flow kind the internal service flow takes unless told otherwise. */
export const INTERNAL_SERVICE_FLOW = "internal-service";

/** An internal event's thread key: `internal:<topic>`. */
export const internalThreadKey = (topic: string) => `${INTERNAL_PROVIDER}:${topic}`;

/** One declared topic: the kinds of event on it, the schema its `data` is checked by, and what it is for. */
export interface InternalTopic {
  /** The kinds an event on the topic may be; a subscription may hear some of them. */
  readonly kinds: readonly string[];
  /** The schema an event's `data` must pass. Absent, the topic takes no data. */
  readonly data?: z.ZodTypeAny;
  /** What the topic announces, in a few words: the publish tool lists it. */
  readonly description?: string;
}

/** The app's declared topics, by name (`deploy.finished`). */
export type InternalTopics = Readonly<Record<string, InternalTopic>>;

/** The topic a thread key names, when it is an internal one. */
export const topicOf = (thread: string): string | undefined =>
  thread.startsWith(`${INTERNAL_PROVIDER}:`) ? thread.slice(INTERNAL_PROVIDER.length + 1) : undefined;

/** The declared topics, as a refusal lists them. */
const declaredTopicsLine = (topics: InternalTopics) => Object.keys(topics).join(", ") || "none";

/** Why `topic` and `kinds` aren't declared, naming what is, or `undefined` when they are. `as` says what the caller does with a topic. */
export function undeclared(topics: InternalTopics, topic: string, kinds: readonly string[] | undefined, as: "publish" | "follow"): string | undefined {
  const declared = Object.hasOwn(topics, topic) ? topics[topic] : undefined;
  if (declared === undefined) return `no_topic: "${topic}" isn't a declared topic. You can ${as}: ${declaredTopicsLine(topics)}.`;
  const unknown = (kinds ?? []).find((kind) => !declared.kinds.includes(kind));
  if (unknown !== undefined) return `not_declared: "${unknown}" isn't a kind of "${topic}". Its kinds: ${declared.kinds.join(", ")}.`;
  return undefined;
}
