/**
 * `useReadFence` lives on `@flow-state-dev/react/internal`, not the root
 * (FIX-2455, epic FIX-2447 D2).
 *
 * The root is what an app author autocompletes; the fence is a seam our own
 * packages share (react's collection hooks, the DevTool) and no page
 * documents. It moved with no alias left on the root (the epic's Q1 was
 * answered "break"), and the published manifest serves the subpath.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as internal from "../src/internal";
import * as root from "../src";

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
  exports: Record<string, { types: string; default: string }>;
  publishConfig: { exports: Record<string, { types: string; default: string }> };
};

describe("@flow-state-dev/react/internal", () => {
  it("carries the read fence, the suspension reduction, and the client and fenced read workforce's components use", () => {
    expect(Object.keys(internal).sort()).toEqual(["deriveSuspensions", "useClient", "useFencedRead", "useReadFence"]);
  });

  it("is gone from the root, with no alias", () => {
    expect(Object.keys(root)).not.toContain("useReadFence");
  });

  it("is served from source in the workspace and from dist when published", () => {
    expect(manifest.exports["./internal"]).toEqual({ types: "./dist/internal.d.ts", default: "./src/internal.ts" });
    expect(manifest.publishConfig.exports["./internal"]).toEqual({
      types: "./dist/internal.d.ts",
      default: "./dist/internal.js"
    });
  });
});
