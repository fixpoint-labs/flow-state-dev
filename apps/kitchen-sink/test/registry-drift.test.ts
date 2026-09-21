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
 * The count assertion is the anti-game clause: deleting a manifest row, or
 * quietly un-installing a target, would otherwise shrink the comparison set
 * and pass by shipping less rather than by matching more.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "../../..");
const registryJsonPath = join(repoRoot, "packages/ui/registry.json");

interface RegistryFile {
  path: string;
  target: string;
}

interface RegistryItem {
  name: string;
  files: RegistryFile[];
}

function loadRegistryFiles(): RegistryFile[] {
  const registry = JSON.parse(readFileSync(registryJsonPath, "utf8")) as {
    items: RegistryItem[];
  };
  return registry.items.flatMap((item) => item.files);
}

describe("kitchen-sink registry drift (FIX-1477 V8)", () => {
  it("has every installed registry target byte-identical to its source", () => {
    const files = loadRegistryFiles();

    // The manifest's own targets the app never installed (the two
    // `generative/` components) are not drift — they are absence. Only the
    // targets actually present under `components/flow-state/` are compared.
    const installed = files.filter((file) => {
      const targetPath = join(repoRoot, "apps/kitchen-sink", file.target);
      try {
        readFileSync(targetPath);
        return true;
      } catch {
        return false;
      }
    });

    // 25 of the manifest's 27 files are installed — the two `generative/`
    // targets are the only ones this app never took. If that count moves,
    // this test's scope moved with it and needs re-reading before trusting
    // a green result.
    expect(installed.length).toBe(25);

    const mismatches: string[] = [];
    for (const file of installed) {
      const sourcePath = join(repoRoot, "packages/ui", file.path);
      const targetPath = join(repoRoot, "apps/kitchen-sink", file.target);
      const source = readFileSync(sourcePath, "utf8");
      const target = readFileSync(targetPath, "utf8");
      if (source !== target) {
        mismatches.push(file.target);
      }
    }

    expect(mismatches).toEqual([]);
  });
});
