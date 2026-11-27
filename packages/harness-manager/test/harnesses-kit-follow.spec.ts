/**
 * The harness kit hands each coding run a pull-request follower when the app
 * gives it one. Without it, a pull request a kit-built run opens is never
 * heard: its reviews, comments and CI reach nobody, so feedback on it goes
 * unanswered unless someone relays it.
 *
 * The follower needs the installation the kit's coding flow is built on (a
 * follow is polled through it), so the app gives a builder, and the kit calls
 * it with that installation and hands what it returns to every manager it builds.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import type { PullRequestFollower } from "@flow-state-dev/core/harness";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";
import type { Harness } from "@flow-state-dev/core/harness";
import { scriptedHarness } from "../src/scripted-harness";

/** What each harness manager the kit builds is configured with. */
const managerConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../src/manager", async (original) => {
  const actual = await original<typeof import("../src/manager")>();
  return {
    ...actual,
    harnessManager: (config: Record<string, unknown>) => {
      managerConfigs.push(config);
      return actual.harnessManager(config as never);
    },
  };
});

const { harnesses } = await import("../src/kit");

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  managerConfigs.splice(0);
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function team(): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-harness-kit-follow-"));
  dirs.push(dir);
  const file = join(dir, "teams/core/workers/codex/WORKER.md");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "---\nname: Codex\ndescription: Codex.\nflow: coder\nharness: codex\n---\nYou are Codex.");
  return dir;
}

const harness: Harness = { id: "codex", label: "Codex", agent: scriptedHarness({ stepEveryMs: 1 }).slot, readiness: async () => ({ ready: true }), pass: [] };
const workspace = localWorkspaceHost({ root: join(tmpdir(), "fsd-harness-kit-runs"), remotes: { allow: [] }, source: () => ({ kind: "repo", repo: tmpdir() }) });

async function start(config: Partial<Parameters<typeof harnesses>[0]>): Promise<void> {
  const state = createFlowState({
    kits: [harnesses({ workspace, ...config }), workforce({ directory: team() })],
    fill: { [harnesses.slots.harnesses]: [harness] },
    stores: { default: { primary: inMemoryStores() } },
  });
  states.push(state);
  await state.ready();
}

describe("the harness kit's pull-request follower", () => {
  it("hands every coding run's manager the follower the app built on the kit's installation", async () => {
    const follower = Object.assign(async () => undefined, { resources: {} }) as PullRequestFollower;
    const builtOn: unknown[] = [];
    await start({ onPullRequestRecorded: (installation) => (builtOn.push(installation), follower) });

    expect(builtOn.length).toBeGreaterThan(0);
    expect(builtOn[0]).toMatchObject({ sessionStateShape: expect.anything(), createCheck: expect.any(Function) });
    expect(managerConfigs.length).toBeGreaterThan(0);
    for (const config of managerConfigs) expect(config.onPullRequestRecorded).toBe(follower);
  });

  it("follows nothing when the app gives no follower", async () => {
    await start({});
    expect(managerConfigs.length).toBeGreaterThan(0);
    for (const config of managerConfigs) expect(config.onPullRequestRecorded).toBeUndefined();
  });
});
