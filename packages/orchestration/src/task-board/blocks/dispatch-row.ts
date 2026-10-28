/**
 * The block that dispatches a claimed row instead of running a worker.
 *
 * A board assignee holding a `dispatcher({ type: "task" })` declares that its rows
 * run elsewhere. This block is what the drain installs at that assignee: it takes
 * the dispatcher's address as declared — the entry it names (or chooses per
 * row, among declared ones) and the session policy (a keyed child, or an
 * existing session chosen per row) — and adds the bookkeeping only the drain can do, because only the
 * drain holds the claim: mint the envelope from the ticket, release the claim
 * before the point of no return, put the dispatch through the seam, hand the
 * claim back on refusal. The drain's shape is untouched — claim, route,
 * record. What changes is what the route does.
 *
 * The block carries the assignee's address, so `defineFlow` verifies the flow
 * declares `task: { actions: { [target]: { block } } }` and the board's roster shows the
 * dispatch statically; and it carries the board's **binding** — its id and the
 * claim gate — which `defineFlow` uses to put that entry behind the gate.
 *
 * ## How the task survives this request without being settled by it
 *
 * `recordSuccess` settles the claim held on the worker-body state, and returns
 * **without settling** when that slot is empty. So the dispatch is a state
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
 * dispatch that is no longer true of *this* request — the child starts its own
 * renewal from its own async chain.
 *
 * ## A plan board waits on the row it handed over (FIX-2082 D2)
 *
 * With `wait`, the drain waits on the row after handing it over, through the
 * one wait every request waits with (`waitOnTask`), and goes on only once the
 * row has ended: at each deadline it waits again, a check-in, and never moves
 * past a running row. Its checks run before the hand-over, with the claim
 * still held, so a wait it can't make fails the row with nothing started. The
 * hand-over is recorded with the request (`runOnce`), so the replay after the
 * park hands nothing over again and waits on the same row.
 *
 * ## Past a plan's hand-over, a failure is the plan's
 *
 * Once the claim has left this request the row is the child's: the board has
 * no claim to fail it against, so `recordError` has nothing to write, and
 * under `skip` it would swallow the error while the drain waits on a row it no
 * longer waits on. So every throw past that point (a wait slot another
 * request took, a ledger write that failed, a row gone, a gate resumed with no
 * wait outcome, a seam that threw once the claim was released) leaves as a
 * {@link HandedOverRowError}, which every recorder rethrows whatever `onError`
 * says: the drain's request fails, naming the row, and no later row runs. A
 * park is not a failure and passes through. On the replay after a park the
 * whole call is past the hand-over, its checks included, which is why they run
 * inside the recorded hand-over on the first run and inside the wait after it.
 *
 * Without `wait` (a delegation board) a seam that threw past the release is
 * not wrapped, and that is sound: the drain waits on no row, so it ends, and
 * the row keeps its lapsing lease until a later drain claims it again (see
 * "Threw" above).
 */
import { handler, SuspensionError } from "@flow-state-dev/core";
import {
  bindTaskDispatcher,
  DispatchRefusedError,
  dispatchThroughSeam,
  markDispatcher,
  resolveTaskAction,
  resolveTaskFlowKind,
  resolveTaskSessionTarget,
} from "@flow-state-dev/core/types";
import type {
  BlockContext,
  BlockDefinition,
  TaskBinding,
  TaskDispatchInput,
  TaskTargetQuery,
} from "@flow-state-dev/core/types";
import { z } from "zod";
import { currentLeaseRenewal } from "../../tasks/lease-renewal-scope";
import type { TaskCollectionRef, TaskWorker, TaskWorkerInput } from "../../tasks";
import { checkWait, waitOnTask, type CheckedWait, type WaitOnTaskOptions } from "../../tasks/helpers/wait-on-task";
import type { TaskAssigneeAddress } from "../dispatch-assignee";
import { taskBoardWorkerBodyStateSchema } from "../schemas";
import { assertJsonSafe } from "./json-safe";
import { HandedOverRowError } from "./recorder-failure";

export interface RowDispatchOptions {
  /** Block-name prefix, so a refusal names the board it came from. */
  name: string;
  /** The declaring board's stable id — half of the durable address. */
  boardId: string;
  /**
   * The assignee this dispatch stands in for — the row's assignee. Omitted for
   * the board's fallback, which stands in for every assignee the board does
   * not name: each row is handed over under the assignee it was claimed with.
   */
  assignee?: string;
  /** The assignee's dispatcher address: the entry it dispatches to and the session policy. */
  address: TaskAssigneeAddress;
  /** The board's claim gate, bound onto this block for `defineFlow` to apply to the entry. */
  binding: TaskBinding;
  /**
   * Wait on the row once it is handed over, until it ends (FIX-2082 D2): a
   * plan board's dispatch. Needs `collection`, the board's ledger.
   */
  wait?: { collection: (ctx: BlockContext) => Promise<TaskCollectionRef> };
}

/**
 * Build the block the drain installs at one dispatcher assignee.
 *
 * Its input is the packed `TaskWorkerInput` the drain already materialized —
 * the same value an inline worker would have received, which is what makes the
 * dispatched and inline paths agree on what the worker sees.
 */
export function createRowDispatch(options: RowDispatchOptions): TaskWorker {
  const { name, boardId, assignee: named, address, binding, wait } = options;

  const handOver = async (payload: TaskWorkerInput, ctx: BlockContext) => {
    const claim = (ctx.sequencer!.state as z.infer<typeof taskBoardWorkerBodyStateSchema>).currentClaim;
    if (claim === undefined) {
      // Unreachable through the drain, which mints the ticket in the tap
      // before any route runs. Named because reaching here would otherwise
      // dispatch a request with no row behind it.
      throw new Error(
        `[task-board] "${boardId}" cannot dispatch assignee "${named ?? "(fallback)"}": no claim is on the ` +
          `worker body state. This block must run inside the board's drain, after the claim.`
      );
    }
    // The fallback hands each row over under the assignee it was claimed
    // with, so the receiving gate's assignee check holds. A row with none has
    // nothing to address the hand-over by: refused with the claim still held,
    // so the row fails through the board's ordinary error path.
    const assignee = named ?? claim.assignee;
    if (assignee === undefined) {
      throw new DispatchRefusedError(
        name,
        address,
        "flow-not-found",
        `[task-board] "${boardId}" could not dispatch task "${claim.taskId}": it names no ` +
          `assignee, and the fallback hands a row over by the name on it.`
      );
    }

    // The load-bearing validation. `packWorkerInput` folds in dependency
    // outputs and flow-policy `priorWork` AFTER the claim — both typed
    // `unknown` and authored by a different worker — so this is the likelier
    // source of a value that cannot cross a process boundary, and it fails
    // here, after ownership was acquired, rather than at admission.
    assertJsonSafe(payload, {
      label: `[task-board] "${boardId}" dispatch payload for task "${claim.taskId}"`,
    });

    // Take the round trip HERE, so both deployment modes send the same value:
    // an external runner serializes the envelope, the in-process path
    // hands the child the very object graph this block is holding, and a
    // payload referencing one object from two places is observable either
    // way. Snapshotting also makes the value that was checked the value that
    // is sent.
    const snapshot = JSON.parse(JSON.stringify(payload)) as TaskWorkerInput;

    const envelope: TaskDispatchInput = {
      boardId,
      assignee,
      taskId: claim.taskId,
      // The claim's identity, carried so the child's gate can VERIFY it
      // against the row — not so it can trust it. Every field comes off the
      // ticket the board minted from the row it claimed.
      attempt: claim.attempt,
      // Which turn of that attempt (FIX-2133 D3): a later turn's claim moves it.
      turn: claim.turn,
      createdAt: claim.createdAt,
      // Spread conditionally: the payload beside it has to clear a gate that
      // rejects a present key holding `undefined` by name.
      ...(claim.incarnationId !== undefined
        ? { incarnationId: claim.incarnationId }
        : {}),
      // The partition the claim was taken in, on a partitioned ledger: the
      // child's gate reads the row there, never where its own context would.
      ...(claim.partition !== undefined ? { partition: claim.partition } : {}),
      payload: snapshot,
    };

    // Everything about where this row goes is looked up now, per row, from
    // the row as it was claimed: the entry, the session, the flow, and the
    // child's initial state. A bad answer refuses here, before anything is
    // dispatched and with the claim still held, like the seam's own
    // refusals below. All of it reads the packed row, never a store.
    const task: TaskTargetQuery = {
      assignee,
      taskId: claim.taskId,
      input: snapshot,
      ...(claim.createdBy !== undefined ? { filedBy: claim.createdBy } : {}),
    };
    const action = await resolveTaskAction(name, address, task, ctx);
    // A keyed child, or an existing session by id when the assignee's
    // policy chooses one. An id is delivered into, never created: the seam
    // refuses a missing session `session-not-found` and one this request's
    // principal cannot reach `session-not-addressable`, before dispatching.
    const session = await resolveTaskSessionTarget(name, address, envelope, task, ctx);
    const flowKind = await resolveTaskFlowKind(name, address, task, ctx);

    // Release BEFORE the point of no return — see the file header. Every
    // throw above keeps the claim, and a refusal below hands it back:
    // `handOverAndWait` reads "no claim on the state" as "handed over".
    await ctx.sequencer!.patchState({ currentClaim: undefined });

    const outcome = await dispatchThroughSeam(ctx, {
      type: "task",
      action,
      session,
      payload: envelope,
      from: name,
      // Stamped onto the dispatched REQUEST record, so a run can be correlated
      // back to the row it came from without opening this board's ledger.
      // Same source as every other field here: the claim ticket the board
      // minted from the row it had already claimed.
      provenance: { taskId: claim.taskId },
      // An assignee may name another flow. The author-facing dispatcher() already
      // forwards this; omitting it here made the seam resolve on the sender
      // and refuse `no-entry` against the wrong map.
      ...(flowKind !== undefined ? { flowKind } : {}),
    });

    if (!outcome.ok) {
      // A refusal is decided before anything is dispatched, so the claim is
      // still this request's to fail. Hand it back, then throw: `recordError`
      // fails the row against it, which is the honest outcome for work that
      // was claimed and could not be started.
      await ctx.sequencer!.patchState({ currentClaim: claim });
      // The same error a `dispatcher()` block throws, so a `.rescue()` can
      // branch on `refused` whichever block sent the dispatch; the board
      // and row are named in the detail.
      throw new DispatchRefusedError(
        name,
        address,
        outcome.refused,
        `[task-board] "${boardId}" could not dispatch task "${claim.taskId}" from assignee ` +
          `"${assignee}": ${outcome.detail}`
      );
    }

    // Past this point the child owns the row, and nothing fallible remains:
    // stop asserting a lease this request no longer holds, and return.
    //
    // Nobody renews the lease between here and the child's gate — with an
    // external runner or under flow-level `queue` concurrency the start
    // is deferred past this call by design, so a queue deeper than the lease
    // TTL leaves the row lapsed when the child arrives. That is no longer a
    // refusal: the gate takes the row back with a fenced renewal on the same
    // attempt and proceeds, and only a reclaim that actually won the write
    // stops it (FIX-1305, `task-entry.ts`).
    currentLeaseRenewal()?.stop();

    return {
      dispatched: true as const,
      taskId: claim.taskId,
      sessionId: outcome.sessionId,
      requestId: outcome.requestId,
      /** True when the child session already existed. */
      adopted: outcome.adopted,
    };
  };

  const block = handler({
    name,
    // Substrate-internal. The user-visible signal that background work started
    // is the child session itself, which the parent session can enumerate.
    transient: true,
    inputSchema: z.unknown(),
    sequencerStateSchema: taskBoardWorkerBodyStateSchema,
    execute: async (payload: TaskWorkerInput, ctx) => {
      if (wait === undefined) return handOver(payload, ctx as unknown as BlockContext);
      return handOverAndWait(payload, ctx as unknown as BlockContext);
    },
  });

  /**
   * A plan board's hand-over (see the file header): the wait's checks with
   * the claim held, the hand-over once, then the wait until the row ends. Any
   * failure past the hand-over is the plan's.
   */
  const handOverAndWait = async (payload: TaskWorkerInput, ctx: BlockContext) => {
    const collection = await wait!.collection(ctx);
    const taskId = payload.taskId;
    const key = `fsd.plan.dispatch:${boardId}:${taskId}:${payload.attempts}`;
    const waitOptions: WaitOnTaskOptions = {
      key: `${key}:wait`,
      waitAgain: true,
      ownBoard: true,
      message: `Waiting on the step "${payload.title ?? payload.goal}" it handed to its own session`,
    };
    if (ctx.runOnce === undefined) {
      throw new Error(`[task-board] "${boardId}" can't wait on task "${taskId}": this request keeps no record to replay.`);
    }
    // Set once an earlier run of this request handed the row over: its replay.
    let replayed = false;
    try {
      let checked: CheckedWait | undefined;
      const handed = await ctx.runOnce(key, async () => {
        const passed = await checkWait(ctx, collection, taskId, waitOptions);
        if ("ok" in passed) {
          // The claim is still held: the row fails through the board's error path.
          throw new Error(
            `[task-board] "${boardId}" can't hand task "${taskId}" to a session of its own and wait on it: ` +
              `${passed.error}: ${passed.message}`
          );
        }
        checked = passed;
        return handOver(payload, ctx);
      });
      if (checked === undefined) {
        // The replay after a park: the row is the child's. The drain's tap
        // claimed it again on the way here (a fenced write that declined), so
        // drop that claim and its lease renewal, as the hand-over did.
        replayed = true;
        await ctx.sequencer!.patchState({ currentClaim: undefined });
        currentLeaseRenewal()?.stop();
      }
      // On the replay the checks run here, past the hand-over.
      const waited = await waitOnTask(ctx, collection, taskId, waitOptions, checked);
      if (!waited.ok && waited.error !== "wait_ended_the_request") {
        throw new Error(`can't wait on it: ${waited.error}: ${waited.message}`);
      }
      return handed;
    } catch (error) {
      if (error instanceof SuspensionError) throw error;
      // Past the hand-over once the claim has left this request: on the first
      // run the hand-over released it, on the replay an earlier run did. This
      // reads the first run's answer off the state, so it holds only while
      // `handOver` keeps the claim on every throw before its release and
      // hands it back on a refusal: change either and fix this with it.
      const released = (ctx.sequencer!.state as z.infer<typeof taskBoardWorkerBodyStateSchema>).currentClaim === undefined;
      if (!replayed && !released) throw error;
      throw new HandedOverRowError(boardId, taskId, error);
    }
  };

  // A fresh address object: the binding is keyed by it, so the assignee's own
  // dispatcher stays unbound — reached outside this board it is refused as
  // held by no board, which is what it would be.
  markDispatcher(block, { ...address });
  bindTaskDispatcher(block, binding);
  // The block is declared over `z.unknown()` because the seam validates the
  // envelope, not this block; what the drain hands it IS the packed worker
  // input, which is the one place the cast is true.
  return block as TaskWorker;
}
