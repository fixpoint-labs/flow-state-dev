/**
 * The drain's tail check (FIX-963): if this run could not record a result it
 * had saved, the run fails — but only once every task has finished.
 *
 * ## Why it is here and not where the failure is found
 *
 * Loud and contained pull against each other. Raising inside a worker rejects
 * the `forEach` and abandons every task that had not started, which is the bug
 * FIX-951 shipped to fix; reporting without failing leaves the drain's result
 * saying the run was clean, which is the bug this issue is about. So the
 * recorders report and return, and the raise waits here, after the fan-out has
 * drained and after the board's completion entry has been written.
 *
 * `onError` is not consulted. It is a policy about a task going wrong, and the
 * board failing to record what it saved is not a task outcome.
 *
 * ## What it reads
 *
 * The reports themselves, off the request's item buffer — the same accessor
 * `TaskHandle.items()` reads through. Scoped by **this drain's run stamp
 * alone**: the buffer is per-request and a request can drain the same board
 * twice, so a second batch must not inherit the first one's failure. Collection
 * id is deliberately not a second filter — see `recorderFailuresForRun`, where
 * a board given a collection *factory* reports under the ref's own id while the
 * drain knows it only as `factory-supplied`.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import {
  recorderFailuresForRun,
  TaskBoardRecorderFailureError,
} from "./recorder-failure";

export interface RaiseRecorderFailuresOptions {
  name: string;
  /** This drain's stamp, read at tail time. */
  runId: (ctx: BlockContext) => string | undefined;
}

/**
 * Read the request's emitted items.
 *
 * Duck-typed against `ctx.response` for the same reason
 * `getOrCreateTaskCollection` is: a mock context wires no response, and an
 * absent buffer yields `[]` rather than throwing.
 */
function requestItems(ctx: BlockContext): readonly OutputItem[] {
  const response = ctx.response as
    | { getItems?: () => readonly OutputItem[] }
    | undefined;
  return response?.getItems?.() ?? [];
}

/**
 * Build the tail check. Composed as a `.tap()` after the board's completion
 * entry and before teardown, so the teardown `.rescue()` still runs when this
 * throws.
 */
export function createRaiseRecorderFailures(
  options: RaiseRecorderFailuresOptions
) {
  const { name, runId } = options;
  return handler({
    name: `${name}-raise-recorder-failures`,
    transient: true,
    inputSchema: z.unknown(),
    execute: async (_input: unknown, ctx) => {
      const run = runId(ctx);
      // The drain installs its run state as its first tap, so reaching the tail
      // without a stamp means this is not a drain run at all. There is nothing
      // to scope a read to, and reading unscoped would let one drain fail on
      // another's report.
      if (run === undefined) return;
      const reports = recorderFailuresForRun(requestItems(ctx), run);
      if (reports.length === 0) return;
      // Every one of them, not just the first: a run with two bookkeeping
      // failures must not read as a run with one.
      throw new TaskBoardRecorderFailureError(reports);
    },
  });
}
