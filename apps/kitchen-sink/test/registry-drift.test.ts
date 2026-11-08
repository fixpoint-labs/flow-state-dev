/**
 * Kitchen-sink's copies of the registry stay byte-identical to their source.
 *
 * `compareRegistryCopies` does the walk. This app's scope, which stories and
 * components it never installed, lives in `scripts/registry-copies.ts`,
 * which `pnpm registry:refresh` writes the copies from too.
 * `compared.length` fails a walk that passes by comparing less.
 */
import { describe, expect, it } from "vitest";
import { compareRegistryCopies } from "../../../packages/ui/scripts/registry-drift";
import { KITCHEN_SINK_REGISTRY_COPIES } from "../scripts/registry-copies";

const drift = () => compareRegistryCopies(KITCHEN_SINK_REGISTRY_COPIES);

describe("kitchen-sink registry drift (FIX-1477 V8)", () => {
  it("has every registry component byte-identical to its installed kitchen-sink copy", () => {
    const { compared, mismatches } = drift();

    // 44 of the registry's component-directory files (all non-`.stories.tsx`
    // files outside `generative/`, less the two connection components and
    // the task action row) are installed here. If that count moves,
    // this test's scope moved with it and needs re-reading before trusting a
    // green result.
    expect(compared.length).toBe(44);

    expect(mismatches).toEqual([]);
  });

  it("has no installed file that lacks a registry source (the symmetric direction)", () => {
    expect(drift().forks).toEqual([]);
  });
});
