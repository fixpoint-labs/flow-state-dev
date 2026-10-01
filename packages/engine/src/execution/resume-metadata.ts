/**
 * Request metadata keys that must never act as a resume instruction (FIX-1707).
 *
 * `metadata` reaches `runAction` from the caller — the HTTP body, a transport
 * envelope, a persisted record a caller once wrote. `resumeContext` and
 * `resumeOf` used to be read from it, which let a caller pre-approve a
 * human-approval gate or release another request's resume lease (BP-031). A
 * resolution now arrives only as `RunActionOptions.resumeContext`, set by
 * `continueRequest`; these keys are dropped wherever metadata enters a run.
 */

/** Metadata keys stripped before a run starts. */
export const RESUME_METADATA_KEYS = ["resumeContext", "resumeOf"] as const;

/** True when `metadata` carries any {@link RESUME_METADATA_KEYS} key. */
export function hasResumeMetadata(metadata: Record<string, unknown> | undefined): boolean {
  return metadata !== undefined && RESUME_METADATA_KEYS.some((key) => key in metadata);
}

/**
 * `metadata` without the {@link RESUME_METADATA_KEYS} keys. Returns the same
 * object when it carries none, so the common path allocates nothing.
 */
export function stripResumeMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (metadata === undefined || !hasResumeMetadata(metadata)) return metadata;
  const { resumeContext: _resumeContext, resumeOf: _resumeOf, ...rest } = metadata;
  return rest;
}
