/**
 * The workforce panels live on `@flow-state-dev/react/workforce`, not on the
 * root (FIX-2456 D3).
 *
 * The root is what a chat-app author autocompletes, and a chat app draws no
 * workforce records, so the panels went to a subpath named for who reads it.
 * These assertions hold that split from both sides: the subpath carries the
 * documented panel API and nothing more, the published manifest actually
 * serves it, and the root no longer pulls the panels in on its own. (The
 * deprecated root aliases, while Q1 keeps them, are held apart in
 * `workforce-root-aliases.test.ts` so removing them is one file.)
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as workforce from "../src/workforce";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const manifest = JSON.parse(readFileSync(here("../package.json"), "utf8")) as {
  exports: Record<string, { types: string; default: string }>;
  publishConfig: { exports: Record<string, { types: string; default: string }> };
};

describe("@flow-state-dev/react/workforce", () => {
  it("carries exactly the panel components and their helpers", () => {
    // The *PropNames lists are deliberately absent: they have no consumer and
    // no README entry, so they leave public surface instead of moving (E6).
    expect(Object.keys(workforce).sort()).toEqual(
      ["BOARD_STATUS_COLUMNS", "BoardColumns", "BoardList", "Roster", "WorkerDetail", "groupIntoColumns"].sort()
    );
  });

  it("is served by the package in the workspace and once published", () => {
    // A subpath missing from either map works in this repo and fails for an
    // adopter (or the reverse), which no in-repo import would notice.
    expect(manifest.exports["./workforce"]).toEqual({
      types: "./dist/workforce/index.d.ts",
      default: "./src/workforce/index.ts"
    });
    expect(manifest.publishConfig.exports["./workforce"]).toEqual({
      types: "./dist/workforce/index.d.ts",
      default: "./dist/workforce/index.js"
    });
    expect(existsSync(here("../src/workforce/index.ts"))).toBe(true);
  });

  it("is no longer re-exported by the root's own export list", () => {
    // The root reaches the panels only through the deprecated-alias module;
    // a direct re-export would put them back in every chat app's autocomplete.
    const root = readFileSync(here("../src/index.ts"), "utf8");
    expect(root).not.toMatch(/from\s+["']\.\/components\/panels["']/);
  });
});
