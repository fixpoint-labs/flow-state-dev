/**
 * The block that spawns a detached worker instead of running it (FIX-982 P3a).
 *
 * This is the tracer bullet: the point where a claimed task stops being work the
 * current request performs and becomes work a Workstream performs while this
 * request returns.
 *
 * It substitutes for the worker in the drain's routing table, so the drain's
 * shape is untouched — claim, route, record. What changes is what the route
 * does.
 *
 * ## How the task survives this request without being settled by it
 *
 * `recordSuccess` settles the claim held on the worker-body state, and returns
 * **without settling** when that slot is empty. So the hand-off is a state
 * write: this block clears `currentClaim` once the dispatch is accepted, and the
 * recorder that runs next sees nothing of its own to record. The row stays
 * `in_progress`, owned by the Workstream, which re-mints the same ticket from it
 * and settles it there.
 *
 * The clear is deliberately **last**. If the spawn throws, the claim is still on
 * the state, the worker body's `.rescue()` reaches `recordError`, and the task
 * fails against the claim that is still genuinely this request's — which is the
 * correct outcome for work that was never handed off. Clearing first would leave
 * a claimed row with nobody holding it and nobody able to fail it.
 *
 * ## Why the lease renewal stops here
 *
 * The parent renews the lease to say "a live worker is on this row." After the
 * hand-off that is no longer true of *this* request — the Workstream starts its
 * own renewal from its own async chain. Leaving the parent's driver running
 * would keep renewing until the parent request ends, which is harmless while it
 * lasts and misleading if the spawn was accepted but the child never started.
 */
import { handler } from "@flow-state-dev/core";
import { requireRequestHost } from "@flow-state-dev/core/types";
import type { WorkstreamDispatchInput } from "@flow-state-dev/core";
import { z } from "zod";
import { currentLeaseRenewal } from "../../tasks/lease-renewal-scope";
import type { TaskWorkerInput } from "../../tasks";
import { coordinateKey, workstreamRoutingSeed, type WorkerCoordinate } from "../coordinate";
import { taskBoardWorkerBodyStateSchema } from "../schemas";
import { assertJsonSafe } from "./json-safe";

export interface SpawnDetachedOptions {
  /** Block-name prefix, so a refusal names the board it came from. */
  name: string;
  /** The declaring board's stable id — half of the routing address. */
  boardId: string;
  /** Which worker on that board this spawn stands in for. */
  coordinate: WorkerCoordinate;
}

/**
 * Build the block that stands in for one detached worker on the drain.
 *
 * Its input is the packed `TaskWorkerInput` the drain already materialized —
 * the same value an inline worker would have received, which is what makes the
 * detached and inline paths agree on what the worker sees.
 */
export function createSpawnDetached(options: SpawnDetachedOptions) {
  const { name, boardId, coordinate } = options;
  const coordKey = coordinateKey(coordinate);

  return handler({
    name,
    // Substrate-internal. The user-visible signal that background work started
    // is the Workstream itself, which the parent session can enumerate.
    transient: true,
    inputSchema: z.unknown(),
    sequencerStateSchema: taskBoardWorkerBodyStateSchema,
    execute: async (payload: TaskWorkerInput, ctx) => {
      const claim = ctx.sequencer!.state.currentClaim;
      if (claim === undefined) {
        // Unreachable through the drain, which mints the ticket in the tap
        // before any route runs. Named because reaching here would otherwise
        // spawn a request with no row behind it — background work nothing can
        // settle, cancel or attribute.
        throw new Error(
          `[task-board] "${boardId}" cannot spawn detached work for ${coordKey}: no claim is on ` +
            `the worker body state. This block must run inside the board's drain, after the claim.`
        );
      }

      // The load-bearing validation (§7.5). `packWorkerInput` folds in
      // dependency outputs and flow-policy `priorWork` AFTER the claim — both
      // typed `unknown` and authored by a different worker — so this is the
      // likelier source of a value that cannot cross a process boundary, and it
      // fails here, after ownership was acquired, rather than at admission.
      //
      // A `JSON.parse(JSON.stringify(v))` round-trip is NOT this check: it
      // throws only on BigInt and cycles, while a Date silently becomes a
      // string, a Map or class instance becomes `{}`, and a function vanishes.
      assertJsonSafe(payload, {
        label: `[task-board] "${boardId}" detached payload for task "${claim.taskId}"`,
      });

      const seed = workstreamRoutingSeed({
        boardId,
        coordinate,
        // A task's topic is what makes two tasks share one Workstream — the
        // second task on the same topic lands in the same child and continues
        // its history. Absent or blank falls back to the task id, so continuity
        // is opted into rather than accidental.
        ...(typeof payload.metadata?.topic === "string"
          ? { topic: payload.metadata.topic }
          : {}),
        topicFallback: claim.taskId,
      });

      const dispatch: WorkstreamDispatchInput = {
        boardId,
        coordinateKey: coordKey,
        taskId: claim.taskId,
        // The claim's identity, carried so the Workstream's start gate can
        // VERIFY it against the row — not so it can trust it. Both fields come
        // off the ticket the board minted from the row it claimed, never off
        // anything a caller supplied.
        attempt: claim.attempt,
        createdAt: claim.createdAt,
        payload,
      };

      const result = await requireRequestHost(ctx).startDetached({
        seed,
        input: dispatch,
      });

      if (!result.ok) {
        // Throwing hands the row to `recordError`, which fails it against the
        // claim still on the state. That is the honest outcome: the work was
        // claimed and could not be started, so the row must not sit
        // `in_progress` waiting for a Workstream that was never created.
        throw new Error(
          `[task-board] "${boardId}" could not start detached work for task "${claim.taskId}" ` +
            `(${coordKey}): ${result.refused} — ${result.detail}`
        );
      }

      // Past this point the Workstream owns the row. Stop asserting a lease this
      // request no longer holds, then release the claim so `recordSuccess`
      // settles nothing. Order matters only in that both follow a successful
      // dispatch — see the file header on why the clear is last.
      //
      // KNOWN GAP (FIX-1070): acceptance is not a start. With an external
      // dispatcher it means enqueued, and under flow-level `queue` concurrency
      // it means deferred behind a key — so between here and the child's start
      // gate nobody holds the lease. If that delay exceeds the lease TTL another
      // drain reclaims the row, and this child then fails its gate as stale.
      // Bounded and safe per occurrence (the gate is what rejects it), but under
      // sustained backlog it can starve. The parent cannot simply keep renewing:
      // its request returns immediately, so the driver would leak. Closing it
      // means modelling "claimed but not yet started", which is the lease's
      // shape to change, not the spawn's.
      currentLeaseRenewal()?.stop();
      await ctx.sequencer!.patchState({ currentClaim: undefined });

      return {
        detached: true as const,
        taskId: claim.taskId,
        sessionId: result.sessionId,
        requestId: result.requestId,
        /** True when the Workstream already existed — a second task on one topic. */
        adopted: result.adopted,
      };
    },
  });
}
