/**
 * DevTeam, served for this goal, with Claude Code as the coder: the DevForce
 * lab's tree and `openLab`, with `claudeCodeHarness` in the coder's slot as
 * the `fsd` profile puts it there, and the Claude Code usage reader as DevTeam
 * registers it.
 *
 * What it adds over `packages/shift-manager/teams/devteam/fsdev.config.mts`:
 *
 * - **The Agent SDK is scripted** (`scripted-sdk.mjs`), loaded where the
 *   harness loads the real one: the check points `sdk-client.ts`'s module name
 *   at it. A run's `rate_limit_event`s and account come from the setup file.
 * - **The reader's environment** comes from the setup file too: an empty home,
 *   or one with an API key, for the legs that read the real probe.
 * - **The Shift Coordinator's model is scripted**: a message carrying
 *   `[[usage:<tag>]]` files one task for the coder on Sandbox (a project with
 *   no repository), its goal carrying the tag. Its judgment is not under test.
 *   No judge, so a run is never retried.
 * - **The store**, a SQLite file at `CLAUDE_USAGE_GOAL_STORE`.
 *
 * Nothing about the hook, the writer, the query or the view is set here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readClaudeUsage } from "@flow-state-dev/claude-code/sdk";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { claudeCodeHarness, CLAUDE_CODE_RUN_TIMEOUT_MS } from "../../../../packages/shift-manager/teams/devteam/harness.mts";
import { LAB_CROWD, LAB_TREE, LAB_USERS, openLab } from "../../../../packages/shift-manager/teams/devteam/host.mts";
import { CODER_FLOW } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts";
import { EM_FLOW } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts";

const STORE = process.env.CLAUDE_USAGE_GOAL_STORE;
const SETUP = process.env.CLAUDE_USAGE_GOAL_SETUP;
if (!STORE || !SETUP) throw new Error("CLAUDE_USAGE_GOAL_STORE and CLAUDE_USAGE_GOAL_SETUP name the store and the setup");

/** Sandbox: a project with no repository, so a run works on its files. */
export const SANDBOX = { visibility: "shared", id: "sandbox" } as const;

const roster = await readDeclaredRoster(LAB_TREE);
const workerFlowOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const em = roster.workers.find((w) => w.declared.flow === EM_FLOW);
const coderWorkerId = ((em?.declared.delegates as string[] | undefined) ?? []).find((id) => workerFlowOf(id) === CODER_FLOW);
if (coderWorkerId === undefined) throw new Error("the DevTeam tree names no coder");

/**
 * The Shift Coordinator's turn: a tagged message files one task for the coder,
 * once per tag; anything else is answered. Once, because the task's ending
 * wakes the Shift Coordinator again with the same conversation in front of it.
 */
function scriptedShiftCoordinator(): ModelResolver {
  const filed = new Set<string>();
  const model: GeneratorModel = {
    modelId: "goal/scripted-shift-coordinator",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages: unknown[] }) {
      const last = options.messages.at(-1) as { role?: string; content?: unknown } | undefined;
      if (last?.role === "tool") return { text: "Filed.", finishReason: "stop" };
      const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
      const tag = /\[\[usage:([a-z0-9-]+)\]\]/.exec(text)?.[1];
      if (tag === undefined || filed.has(tag)) return { text: "Noted.", finishReason: "stop" };
      filed.add(tag);
      const args = { goal: `Answer in one line. [[usage:${tag}]]`, assignee: coderWorkerId, input: { project: SANDBOX } };
      return { toolCalls: [{ toolCallId: `shift-coordinator-${tag}`, toolName: "createTask", args }], finishReason: "tool-calls" };
    },
  };
  return Object.assign(
    (_id: string, block?: string) => {
      if (block === "coordinator-route-ask") throw new Error("no route model in this check");
      return model;
    },
    { resolveId: (id: string) => id },
  ) as unknown as ModelResolver;
}

/** How the reader's probe is pointed, as the check last wrote it. */
type Setup = { reader: { home: string; apiKey?: string } };

const lab = await openLab({
  stores: sqliteStores({ filename: STORE }),
  harness: claudeCodeHarness,
  runTimeoutMs: CLAUDE_CODE_RUN_TIMEOUT_MS,
  workspace: { root: join(STORE, "..", "runs"), remotes: { allow: [] } },
  coderWorkerId,
  inventory: true,
  devtool: true,
  withoutJudge: true,
  modelResolver: scriptedShiftCoordinator(),
  projects: [{ id: SANDBOX.id, title: "Sandbox", members: [LAB_USERS.member.userId, ...LAB_CROWD.map((u) => u.userId)] }],
  usage: {
    "claude-code": () => {
      const { reader } = JSON.parse(readFileSync(SETUP, "utf8")) as Setup;
      return readClaudeUsage({
        env: { PATH: process.env.PATH ?? "", HOME: reader.home, ...(reader.apiKey === undefined ? {} : { ANTHROPIC_API_KEY: reader.apiKey }) },
      });
    },
  },
});

export default lab.state;
