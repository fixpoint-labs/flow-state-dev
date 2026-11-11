/**
 * Structural (FIX-2624, Cursor 5865490275): the no-session routes ask who the
 * caller is in one place, `resolveFlowCaller`, always at the address of the
 * flow whose rules apply. A second `resolvePrincipal` call in these files is
 * how a principal gets derived from a flow other than the one that runs (the
 * runBy-{flow} bypass) or hands a configured resolver the query's userId (the
 * identity read).
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
});
