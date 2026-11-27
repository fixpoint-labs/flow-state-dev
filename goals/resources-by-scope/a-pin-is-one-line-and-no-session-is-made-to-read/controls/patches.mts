/**
 * The goal's named controls, as scratch patches to engine source modules,
 * applied as the run under test loads them (`goals/lib/module-patch.mjs`).
 * Nothing is written to the checkout; the run prints each patch in full and
 * fails when one never reached the code it serves.
 *
 *   no-version-check     the default write flow writes without the version the
 *                        client read: every `input.version` check is dropped,
 *                        so a stale write lands over a newer one. Leg b must
 *                        FAIL on `b:both-changes-stored`.
 *   principal-from-body  the scope routes' caller is the `userId` the request
 *                        claims (body or query), not the one the resolver
 *                        signed in. Leg b must FAIL on `b:forged-user-ignored`.
 */
import type { ModulePatch } from "../../../lib/index.mts";

const WRITE_FLOW = "packages/engine/src/resources/default-write-flow.ts";
const SCOPE_ADDRESS = "packages/engine/src/resources/scope-address.ts";

export const PATCHES: Record<string, ModulePatch[]> = {
  "no-version-check": [
    {
      module: WRITE_FLOW,
      from: String.raw`if \(input\.version !== (?:current\.version|currentVersion)\) throw stale\([^;]*\);`,
      to: "/* GOAL_CONTROL=no-version-check: the version read is not checked */"
    }
  ],
  "principal-from-body": [
    {
      module: SCOPE_ADDRESS,
      from: String.raw`return \{ userId: caller\.userId, orgId: caller\.orgId \};`,
      to: "return { userId: options.claimedUserId ?? caller.userId, orgId: caller.orgId };"
    }
  ]
};
