/**
 * Kitchen-sink's copies of the registry stay byte-identical to their source.
 *
 * `compareRegistryCopies` does the walk. This file only states this app's
 * scope: stories are not installed, and neither are the two `generative/`
 * components. `compared.length` fails a walk that passes by comparing less.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareRegistryCopies } from "../../../packages/ui/scripts/registry-drift";

/**
 * Files under `components/flow-state/` with no registry source, kept
 * app-only on purpose. Each entry needs a reason — this is an explicit
 * allowlist, not a pattern exclusion, so a future fork with no source
 * still fails loudly instead of matching a wildcard meant for something
 * else.
 */
const APP_ONLY_FILES: Record<string, string> = {};

const testDir = dirname(fileURLToPath(import.meta.url));
const kitchenSinkTargetDir = join(testDir, "../components/flow-state");

const drift = () =>
  compareRegistryCopies({
    targetDir: kitchenSinkTargetDir,
    notInstalled: (file) => file.startsWith("generative/"),
    appOnly: APP_ONLY_FILES,
  });

describe("kitchen-sink registry drift (FIX-1477 V8)", () => {
  it("has every registry component byte-identical to its installed kitchen-sink copy", () => {
    const { compared, mismatches } = drift();

    // 36 of the registry's component-directory files (all non-`.stories.tsx`
    // files outside `generative/`) are installed here. If that count moves,
    // this test's scope moved with it and needs re-reading before trusting a
    // green result.
    expect(compared.length).toBe(36);

    expect(mismatches).toEqual([]);
  });

  it("has no installed file that lacks a registry source (the symmetric direction)", () => {
    expect(drift().forks).toEqual([]);
  });
});
