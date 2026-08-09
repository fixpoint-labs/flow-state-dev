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
 * - the liveness gate refused → `livenessOf` is **absent from the bundle**
 */
import type {
  FlowInstance,
  LivenessAnswers,
  RequestHost,
  SettleParentTaskInput,
  SettleParentTaskResult,
  StartDetachedInput,
  StartDetachedResult
} from "@flow-state-dev/core/types";
import type { SessionRecord, StoreRegistry } from "../stores/types";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import { deriveChildSessionId, evaluateAdoption } from "./detached-child";
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
}) => Promise<{ requestId: string }>;

/** The one parent-board row this request was dispatched for, stamped at spawn. */
export type ParentTaskBinding = {
  read(): Promise<unknown | undefined>;
  settle(input: SettleParentTaskInput): Promise<SettleParentTaskResult>;
};

export type RequestHostInputs = {
  stores: Pick<StoreRegistry, "session" | "activeRequests">;
  flow: FlowInstance;
  /** Server-derived identity of the running request. Never caller-supplied. */
  identity: {
    userId: string;
    tenantId: string | undefined;
    orgId: string | undefined;
    /** The running request's session — the parent of anything it spawns. */
    sessionId: string;
  };
  /** Absent when this process executes requests but cannot start one. */
  startOperation?: DetachedStartOperation;
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
        parentSessionId: identity.sessionId
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
        ...(args.record !== undefined ? { metadata: { ...args.record } } : {})
      };

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
      actionName: core.block.name
    });

    return { ok: true, sessionId: childId, requestId: started.requestId, adopted };
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
    return { host };
  }

  return { host, livenessRefusal: { reason: gate.reason, detail: gate.detail } };
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
