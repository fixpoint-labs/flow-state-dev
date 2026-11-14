/**
 * The harness kit: an app lists `harnesses({ workspace })` beside workforce
 * and fills its `harnesses` slot with harness values. It gets one coding
 * worker flow, `coder`, every coding worker runs on, and a readiness view
 * with one row per harness filled, with no host-side coding flow, readiness
 * map or readiness flow.
 *
 * Graded on what the running app serves and refuses.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";
import type { Harness } from "../src/harness";
import { scriptedHarness } from "../src/scripted-harness";
import { harnesses } from "../src/kit";

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-harness-kit-"));
  dirs.push(dir);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

const worker = (name: string, extra: string) => `---\nname: ${name}\ndescription: ${name}.\n${extra}---\nYou are ${name}.`;
const TEAM = {
  "teams/core/workers/lead/WORKER.md": worker("Lead", ""),
  "teams/core/workers/codex/WORKER.md": worker("Codex", "flow: coder\nharness: codex\n"),
};

/** A harness whose run is never started here: what a test of the install needs. */
const harness = (id: string, ready: boolean): Harness => ({
  id,
  label: id.toUpperCase(),
  agent: scriptedHarness({ stepEveryMs: 1 }).slot,
  readiness: async () => (ready ? { ready: true } : { ready: false, reason: `${id} is signed out`, remedy: `sign ${id} in` }),
  pass: [],
});

const workspace = localWorkspaceHost({ root: join(tmpdir(), "fsd-harness-kit-runs"), remotes: { allow: [] }, source: () => ({ kind: "repo", repo: tmpdir() }) });

function start(kits: Parameters<typeof createFlowState>[0]["kits"], fill: Record<string, unknown>): FlowState {
  const state = createFlowState({ kits, fill, stores: { default: { primary: inMemoryStores() } } });
  states.push(state);
  return state;
}

/** The readiness view's rows, read as a client reads it: through the router, with no session. */
async function readinessEntries(state: FlowState): Promise<Array<{ harness: string; label: string; ready: boolean }>> {
  const router = await state.getRouter();
  const path = ["harnesses", "views", "readiness"];
  const res = await router.POST(
    new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice", input: {} }),
    }),
    { params: { path } },
  );
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { output: Array<{ harness: string; label: string; ready: boolean }> }).output;
}

describe("the harness kit", () => {
  it("serves one coding worker flow and a readiness view with one row per harness filled", async () => {
    const directory = tree(TEAM);
    const state = start([harnesses({ workspace }), workforce({ directory })], {
      [harnesses.slots.harnesses]: [harness("codex", true), harness("cursor", false)],
    });
    await state.ready();
    expect([...state.meta.flowKeys].sort()).toEqual(["agent", "coder", "harnesses", "workforce-roster"]);
    const entries = await readinessEntries(state);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((entry) => [entry.harness, entry.label, entry.ready])).toEqual([
      ["codex", "CODEX", true],
      ["cursor", "CURSOR", false],
    ]);
  });

  it("refuses a coding worker at hire when the kit's coding flow is switched off", async () => {
    const directory = tree(TEAM);
    const state = start([harnesses({ workspace }).without(workforce.slots.workerFlows, "coder"), workforce({ directory })], {
      [harnesses.slots.harnesses]: [harness("codex", true)],
    });
    const refused = await state.ready().then(
      () => "started",
      (error: Error) => error.message,
    );
    expect(refused).toContain("codex");
    expect(refused).toContain("flow");
  });

  it("refuses a worker that names a harness nobody filled", async () => {
    const directory = tree(TEAM);
    const state = start([harnesses({ workspace }), workforce({ directory })], {
      [harnesses.slots.harnesses]: [harness("cursor", true)],
    });
    const refused = await state.ready().then(
      () => "started",
      (error: Error) => error.message,
    );
    expect(refused).toContain("codex");
    // Refused for the harness it names, not for a missing flow: the kit's `coder` is there.
    expect(refused).toMatch(/harness/);
    expect(refused).not.toMatch(/names no flow/);
  });
});
