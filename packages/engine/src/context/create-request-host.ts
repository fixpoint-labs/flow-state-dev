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
 * Verbs whose preconditions a deployment has not met are not silently broken —
 * each has a named outcome in the public contract:
 *
 * - no host dispatch operation wired → the seam refuses `no-dispatch-operation`
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
} from "@flow-state-dev/core/types";
import type { SessionRecord, StoreRegistry } from "../stores/types";
import { resolveEntry } from "@flow-state-dev/core";
import type { RuntimeConfig } from "../runtime-config";
import { resolveLineageId, resolveSessionStorageKey } from "../stores/scope-keys";
import { deriveDispatchChildSessionId, evaluateAdoption } from "./detached-child";
import type { DispatchOperation } from "./dispatch-operation";
import { purgeStaleResourceState } from "./ensure-session-record";
import { evaluateLivenessGate, type LivenessGateInputs } from "./liveness-gate";
import { readLiveness } from "./liveness-read";

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
  /** Absent when this process executes requests but cannot dispatch one. */
  dispatchOperation?: DispatchOperation;
  /**
   * The config this request runs under, handed to the dispatch operation so
   * a child inherits it rather than the host's construction-time one
   * (FIX-1077). See `DispatchOperation`.
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
    // Compared as two bindings, not two values that happen to be set: an
    // org-bound sender delivering into an unbound session would be accepted
    // here and then refused by `createExecutionContext`'s org-immutability
    // check before the handler ran (a reported success that never runs), and
    // an unbound sender delivering into a bound session would run under an
    // org it never carried.
    const recordOrg = record.orgId ?? undefined;
    if (recordOrg !== identity.orgId) {
      return refuse(
        "session-not-addressable",
        `session "${sessionId}" is bound to org "${recordOrg ?? "<unbound>"}", but this ` +
          `request is bound to "${identity.orgId ?? "<unbound>"}"; a delivery never moves a ` +
          `session across an org boundary`
      );
    }
    return {
      ok: true,
      sessionId,
      orgId: recordOrg,
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
      // is what keeps them safe (see `SessionRecord.topic`). They are the two
      // fields the children listing reads.
      ...label("topic", key),
      ...label("coordinate", `${address.type}:${address.target}`)
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

  const host: RequestHost = { parentTask, settleParentTask };

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
 * `deriveDispatchChildSessionId` length-frames the key, so `key: ""` and an absent
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
