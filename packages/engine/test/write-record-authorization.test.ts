// FIX-2624.
/**
 * Structural: every route-layer place that resolves a stored record's owner
 * either asks the one write-record rule first (`writeRecordGovernor` or
 * `isWriteRecord`, `default-write-flow.ts`), or serves only records the route
 * guard already admitted through it. A write record never falls
 * through to the host's resolver.
 *
 * A new file under `src/routes/` that calls `resolveRecordOwner` fails here
 * until it is classified below, with its reason.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

  it("installs the built-in flows at every runtime entry that resolves flows from a registry", () => {
    // The host does; so must anything else that runs actions on a registry it resolves itself
    // (a queue worker), or a job addressed to the default write flow is an unknown flow there.
    const host = readFileSync(join(__dirname, "../src/transports/host/createInboundTransportHost.ts"), "utf8");
    expect(host).toContain("installBuiltIns(registry)");
    const packages = join(__dirname, "../..");
    const entries: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(path, "utf8");
          // Resolves a flow on a registry it holds (not a host's or a runtime's), then runs it.
          if (/(?<![.\w])registry\.get\(/.test(source) && /\brunAction\(/.test(source)) entries.push(path);
        }
      }
    };
    for (const name of readdirSync(packages)) {
      if (name === "engine") continue;
      try {
        walk(join(packages, name, "src"));
      } catch {
        // a package with no src
      }
    }
    expect(entries.length, "no runtime entry found: the scan has stopped seeing the worker").toBeGreaterThan(0);
    const missing = entries.filter((path) => !readFileSync(path, "utf8").includes("installBuiltIns("));
    expect(missing, "a runtime entry resolves flows without the framework's built-ins").toEqual([]);
  });

  it("gives the default write flow the host's own resolver, and uses it only to compare declarations", () => {
    // The route and the default write flow reach one verdict on whether declarations agree
    // (`declarationsAgree`, through `resolveAddress`), so both use the same host resolver. The
    // built-in flow captures none at install (one instance serves every host sharing a registry):
    // it reads the running runtime's off its context, which the router and the worker set.
    const router = readFileSync(join(ROUTES, "http-handlers.ts"), "utf8");
    expect(router).toMatch(/const runtimeConfig: RuntimeConfig = \{[^}]*\bhostResolver\b/);
    const context = readFileSync(join(__dirname, "../src/context/createExecutionContext.ts"), "utf8");
    expect(context).toContain("hostResolver: options.effectiveRuntimeConfig?.hostResolver");
    expect(context.match(/attachBuiltInHost\((rootContext|childContext), builtInHost\)/g)?.length).toBe(2);
    // Every worker adapter createFlowState starts hands the worker the host's resolver, from the
    // runtime it is given: no caller supplies it, and a new adapter can't leave it out.
    const packages = join(__dirname, "../..");
    const adapters = readdirSync(packages).flatMap((pkg) => {
      const src = join(packages, pkg, "src");
      if (!existsSync(src)) return [];
      return readdirSync(src, { recursive: true })
        .map((file) => join(src, String(file)))
        .filter((file) => file.endsWith(".ts") && readFileSync(file, "utf8").includes("startWorker: ("));
    });
    expect(adapters.length).toBeGreaterThan(0);
    for (const file of adapters) expect(readFileSync(file, "utf8"), file).toContain("resolvePrincipal: rt.resolvePrincipal");
    const worker = readFileSync(join(__dirname, "../../bullmq/src/worker.ts"), "utf8");
    expect(worker).toContain("installBuiltIns(registry)");
    expect(worker).toContain("hostResolver: deps.resolvePrincipal ?? defaultBodyUserIdPrincipalResolver");
    // Inside the flow it reaches nothing but the agreement check: never a caller, never an owner.
    const flow = readFileSync(join(__dirname, "../src/resources/default-write-flow.ts"), "utf8");
    const body = flow.slice(flow.indexOf("function writeOperations("));
    const uses = body.split("\n").filter((line) => /\bhostResolver\b/.test(line)).map((line) => line.trim());
    expect(uses).toEqual([
      "const hostResolver = host.hostResolver ?? defaultBodyUserIdPrincipalResolver;",
      "const address = resolveAddress(registry, hostResolver, target.scope, target.key, (flow) =>"
    ]);
    // And no store but the running runtime's.
    expect(body).not.toMatch(/options\.stores|\bstores\s*[,:]\s*StoreRegistry/);
    // `resolveAddress` compares resolvers; it never calls one.
    const address = readFileSync(join(__dirname, "../src/resources/scope-address.ts"), "utf8");
    const compare = address.slice(address.indexOf("export function resolveAddress("), address.indexOf("export type AddressCaller"));
    expect(compare).not.toMatch(/resolver\(|hostResolver\(|resolvePrincipal\(/);
    // The governor of a write record is handed the route's own host resolver.
    const auth = readFileSync(join(ROUTES, "route-auth.ts"), "utf8");
    expect(auth).toContain("writeRecordGovernor(ctx.registry, ctx.hostResolver, record)");
  });

  it("guards every parsed route before authorization", () => {
    const handlers = readFileSync(join(ROUTES, "http-handlers.ts"), "utf8");
    const guard = handlers.indexOf("reservedAddressRefusal(route)");
    const auth = handlers.indexOf("authorizeManagementRoute(request, route");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(auth);
  });
});
