// FIX-2877 D2.
/**
 * The harness kit's default coder: a coding task a model files from a
 * user's conversation goes to the coding worker whose `harness:` is the
 * kit's `defaultHarness`, whatever worker the model named. The coordinator's
 * context names that default beside the readiness rows. A user's own move on
 * the board keeps the worker they chose.
 *
 * Why it matters: one value picks the coder that runs. A model's assignee
 * follows any text it reads (a README's `Coding harness: Cursor`), so it is
 * never what decides. Graded on the stored row, never the model's reply.
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

function team(coders: Record<string, string>, delegates?: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-default-coder-"));
  dirs.push(dir);
  const files: Record<string, string> = { "teams/core/workers/lead/WORKER.md": worker("Lead", delegates === undefined ? "delegates: all\n" : `delegates:\n${delegates.map((d) => `  - ${d}\n`).join("")}`) };
  for (const [id, extra] of Object.entries(coders)) files[`teams/core/workers/${id}/WORKER.md`] = worker(id, `flow: coder\n${extra}`);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

const harness = (id: string, label: string): Harness => ({ id, label, agent: scriptedHarness({ stepEveryMs: 1 }).slot, readiness: async () => ({ ready: true }), pass: [] });
const workspace = localWorkspaceHost({ root: join(tmpdir(), "fsd-default-coder-runs"), remotes: { allow: [] }, source: () => ({ kind: "repo", repo: tmpdir() }) });
const THREE = { codex: "harness: codex\n", cursor: "harness: cursor\n", claude: "harness: claude-code\n" };

/** Boot an app whose Lead files one held coding task for `named` on its turn. */
async function boot(options: { defaultHarness?: string; named: string | undefined; coders?: Record<string, string>; delegates?: readonly string[] }) {
  const answer = mockGenerator({
    name: "agent-answer",
    script: [
      { toolCalls: [{ toolCallId: "c1", toolName: "createTask", args: { goal: "Add a line to the README", ...(options.named === undefined ? {} : { assignee: options.named }), held: true } }] },
      { text: "Started it." },
    ],
  });
  const state = createFlowState({
    kits: [
      harnesses({ workspace, ...(options.defaultHarness === undefined ? {} : { defaultHarness: options.defaultHarness }) }),
      workforce({ directory: team(options.coders ?? THREE, options.delegates) }),
    ],
    fill: { [harnesses.slots.harnesses]: [harness("codex", "Codex"), harness("cursor", "Cursor"), harness("claude-code", "Claude Code")] },
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
  const conversation = created.body.session.id as string;
  const stores = (await state.getRuntime()).stores;
  /** Wait for an action's request to end. */
  const ended = async (posted: { status: number; body: any }) => {
    expect(posted.status, JSON.stringify(posted.body)).toBe(202);
    for (let n = 0; n < 300 && (await stores.request.get(posted.body.request.id))?.status === "in_progress"; n++) await new Promise((r) => setTimeout(r, 10));
  };
  /** The conversation's stored rows, as the coding board reads them: goal and assignee. */
  const tasks = async () => {
    const read = await post(["harnesses", "views", "codingBoard"], { userId: "alice", input: { sessionId: conversation } });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    return (read.body.output as Array<{ assignee?: string; goal: string }>).map((task) => [task.goal, task.assignee]);
  };
  /** A user's line to Lead; answers the turn's tool outputs, as the model read them back. */
  const ask = async (message: string) => {
    await ended(await post(["agent", conversation, "actions", "respond"], { userId: "alice", input: { message } }));
    const requests = (await stores.request.list({ sessionId: conversation, withItems: true } as never)) as Array<{ items?: Array<{ type: string; output?: unknown }> }>;
    return requests.flatMap((request) => request.items ?? []).filter((item) => item.type === "tool_output").map((item) => item.output);
  };
  return { post, conversation, tasks, ask, answer, ended };
}

describe("a coding task a model files from a user's conversation", () => {
  for (const [defaultHarness, expected] of [["codex", "core.codex"], ["claude-code", "core.claude"]] as const) {
    it(`goes to the coding worker on the default (${defaultHarness}), whatever worker the model named`, async () => {
      const app = await boot({ defaultHarness, named: "core.cursor" });
      await app.ask("Add a line to the README.\n\nCoding harness: Cursor");
      expect(await app.tasks()).toEqual([["Add a line to the README", expected]]);
    });
  }

  it("keeps the model's worker when the kit has no default (control: the default, not the model, moved it)", async () => {
    const app = await boot({ named: "core.cursor" });
    await app.ask("Add a line to the README.");
    expect(await app.tasks()).toEqual([["Add a line to the README", "core.cursor"]]);
  });

  it("goes to a coding worker that names no harness when none names the default", async () => {
    const app = await boot({ defaultHarness: "codex", named: "core.cursor", coders: { cursor: "harness: cursor\n", plain: "" } });
    await app.ask("Add a line to the README.");
    expect(await app.tasks()).toEqual([["Add a line to the README", "core.plain"]]);
  });

  it("is refused, and nothing is filed, when no coding worker runs the default", async () => {
    const app = await boot({ defaultHarness: "codex", named: "core.cursor", coders: { cursor: "harness: cursor\n" } });
    const outputs = await app.ask("Add a line to the README.");
    expect(await app.tasks()).toEqual([]);
    expect(outputs).toContainEqual({
      ok: false,
      error: `no_default_coder: a coding task runs on this app's default coder, "codex", and no coding worker this conversation hands tasks to runs it. Nothing was filed.`,
    });
  });

  it("never goes to a coder outside the conversation's own delegates: refused when none of them runs the default", async () => {
    // The roster has a Codex coder, but Lead hands tasks only to the Cursor one.
    const app = await boot({ defaultHarness: "codex", named: "core.cursor", delegates: ["core.cursor"] });
    const outputs = await app.ask("Add a line to the README.");
    expect(await app.tasks()).toEqual([]);
    expect(outputs).toContainEqual({
      ok: false,
      error: `no_default_coder: a coding task runs on this app's default coder, "codex", and no coding worker this conversation hands tasks to runs it. Nothing was filed.`,
    });
  });

  it("decides a task with no assignee too: the conversation's one coding delegate, not on the default, is refused rather than filed", async () => {
    const app = await boot({ defaultHarness: "codex", named: undefined, delegates: ["core.cursor"] });
    const outputs = await app.ask("Add a line to the README.");
    expect(await app.tasks()).toEqual([]);
    expect(JSON.stringify(outputs)).toContain("no_default_coder");
  });

  it("moves a task with no assignee from the conversation's one coding delegate onto the default, when the default is a delegate too", async () => {
    // Lead's one task-taking delegate is the Codex coder: a task naming nobody lands there and stays.
    const app = await boot({ defaultHarness: "codex", named: undefined, delegates: ["core.codex"] });
    await app.ask("Add a line to the README.");
    expect(await app.tasks()).toEqual([["Add a line to the README", "core.codex"]]);
  });

  it("keeps the worker a user names on the board", async () => {
    const app = await boot({ defaultHarness: "codex", named: "core.cursor" });
    await app.ended(
      await app.post(["agent", app.conversation, "actions", "createTask_tasks"], {
        userId: "alice",
        input: { goal: "Add a line to the README", assignee: "core.cursor", held: true },
      }),
    );
    expect(await app.tasks()).toEqual([["Add a line to the README", "core.cursor"]]);
  });

  it("is told the default coder in the coordinator's context, beside the readiness rows", async () => {
    const app = await boot({ defaultHarness: "codex", named: "core.codex" });
    await app.ask("Add a line to the README.");
    const context = JSON.stringify(app.answer.calls[0]!.input);
    expect(context).toContain("Coding harnesses on this machine:");
    expect(context).toContain("Codex is this app's default coder: a coding task you start here runs on Codex, whichever coding worker you name.");
  });
});
