/**
 * A client component takes workforce names from `@flow-state-dev/workforce/browser`,
 * never from the package root.
 *
 * The root carries the channel floor, which reaches the orchestration task
 * board and `node:async_hooks`. A dev bundler that keeps a module a client
 * component names fails the page on that import: `GET /` answered 500 when the
 * picked-channel panel took `CHANNEL_POST_COMPONENT` from the root. The
 * subpath's own import graph is held Node-free by
 * `packages/workforce/test/browser-subpath-safe.test.ts`; this holds the app to
 * using it.
 *
 * A client component's whole graph is bundled for the browser, including the
 * helpers it imports that carry no directive of their own (`lib/workforce-shell.ts`),
 * so the check walks each `"use client"` module's relative and `@/` imports.
 *
 * Red state: value-import `@flow-state-dev/workforce` in any module a client
 * component reaches and the case fails naming the chain.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { findImportsFromEntry } from "@flow-state-dev/testing";
import { describe, expect, it } from "vitest";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `.ts`/`.tsx` file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const clientModules = ["app", "components", "lib"]
  .flatMap((dir) => sourceFiles(join(appDir, dir)))
  .filter((path) => /^\s*["']use client["']/.test(readFileSync(path, "utf8")));

describe("client components and the workforce package", () => {
  it("finds the client components it checks", () => {
    // Guards the scan itself: an empty list would pass the case below.
    expect(clientModules.map((path) => relative(appDir, path))).toEqual(
      expect.arrayContaining(["components/picked-session-panel.tsx", "app/page.tsx"]),
    );
  });

  it("no client component reaches a value import of the workforce package root", () => {
    // `import type` is erased and fine; the walk skips it.
    const offenders = clientModules.flatMap((path) =>
      findImportsFromEntry(path, (specifier) => specifier === "@flow-state-dev/workforce", {
        aliases: { "@/": appDir },
      }),
    );
    expect(offenders).toEqual([]);
  });
});
