/**
 * How the running request resumed (FIX-2129): a framework package reads it
 * where it admits a resumed request, before any of the request's own blocks
 * run. The claim gate reads it to let a task's own run, resumed `cancelled`
 * from a wait for a user, run to its end on a row already cancelled, holding
 * no claim.
 *
 * Framework-facing, like the request-end seam: the runtime attaches it under a
 * symbol key, so no handler body reaches it by name. A request that is not a
 * resume (a first run, or a crash recovery's continuation) reads `undefined`.
 */
import type { SuspensionStatus } from "./suspension";

/** How the suspension this request resumed from was resolved. */
export interface RequestResume {
  /** The suspension's resolution: `approved`, `submitted`, `cancelled`, `stopped`, `expired`, and so on. */
  readonly resolution: SuspensionStatus;
  /** Whether that suspension waited for a user (`isUserSuspension`). */
  readonly userSuspension: boolean;
}

/** The context slot the runtime attaches the resume reader under. */
export const REQUEST_RESUME_SEAM: unique symbol = Symbol.for("@flow-state-dev/request-resume-seam");

/**
 * How the running request resumed, or `undefined` when it is not a resume or
 * the context carries no seam (a hand-built test context).
 */
export function requestResumeOf(ctx: { readonly [REQUEST_RESUME_SEAM]?: () => RequestResume | undefined }): RequestResume | undefined {
  return ctx[REQUEST_RESUME_SEAM]?.();
}
