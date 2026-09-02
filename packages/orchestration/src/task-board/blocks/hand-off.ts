/**
 * The block that hands a claimed row off instead of running its worker.
 *
 * It substitutes for the worker in the drain's routing table, so the drain's
 * shape is untouched — claim, route, record. What changes is what the route
 * does: it puts a `task` message through the dispatch seam, addressed to the
 * seat's entry on the flow (`flow.tasks[seat]`), and returns while the child
 * session runs the worker.
 *
 * The block carries its address — `{ type: "task", target: seat, boardId }` —
 * so `defineFlow` verifies the flow declares `tasks: board.tasks` and the
 * board's roster shows the hand-off statically.
 *
 * ## How the task survives this request without being settled by it
 *
 * `recordSuccess` settles the claim held on the worker-body state, and returns
 * **without settling** when that slot is empty. So the hand-off is a state
 * write: this block clears `currentClaim`, and the recorder that runs next sees
 * nothing of its own to record. The row stays `in_progress`, owned by the child,
 * which re-mints the same ticket from it and settles it there.
 *
 * ## Why the clear runs BEFORE the dispatch, and hands the claim back on refusal
 *
 * The clear is a store write and can fail. Run *after* an accepted dispatch, a
 * failed clear leaves the old `currentClaim` on the state and throws — so the
 * body's `.rescue()` reaches `recordError`, which marks the task **failed**
 * while the child that owns it is running it. Releasing first means there is
 * **no fallible step left after acceptance**: past the seam accepting, this
 * block only stops a timer and returns. The two failure shapes are handled
 * explicitly:
 *
 * - **Refused** (`ok: false`) is definitive — every refusal is decided before
 *   anything is dispatched. The claim is put back and this block throws, so
 *   `recordError` fails the row against the claim that is still genuinely this
 *   request's.
 * - **Threw** is not definitive: `host.dispatch` starts the run and only then
 *   hands `finished` to the deployment's `onBackgroundWork` hook, so a throw
 *   from that hook is a throw with a child already running. The claim stays
 *   released and nothing is settled: the row keeps its lapsing lease and the
 *   next drain recovers it, bounded by the substrate's abandonment allowance.
 *
 * ## Why the lease renewal stops here
 *
 * The parent renews the lease to say "a live worker is on this row." After the
 * hand-off that is no longer true of *this* request — the child starts its own
 * renewal from its own async chain.
 */
import { handler } from "@flow-state-dev/core";
import { dispatchThroughSeam, markDispatcher } from "@flow-state-dev/core/types";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { currentLeaseRenewal } from "../../tasks/lease-renewal-scope";
import type { TaskWorkerInput } from "../../tasks";
import type { TaskSessionPolicy } from "../hand-off";
import { taskBoardWorkerBodyStateSchema } from "../schemas";
import type { TaskDispatchInput } from "../task-entry";
import { assertJsonSafe } from "./json-safe";

export interface HandOffOptions {
  /** Block-name prefix, so a refusal names the board it came from. */
  name: string;
  /** The declaring board's stable id — half of the durable address. */
  boardId: string;
  /** The seat this hand-off stands in for — the task entry's name. */
  seat: string;
  /** Which child session the seat's rows run in. */
  session: TaskSessionPolicy;
}

/** Length-prefix a field so field boundaries cannot migrate in a composed key. */
function framed(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * The child-session key for one row under the seat's policy.
 *
 * The presets frame the board id in, so two boards' `per-task` children stay
 * apart even when their task ids coincide. An explicit `key` is used verbatim —
 * sharing a child across seats, or across boards, is exactly what an author
 * writes one for.
 */
function sessionKeyFor(
  policy: TaskSessionPolicy,
  boardId: string,
  seat: string,
  task: TaskWorkerInput
): string {
  if (policy === "per-task") return `task|${framed(boardId)}|${framed(task.taskId)}`;
  if (policy === "per-worker") return `worker|${framed(boardId)}|${framed(seat)}`;
  const key = policy.key(task);
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(
      `[task-board] "${boardId}" seat "${seat}" computed an empty session key for task ` +
        `"${task.taskId}" (${JSON.stringify(key)}). The key names the child session; return a ` +
        `value that identifies the unit of work.`
    );
  }
  return key;
}

/**
 * Build the block that stands in for one handed-off worker on the drain.
 *
 * Its input is the packed `TaskWorkerInput` the drain already materialized —
 * the same value an inline worker would have received, which is what makes the
 * handed-off and inline paths agree on what the worker sees.
 */
export function createHandOff(options: HandOffOptions): BlockDefinition<any, any> {
  const { name, boardId, seat, session } = options;

  const block = handler({
    name,
    // Substrate-internal. The user-visible signal that background work started
    // is the child session itself, which the parent session can enumerate.
    transient: true,
    inputSchema: z.unknown(),
    sequencerStateSchema: taskBoardWorkerBodyStateSchema,
    execute: async (payload: TaskWorkerInput, ctx) => {
      const claim = ctx.sequencer!.state.currentClaim;
      if (claim === undefined) {
        // Unreachable through the drain, which mints the ticket in the tap
        // before any route runs. Named because reaching here would otherwise
        // dispatch a request with no row behind it.
        throw new Error(
          `[task-board] "${boardId}" cannot hand off seat "${seat}": no claim is on the ` +
            `worker body state. This block must run inside the board's drain, after the claim.`
        );
      }

      // The load-bearing validation. `packWorkerInput` folds in dependency
      // outputs and flow-policy `priorWork` AFTER the claim — both typed
      // `unknown` and authored by a different worker — so this is the likelier
      // source of a value that cannot cross a process boundary, and it fails
      // here, after ownership was acquired, rather than at admission.
      assertJsonSafe(payload, {
        label: `[task-board] "${boardId}" hand-off payload for task "${claim.taskId}"`,
      });

      // Take the round trip HERE, so both deployment modes send the same value:
      // an external dispatcher serializes the envelope, the in-process path
      // hands the child the very object graph this block is holding, and a
      // payload referencing one object from two places is observable either
      // way. Snapshotting also makes the value that was checked the value that
      // is sent.
      const snapshot = JSON.parse(JSON.stringify(payload)) as TaskWorkerInput;

      const envelope: TaskDispatchInput = {
        boardId,
        taskId: claim.taskId,
        // The claim's identity, carried so the child's gate can VERIFY it
        // against the row — not so it can trust it. Every field comes off the
        // ticket the board minted from the row it claimed.
        attempt: claim.attempt,
        createdAt: claim.createdAt,
        // Spread conditionally: the payload beside it has to clear a gate that
        // rejects a present key holding `undefined` by name.
        ...(claim.incarnationId !== undefined
          ? { incarnationId: claim.incarnationId }
          : {}),
        payload: snapshot,
      };

      const key = sessionKeyFor(session, boardId, seat, snapshot);

      // Release BEFORE the point of no return — see the file header.
      await ctx.sequencer!.patchState({ currentClaim: undefined });

      const outcome = await dispatchThroughSeam(ctx, {
        type: "task",
        target: seat,
        session: { key },
        payload: envelope,
        from: name,
        // Stamped onto the dispatched REQUEST record, so a run can be correlated
        // back to the row it came from without opening this board's ledger.
        // Same source as every other field here: the claim ticket the board
        // minted from the row it had already claimed.
        provenance: { taskId: claim.taskId },
      });

      if (!outcome.ok) {
        // A refusal is decided before anything is dispatched, so the claim is
        // still this request's to fail. Hand it back, then throw: `recordError`
        // fails the row against it, which is the honest outcome for work that
        // was claimed and could not be started.
        await ctx.sequencer!.patchState({ currentClaim: claim });
        throw new Error(
          `[task-board] "${boardId}" could not hand off task "${claim.taskId}" to seat ` +
            `"${seat}": ${outcome.refused} — ${outcome.detail}`
        );
      }

      // Past this point the child owns the row, and nothing fallible remains:
      // stop asserting a lease this request no longer holds, and return.
      //
      // KNOWN GAP, scoped to deferred-start deployments: with an external
      // dispatcher or under flow-level `queue` concurrency the start is
      // deferred past this call by design, so between here and the child's gate
      // nobody holds the lease. If that delay exceeds the lease TTL another
      // drain reclaims the row and the child then fails its gate as stale —
      // bounded and safe per occurrence, but starvable under sustained backlog.
      currentLeaseRenewal()?.stop();

      return {
        handedOff: true as const,
        taskId: claim.taskId,
        sessionId: outcome.sessionId,
        requestId: outcome.requestId,
        /** True when the child session already existed. */
        adopted: outcome.adopted,
      };
    },
  });

  return markDispatcher(block, { type: "task", target: seat, boardId });
}
