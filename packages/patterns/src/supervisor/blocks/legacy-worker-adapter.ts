/**
 * `legacyWorkerAdapter` — backward-compat shim for pre-migration
 * supervisor workers.
 *
 * Discriminator: a worker is "legacy" iff its declared `inputSchema`
 * is the exported `executableTaskSchema` (matched by reference
 * equality). Workers without `inputSchema` (or with any other schema)
 * pass through unchanged — they receive the substrate's
 * `TaskWorkerInput` directly.
 *
 * The adapter uses `connectInput` to translate
 * `TaskWorkerInput → ExecutableTask` at runtime so the underlying
 * worker keeps its legacy contract.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { TaskWorkerInput } from "@flow-state-dev/orchestration";
import { executableTaskSchema, type ExecutableTask } from "../schemas";

/**
 * Wrap a pre-migration worker so it accepts the substrate's
 * `TaskWorkerInput`. Detection is by `inputSchema` reference equality
 * against the exported `executableTaskSchema`.
 */
export function legacyWorkerAdapter(
  worker: BlockDefinition<any, any>,
) {
  if (worker.inputSchema !== executableTaskSchema) return worker;
  return worker.connectInput<TaskWorkerInput>(
    (twi: TaskWorkerInput): ExecutableTask => {
      // FIX-827: read the first-class `context` field; fall back to the
      // legacy `input`-as-context hack transitionally so this doesn't
      // regress callers mid-migration.
      const context =
        twi.context ?? (typeof twi.input === "string" ? twi.input : undefined);
      return {
        id: twi.taskId,
        goal: twi.goal,
        ...(context !== undefined ? { context } : {}),
        ...(twi.feedback !== undefined ? { feedback: twi.feedback } : {}),
      };
    },
  );
}
