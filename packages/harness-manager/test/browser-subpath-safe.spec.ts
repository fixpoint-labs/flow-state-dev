/**
 * Guard: `@flow-state-dev/harness-manager/browser` stays browser-safe.
 *
 * An app's task view imports that subpath to show what a run recorded. The
 * package root provisions checkouts through `@flow-state-dev/workspace`, which
 * imports Node built-ins, so one import from the root on this graph fails a
 * consumer's page at compile time. The walk follows workspace-package
 * specifiers into their source, since the offender can sit in another package.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findNodeBuiltinsFromEntry } from "@flow-state-dev/testing";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserEntry = path.join(pkgRoot, "src/browser.ts");

describe("@flow-state-dev/harness-manager/browser", () => {
  it("reaches no Node built-in, in this package or a workspace package it imports", () => {
    const offenders = findNodeBuiltinsFromEntry(browserEntry, { followWorkspacePackages: true });
    expect(
      offenders,
      `the browser entry reaches Node built-ins:\n${offenders.join("\n")}\n\n` +
        "Move the name a browser needs into a leaf module and export it from there.",
    ).toEqual([]);
  });

  it("resolves, as a consumer imports it, to the file the walk starts from", async () => {
    // A consumer goes through `exports["./browser"]`; pointed anywhere else, the walk guards the wrong module.
    const published = await import("@flow-state-dev/harness-manager/browser");
    expect(published).toBe(await import("../src/browser"));
  });

  it("still exports the reader an app's task view imports", async () => {
    // The other direction: emptying the entry would pass the walk above.
    const entry = await import("@flow-state-dev/harness-manager/browser");
    expect(typeof entry.readRecordedWork).toBe("function");
  });

  it("finds the Node built-in the package root reaches", () => {
    // The control: the walk does see built-ins, so its silence on the entry means something.
    const offenders = findNodeBuiltinsFromEntry(path.join(pkgRoot, "src/index.ts"), { followWorkspacePackages: true });
    expect(offenders.length).toBeGreaterThan(0);
  });
});
