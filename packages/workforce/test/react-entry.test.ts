/**
 * Workforce's components live on `@flow-state-dev/workforce/react`, beside
 * the views they read, and nowhere else: `@flow-state-dev/react` has no
 * workforce subpath, with no alias (BP-034), and its root names none of them.
 * The package root stays free of React: only this entry imports it.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findImportsFromEntry } from "@flow-state-dev/testing/bundle";
import * as entry from "../src/react";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const manifest = (path: string) =>
  JSON.parse(readFileSync(here(path), "utf8")) as {
    exports: Record<string, { types: string; default: string }>;
    publishConfig: { exports: Record<string, { types: string; default: string }> };
  };

describe("@flow-state-dev/workforce/react", () => {
  it("carries the panel components and their helpers", () => {
    expect(Object.keys(entry).sort()).toEqual(["BOARD_STATUS_COLUMNS", "BoardColumns", "BoardList", "Roster", "WorkerDetail", "groupIntoColumns"].sort());
  });

  it("is served by the package in the workspace and once published, and React's package serves no workforce subpath", () => {
    const workforce = manifest("../package.json");
    expect(workforce.exports["./react"]).toEqual({ types: "./dist/react/index.d.ts", default: "./src/react/index.ts" });
    expect(workforce.publishConfig.exports["./react"]).toEqual({ types: "./dist/react/index.d.ts", default: "./dist/react/index.js" });
    const react = manifest("../../react/package.json");
    expect(react.exports["./workforce"]).toBeUndefined();
    expect(react.publishConfig.exports["./workforce"]).toBeUndefined();
    expect(existsSync(here("../../react/src/workforce"))).toBe(false);
  });

  it("keeps React off the package root", () => {
    const react = (specifier: string) => specifier === "react" || specifier.startsWith("@flow-state-dev/react");
    expect(findImportsFromEntry(here("../src/index.ts"), react, { followWorkspacePackages: true })).toEqual([]);
    // The control: the walk does see React from this entry, so its silence on the root means something.
    expect(findImportsFromEntry(here("../src/react/index.ts"), react, { followWorkspacePackages: true }).length).toBeGreaterThan(0);
  });
});
