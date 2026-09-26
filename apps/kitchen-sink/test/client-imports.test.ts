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
 * Red state: point any `"use client"` module's workforce import back at
 * `@flow-state-dev/workforce` and the case fails naming that file.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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

// A value import or re-export from the root. `import type` is erased and fine.
const rootValueImport =
  /(?:import|export)(?!\s+type\b)\b[^"';]*?\bfrom\s*["']@flow-state-dev\/workforce["']/;

describe("client components and the workforce package", () => {
  it("finds the client components it checks", () => {
    // Guards the scan itself: an empty list would pass the case below.
    expect(clientModules.map((path) => relative(appDir, path))).toEqual(
      expect.arrayContaining(["components/picked-session-panel.tsx", "app/page.tsx"]),
    );
  });

  it("no client component value-imports the workforce package root", () => {
    const offenders = clientModules
      .filter((path) => rootValueImport.test(readFileSync(path, "utf8")))
      .map((path) => relative(appDir, path));
    expect(offenders).toEqual([]);
  });
});
