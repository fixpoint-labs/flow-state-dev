/**
 * Guard: importing `@flow-state-dev/harness-manager` never pulls in
 * workforce. The harness kit (`./kit`) requires workforce and is the only
 * entry that imports it; the root (the manager, the judge, the checks, the
 * session flow) stays usable by an app with no workforce. The walk follows
 * workspace packages, so an import that reaches workforce through another
 * package is caught too.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findImportsFromEntry } from "@flow-state-dev/testing/bundle";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workforce = (specifier: string) => specifier === "@flow-state-dev/workforce" || specifier.startsWith("@flow-state-dev/workforce/");

describe("@flow-state-dev/harness-manager", () => {
  it("reaches no workforce module from its root", () => {
    const offenders = findImportsFromEntry(path.join(pkgRoot, "src/index.ts"), workforce, { followWorkspacePackages: true });
    expect(offenders, `the root reaches workforce:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("finds workforce from the kit entry", () => {
    // The control: the walk does see workforce, so its silence on the root means something.
    const offenders = findImportsFromEntry(path.join(pkgRoot, "src/kit/index.ts"), workforce, { followWorkspacePackages: true });
    expect(offenders.length).toBeGreaterThan(0);
  });
});
