/**
 * Claude Code filled into the harness kit as a plain value, the way Codex and
 * Cursor are: its coding workers can name `harness: claude-code`, and the
 * collections a Claude Code run records its work into are served by the flow
 * that runs it, with no Claude Code kit and no flow of its own.
 *
 * Graded on what the running app serves: its flows and their resources.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeCodeHarness } from "@flow-state-dev/claude-code";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { localRepoWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-claude-code-harness-"));
  dirs.push(dir);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

const workspace = localRepoWorkspaceHost({ root: join(tmpdir(), "fsd-claude-code-harness-runs"), repo: tmpdir() });

async function start(values: ReturnType<typeof claudeCodeHarness>[], harness: string) {
  const directory = tree({
    "teams/core/workers/coder/WORKER.md": `---\nname: Coder\ndescription: Codes.\nflow: coder\nharness: ${harness}\n---\nYou code.`,
  });
  const state = createFlowState({
    kits: [harnesses({ workspace }), workforce({ directory })],
    fill: { [harnesses.slots.harnesses]: values },
    stores: { default: { primary: inMemoryStores() } },
  });
  states.push(state);
  return state;
}

describe("Claude Code as a harness value", () => {
  it("serves its run's collections on the coder flow", async () => {
    const state = await start([claudeCodeHarness()], "claude-code");
    await state.ready();
    const { registry } = await state.getRuntime();
    expect([...state.meta.flowKeys]).not.toContain("claude-code");
    const resources = Object.keys((registry.get("coder") as unknown as { resources?: object }).resources ?? {});
    expect(resources).toEqual(expect.arrayContaining(["observed-file-ops", "observed-gaps"]));
  });

  it("is in plan mode only as the `claude-code-plan` value", async () => {
    const without = await start([claudeCodeHarness()], "claude-code-plan");
    expect(await without.ready().then(() => "started", (error: Error) => error.message)).toContain("claude-code-plan");
    const both = await start([claudeCodeHarness(), claudeCodeHarness({ plan: true })], "claude-code-plan");
    expect(await both.ready().then(() => "started", (error: Error) => error.message)).toBe("started");
  });
});
