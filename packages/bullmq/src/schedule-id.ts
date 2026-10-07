/**
 * The dispatch id of a dynamic schedule, kept free of imports.
 *
 * A copy of `formatScheduleId` from `@flow-state-dev/scheduled`, which is an
 * optional peer of this package and so cannot be imported at runtime.
 * `packages/scheduled/test/dispatch-id-contract.test.ts` holds this copy, the
 * Vercel tick's and the canonical one to the same output.
 */

/** `<orgId>/<userId>/<key>`, each part URL-encoded. */
export function dynamicScheduleId(orgId: string, userId: string, key: string): string {
  return [orgId, userId, key].map(encodeURIComponent).join("/");
}
