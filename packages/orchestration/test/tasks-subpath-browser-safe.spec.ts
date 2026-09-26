/**
 * Guard: `@flow-state-dev/orchestration/tasks` stays browser-safe.
 *
 * `docs/architecture/items.md` publishes that subpath as browser-safe, so a UI
 * can value-import `extractTaskItems` and attribute items with the same
 * algorithm the substrate uses. A browser bundler cannot resolve a Node
 * built-in, so one module joining this entry with a `node:` import breaks every
 * consumer of that promise — at bundle time, in their build, not ours.
 *
 * That is exactly how it broke: `lease-renewal.ts` needs `node:async_hooks`,
 * was re-exported from this entry, and nothing noticed for six rounds of
 * review. The package as a whole is Node-only and allowed to be — the task
 * board uses `AsyncLocalStorage` too, and the main entry reaches `node:fs`
 * through skills. The constraint belongs to **this entry point**, not to the
 * package, which is why the check has to walk the reachable graph from the
 * entry rather than scan `src/` the way the contracts guard does.
 *
 * Scope: our own relative module graph. A bare specifier (`zod`,
 * `@flow-state-dev/core`) is not followed — those carry their own guarantees,
 * and `contracts-zero-dep.spec.ts` is the precedent for pinning them at their
 * own boundary.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findNodeBuiltinsFromEntry } from "@flow-state-dev/testing";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");

/** Entry points this package publishes as safe to bundle for a browser. */
const BROWSER_SAFE_ENTRIES = ["src/tasks/index.ts"];

// Package-local on purpose (see "Scope" above). Following workspace packages
// today reaches `node:module`/`node:url` via define-task-collection.ts -> the
// `@flow-state-dev/core` root -> core/src/models/createModelResolver.ts.
const findNodeBuiltins = (entry: string): string[] =>
  findNodeBuiltinsFromEntry(path.join(pkgRoot, entry), { followWorkspacePackages: false });

describe("browser-safe subpath exports", () => {
  for (const entry of BROWSER_SAFE_ENTRIES) {
    it(`${entry} reaches no Node built-in`, () => {
      const offenders = findNodeBuiltins(entry);
      expect(
        offenders,
        `${entry} is published as browser-safe but reaches Node built-ins:\n${offenders.join(
          "\n"
        )}\n\nEither keep the new module off this entry (export it from the ` +
          `package's main entry, which is Node-only), or drop the built-in.`
      ).toEqual([]);
    });
  }

  it("the entry still exports the utility the docs promise", () => {
    // Guards the other direction: "fix" the check by emptying the entry and
    // this fails. `extractTaskItems` is the export `docs/architecture/items.md`
    // names as the reason this subpath is browser-safe at all.
    const entry = readFileSync(path.join(pkgRoot, "src/tasks/index.ts"), "utf8");
    expect(entry).toMatch(/extractTaskItems/);
  });
});
