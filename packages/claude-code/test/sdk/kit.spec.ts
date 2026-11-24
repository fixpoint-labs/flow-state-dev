/**
 * `claudeCode()`: Claude Code as a small kit. It installs the collections a
 * Claude Code run records into, and fills the harness kit's `harnesses` slot
 * with Claude Code itself, so an app lists it beside the harness kit and its
 * coding workers can name `harness: claude-code`.
 *
 * Graded on what the running app serves: its flows and the readiness rows.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";
import { claudeCode } from "../../src/sdk/kit";

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-claude-code-kit-"));
  dirs.push(dir);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

const workspace = localWorkspaceHost({ root: join(tmpdir(), "fsd-claude-code-kit-runs"), remotes: { allow: [] }, source: () => ({ kind: "repo", repo: tmpdir() }) });

async function served(plan: boolean) {
  const directory = tree({
    "teams/core/workers/coder/WORKER.md": "---\nname: Coder\ndescription: Codes.\nflow: coder\nharness: claude-code\n---\nYou code.",
  });
  const state = createFlowState({
    kits: [claudeCode(plan ? { plan: true } : {}), harnesses({ workspace }), workforce({ directory })],
    stores: { default: { primary: inMemoryStores() } },
  });
  states.push(state);
  await state.ready();
  const { registry } = await state.getRuntime();
  return { flows: [...state.meta.flowKeys].sort(), registry };
}

describe("claudeCode()", () => {
  it("fills the harness slot with Claude Code and serves its collections", async () => {
    const { flows, registry } = await served(false);
    expect(flows).toEqual(["agent", "claude-code", "coder", "harnesses", "workforce-roster"]);
    const resources = Object.keys((registry.get("claude-code") as unknown as { resources?: object }).resources ?? {});
    expect(resources).toEqual(expect.arrayContaining(["observed-file-ops", "observed-gaps", "workspace-outcomes"]));
  });

  it("with `plan`, fills Claude Code in plan mode as a second harness", async () => {
    const directory = tree({
      "teams/core/workers/planner/WORKER.md": "---\nname: Planner\ndescription: Plans.\nflow: coder\nharness: claude-code-plan\n---\nYou plan.",
    });
    const start = (plan: boolean) => {
      const state = createFlowState({
        kits: [claudeCode(plan ? { plan: true } : {}), harnesses({ workspace }), workforce({ directory })],
        stores: { default: { primary: inMemoryStores() } },
      });
      states.push(state);
      return state.ready().then(() => "started", (error: Error) => error.message);
    };
    expect(await start(true)).toBe("started");
    expect(await start(false)).toContain("claude-code-plan");
  });
});
