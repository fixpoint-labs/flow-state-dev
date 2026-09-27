/**
 * Guard: `@flow-state-dev/workforce/browser` stays browser-safe.
 *
 * A client component imports that subpath for the names a panel reads with —
 * the roster key, the channel post component, the transcript line type. A
 * browser bundler cannot resolve a Node built-in, so one module on that graph
 * importing `node:async_hooks` fails the whole page at compile time, in the
 * consumer's dev server rather than in our tests.
 *
 * That is how it broke: a kitchen-sink client component took
 * `CHANNEL_POST_COMPONENT` from the package root, the constant lived in
 * `channel-flow.ts`, and that module reaches the orchestration task board,
 * which imports `node:async_hooks`. The offending import sat in ANOTHER
 * package, so unlike `orchestration/test/tasks-subpath-browser-safe.spec.ts`
 * this walk follows workspace-package specifiers into their source through
 * each package's `exports`. Other bare specifiers (`zod`) are not followed.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findNodeBuiltinsFromEntry } from "@flow-state-dev/testing";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserEntry = path.join(pkgRoot, "src/browser.ts");

describe("@flow-state-dev/workforce/browser", () => {
  it("reaches no Node built-in, in this package or a workspace package it imports", () => {
    const offenders = findNodeBuiltinsFromEntry(browserEntry, { followWorkspacePackages: true });
    expect(
      offenders,
      `the browser entry reaches Node built-ins:\n${offenders.join("\n")}\n\n` +
        "Move the name a browser needs into a leaf module and export it from there."
    ).toEqual([]);
  });

  it("resolves, as a consumer imports it, to the file the walk starts from", async () => {
    // A consumer goes through `exports["./browser"]`; if that pointed anywhere
    // else, the walk above would be guarding the wrong module.
    const published = await import("@flow-state-dev/workforce/browser");
    expect(published).toBe(await import("../src/browser"));
  });

  it("still exports the names the kitchen-sink panels import", async () => {
    // The other direction: emptying the entry would pass the walk above.
    const entry = await import("@flow-state-dev/workforce/browser");
    expect(entry.CHANNEL_POST_COMPONENT).toBe("channel-post");
    expect(entry.HIRED_ROSTER_RESOURCE).toBe("hiredRoster");
    expect(entry.SEAT_INVENTORY_RESOURCE).toBe("seatInventory");
    expect(typeof entry.splitSeatAddress).toBe("function");
    expect(typeof entry.channelTranscriptLineSchema.parse).toBe("function");
    // The sixth, the `ChannelTranscriptLine` type, is pinned in `browser-exports.test-d.ts`.
  });

  it("finds the Node built-in the package root reaches through the channel floor", () => {
    // Proves the walk crosses into workspace packages: the root is NOT
    // browser-safe, and the offender lives in orchestration, not here.
    const offenders = findNodeBuiltinsFromEntry(path.join(pkgRoot, "src/index.ts"), {
      followWorkspacePackages: true,
    });
    expect(offenders.join("\n")).toMatch(/"node:async_hooks" via .*orchestration\/src\//);
  });
});
