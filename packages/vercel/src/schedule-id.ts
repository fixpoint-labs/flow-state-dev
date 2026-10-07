/**
 * The dispatch id of a dynamic schedule, kept free of imports.
 *
 * A copy of `formatScheduleId` from `@flow-state-dev/scheduled`. That package
 * is an optional peer, and `./schedules` promises no runtime imports, so the
 * tick cannot import it. `packages/scheduled/test/dispatch-id-contract.test.ts`
 * holds this copy, the BullMQ worker's and the canonical one to the same
 * output.
 */

/** `<orgId>/<userId>/<key>`, each part URL-encoded. */
export function dynamicScheduleId(orgId: string, userId: string, key: string): string {
  return [orgId, userId, key].map(encodeURIComponent).join("/");
}
