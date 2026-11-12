/**
 * Structural (FIX-2624, Cursor 5865490275): the no-session routes ask who the
 * caller is in one place, `resolveFlowCaller`, always at the address of the
 * flow whose rules apply. A second `resolvePrincipal` call in these files is
 * how a principal gets derived from a flow other than the one that runs (the
 * runBy-{flow} bypass) or hands a configured resolver the query's userId (the
 * identity read). A write record (its session, a request's status, stream and
 * abort) answers to the flow whose door ran it: a named writer itself, never a
 * declarer picked by registry order.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const calls = (source: string) => source.match(/\.resolvePrincipal\(/g)?.length ?? 0;

describe("the no-session routes' caller", () => {
  it("is resolved only by resolveFlowCaller", () => {
    expect(calls(read("routes/scope-routes.ts"))).toBe(0);
    const address = read("resources/scope-address.ts");
    expect(calls(address)).toBe(1);
    const body = address.slice(address.indexOf("export async function resolveFlowCaller"), address.indexOf("export async function admitAddress"));
    expect(calls(body)).toBe(1);
  });

  it("governs a named writer's records by the writer, on every record route", () => {
    const flow = read("resources/default-write-flow.ts");
    const governor = flow.slice(flow.indexOf("function writeSessionGoverningFlow("), flow.indexOf("/** A refused write"));
    const writerBranch = governor.indexOf("registry.get(target.writer)");
    expect(writerBranch).toBeGreaterThan(-1);
    // The writer is chosen before any declarer could be.
    expect(writerBranch).toBeLessThan(governor.indexOf("resolveAddress("));
    // Every record route (a session, a request record, an in-flight entry) asks the one owner rule.
    const auth = read("routes/route-auth.ts");
    expect(auth.match(/ownerFlowOf\(ctx, /g)?.length).toBe(3);
    const owner = auth.slice(auth.indexOf("function ownerFlowOf("), auth.indexOf("function ownerFlowOf(") + 1200);
    expect(owner).toContain("writeRecordGovernor(ctx.registry, ctx.hostResolver, record)");
  });

  it("projects a direct read through the session snapshot's builder, never a second projection", () => {
    // A direct call to resolveClientData defaults to the whole state, where the snapshot gates it.
    for (const file of ["routes/scope-routes.ts", "resources/scope-address.ts"]) {
      expect(read(file)).not.toMatch(/resolveClientData\(/);
    }
    const address = read("resources/scope-address.ts");
    const project = address.slice(address.indexOf("export async function projectForClient"));
    expect(project.slice(0, project.indexOf("\n}\n"))).toContain("buildResourceSnapshot(");
    expect(read("routes/scope-routes.ts")).toContain("projectForClient(address, state)");
    // A collection entry: the session-addressed collection routes' own projection.
    expect(read("routes/scope-routes.ts")).toContain('import { applyClientData } from "./resource-routes";');
  });
});
