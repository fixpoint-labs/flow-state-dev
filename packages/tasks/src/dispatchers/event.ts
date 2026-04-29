/**
 * `eventDispatcher({ topicFor, topic })` — picks the first `pending`
 * task whose `topicFor(task)` matches the published event topic.
 *
 * Topic comparison goes through the user-supplied `topicFor` extractor
 * so tasks can store the topic anywhere in metadata they like (e.g.,
 * `metadata.topic`, `metadata.event.kind`). The dispatcher itself is
 * stateless; the published event identity is read from runtime context
 * (caller injects it via the closure on the factory).
 */
import type { Task } from "../schema/task";
import { isReady } from "../collection/internal";
import type { TaskDispatcher } from "./types";

export interface EventDispatcherOptions {
  /** Extract the topic this task waits on. Return `undefined` if the task is not event-driven. */
  topicFor: (task: Task) => string | undefined;
  /**
   * The event currently being processed. Tasks whose `topicFor` matches
   * this value are eligible for claim. Pass a callback for dispatchers
   * that need to read the topic at claim time (most common — flows
   * dispatch one event per invocation).
   */
  topic: string | (() => string | undefined);
}

function resolveTopic(value: EventDispatcherOptions["topic"]): string | undefined {
  return typeof value === "function" ? value() : value;
}

export function eventDispatcher(options: EventDispatcherOptions): TaskDispatcher {
  return {
    async claim(collection, workerId) {
      const topic = resolveTopic(options.topic);
      if (topic === undefined) return null;
      const lookup = (id: string) => collection.get(id);

      return collection.claim(workerId, {
        eligibility: (task) =>
          isReady(task, lookup) && options.topicFor(task) === topic,
      });
    },
  };
}
