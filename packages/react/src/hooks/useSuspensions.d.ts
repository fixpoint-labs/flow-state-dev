import type { OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import type { ResumeAction, SuspensionReason, SuspensionStatus } from "@flow-state-dev/core/types";
import type { SessionView } from "./useSession";
/**
 * Narrowing options for {@link useSuspensions}.
 */
export interface UseSuspensionsOptions {
    /** Restrict to a single request's suspensions. Default: all in session.items. */
    requestId?: string;
    /** Restrict to specific reasons (e.g. ["user_approval"]). Default: all reasons. */
    reasons?: SuspensionReason[];
}
/**
 * A single suspension folded with its resolution (if any). `status`/`pending`
 * reflect whether a matching `suspension_resume` item has arrived; `isResolving`
 * reflects an in-flight approve/reject call for this specific suspension.
 */
export interface SuspensionView {
    /** The suspension item itself. */
    item: SuspensionItem;
    /** "pending" until a matching suspension_resume item appears; then its resolution. */
    status: SuspensionStatus;
    /** True when no matching suspension_resume item exists yet. */
    pending: boolean;
    /** The resolution payload, once resolved (from the suspension_resume item). */
    resumeData?: unknown;
    resolvedBy?: string;
    /**
     * The resolution actions this suspension permits (from `item.allow`). A layout
     * reads it to decide which controls to show — e.g. a Skip button appears iff it
     * includes `"skip"`. Falls back to binary `["approve", "reject"]` for older
     * suspensions persisted before `allow` existed.
     */
    allow: ResumeAction[];
    /** True while a resolve call for this suspension is in flight. */
    isResolving: boolean;
}
/**
 * Reactive suspension view plus approve/reject actions returned by
 * {@link useSuspensions}.
 */
export interface UseSuspensionsResult {
    /** All suspensions (pending + resolved) matching the options, in stream order. */
    suspensions: SuspensionView[];
    /** Convenience filter: only pending suspensions. */
    pending: SuspensionView[];
    /**
     * Resolve a suspension with any permitted action, streaming its continuation
     * back into `session.items`. This is the general resolver — `submit` carries a
     * typed payload (a question answer, a form, a selection); `skip` declines an
     * optional step; `approve`/`reject` keep their binary meaning. Resolves once the
     * resume has been dispatched; rejects if the resume call fails.
     */
    resolve: (suspensionId: string, args: {
        action: ResumeAction;
        data?: unknown;
    }) => Promise<void>;
    /**
     * Approve a suspension and stream its continuation back into `session.items`.
     * Thin wrapper over {@link resolve} with `action: "approve"`.
     */
    approve: (suspensionId: string, data?: unknown) => Promise<void>;
    /** Reject a suspension. Same streaming semantics as {@link approve}. */
    reject: (suspensionId: string, data?: unknown) => Promise<void>;
    /**
     * Most-recent failed approve/reject error (also rethrown by the call).
     * Single-slot: concurrent resolves of different ids overwrite each other.
     */
    error: Error | null;
}
/**
 * Pure derivation over a session's item stream — the body of the hook's
 * `useMemo`. Collects `suspension` items, indexes `suspension_resume` items by
 * `suspensionId`, applies the option filters, and stamps `isResolving` from the
 * supplied in-flight set. Exported for direct unit testing (the react package
 * has no DOM render harness by convention).
 */
export declare function deriveSuspensions(items: readonly OutputItem[], options?: UseSuspensionsOptions, inFlight?: ReadonlySet<string>): {
    suspensions: SuspensionView[];
    pending: SuspensionView[];
};
/**
 * Arguments for {@link resolveSuspension}. `markStart`/`markEnd` toggle the
 * caller's in-flight set; `setError` is the error slot setter. `resolve` is the
 * session's streaming answer (`SessionView.answerSuspension`) — the resolution
 * streams the continuation back into `session.items`.
 */
export interface ResolveSuspensionArgs {
    resolve: (args: {
        suspensionId: string;
        requestId: string;
        action: ResumeAction;
        data?: unknown;
    }) => Promise<void>;
    item: Pick<SuspensionItem, "suspensionId" | "requestId">;
    action: ResumeAction;
    data?: unknown;
    markStart: (id: string) => void;
    markEnd: (id: string) => void;
    setError: (error: Error | null) => void;
}
/**
 * The shared body of `approve`/`reject`. Marks in-flight, streams the resolution
 * through the session's answer (so the continuation renders live), captures any
 * error into `setError`, and **rethrows** so callers can branch on success.
 * In-flight is always cleared in `finally`. Exported for direct unit testing.
 */
export declare function resolveSuspension(args: ResolveSuspensionArgs): Promise<void>;
/**
 * Derives suspension state from `session.items` and returns approve/reject
 * actions. Derivation is a `useMemo` over the live stream; resolution
 * goes through `session.answerSuspension`.
 */
export declare function useSuspensions(session: SessionView, options?: UseSuspensionsOptions): UseSuspensionsResult;
//# sourceMappingURL=useSuspensions.d.ts.map