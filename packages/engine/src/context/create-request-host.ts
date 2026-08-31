/**
 * Build the request-bound operation bundle attached to `ctx.requestHost` (FIX-999).
 *
 * Constructed **once** per request in `createExecutionContext`; nested scopes
 * inherit the same object reference, exactly as `stores` already does. Every
 * operation closes over the running request's server-derived identity, so a
 * capability supplies the *target* of an operation and never the *authority*
 * for it.
 *
 * Verbs whose preconditions a deployment has not met are not silently broken —
 * each has a named outcome in the public contract:
 *
 * - no host start operation wired → `startDetached` refuses `no-start-operation`
 * - the flow declares no workstream core → refuses `no-workstream-core`
 * - this request was not dispatched for a task → `parentTask()` resolves
 *   `undefined` and `settleParentTask` refuses `no-parent-task`
 * - no host send operation wired → `sendMessage` refuses `no-send-operation`
 * - the liveness gate refused → `livenessOf` is **absent from the bundle**
 *
 * One verb here takes a **session id**, and that is the contract rather than an
 * exception to it: `sendMessage` authorizes by **peerage** — checking the named
 * session's owner, tenant, org binding and flow kind against the running
 * request's own — where every other verb authorizes by **descent**. Identity is
 * still server-derived either way; see `core/types/request-host.ts`.
 */
import type {
  FlowInstance,
  LivenessAnswers,
  RequestHost,
  SendMessageInput,
  SendMessageResult,
  SettleParentTaskInput,
  SettleParentTaskResult,
  StartDetachedInput,
  StartDetachedResult
} from "@flow-state-dev/core/types";
import type { SessionKind, SessionRecord, StoreRegistry } from "../stores/types";
import { resolveRelayDoor } from "../execution/relay-door";
import type { RelaySendOperation } from "./relay-send-operation";
import { workstreamBindingKey } from "@flow-state-dev/core/types";
import { workstreamDispatchInputSchema } from "@flow-state-dev/core";
import type { RuntimeConfig } from "../runtime-config";
import { resolveLineageId, resolveSessionStorageKey } from "../stores/scope-keys";
import { deriveChildSessionId, evaluateAdoption } from "./detached-child";
import { purgeStaleResourceState } from "./ensure-session-record";
import { evaluateLivenessGate, type LivenessGateInputs } from "./liveness-gate";
import { readLiveness } from "./liveness-read";

/**
 * Starts a request the seam has already prepared a child session for. Supplied
 * by the host, because dispatch must go through the host-level arbiter and
 * enqueue-time materialization rather than straight to a dispatcher.
 */
export type DetachedStartOperation = (spec: {
  sessionId: string;
  input: unknown;
  /** Handler block name, carried as provenance only. */
  actionName: string;
  /** The flow the child belongs to — always the parent's own (FIX-982 P3a). */
  flowKind: string;
  /**
   * The child's principal, tenant and org.
   *
   * Passed rather than re-read from the child record the seam just wrote: these
   * are the values the seam **derived the child key from** and validated
   * adoption against, so passing them is what makes the dispatch provably the
   * same identity as the record. Re-reading would introduce a second source that
   * can disagree, and the disagreement would be a request running under an
   * identity the key was never derived for.
   */
  userId: string;
  tenantId?: string;
  orgId?: string;
  /**
   * Provenance stamped onto the request record — what a reader needs to tell
   * *which* body of background work a detached request is. Server-assembled;
   * never the caller's bag.
   */
  metadata?: Record<string, unknown>;
  /**
   * The runtime config the LAUNCHING request is running under, for the child to
   * inherit (FIX-1077).
   *
   * A host is built once, but a caller may run a given request under a derived
   * config — `fsdev run` builds `{ ...appConfig, modelResolver, logger }` so
   * `--model` takes effect. The child is that request's own work continued in
   * the background, so it runs under the same resolvers and logger rather than
   * the host's construction-time ones. Absent → the host's own config applies.
   */
  runtimeConfig?: RuntimeConfig;
}) => Promise<
  | { requestId: string }
  /**
   * The dispatch never happened, definitively. Distinguished from a thrown
   * rejection because the two need opposite handling by the caller: nothing
   * started means the caller still owns whatever it was about to hand over, so
   * it can settle it; a throw after the attempt cannot rule out a live child.
   */
  | { notStarted: true; reason: string }
>;

/**
 * The largest `timeoutMs` a send accepts.
 *
 * Node's timers are 32-bit: `setTimeout` with anything past this clamps to a
 * **1 ms** timer with only a warning, so a caller asking for an unbounded wait
 * would be answered almost immediately and could not tell that from an ordinary
 * timeout. The bound is refused rather than clamped for exactly that reason.
 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Whether a caller-supplied wait budget is one Node's timers can actually hold. */
function isSupportedTimeout(timeoutMs: number): boolean {
  return Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS;
}

/** The one parent-board row this request was dispatched for, stamped at spawn. */
export type ParentTaskBinding = {
  read(): Promise<unknown | undefined>;
  settle(input: SettleParentTaskInput): Promise<SettleParentTaskResult>;
};

export type RequestHostInputs = {
  // `resourceState` is here only for the tombstone reclamation a newly created
  // child owes itself — see the `purgeStaleResourceState` call below.
  stores: Pick<StoreRegistry, "session" | "activeRequests" | "resourceState">;
  flow: FlowInstance;
  /** Server-derived identity of the running request. Never caller-supplied. */
  identity: {
    userId: string;
    tenantId: string | undefined;
    orgId: string | undefined;
    /** The running request's session — the parent of anything it spawns. */
    sessionId: string;
    /**
     * The lineage the running session belongs to (FIX-1068). Inherited by the
     * child verbatim, which is the whole of what makes parent and descendant
     * address one bucket — there is nothing to re-derive and nothing to agree on.
     */
    lineageId: string;
    /**
     * What kind of session the RUNNING request is in (FIX-1230) — the sender's
     * half of relay's two-axis door.
     *
     * Read off the session record `createExecutionContext` has already loaded
     * and identity-checked, which is what makes gating on it BP-031-clean: it is
     * server-derived, and never asserted by the sender. `undefined` for a record
     * written before the field existed, and relay **refuses** that rather than
     * defaulting it.
     */
    sessionKind: SessionKind | undefined;
    /**
     * Whether the running request named its own session, or had one minted for
     * it (FIX-1230).
     *
     * An action dispatched with no `sessionId` runs under a privately minted
     * session whose id the response never carries, so no later request can name
     * it. A send from there would hand back a delivery id nothing could ever ask
     * about — status authorizes by the sending *session* — so relay refuses it.
     *
     * Passed as a fact rather than inferred from the id's shape: what makes the
     * session unaddressable is that nobody was told it, and that is knowable
     * only where the request was assembled.
     */
    sessionWasCallerSupplied: boolean;
  };
  /** Absent when this process executes requests but cannot start one. */
  startOperation?: DetachedStartOperation;
  /**
   * Dispatches a relay delivery through the host. Absent → `sendMessage` refuses
   * `no-send-operation`, the same residual shape `startDetached` has for its own
   * missing operation: a process that executes requests but was not wired to
   * start one.
   */
  relaySendOperation?: RelaySendOperation;
  /**
   * The config this request runs under, handed to the start operation so a
   * detached child inherits it rather than the host's construction-time one
   * (FIX-1077). See `DetachedStartOperation`.
   */
  effectiveRuntimeConfig?: RuntimeConfig;
  /** Absent unless this request was dispatched for a parent-board task. */
  parentTask?: ParentTaskBinding;
  /** Everything the liveness gate needs. The gate runs here, once. */
  liveness: Omit<LivenessGateInputs, "registry">;
  now?: () => number;
};

/** Reported by construction so a host can log which capabilities it wired. */
export type RequestHostBuild = {
  host: RequestHost;
  /** Absent when liveness was enabled; otherwise why it was refused. */
  livenessRefusal?: { reason: string; detail: string };
};

export function createRequestHost(inputs: RequestHostInputs): RequestHostBuild {
  const { stores, flow, identity } = inputs;
  const nowMs = inputs.now ?? Date.now;

  const gate = evaluateLivenessGate({
    registry: stores.activeRequests,
    ...inputs.liveness
  });

  const startDetached = async (args: StartDetachedInput): Promise<StartDetachedResult> => {
    // Admission first: with no workstream core there is nothing to dispatch
    // into, and resolution must not fall through to a caller-addressed action.
    const core = flow.workstream;
    if (core === undefined) {
      return {
        ok: false,
        refused: "no-workstream-core",
        detail: `flow "${flow.kind}" declares no workstream core, so it accepts no detached dispatch`
      };
    }
    // THE ROUTABILITY GUARANTEE (FIX-1074). Every way a board can reach the
    // runtime without reaching `flow.workstreamBindings` converges on one state:
    // the flow has a workstream core, and no route for this board. Definition
    // time cannot close that — a board constructed at dispatch does not exist
    // when the flow is built — so the check that has to be uniform lives here,
    // where the fact is knowable whatever produced the board.
    //
    // Refusing HERE and not at the child's dispatch is the whole point: the
    // caller still holds its claim, so its recorder settles the row against a
    // named refusal. Discovered one hop later, the row has already been handed
    // over and nothing can settle it until its lease lapses.
    //
    // Shape-checked rather than assumed: `startDetached` is a general verb and a
    // caller with no board passes whatever input its own core takes, so only an
    // input that actually names a board is judged. `coordinateKey` is compared
    // too — a flow may route a board's other workers and not this one.
    //
    // WHAT THIS PROVES, EXACTLY: that *some* declaration in this flow owns this
    // address — not that the board making the call is that declaration. The two
    // differ only when a board built at runtime reuses a registered board's
    // `boardId` and coordinate, and they cannot be told apart here: nothing
    // identifies the caller. `requestHost` is built once per request, not per
    // block (see `runAction`'s `createExecutionContext` call), so everything this
    // seam knows about who is calling arrives in `args`, from the caller. A token
    // presented there would separate the accidental collision, but it would be a
    // convention like `provenance.taskId` below, not an enforcement — and a
    // convention documented as a guarantee is what this epic keeps paying for.
    //
    // What limits the damage is downstream and is real: the dispatch enters the
    // REGISTERED board's runner, whose start gate re-reads the row from that
    // board's own ledger and refuses unless `attempts`, `createdAt`,
    // `incarnationId`, a live lease and `status === "in_progress"` all hold, and
    // separately refuses unless the envelope's `coordinateKey` equals the
    // coordinate re-derived from the row. Two boards on separate ledgers there
    // fail the identity arms, so the collision costs a stalled row rather than a
    // wrong settle. It is the two-boards-one-collection case that survives every
    // arm — the row really is shared — and there the registered board's worker
    // runs the runtime board's payload. Closing that needs caller identity
    // threaded into the block context, which is the runtime's shape to change and
    // not this check's (FIX-1074).
    const addressed = workstreamDispatchInputSchema.safeParse(args.input);
    if (addressed.success) {
      const key = workstreamBindingKey(
        addressed.data.boardId,
        addressed.data.coordinateKey
      );
      if (flow.workstreamBindings?.get(key) === undefined) {
        return {
          ok: false,
          refused: "board-not-routable",
          detail:
            `flow "${flow.kind}" declares no detached binding for board ` +
            `"${addressed.data.boardId}" at coordinate "${addressed.data.coordinateKey}", so a ` +
            `child dispatched for it would have no route. The board is reachable at runtime but ` +
            `never reached the flow definition — declare it on a statically-reachable action, or ` +
            `stop dispatching it detached.`
        };
      }
    }

    if (inputs.startOperation === undefined) {
      return {
        ok: false,
        refused: "no-start-operation",
        detail:
          "this process executes requests but was not wired to start one; a deployment whose " +
          "capabilities dispatch must supply a start operation in every process that runs them"
      };
    }

    // The caller named none of this: the key is derived from the seed plus the
    // running request's tenant, principal and parent session.
    const childId = deriveChildSessionId(
      {
        userId: identity.userId,
        tenantId: identity.tenantId,
        parentSessionId: identity.sessionId,
        lineageId: identity.lineageId
      },
      args.seed
    );
    const storageKey = resolveSessionStorageKey(childId, identity.tenantId);
    const expected = {
      flowKind: flow.kind,
      userId: identity.userId,
      tenantId: identity.tenantId,
      orgId: identity.orgId,
      parentSessionId: identity.sessionId
    };

    const existing = await stores.session.get(storageKey);
    let adopted = false;

    if (existing !== undefined) {
      // Adoption validates the record's whole identity, not just the key — the
      // seam is not the only writer at this id (see `evaluateAdoption`).
      const verdict = evaluateAdoption(existing, expected);
      if (!verdict.adoptable) {
        return {
          ok: false,
          refused: "key-occupied",
          detail: `the derived child key is held by a record whose ${verdict.mismatch} does not match this request`
        };
      }
      // No label backfill here, deliberately. A child created by this writer
      // already carries the labels this seed would stamp — the key is derived
      // from the seed, so the same key means the same seed. The only records
      // reached here without them predate the field, and rewriting a live
      // record to add a display name would spend a store write and race every
      // concurrent adopter to repair nothing a reader cannot already handle.
      adopted = true;
    } else {
      const ts = nowMs();
      const record: SessionRecord = {
        id: storageKey,
        // Session-state defaults, applied before the write — the create route
        // parses initial state through the flow's schema precisely so typed
        // block reads never observe missing keys, and execution does not
        // retroactively initialize an existing record.
        state: resolveSessionStateDefaults(flow) as SessionRecord["state"],
        version: 0,
        createdAt: ts,
        updatedAt: ts,
        flowKind: flow.kind,
        userId: identity.userId,
        journal: [],
        ...(identity.tenantId !== undefined ? { tenantId: identity.tenantId } : {}),
        ...(identity.orgId !== undefined ? { orgId: identity.orgId } : {}),
        parentSessionId: identity.sessionId,
        // The one site in the framework that mints a `"workstream"` session
        // (FIX-1230), and the reason relay's door has two axes. This child is
        // inside-world: a relay message reaches only what its flow declares
        // under `relay.on`, never `flow.actions`, and a message sent *from* it
        // is confined the same way. The other three writers default
        // `"top-level"`, so an enumeration that stamped three of four would
        // ship a session nobody can reach.
        sessionKind: "workstream" as const,
        // Inherited verbatim. Not a hash, not a re-derivation — the same
        // value, so parent and child address one bucket by construction (FIX-1068).
        lineageId: identity.lineageId,
        // Canonical labels, stamped here and only here (FIX-1010). They are
        // taken from the seed **this call already consumed to derive the child
        // key**, not from `args.record` below — which is why a caller cannot
        // forge one. Choosing a label and choosing which child you get are the
        // same choice, so the stamp can never disagree with the record's
        // identity; a value supplied alongside the seed could say anything.
        //
        // Top-level rather than inside `metadata` so a reader can tell a
        // server-written field from the caller's bag without trusting the bag
        // (BP-031 in spirit — the labels decide nothing, but a display field
        // sourced from caller input still reads as server truth once it is on
        // the wire). `metadata` keeps carrying `args.record` verbatim, and a
        // `topic` key in there labels nothing.
        //
        // The labels are display-only and carry no authority; `SessionRecord`
        // in `stores/types.ts` holds that contract.
        ...label("topic", args.seed.topic),
        ...label("coordinate", args.seed.key),
        ...(args.record !== undefined ? { metadata: { ...args.record } } : {})
      };

      // Reclaim the id's resource-state tombstones before the create, and only
      // on this branch — `existing === undefined`, so no child is being adopted
      // here (FIX-1258). It matters more on this path than anywhere: a child's
      // key is DERIVED from its seed, so the same seed always lands on the same
      // key, and reuse is the norm rather than the exception — which is why
      // this path has an adoption branch at all. Without it, a child whose
      // session was deleted comes back with every static resource permanently
      // unwritable. Before the create for the ordering reason
      // `purgeStaleResourceState` carries: nothing may commit ahead of it.
      await purgeStaleResourceState(stores, storageKey);

      // Create-if-absent: this is how a caller wins or loses a create race,
      // rather than silently overwriting a concurrent adopter's child.
      const result = await stores.session.set(storageKey, record, "absent");
      if (!result.ok) {
        // `SetResult` is a discriminated union, so the conflict arm is reached
        // by narrowing on `ok` — no cast, and the field name is checked against
        // the store contract rather than asserted.
        //
        // An undefined `currentValue` means the row is TOMBSTONED, which
        // `stores/types.ts` requires a caller to treat as deleted and stop on,
        // never as "reuse what I had cached". So it refuses exactly like a
        // mismatched record does; only a present, adoptable child is adopted.
        const current = result.conflict.currentValue;
        if (current === undefined || !evaluateAdoption(current, expected).adoptable) {
          return {
            ok: false,
            refused: "key-occupied",
            detail: "the derived child key was taken by a non-matching record during this call"
          };
        }
        adopted = true;
      }
    }

    // Start goes through the host operation and resolves only once the dispatch
    // has been accepted — a rejected enqueue must surface as a failure, not as a
    // Started with nothing running. The child record is deliberately left in
    // place on failure: a retry adopts it, and deleting it would race a
    // concurrent adopter.
    const started = await inputs.startOperation({
      sessionId: childId,
      input: args.input,
      actionName: core.block.name,
      flowKind: flow.kind,
      // The same identity the child key was derived from and adoption was
      // validated against — see `DetachedStartOperation`.
      userId: identity.userId,
      ...(identity.tenantId !== undefined ? { tenantId: identity.tenantId } : {}),
      ...(identity.orgId !== undefined ? { orgId: identity.orgId } : {}),
      // The routing seed, restated as request provenance. This is what lets a
      // reader tell one body of background work from another on the request
      // record itself, without resolving the child session first. Taken from the
      // seed this call already consumed to derive the key — so it cannot
      // disagree with the child it names — and never from `args.record`, which
      // is the caller's own bag.
      //
      // `taskId` answers the next question down — not *which body* of work this
      // is, but *which row* this run was spawned for — and it is the one fact
      // here the seam did not derive itself. It comes through `args.provenance`,
      // a channel whose contract is "put a fact here only when the runtime
      // produced it", and pointedly NOT through `args.record`, which stays off
      // the request record entirely.
      //
      // That contract is a convention, not an enforcement: `startDetached` is on
      // the block context, so any block author can call it and pass any id. The
      // two fields above cannot disagree with the child they name — the same
      // seed derived its key — but this one is taken on trust, and a reader
      // should not treat it as checked. It decides nothing, which is what
      // contains it; see `StartDetachedInput.provenance`.
      //
      // Absent when the caller has no durable row behind it, which is an
      // ordinary state and not a defect — a reader that finds no `taskId` has a
      // run it cannot correlate to a board, exactly as before this field
      // existed (BP-030).
      metadata: {
        workstream: {
          topic: args.seed.topic,
          ...(args.seed.key !== undefined ? { key: args.seed.key } : {}),
          ...(args.provenance !== undefined
            ? { taskId: args.provenance.taskId }
            : {})
        }
      },
      // The child continues THIS request's work, so it runs under THIS
      // request's config — not the host's construction-time one.
      ...(inputs.effectiveRuntimeConfig !== undefined
        ? { runtimeConfig: inputs.effectiveRuntimeConfig }
        : {})
    });

    if ("notStarted" in started) {
      // Nothing was dispatched, so the caller still owns the work — returning a
      // refusal rather than throwing is what lets it settle its own row instead
      // of leaving it for the lease to recover. The host refuses synchronously
      // for a small set of pre-dispatch conditions, the reachable one being a
      // flow-level `reject` concurrency policy whose key the parent already
      // holds (FIX-982).
      return {
        ok: false,
        refused: "dispatch-rejected",
        detail: `the host refused the dispatch before starting it: ${started.reason}`
      };
    }

    return { ok: true, sessionId: childId, requestId: started.requestId, adopted };
  };

  /**
   * Send a message to another session (FIX-1230).
   *
   * **Every refusal is decided here**, at the verb, which is the single place a
   * relay message is created. The agent-facing tool is a thin surface over this
   * same function precisely so it cannot skip one — a guard added at the tool is
   * a guard the verb's other callers skip.
   *
   * The order below is not arbitrary. Sender-side checks run **first**, so a
   * caller that cannot legitimately send learns that without also learning
   * whether the recipient it named exists. Recipient-side checks then run
   * outside-in: identity, then the flow boundary, then the door.
   */
  const sendMessage = async (args: SendMessageInput): Promise<SendMessageResult> => {
    // ---- Sender-side. Nothing here reads the recipient. ----

    if (args.mode === "waitForResponse") {
      return {
        ok: false,
        outcome: "refused",
        refused: "mode-not-available",
        detail:
          'waiting for a reply is not available yet. Send with mode: "fireAndForget", or wait ' +
          "for the release that adds it."
      };
    }

    // Validated whenever supplied, even on a mode with no clock, so one value
    // cannot mean two things. REFUSED rather than clamped: Node's timers are
    // 32-bit, so `Infinity`, `NaN` and anything past `2**31 - 1` become a 1 ms
    // timer — a caller asking for an unbounded wait would get an immediate
    // timeout, indistinguishable from an ordinary one.
    if (args.timeoutMs !== undefined && !isSupportedTimeout(args.timeoutMs)) {
      return {
        ok: false,
        outcome: "refused",
        refused: "invalid-timeout",
        detail: `timeoutMs must be a positive integer no greater than ${MAX_TIMEOUT_MS}; received ${String(args.timeoutMs)}`
      };
    }

    if (inputs.relaySendOperation === undefined) {
      return {
        ok: false,
        outcome: "refused",
        refused: "no-send-operation",
        detail:
          "this process executes requests but was not wired to dispatch one; a deployment " +
          "whose capabilities send messages must supply a send operation in every process " +
          "that runs them"
      };
    }

    // Both modes, not just the waiting one. Status authorizes by the sending
    // SESSION, so an unaddressable sender is handed a `deliveryRequestId` no
    // future request can ever query — and for fire-and-forget that status is the
    // only feedback path there is. A promise whose durable backing does not
    // exist is not improved by the caller not blocking on it.
    if (!identity.sessionWasCallerSupplied) {
      return {
        ok: false,
        outcome: "refused",
        refused: "no-durable-sender",
        detail:
          "this request runs in a session nobody named, so its id is known to no later " +
          "request and the delivery could never be asked about. Send from a request that " +
          "supplied a session id."
      };
    }

    // "Caller-supplied" is a fact about request START, and a session id outlives
    // the session. A caller can delete and recreate its own session while this
    // request is still executing — deletion removes the record and no request
    // records, and does not abort running requests — and this closure would keep
    // naming a session that no longer exists *as itself*. The delivery id would
    // then be authorized to an extinct lineage no later turn can query, which is
    // the same permanent status loss, reached by a different road. Same code
    // deliberately: the caller-visible consequence is identical, and a second one
    // would only say which way it lost.
    //
    // Compared through the SAME fallback `createExecutionContext` applies, not
    // against the raw field. A session record written before lineages existed
    // carries none, and the runtime reads it as `lin_${storageKey}` — so
    // comparing the bare field would refuse every legacy sender here, with a
    // code telling it to use a session that has an id rather than the one
    // telling it to run the migration. Both would refuse; only one would say
    // anything true.
    const senderStorageKey = resolveSessionStorageKey(identity.sessionId, identity.tenantId);
    const senderRecord = await stores.session.get(senderStorageKey);
    const senderLineage = resolveLineageId({
      id: senderStorageKey,
      lineageId: senderRecord?.lineageId
    });
    if (senderRecord === undefined || senderLineage !== identity.lineageId) {
      return {
        ok: false,
        outcome: "refused",
        refused: "no-durable-sender",
        detail:
          "the sending session no longer exists as the one this request started in, so a " +
          "delivery id it received could never be resolved"
      };
    }

    // ---- Recipient-side. ----

    const recipientStorageKey = resolveSessionStorageKey(args.to, identity.tenantId);
    const recipient = await stores.session.get(recipientStorageKey);

    // Absent, another owner, and another TENANT all answer the same code on
    // purpose. A distinct reason would confirm that a session exists across a
    // boundary the caller cannot see past, which is an existence oracle —
    // `livenessOf` makes the same trade. The tenant arm is also the one that has
    // to be checked HERE rather than left downstream: without it
    // `createExecutionContext` throws `TenantBindingMismatchError` once the
    // dispatch is already under way, which both breaks the returned-refusal
    // taxonomy and leaks the same oracle through the error.
    if (
      recipient === undefined ||
      recipient.userId !== identity.userId ||
      (recipient.tenantId ?? undefined) !== identity.tenantId
    ) {
      return {
        ok: false,
        outcome: "refused",
        refused: "unknown-recipient",
        detail: `no session "${args.to}" is reachable from this request`
      };
    }

    // Org is the one identity field whose downstream check permits a difference:
    // the existing binding check fires only when both are set and differ, so an
    // unbound sender naming an org-bound recipient would silently resolve to the
    // recipient's org. Compared as bound-vs-unbound here for that reason.
    if ((recipient.orgId ?? undefined) !== identity.orgId) {
      return {
        ok: false,
        outcome: "refused",
        refused: "org-mismatch",
        detail: "the sender and the recipient are bound to different organizations"
      };
    }

    // NOTHING DOWNSTREAM ENFORCES THIS. `createExecutionContext` validates a
    // reused session's user, tenant and org and reads `flowKind` nowhere — the
    // framework states outright that a session id is not a flow boundary and one
    // session can host requests of two flows. So without this check a same-owner
    // send naming a session that belongs to another flow passes every existing
    // check and runs *the sender's* flow handler against that session's history
    // and state. Refused with the addressing code, again to avoid an oracle.
    if (recipient.flowKind !== flow.kind) {
      return {
        ok: false,
        outcome: "refused",
        refused: "unknown-recipient",
        detail: `no session "${args.to}" is reachable from this request`
      };
    }

    const door = resolveRelayDoor({
      flow,
      kind: args.kind,
      senderKind: identity.sessionKind,
      recipientKind: recipient.sessionKind
    });
    if (!door.ok) {
      return { ok: false, outcome: "refused", refused: door.refused, detail: door.detail };
    }

    const started = await inputs.relaySendOperation({
      sessionId: args.to,
      flowKind: flow.kind,
      // Provenance only — the relay source resolves the stamped door.
      actionName: door.core.block.name,
      // A declared binding maps the message itself; the fallthrough dispatches
      // the BARE payload, because a public action validates the dispatched value
      // against its own schema and would reject a wrapper even when the sender
      // supplied exactly the right body. `kind` and `from` ride the stamp, where
      // the recipient can read them without their being part of validated input.
      //
      // Mapped HERE rather than at the delivery, matching the webhook route,
      // which resolves its binding's `input` at the transport boundary before
      // dispatching. A mapper that throws therefore surfaces to the SENDING
      // block rather than becoming a returned refusal — deliberately: a broken
      // mapper is the recipient flow author's bug, not a refusal of this send,
      // and the taxonomy's "no refusal throws" is about refusals.
      input:
        door.door === "declared"
          ? await door.core.input({
              kind: args.kind,
              payload: args.payload,
              from: identity.sessionId
            })
          : args.payload,
      userId: identity.userId,
      ...(identity.tenantId !== undefined ? { tenantId: identity.tenantId } : {}),
      ...(identity.orgId !== undefined ? { orgId: identity.orgId } : {}),
      relay: {
        kind: args.kind,
        door: door.door,
        from: identity.sessionId,
        // The sender-side half of the status authorization relation, persisted
        // now even though nothing reads it until the status verb ships. A verb
        // arriving late is a missing feature; a delivery record written without
        // the relation that authorizes reading it is a hole in data users
        // already created, and no later release could repair it.
        fromLineageId: identity.lineageId,
        // The incarnation the checks above approved. Acceptance and execution
        // are not the same moment — a delivery can be accepted, sit behind a
        // held concurrency key, and run later, in a plain single-process
        // deployment — and a recipient deleted and recreated under the same id
        // in that window gets a new lineage that nothing downstream re-checks.
        // This is what the guard in `runAction` compares against.
        recipientLineageId: resolveLineageId({
          id: recipientStorageKey,
          lineageId: recipient.lineageId
        })
      },
      ...(inputs.effectiveRuntimeConfig !== undefined
        ? { runtimeConfig: inputs.effectiveRuntimeConfig }
        : {})
    });

    if ("notStarted" in started) {
      // Two guarantees relay makes are void past an external queue boundary, not
      // one: the concurrency gate does not apply to external dispatch at all, so
      // the recipient's declared policy is not enforced on a delivery, and a run
      // in another process cannot be woken by this one. Refusing by name beats
      // under-delivering silently.
      //
      // There is deliberately NO capability flag that lifts this. Relay needs
      // three guarantees past that boundary — wake support, door authority and
      // arbitration — and a single flag would let one be enabled without the
      // other two. Lifting it is a later change that must demonstrate all three,
      // and inverting a shipped guard is the correct cost: it forces the change
      // to be argued, which a flag flip does not.
      if ("externalDispatcher" in started) {
        return {
          ok: false,
          outcome: "refused",
          refused: "external-dispatcher",
          detail:
            "this deployment dispatches work to an external queue, where a delivery is not " +
            "arbitrated and the recipient's concurrency policy is not applied to it. " +
            "Messaging refuses rather than under-delivering."
        };
      }
      if ("recipientBusy" in started) {
        return {
          ok: false,
          outcome: "refused",
          refused: "recipient-busy",
          detail: `the recipient declined the delivery: ${started.reason}`
        };
      }
      // A dispatch that never happened, reported as the addressing refusal it
      // most resembles rather than thrown — the taxonomy admits no throws, and a
      // caller can act on a named value.
      return {
        ok: false,
        outcome: "refused",
        refused: "unknown-recipient",
        detail: `the host refused the delivery before starting it: ${started.reason}`
      };
    }

    return { ok: true, outcome: "accepted", deliveryRequestId: started.requestId };
  };

  const parentTask = async (): Promise<unknown | undefined> => {
    if (inputs.parentTask === undefined) return undefined;
    return inputs.parentTask.read();
  };

  const settleParentTask = async (
    input: SettleParentTaskInput
  ): Promise<SettleParentTaskResult> => {
    if (inputs.parentTask === undefined) {
      return {
        ok: false,
        refused: "no-parent-task",
        detail: "this request was not dispatched for a parent-board task, so there is no row to settle"
      };
    }
    return inputs.parentTask.settle(input);
  };

  const host: RequestHost = { startDetached, sendMessage, parentTask, settleParentTask };

  if (gate.enabled) {
    const staleThresholdMs = gate.staleThresholdMs;
    host.livenessOf = (requestIds: readonly string[]): Promise<LivenessAnswers> =>
      readLiveness(requestIds, {
        registry: stores.activeRequests,
        staleThresholdMs,
        flowKind: flow.kind,
        principal: { userId: identity.userId, tenantId: identity.tenantId },
        isDescendantSession: (sessionId) =>
          isDescendantSession(stores, sessionId, identity, flow.kind),
        now: nowMs
      });
    return { host };
  }

  return { host, livenessRefusal: { reason: gate.reason, detail: gate.detail } };
}

/**
 * One canonical label field, present only when there is something to show.
 *
 * **An empty label is not a label.** The alternative is two ways to be
 * unlabelled — absent and `""` — and every reader would have to know both, when
 * the wire contract and the docs already define exactly one. A UI given `""`
 * renders a blank name where absence renders its fallback.
 *
 * For `coordinate` this is also a consistency rule rather than a preference:
 * `deriveChildSessionId` length-frames the seed, so `key: ""` and an absent
 * `key` produce the **same child**. Stamping one of them an empty coordinate
 * would let two calls that provably land on the same record disagree about its
 * label, with the winner decided by whoever created it first.
 */
function label(
  field: "topic" | "coordinate",
  value: string | undefined
): { topic?: string } | { coordinate?: string } {
  return value === undefined || value.length === 0 ? {} : { [field]: value };
}

/**
 * Flow session-state defaults, applied before the child record is written.
 *
 * The create route parses initial state through the flow's `stateSchema` before
 * persisting, precisely so typed block reads never observe missing keys — and
 * execution does not retroactively initialize an existing record. A child
 * created here bypasses that route, so it must do the same defaulting or the
 * first typed read in the child sees `undefined` where the schema promised a
 * value. A schema that cannot default an empty object yields `{}` rather than
 * failing the spawn; nothing here is a validation gate.
 */
function resolveSessionStateDefaults(flow: FlowInstance): Record<string, unknown> {
  const schema = flow.session?.stateSchema;
  if (schema === undefined) return {};
  const parsed = schema.safeParse({});
  return parsed.success ? (parsed.data as Record<string, unknown>) : {};
}

/**
 * Whether `sessionId` lies in the caller's descendant chain, under the same
 * principal and tenant.
 *
 * Walks `parentSessionId` upward from the candidate. The current session
 * qualifies — a request may ask about siblings it started in its own session.
 * The walk is bounded so a corrupted parent cycle cannot hang a read, and every
 * hop re-checks the principal, so a chain cannot be followed out of its tenant.
 */
const MAX_LINEAGE_DEPTH = 32;

async function isDescendantSession(
  stores: Pick<StoreRegistry, "session">,
  sessionId: string | undefined,
  identity: { userId: string; tenantId: string | undefined; sessionId: string },
  flowKind: string
): Promise<boolean> {
  if (sessionId == null) return false;
  // A request may ask about work it started in its own session.
  if (sessionId === identity.sessionId) return true;

  let cursor: string | undefined = sessionId;
  for (let depth = 0; depth < MAX_LINEAGE_DEPTH && cursor != null; depth += 1) {
    const record: SessionRecord | undefined = await stores.session.get(
      resolveSessionStorageKey(cursor, identity.tenantId)
    );
    if (record === undefined) return false;
    // Re-checked at every hop, so a chain cannot be walked out of its principal,
    // tenant or flow even if a record somewhere claims a foreign parent.
    if (record.userId !== identity.userId) return false;
    if ((record.tenantId ?? undefined) !== identity.tenantId) return false;
    if (record.flowKind !== flowKind) return false;

    const parent: string | undefined = record.parentSessionId ?? undefined;
    if (parent === identity.sessionId) return true;
    cursor = parent;
  }
  return false;
}
