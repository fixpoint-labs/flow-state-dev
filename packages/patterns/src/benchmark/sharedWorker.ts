/**
 * Shared default worker for benchmark subjects.
 *
 * The benchmark's fidelity guarantee is that the ONLY variable across pattern
 * subjects is the coordination shape — every pattern runs the same underlying
 * worker generator, same model, same prompt. This module is that worker.
 *
 * Adapters pass `sharedDefaultWorker(name, model)` wherever a pattern requires
 * a caller-supplied worker block (supervisor, parallelTasks, routedSpecialists
 * specialists). Patterns that build their own internal agents from a `model`
 * (round-robin, debate, plan-and-execute defaults) don't use this directly —
 * they receive the same model id instead, so the executor is equivalent.
 */
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

/**
 * Build the shared benchmark worker: a single-shot generator that takes a task
 * and returns a plain-string answer.
 *
 * Input is intentionally permissive (`z.any()`) because different patterns hand
 * workers different shapes — supervisor/parallelTasks pass the substrate
 * `TaskWorkerInput` (`{ taskId, goal, ... }`); routedSpecialists pass whatever
 * the controller threads. `user()` normalises: a bare string is the task; an
 * object's `goal` field is the task; anything else is JSON-serialised.
 */
export function sharedDefaultWorker(name: string, model: string) {
  return generator({
    name,
    model,
    inputSchema: z.any(),
    outputSchema: z.string(),
    prompt:
      "You are a capable problem-solver. Complete the assigned task accurately and completely.",
    user: (input: unknown) =>
      typeof input === "string"
        ? input
        : ((input as { goal?: string } | null)?.goal ?? JSON.stringify(input)),
  });
}
