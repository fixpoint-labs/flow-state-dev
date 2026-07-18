/**
 * Type-level tests — verify generic propagation through the public API.
 * These don't run at the test level; vitest's typecheck mode covers them.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import type {
  Task,
  TaskCollectionRef,
  TaskWorker,
  TaskWorkerInput,
} from "../src/tasks";

// TaskCollectionRef<TInput, TOutput> infers payload types through.
declare const collection: TaskCollectionRef<{ q: string }, { a: number }>;

async function checkTaskTypes() {
  const created: Task<{ q: string }, { a: number }> = await collection.addTask({
    goal: "g",
    input: { q: "hello" },
  });
  const out: { a: number } | undefined = created.output;
  void out;

  const claimed = await collection.claim("w");
  if (claimed !== null) {
    // Claimed task carries narrowed input type.
    const q: string | undefined = claimed.input?.q;
    void q;
  }

  await collection.complete("id", { a: 1 });
}

void checkTaskTypes;

// BlockDefinition<TaskWorkerInput<TIn>, TOut> works as a worker registry value.
const myWorker = handler({
  name: "w",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: (input: TaskWorkerInput<{ q: string }>) => ({ a: input.input?.q.length ?? 0 }),
});

const _registry: Record<string, TaskWorker> = { w: myWorker };
void _registry;
