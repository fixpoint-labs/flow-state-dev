// FIX-2536.
/**
 * `@flow-state-dev/vercel/schedules` with `@flow-state-dev/scheduled` absent:
 * that package is an optional peer, so the module must load
 * without it. An app that only uses `createGetToPostCronShim` installs no
 * schedule index.
 *
 * Why this matters: a top-level runtime import of the peer makes the whole
 * subpath fail to load for those apps. Only the tick handler needs the shared
 * tick, and it loads it when it runs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(import.meta.dirname, "../src/schedules.ts"), "utf8");

describe("the schedules subpath and its optional peer", () => {
  it("imports @flow-state-dev/scheduled for types only at the top level", () => {
    const statics = SOURCE.split("\n").filter((line) => /^import\b/.test(line) && line.includes("@flow-state-dev/scheduled"));
    expect(statics.length).toBeGreaterThan(0);
    for (const line of statics) expect(line).toMatch(/^import type\b/);
  });

  it("loads the shared tick only inside the tick handler, with a dynamic import", () => {
    expect(SOURCE).toMatch(/await import\("@flow-state-dev\/scheduled\/collection"\)/);
  });
});
