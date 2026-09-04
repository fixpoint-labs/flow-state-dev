/**
 * The block that hands a claimed row off instead of running a worker.
 *
 * A board seat holding a `dispatcher({ type: "task" })` declares that its rows
 * run elsewhere. This block is what the drain installs at that seat: it takes
 * the dispatcher's address as declared — the entry it names and the session
 * policy — and adds the bookkeeping only the drain can do, because only the
 * drain holds the claim: mint the envelope from the ticket, release the claim
 * before the point of no return, put the dispatch through the seam, hand the
 * claim back on refusal. The drain's shape is untouched — claim, route,
 * record. What changes is what the route does.
 *
 * The block carries the seat's address, so `defineFlow` verifies the flow
 * declares `task: { actions: { [target]: { block } } }` and the board's roster shows the
 * hand-off statically; and it carries the board's **binding** — its id and the
 * claim gate — which `defineFlow` uses to put that entry behind the gate.
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
import {
  bindTaskDispatcher,
  dispatchThroughSeam,
  markDispatcher,
  taskSessionKeyFor,
} from "@flow-state-dev/core/types";
import type { BlockDefinition, TaskBinding, TaskDispatchInput } from "@flow-state-dev/core/types";
import { z } from "zod";
import { currentLeaseRenewal } from "../../tasks/lease-renewal-scope";
import type { TaskWorkerInput } from "../../tasks";
import type { TaskSeatAddress } from "../hand-off";
import { taskBoardWorkerBodyStateSchema } from "../schemas";
import { assertJsonSafe } from "./json-safe";

export interface HandOffOptions {
  /** Block-name prefix, so a refusal names the board it came from. */
  name: string;
  /** The declaring board's stable id — half of the durable address. */
  boardId: string;
  /** The seat this hand-off stands in for — the row's assignee. */
  seat: string;
  /** The seat's dispatcher address: the entry it hands off to and the session policy. */
  address: TaskSeatAddress;
  /** The board's claim gate, bound onto this block for `defineFlow` to apply to the entry. */
  binding: TaskBinding;
}

/**
 * Build the block the drain installs at one dispatcher seat.
 *
 * Its input is the packed `TaskWorkerInput` the drain already materialized —
 * the same value an inline worker would have received, which is what makes the
 * handed-off and inline paths agree on what the worker sees.
 */
export function createHandOff(options: HandOffOptions): BlockDefinition<any, any> {
  const { name, boardId, seat, address, binding } = options;

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
        seat,
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

      const key = taskSessionKeyFor(name, address.session, envelope, ctx);

      // Release BEFORE the point of no return — see the file header.
      await ctx.sequencer!.patchState({ currentClaim: undefined });

      const outcome = await dispatchThroughSeam(ctx, {
        type: "task",
        target: address.target,
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
          `[task-board] "${boardId}" could not hand off task "${claim.taskId}" from seat ` +
            `"${seat}" to task entry "${address.target}": ${outcome.refused} — ${outcome.detail}`
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

  // A fresh address object: the binding is keyed by it, so the seat's own
  // dispatcher stays unbound — reached outside this board it is refused as
  // held by no board, which is what it would be.
  markDispatcher(block, { ...address });
  bindTaskDispatcher(block, binding);
  return block;
}
