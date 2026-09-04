/**
 * Build the request-bound operations attached to a block context: the
 * `ctx.requestHost` bundle (FIX-999) and the dispatch seam.
 *
 * Constructed **once** per request in `createExecutionContext`; nested scopes
 * inherit the same object references, exactly as `stores` already does. Every
 * operation closes over the running request's server-derived identity, so a
 * capability supplies the *target* of an operation and never the *authority*
 * for it.
 *
 * ## The dispatch seam
 *
 * A `dispatcher()` block (or the task board's hand-off) puts a `DispatchSpec`
 * through the seam. The seam does four things, in order, and refuses by name
 * at each:
 *
 * 1. **Resolve the entry.** `(type, target)` on the flow's own map, with no
 *    fallback — `no-entry` otherwise. The `defineFlow` walk already refused an
 *    address that resolves nothing, so this is the run-time half of the same
 *    rule, reached only by a dispatch the walk could not see (a carried core).
 * 2. **Resolve the session.** A `key` derives a child of the running session
 *    and mints or adopts it; an `id` names a session that must exist and be this
 *    principal's on this flow — `session-not-found` / `session-not-addressable`
 *    otherwise, never created.
 * 3. **Build the envelope**, from values the seam derived: the dispatch type as
 *    the source, the sender's principal, tenant and org, and server-assembled
 *    provenance under `metadata.dispatch` — including, for an `id` delivery,
 *    the recipient's lineage at acceptance, which `runAction`'s incarnation
 *    guard compares against before the run.
 * 4. **Start it through the host operation**, resolving only once the host has
 *    *accepted* it.
 *
 * `startDetached` stays on the bundle behind the D-8 fence: unchanged, and
 * taking no new callers.
 *
 * Verbs whose preconditions a deployment has not met are not silently broken —
 * each has a named outcome in the public contract:
 *
 * - no host start operation wired → `startDetached` refuses `no-start-operation`
 * - no host dispatch operation wired → the seam refuses `no-dispatch-operation`
 * - the flow declares no workstream core → refuses `no-workstream-core`
 * - this request was not dispatched for a task → `parentTask()` resolves
 *   `undefined` and `settleParentTask` refuses `no-parent-task`
 * - the liveness gate refused → `livenessOf` is **absent from the bundle**
 */
import type {
  DispatchOutcome,
  DispatchRefusal,
  DispatchSeam,
  DispatchSpec,
  FlowInstance,
  LivenessAnswers,
  RequestHost,
  SettleParentTaskInput,
  SettleParentTaskResult,
  StartDetachedInput,
  StartDetachedResult
} from "@flow-state-dev/core/types";
import type { SessionRecord, StoreRegistry } from "../stores/types";
import { workstreamBindingKey } from "@flow-state-dev/core/types";
import { resolveEntry, workstreamDispatchInputSchema } from "@flow-state-dev/core";
import type { RuntimeConfig } from "../runtime-config";
import { resolveLineageId, resolveSessionStorageKey } from "../stores/scope-keys";
import {
  deriveChildSessionId,
  deriveDispatchChildSessionId,
  evaluateAdoption
} from "./detached-child";
import type { DispatchOperation } from "./dispatch-operation";
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
  };
  /** Absent when this process executes requests but cannot start one. */
  startOperation?: DetachedStartOperation;
  /** Absent when this process executes requests but cannot dispatch one. */
  dispatchOperation?: DispatchOperation;
  /**
   * The config this request runs under, handed to the start and dispatch
   * operations so a child inherits it rather than the host's construction-time
   * one (FIX-1077). See `DetachedStartOperation` / `DispatchOperation`.
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
  /** The dispatch seam, attached to the context under `DISPATCH_SEAM`. */
  seam: DispatchSeam;
  /** Absent when liveness was enabled; otherwise why it was refused. */
  livenessRefusal?: { reason: string; detail: string };
};

/** A named refusal — the shape both the seam and its session resolution return. */
type Refused = { readonly ok: false; readonly refused: DispatchRefusal; readonly detail: string };

/**
 * A resolved session target: where the dispatched request runs, under whose
 * org, whether it already existed — and, for a delivery into an existing
 * session, the lineage the seam approved, so the run can tell a replacement
 * session from the one it was addressed to.
 */
type ResolvedSession =
  | {
      ok: true;
      sessionId: string;
      orgId: string | undefined;
      adopted: boolean;
      delivery: "child" | "existing";
      recipientLineageId?: string;
    }
  | Refused;

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

  const refuse = (refused: DispatchRefusal, detail: string): Refused => ({
    ok: false,
    refused,
    detail
  });

  /**
   * An `id` target: the session must exist and be reachable from this request
   * — same flow, same principal, same tenant, and not bound to a different org.
   * Never created: an unknown id is a typo, a stale reference, or a hallucinated
   * value, and creating a session for it would be work nobody is watching.
   *
   * Absent, another owner, and another tenant answer the same refusal on
   * purpose: a distinct reason would confirm that a session exists across a
   * boundary the caller cannot see past, which is an existence oracle.
   */
  const resolveExistingSession = async (sessionId: string): Promise<ResolvedSession> => {
    const storageKey = resolveSessionStorageKey(sessionId, identity.tenantId);
    const record = await stores.session.get(storageKey);
    if (
      record === undefined ||
      record.userId !== identity.userId ||
      (record.tenantId ?? undefined) !== identity.tenantId
    ) {
      return refuse("session-not-found", `no session "${sessionId}" is reachable from this request`);
    }
    if (record.flowKind !== flow.kind) {
      return refuse(
        "session-not-addressable",
        `session "${sessionId}" belongs to flow "${record.flowKind}", not "${flow.kind}"; ` +
          `cross-flow delivery is not supported`
      );
    }
    const recordOrg = record.orgId ?? undefined;
    if (recordOrg !== undefined && identity.orgId !== undefined && recordOrg !== identity.orgId) {
      return refuse(
        "session-not-addressable",
        `session "${sessionId}" is bound to org "${recordOrg}", not "${identity.orgId}"`
      );
    }
    return {
      ok: true,
      sessionId,
      orgId: recordOrg ?? identity.orgId,
      adopted: true,
      delivery: "existing",
      // The incarnation the checks above approved. Acceptance and execution are
      // not the same moment — a delivery can be accepted, wait behind a held
      // concurrency key, and run later — and a recipient deleted and recreated
      // under the same id in that window gets a new lineage that nothing
      // downstream re-checks. `runAction`'s guard compares against this.
      recipientLineageId: resolveLineageId({ id: storageKey, lineageId: record.lineageId })
    };
  };

  /**
   * A `key` target: derive the child from the key plus the running request's
   * identity, then adopt it if it exists or create it if it does not. The
   * caller named none of the identity — that is what makes the child
   * unreachable except through the parent that owns it.
   */
  const resolveChildSession = async (
    key: string,
    address: { type: string; target: string }
  ): Promise<ResolvedSession> => {
    const childId = deriveDispatchChildSessionId(
      {
        userId: identity.userId,
        tenantId: identity.tenantId,
        parentSessionId: identity.sessionId,
        lineageId: identity.lineageId
      },
      key
    );
    const storageKey = resolveSessionStorageKey(childId, identity.tenantId);
    const expected = {
      flowKind: flow.kind,
      userId: identity.userId,
      tenantId: identity.tenantId,
      orgId: identity.orgId,
      parentSessionId: identity.sessionId,
      lineageId: identity.lineageId
    };

    const existing = await stores.session.get(storageKey);
    if (existing !== undefined) {
      // Adoption validates the record's whole identity, not just the key — the
      // seam is not the only writer at this id (see `evaluateAdoption`).
      const verdict = evaluateAdoption(existing, expected);
      if (!verdict.adoptable) {
        return refuse(
          "key-occupied",
          `the derived child key is held by a record whose ${verdict.mismatch} does not match this request`
        );
      }
      return { ok: true, sessionId: childId, orgId: identity.orgId, adopted: true, delivery: "child" };
    }

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
      // Inherited verbatim. Not a hash, not a re-derivation — the same value,
      // so parent and child address one bucket by construction (FIX-1068).
      lineageId: identity.lineageId,
      // Display labels, stamped here and only here: the key this child was
      // derived from, and the entry it was dispatched for. Taken from the
      // values this call already consumed to derive the child, so they cannot
      // disagree with the record's identity — and carrying no authority, which
      // is what keeps them safe (see `SessionRecord.topic`). The same two
      // fields the detached start stamps, so the workstreams listing shows a
      // dispatched child like any other.
      topic: key,
      coordinate: `${address.type}:${address.target}`
    };

    // Reclaim the id's resource-state tombstones before the create (FIX-1258).
    // A child's id is DERIVED from its key, so the same key always lands on
    // the same id and reuse is the norm; without this a child whose session
    // was deleted comes back with every static resource permanently
    // unwritable. Before the create, so nothing commits ahead of it.
    await purgeStaleResourceState(stores, storageKey);

    // Create-if-absent: this is how a caller wins or loses a create race,
    // rather than silently overwriting a concurrent adopter's child.
    const result = await stores.session.set(storageKey, record, "absent");
    if (!result.ok) {
      // An undefined `currentValue` means the row is TOMBSTONED, which the
      // store contract requires a caller to treat as deleted and stop on. So it
      // refuses exactly like a mismatched record does; only a present, adoptable
      // child is adopted.
      const current = result.conflict.currentValue;
      if (current === undefined || !evaluateAdoption(current, expected).adoptable) {
        return refuse(
          "key-occupied",
          "the derived child key was taken by a non-matching record during this call"
        );
      }
      return { ok: true, sessionId: childId, orgId: identity.orgId, adopted: true, delivery: "child" };
    }
    return { ok: true, sessionId: childId, orgId: identity.orgId, adopted: false, delivery: "child" };
  };

  const seam: DispatchSeam = async (spec: DispatchSpec): Promise<DispatchOutcome> => {
    // Admission first: the address must resolve on its own type's map. Never
    // falls through to another type — a `task` dispatch cannot reach an action.
    if (resolveEntry(flow, spec.type, spec.target) === undefined) {
      return refuse(
        "no-entry",
        `flow "${flow.kind}" declares no ${spec.type} entry "${spec.target}"`
      );
    }

    if (inputs.dispatchOperation === undefined) {
      return refuse(
        "no-dispatch-operation",
        "this process executes requests but was not wired to dispatch one; a deployment whose " +
          "blocks dispatch must supply a dispatch operation in every process that runs them"
      );
    }

    const session =
      "id" in spec.session
        ? await resolveExistingSession(spec.session.id)
        : await resolveChildSession(spec.session.key, spec);
    if (!session.ok) return session;

    // Start goes through the host operation and resolves only once the dispatch
    // has been accepted — a rejected enqueue must surface as a failure, not as
    // an accepted result with nothing running. A freshly created child record
    // is deliberately left in place on failure: a retry adopts it, and deleting
    // it would race a concurrent adopter.
    const started = await inputs.dispatchOperation({
      source: spec.type,
      target: spec.target,
      sessionId: session.sessionId,
      delivery: session.delivery,
      input: spec.payload,
      flowKind: flow.kind,
      // The same identity the child key was derived from, or the existing
      // session was validated against — see `DispatchOperation`.
      userId: identity.userId,
      ...(identity.tenantId !== undefined ? { tenantId: identity.tenantId } : {}),
      ...(session.orgId !== undefined ? { orgId: session.orgId } : {}),
      // Server-assembled provenance for the request record: the address, the
      // sending block and session, the key (when a child was derived), the
      // recipient's approved lineage (when an existing session was named), and
      // the facts the sender supplied through `provenance` — a channel whose
      // contract is "put a fact here only when the runtime produced it".
      metadata: {
        dispatch: {
          type: spec.type,
          target: spec.target,
          from: { block: spec.from, sessionId: identity.sessionId },
          ...("key" in spec.session ? { key: spec.session.key } : {}),
          ...(session.recipientLineageId !== undefined
            ? { recipientLineageId: session.recipientLineageId }
            : {}),
          ...(spec.provenance ?? {})
        }
      },
      // The dispatched request continues THIS request's work, so it runs under
      // THIS request's config — not the host's construction-time one.
      ...(inputs.effectiveRuntimeConfig !== undefined
        ? { runtimeConfig: inputs.effectiveRuntimeConfig }
        : {})
    });

    if ("notStarted" in started) {
      // Nothing was dispatched, so the caller still owns the work — returning a
      // refusal rather than throwing is what lets it settle its own row instead
      // of leaving it for the lease to recover.
      if ("externalDispatcher" in started) {
        // A delivery into an existing session needs the recipient's concurrency
        // policy applied and the run reachable from this process; past an
        // external queue boundary neither holds, so it refuses by name rather
        // than under-delivering. A `key` child is unaffected: it is a fresh
        // session whose run the queue owns, exactly like a detached start.
        return refuse(
          "external-dispatcher",
          "this deployment dispatches work to an external queue, where a delivery into an " +
            "existing session is not arbitrated against that session's concurrency policy; " +
            "delivery refuses rather than under-delivering"
        );
      }
      // The host refuses synchronously for a small set of pre-dispatch
      // conditions, the reachable one being a `reject` concurrency policy whose
      // key is already held.
      return refuse(
        "dispatch-rejected",
        `the host refused the dispatch before starting it: ${started.reason}`
      );
    }

    return {
      ok: true,
      sessionId: session.sessionId,
      requestId: started.requestId,
      adopted: session.adopted
    };
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

  const host: RequestHost = { startDetached, parentTask, settleParentTask };

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
    return { host, seam };
  }

  return { host, seam, livenessRefusal: { reason: gate.reason, detail: gate.detail } };
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
