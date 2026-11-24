// FIX-2877.
/**
 * The harness kit's default coder in the coordinator's context: the line
 * under the readiness rows names it by its label, so a coordinator starts
 * coding work there. With no default, no line. Graded on the context the
 * model is handed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
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

const worker = (name: string, extra: string) => `---\nname: ${name}\ndescription: ${name}.\n${extra}---\nYou are ${name}.`;

function team(): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-default-coder-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "teams/core/workers/lead/WORKER.md": worker("Lead", "delegates: all\n"),
    "teams/core/workers/codex/WORKER.md": worker("codex", "flow: coder\nharness: codex\n"),
    "teams/core/workers/cursor/WORKER.md": worker("cursor", "flow: coder\nharness: cursor\n"),
  };
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

const harness = (id: string, label: string): Harness => ({ id, label, agent: scriptedHarness({ stepEveryMs: 1 }).slot, readiness: async () => ({ ready: true }), pass: [] });
const workspace = localWorkspaceHost({ root: join(tmpdir(), "fsd-default-coder-runs"), remotes: { allow: [] }, source: () => ({ kind: "repo", repo: tmpdir() }) });

/** The context Lead's first model call is handed, on an app whose kit has `defaultHarness`. */
async function leadContext(defaultHarness?: string): Promise<string> {
  const answer = mockGenerator({ name: "agent-answer", script: [{ text: "Hello." }] });
  const state = createFlowState({
    kits: [harnesses({ workspace, ...(defaultHarness === undefined ? {} : { defaultHarness }) }), workforce({ directory: team() })],
    fill: { [harnesses.slots.harnesses]: [harness("codex", "Codex"), harness("cursor", "Cursor")] },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({ generators: { "agent-answer": answer, "agent-answer-with-activate-tool": answer } }),
  } as never);
  states.push(state);
  await state.ready();
  const router = await state.getRouter();
  const post = async (path: string[], body: unknown) => {
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: { path } },
    );
    return { status: res.status, body: (await res.json()) as any };
  };
  const created = await post(["agent", "sessions"], { userId: "alice", state: { workerId: "core.lead" } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const sent = await post(["agent", created.body.session.id, "actions", "respond"], { userId: "alice", input: { message: "Hi." } });
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  const stores = (await state.getRuntime()).stores;
  for (let n = 0; n < 300 && (await stores.request.get(sent.body.request.id))?.status === "in_progress"; n++) await new Promise((r) => setTimeout(r, 10));
  return JSON.stringify(answer.calls[0]!.input);
}

describe("the harness kit's default coder in the coordinator's context", () => {
  it("is named under the readiness rows, by its label", async () => {
    const context = await leadContext("codex");
    expect(context).toContain("Coding harnesses on this machine:");
    expect(context).toContain("Codex is this app's default coder: start coding work on the coding worker that runs on Codex, unless the user names another.");
  });

  it("is named by no line when the kit has no default", async () => {
    const context = await leadContext();
    expect(context).toContain("Coding harnesses on this machine:");
    expect(context).not.toContain("default coder");
  });
});
