/**
 * Structural: every route-layer place that resolves a stored record's owner
 * either asks the one write-record rule first (`writeRecordGovernor` or
 * `isWriteRecord`, `default-write-flow.ts`), or serves only records the route
 * guard already admitted through it (FIX-2624). A write record never falls
 * through to the host's resolver.
 *
 * A new file under `src/routes/` that calls `resolveRecordOwner` fails here
 * until it is classified below, with its reason.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = join(__dirname, "../src/routes");

/** Files that authorize a record themselves: each must apply the write-record rule. */
const AUTHORIZES = new Set([
  "route-auth.ts", // ownerFlowOf: every session, request and blob route's guard
  "instance-caller.ts", // ownResolverVerdict: the session and active-request listings
  "recovery-routes.ts" // the active and interrupted listings
]);

/** Files that resolve the owner of a record route-auth (or a listing above) already admitted. */
const SERVES_ADMITTED = new Set([
  "route-utils.ts", // resolveOwnerFlow for a session the guard checked; write sessions never reach it
  "client-session.ts", // the same, for the client's session reads
  "debug-snapshot.ts", // debug reads of a session the guard checked
  "session-routes.ts" // the session listing, after ownResolverVerdict
]);

describe("write-record authorization", () => {
  const files = readdirSync(ROUTES).filter((name) => name.endsWith(".ts"));
  const callers = files.filter((name) => readFileSync(join(ROUTES, name), "utf8").includes("resolveRecordOwner("));

  it("classifies every route file that resolves a record's owner", () => {
    const unclassified = callers.filter((name) => !AUTHORIZES.has(name) && !SERVES_ADMITTED.has(name));
    expect(unclassified, "a new owner lookup: apply the write-record rule, then classify it here").toEqual([]);
  });

  it("applies the write-record rule in every file that authorizes a record", () => {
    for (const name of AUTHORIZES) {
      const source = readFileSync(join(ROUTES, name), "utf8");
      expect(/writeRecordGovernor\(|isWriteRecord\(/.test(source), `${name} authorizes without the write-record rule`).toBe(true);
    }
  });

  it("guards every parsed route before authorization", () => {
    const handlers = readFileSync(join(ROUTES, "http-handlers.ts"), "utf8");
    const guard = handlers.indexOf("reservedAddressRefusal(route)");
    const auth = handlers.indexOf("authorizeManagementRoute(request, route");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(auth);
  });
});
