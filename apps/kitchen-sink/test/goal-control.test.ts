/**
 * `goalControl()` — the one gate every goal control passes through.
 *
 * A control swaps real behaviour for a broken stand-in so a goal check can be
 * seen to fail. That must never reach a deployed build, so the gate reads
 * `GOAL_CONTROL` only under `KITCHEN_SINK_TEST_MODE=1`.
 *
 * And V4 of `specs/issues/FIX-1611/PLAN.md` (BR-22): every control this app
 * carries asks the gate rather than the environment, so each is inert outside
 * test mode; and nothing under `packages/` reads a control at all. Each
 * control is also seen to swap its stand-in in under test mode, so "inert" is
 * not a control that never does anything.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handler } from "@flow-state-dev/core";
import { channelPostCapability, type ChannelManifest } from "@flow-state-dev/workforce";
import { z } from "zod";

import { goalControl, pageGoalControl } from "@/lib/goal-control";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("goalControl", () => {
  it("names no control outside test mode, whatever GOAL_CONTROL says", () => {
    vi.stubEnv("GOAL_CONTROL", "no-author-filter");
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
    expect(goalControl()).toBeUndefined();
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "0");
    expect(goalControl()).toBeUndefined();
  });

  it("names the control in test mode, and none when GOAL_CONTROL is empty", () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "no-author-filter");
    expect(goalControl()).toBe("no-author-filter");
    vi.stubEnv("GOAL_CONTROL", "");
    expect(goalControl()).toBeUndefined();
  });
});

const APP = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(APP, "..", "..");

/** Every TypeScript source file under `dir`, skipping dependencies and build output. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourcesUnder(path));
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(path);
  }
  return out;
}

describe("V4 · every control is read through the gate, and only in this app (BR-22)", () => {
  it("reads GOAL_CONTROL in one place in the app: the gate", () => {
    const readers = ["app", "components", "flows", "lib", "workforce", "fsdev.config.ts"]
      .flatMap((part) => (part.endsWith(".ts") ? [join(APP, part)] : sourcesUnder(join(APP, part))))
      .filter((path) => /process\.env\.GOAL_CONTROL|env\[["']GOAL_CONTROL["']\]/.test(readFileSync(path, "utf8")))
      .map((path) => relative(APP, path));
    expect(readers).toEqual(["lib/goal-control.ts"]);
  });

  it("reads no control anywhere under packages/", () => {
    const names = ["GOAL_CONTROL", "KITCHEN_SINK_TEST_MODE"];
    const hits = sourcesUnder(join(REPO, "packages"))
      .flatMap((path) => {
        const text = readFileSync(path, "utf8");
        return names.filter((name) => text.includes(name)).map((name) => `${relative(REPO, path)}: ${name}`);
      });
    expect(hits).toEqual([]);
  });

  /** Each control, off and on: what it hands back outside test mode, and in it. */
  const wake = handler({ name: "a-wake", inputSchema: z.unknown(), outputSchema: z.unknown(), execute: () => null });
  const catalog = { escalate: handler({ name: "escalate", inputSchema: z.unknown(), outputSchema: z.unknown(), execute: () => null }) };
  const routed = [{ id: "support.help", declared: { routing: { fallback: "support.general" } } }] as unknown as ChannelManifest[];

  const controls: Array<[name: string, apply: () => Promise<{ swapped: boolean }>]> = [
    ["no-landing", async () => ({ swapped: (await import("@/lib/channel-landing-control")).channelLandingControl(catalog, channelPostCapability) !== undefined })],
    ["no-filing", async () => ({ swapped: (await import("@/lib/escalate-control")).escalateControl(catalog) !== undefined })],
    ["no-route", async () => ({ swapped: (await import("@/lib/channel-route-control")).withChannelRouteControl(routed) !== routed })],
    ["name-only-notify", async () => ({ swapped: (await import("@/lib/channel-wake-control")).withChannelWakeControl(wake) !== wake })],
    ["no-author-filter", async () => ({ swapped: (await import("@/lib/channel-wake-control")).withChannelWakeControl(wake) !== wake })],
    ["post-without-author", async () => ({ swapped: (await import("@/lib/channel-post-control")).channelPostControl() !== undefined })],
  ];

  it.each(controls)("%s: inert outside test mode, and swapped in under it", async (name, apply) => {
    vi.stubEnv("GOAL_CONTROL", name);
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
    expect(await apply()).toEqual({ swapped: false });
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    expect(await apply()).toEqual({ swapped: true });
  });
});

describe("pageGoalControl", () => {
  const opened = (query: string) => new URLSearchParams(query);

  it("ignores ?goalControl in a build not made for tests", () => {
    vi.stubEnv("NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE", "");
    expect(pageGoalControl(opened("goalControl=no-live"))).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE", "0");
    expect(pageGoalControl(opened("goalControl=no-live"))).toBeUndefined();
  });

  it("names the control a test build's page was opened with, and none when absent", () => {
    vi.stubEnv("NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE", "1");
    expect(pageGoalControl(opened("goalControl=no-live"))).toBe("no-live");
    expect(pageGoalControl(opened("goalControl="))).toBeUndefined();
    expect(pageGoalControl(opened(""))).toBeUndefined();
  });
});
