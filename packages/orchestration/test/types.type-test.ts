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
import { taskBoard, createTaskBoardCapability } from "../src/task-board";

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

// ---------------------------------------------------------------------------
// Task board capability accessor propagates the board's TInput/TOutput
// (FIX-908 §4.3): a mismatched addTask payload must be a compile error, both
// through `taskBoard()` and through a direct `createTaskBoardCapability` call.
// ---------------------------------------------------------------------------

async function checkBoardAccessorTypes() {
  const board = taskBoard<{ q: string }, { a: number }>({
    name: "typed",
    workers: myWorker as TaskWorker,
  });

  // The handle's capability carries the accessor generics.
  const accessor = board.capability.fns!(undefined as never);

  // Correct payload — no error.
  const created: Task<{ q: string }, { a: number }> = await accessor.addTask({
    goal: "g",
    input: { q: "hello" },
  });
  const out: { a: number } | undefined = created.output;
  void out;

  // Reads return the narrowed task type.
  const listed = await accessor.listTasks();
  const q: string | undefined = listed[0]?.input?.q;
  void q;

  // @ts-expect-error — input payload shape mismatch is rejected, not erased to unknown.
  await accessor.addTask({ goal: "g", input: { q: 123 } });

  // Same guarantee through a direct createTaskBoardCapability call.
  const directCap = createTaskBoardCapability<{ q: string }, { a: number }>({
    backing: "request",
    boardName: "direct",
    collectionId: "direct",
  });
  const direct = directCap.fns!(undefined as never);
  // @ts-expect-error — mismatched payload rejected on the direct accessor too.
  await direct.addTask({ goal: "g", input: { q: 123 } });
}

void checkBoardAccessorTypes;
