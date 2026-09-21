/**
 * V8 (specs/issues/FIX-1477/PLAN.md): every file this app installed from the
 * `@flow-state-dev/ui` registry stays byte-identical to its source.
 *
 * `components/flow-state/` is a copy-in, not a dependency (see this app's
 * `CLAUDE.md` → "UI Components: Upstream-First Convention"). A copy that
 * silently forks from its source stops being reviewable as "the registry" —
 * a reader who clones it inherits the fork and never learns they have one.
 * BR-14 in `specs/issues/FIX-1477/BUSINESS-RULES.md` is stricter here than
 * the registry's usual contract (an app that installs a component owns its
 * copy) precisely because this app's job is to *be* the copyable reference.
 *
 * This walks `packages/ui/registry/components/` directly rather than
 * `registry.json`'s manifest (originally V8's only source of files to
 * compare). `routed-specialists.tsx` and `evented-actors.tsx` both exist in
 * both directories, both drifted from their source, and neither is a
 * `registry.json` item — the manifest-scoped version of this check was
 * structurally blind to them (FIX-1477 S9 PR #2019, Cursor Bugbot finding).
 * A drift check whose scope silently excludes real drift is worse than no
 * check: it reads as proof the pair is fine.
 *
 * Two categories of registry-source file are deliberately excluded, both
 * confirmed by walking the tree rather than assumed:
 *
 * - `*.stories.tsx` — Storybook stories. Dev-only source for the registry
 *   package itself; this app has no Storybook setup and installs none of
 *   them (confirmed: `components/flow-state/` contains zero `.stories.tsx`
 *   files, so there is nothing to compare them against).
 * - `generative/` — the two components (`info-card.tsx`, `link-card.tsx`)
 *   this app never installed. Absence, not drift; matches the 25-of-27
 *   installed count the old manifest-scoped version of this test asserted.
 *
 * Every other file under `packages/ui/registry/components/` must have a
 * byte-identical counterpart at the same relative path under
 * `apps/kitchen-sink/components/flow-state/`.
 *
 * The count assertion is the anti-game clause: deleting a source file, or
 * quietly un-installing a target, would otherwise shrink the comparison set
 * and pass by shipping less rather than by matching more.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "../../..");
const registrySourceDir = join(repoRoot, "packages/ui/registry/components");
const kitchenSinkTargetDir = join(repoRoot, "apps/kitchen-sink/components/flow-state");

/** Every file under `dir`, recursively, as paths relative to `dir`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full).map((f) => join(entry, f)));
    } else {
      out.push(entry);
    }
  }
  return out;
}

/** Registry source files this app is expected to have installed a copy of. */
function comparableSourceFiles(): string[] {
  return walk(registrySourceDir)
    .filter((f) => !f.endsWith(".stories.tsx"))
    .filter((f) => !f.startsWith("generative/"))
    .sort();
}

describe("kitchen-sink registry drift (FIX-1477 V8)", () => {
  it("has every registry component byte-identical to its installed kitchen-sink copy", () => {
    const files = comparableSourceFiles();

    // 36 of the registry's component-directory files (all non-`.stories.tsx`
    // files outside `generative/`) are installed here. If that count moves,
    // this test's scope moved with it and needs re-reading before trusting a
    // green result.
    expect(files.length).toBe(36);

    const mismatches: string[] = [];
    for (const file of files) {
      const sourcePath = join(registrySourceDir, file);
      const targetPath = join(kitchenSinkTargetDir, file);
      const source = readFileSync(sourcePath, "utf8");
      let target: string;
      try {
        target = readFileSync(targetPath, "utf8");
      } catch {
        mismatches.push(`${file} (not installed in kitchen-sink)`);
        continue;
      }
      if (source !== target) {
        mismatches.push(file);
      }
    }

    expect(mismatches).toEqual([]);
  });
});
