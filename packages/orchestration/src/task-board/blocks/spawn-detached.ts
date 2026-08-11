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
 * write: this block clears `currentClaim`, and the recorder that runs next sees
 * nothing of its own to record. The row stays `in_progress`, owned by the
 * Workstream, which re-mints the same ticket from it and settles it there.
 *
 * ## Why the clear runs BEFORE the dispatch, and hands the claim back on refusal
 *
 * The clear is a store write and can fail. Run *after* an accepted dispatch, a
 * failed clear leaves the old `currentClaim` on the state and throws — so the
 * body's `.rescue()` reaches `recordError`, which marks the task **failed**
 * while the Workstream that owns it is running it. The row then reads terminal
 * to everyone, the child's settlement is declined at the fence, and the work is
 * lost with nothing reporting it.
 *
 * A failed spawn and a failed post-hand-off write are opposite situations, and
 * ordering is what separates them. Releasing first means there is **no fallible
 * step left after acceptance**: past `startDetached` returning ok this block
 * only stops a timer and returns. And releasing first costs nothing while the
 * spawn can still fail, because the two failure shapes are handled explicitly:
 *
 * - **Refused** (`ok: false`) is definitive — every refusal is decided before
 *   anything is dispatched. The claim is put back and this block throws, so
 *   `recordError` fails the row against the claim that is still genuinely this
 *   request's, exactly as before.
 * - **Threw** is not definitive, and not merely as a precaution: `host.dispatch`
 *   starts the run and only then hands `finished` to the deployment's
 *   `onBackgroundWork` hook, so a throw from that hook is a throw with a child
 *   already running. Nothing here can tell that apart from a store read that
 *   failed before anything was dispatched, so the claim stays released and
 *   nothing is settled: the row keeps its lapsing lease and the next drain
 *   recovers it, bounded by the substrate's abandonment allowance. Deferring
 *   recovery by one lease is the cheap direction; failing a row a live child is
 *   working is not.
 *
 *   A child that dies during its own setup now lands here too, and that is the
 *   point: `startDetached` resolves only once the child has entered execution,
 *   so a setup failure is a throw the parent request carries rather than a
 *   success it reports. Recovery is the same one lease either way; what changed
 *   is that the failure is visible when it happens.
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
        // Topic is one of three things that have to agree before two tasks share
        // a Workstream: same board, same worker coordinate, same topic. The seed
        // carries all three (`workstreamRoutingSeed` frames `boardId` and the
        // coordinate into its `key`), and the runtime hashes them with the
        // parent session and principal. So a topic shared across two workers, or
        // across two boards, lands in two different children — the second task
        // continues the first's history only when the whole address matches.
        // Absent or blank falls back to the task id, so continuity is opted into
        // rather than accidental.
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
        // VERIFY it against the row — not so it can trust it. Every field comes
        // off the ticket the board minted from the row it claimed, never off
        // anything a caller supplied.
        attempt: claim.attempt,
        createdAt: claim.createdAt,
        // Spread conditionally, because the payload beside it has to clear a
        // gate that rejects a present key holding `undefined` by name. Absent
        // means the claimed row carried no nonce, which the start gate reads as
        // "cannot tell" rather than as a mismatch.
        ...(claim.incarnationId !== undefined
          ? { incarnationId: claim.incarnationId }
          : {}),
        payload,
      };

      // Release BEFORE the point of no return — see the file header. A failure
      // here is a failure to hand off: nothing has been dispatched, the claim is
      // untouched, and the throw reaches `recordError` with it still in place.
      await ctx.sequencer!.patchState({ currentClaim: undefined });

      const result = await requireRequestHost(ctx).startDetached({
        seed,
        input: dispatch,
        // Stamped onto the detached REQUEST record, so a run can be correlated
        // back to the row it came from without opening this board's ledger. The
        // dispatch input above carries the same id, but that is the runner's
        // private envelope — nothing projects it onto a read route.
        //
        // Same source as every other field here: the claim ticket the board
        // minted from the row it had already claimed, never anything a task
        // author or a transport supplied. It labels and decides nothing — the
        // runner's start gate still verifies the claim off `dispatch` against
        // the row it re-reads (see `StartDetachedInput.provenance`).
        provenance: { taskId: claim.taskId },
      });

      if (!result.ok) {
        // A refusal is decided before anything is dispatched, so the claim is
        // still this request's to fail. Hand it back, then throw: `recordError`
        // fails the row against it, which is the honest outcome for work that
        // was claimed and could not be started. Restoring can itself fail, and
        // that lands in the not-definitive case below by construction — the
        // claim is not on the state, so nothing is settled and the row is
        // recovered.
        await ctx.sequencer!.patchState({ currentClaim: claim });
        throw new Error(
          `[task-board] "${boardId}" could not start detached work for task "${claim.taskId}" ` +
            `(${coordKey}): ${result.refused} — ${result.detail}`
        );
      }

      // Past this point the Workstream owns the row, and nothing fallible
      // remains: stop asserting a lease this request no longer holds, and
      // return.
      //
      // KNOWN GAP (FIX-1070), now scoped to the deferred-start deployments. On
      // the default in-process path `startDetached` resolves only once the child
      // has ENTERED EXECUTION, so the window below is closed there. With an
      // external dispatcher, or under flow-level `queue` concurrency, the start
      // is deferred past this call by design — a start signal would mean waiting
      // out the queue, which is the launching request blocking on detached work.
      // Those two keep the gap: between here and the child's start gate nobody
      // holds the lease, and if that delay exceeds the lease TTL another drain
      // reclaims the row and this child then fails its gate as stale. Bounded
      // and safe per occurrence (the gate is what rejects it), but under
      // sustained backlog it can starve. The parent cannot simply keep renewing:
      // its request returns immediately, so the driver would leak. Closing it
      // means modelling "claimed but not yet started", which is the lease's
      // shape to change, not the spawn's.
      currentLeaseRenewal()?.stop();

      return {
        detached: true as const,
        taskId: claim.taskId,
        sessionId: result.sessionId,
        requestId: result.requestId,
        /**
         * True when the Workstream already existed — a second task addressed to
         * the same board, worker and topic as one that came before it.
         */
        adopted: result.adopted,
      };
    },
  });
}
