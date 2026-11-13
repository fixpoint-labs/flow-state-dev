// FIX-276, generalized in FIX-849; FIX-276.
/**
 * useSuspensions — derives pending/resolved suspension state from a session's
 * live item stream and provides resolution actions. `resolve(id, { action, data })` is the general resolver (submit a
 * typed payload, skip an optional step, or approve/reject); `approve`/`reject`
 * are thin wrappers over it.
 *
 * Suspensions surface when a durable action calls `ctx.suspend()` (e.g. to wait
 * for human approval). The pause emits a `suspension` item; the eventual
 * resolution emits a matching `suspension_resume` item into the same stream.
 * This hook folds both halves into a stable view and exposes `approve`/`reject`
 * callbacks that resolve through the session's STREAMING resume — so the resumed
 * continuation streams straight into `session.items` and the resolution renders
 * live, with no page refresh. Transport lives in the client /
 * `useSession`; this hook only derives state and tracks in-flight/error UI
 * status.
 */
import { useCallback, useMemo, useState } from "react";
/**
 * Pure derivation over a session's item stream — the body of the hook's
 * `useMemo`. Collects `suspension` items, indexes `suspension_resume` items by
 * `suspensionId`, applies the option filters, and stamps `isResolving` from the
 * supplied in-flight set. Exported for direct unit testing (the react package
 * has no DOM render harness by convention).
 */
export function deriveSuspensions(items, options = {}, inFlight = new Set()) {
    refuseOldReasons(options.reasons);
    return suspensionViews(items, options, inFlight);
}
/** The `user_*` reason each old `human_*` one was renamed to. */
const RENAMED_REASONS = {
    human_approval: "user_approval", // retired-name-refusal: the old reason, refused or read as its new one
    human_input: "user_input" // retired-name-refusal: the old reason, refused or read as its new one
};
/** An old `human_*` filter would match nothing new: refused, naming its `user_*` reason. */
function refuseOldReasons(reasons) {
    for (const reason of reasons ?? []) {
        const renamed = Object.hasOwn(RENAMED_REASONS, reason) ? RENAMED_REASONS[reason] : undefined;
        if (renamed !== undefined)
            throw new Error(`useSuspensions: reason "${reason}" was renamed. Use "${renamed}".`);
    }
}
/** {@link deriveSuspensions} without the filter check, for the hook, which checks once per filter. */
function suspensionViews(items, options, inFlight) {
    // Match by `type` literal — this package imports only TYPES from core, not
    // its runtime predicates.
    const resumeIndex = new Map();
    for (const item of items) {
        if (item.type === "suspension_resume") {
            const resumeItem = item;
            resumeIndex.set(resumeItem.suspensionId, resumeItem);
        }
    }
    const suspensions = [];
    for (const item of items) {
        if (item.type !== "suspension")
            continue;
        const suspItem = item;
        if (options.requestId !== undefined && suspItem.requestId !== options.requestId)
            continue;
        // A stop core 0.2.0 stored under an old `human_*` reason matches its `user_*` filter.
        const reason = Object.hasOwn(RENAMED_REASONS, suspItem.reason) ? RENAMED_REASONS[suspItem.reason] : suspItem.reason;
        if (options.reasons !== undefined && !options.reasons.includes(reason))
            continue;
        const resume = resumeIndex.get(suspItem.suspensionId);
        suspensions.push({
            item: suspItem,
            pending: resume === undefined,
            // An unknown future resolution tag passes through verbatim rather than
            // throwing — the reducer tolerates a vocabulary it does not recognise.
            status: resume?.resolution ?? "pending",
            resumeData: resume?.resumeData,
            resolvedBy: resume?.resolvedBy,
            allow: suspItem.allow ?? ["approve", "reject"],
            isResolving: inFlight.has(suspItem.suspensionId)
        });
    }
    return {
        suspensions,
        pending: suspensions.filter((view) => view.pending)
    };
}
/**
 * The shared body of `approve`/`reject`. Marks in-flight, streams the resolution
 * through the session's answer (so the continuation renders live), captures any
 * error into `setError`, and **rethrows** so callers can branch on success.
 * In-flight is always cleared in `finally`. Exported for direct unit testing.
 */
export async function resolveSuspension(args) {
    const { item } = args;
    args.markStart(item.suspensionId);
    args.setError(null);
    try {
        await args.resolve({
            suspensionId: item.suspensionId,
            requestId: item.requestId,
            action: args.action,
            data: args.data
        });
    }
    catch (err) {
        // Normalize once and rethrow the SAME value stored in the error slot, so a
        // caller catching the rejection and the `error` state never diverge (they
        // would for a non-Error throw).
        const error = err instanceof Error ? err : new Error(String(err));
        args.setError(error);
        throw error;
    }
    finally {
        args.markEnd(item.suspensionId);
    }
}
// BP-010.
/**
 * Derives suspension state from `session.items` and returns approve/reject
 * actions. Derivation is a `useMemo` over the live stream; resolution
 * goes through `session.answerSuspension`.
 */
export function useSuspensions(session, options = {}) {
    // In-flight suspensionIds, immutably updated so concurrent resolves of
    // different ids never clobber one another's membership.
    const [inFlight, setInFlight] = useState(() => new Set());
    const [error, setError] = useState(null);
    const { requestId, reasons } = options;
    // Key the reasons array by value, not reference: an inline literal
    // (`useSuspensions(session, { reasons: ["user_approval"] })`) is a new array
    // every render, which would force deriveSuspensions to recompute each time.
    const reasonsKey = reasons === undefined ? undefined : reasons.join(" ");
    // Checked once per distinct filter, not on each stream update; an old one still throws here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useMemo(() => refuseOldReasons(reasons), [reasonsKey]);
    const { suspensions, pending } = useMemo(() => suspensionViews(session.items, { requestId, reasons }, inFlight), 
    // `reasons` is intentionally tracked via `reasonsKey` (by value, not reference).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.items, requestId, reasonsKey, inFlight]);
    const markStart = useCallback((id) => {
        setInFlight((prev) => new Set(prev).add(id));
    }, []);
    const markEnd = useCallback((id) => {
        setInFlight((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, []);
    const resolve = useCallback((suspensionId, args) => {
        const target = session.items.find((item) => {
            if (item.type !== "suspension")
                return false;
            return item.suspensionId === suspensionId;
        });
        if (target === undefined) {
            return Promise.reject(new Error("No suspension found with id: " + suspensionId));
        }
        return resolveSuspension({
            resolve: session.answerSuspension,
            item: target,
            action: args.action,
            data: args.data,
            markStart,
            markEnd,
            setError
        });
    }, [session.answerSuspension, session.items, markStart, markEnd]);
    // Binary approve/reject stay as thin wrappers over the general resolver.
    const approve = useCallback((suspensionId, data) => resolve(suspensionId, { action: "approve", data }), [resolve]);
    const reject = useCallback((suspensionId, data) => resolve(suspensionId, { action: "reject", data }), [resolve]);
    return { suspensions, pending, resolve, approve, reject, error };
}
//# sourceMappingURL=useSuspensions.js.map