/**
 * DevTeam, served for this goal: the DevForce lab's tree and `openLab`, with
 * the coder on Claude Code, Codex or Cursor, each scripted and paused mid-run.
 * FIX-2145's Lab (`../../it-shows-worker-token-usage/lab/`), copied.
 *
 * What it adds over `packages/shift-manager/teams/devteam/fsdev.config.mts`:
 *
 * - **How this start stands** (`goal-env.mts`, imported first): production or not.
 * - **The coder's harness**, from `TASK_SPEND_GOAL_HARNESS`: `claude-code`
 *   (`claudeCodeHarness` configured with {@link CONFIGURED_MODEL}, the Agent
 *   SDK scripted by `scripted-sdk.mjs` at its import seam), `codex`
 *   (`codexAgent` started with `gpt-5`, its client scripted through
 *   `resolveCodexClient`) or `cursor` (`cursorAgent` configured with
 *   `composer-2`, its client scripted through `resolveCursorClient`). Each
 *   scripted run pauses where the setup says, until the check releases it
 *   (`pause.mjs`).
 * - **The models are scripted.** The Shift Coordinator's (`anthropic/claude-haiku-5-5`)
 *   files one coder task per `[[usage:<tag>]]` in a message and reports no
 *   usage. `openai/gpt-6-luna` (the general lead's and the researcher's)
 *   answers at 4 + 4 tokens a call: the general lead files one researcher task
 *   per `[[research:<tag>]]`; the researcher's task run reports progress once,
 *   then answers, two calls.
 * - **The store**, a SQLite file at `TASK_SPEND_GOAL_STORE`.
 *
 * Nothing about the ledger, the harness reports, the task's spend writes or
 * `listTasks` is set here.
 */
import "./goal-env.mts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codexAgent } from "@flow-state-dev/codex";
import { cursorAgent } from "@flow-state-dev/cursor";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";
import type { GeneratorModel, HarnessBlock, ModelResolver } from "@flow-state-dev/core/types";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { claudeCodeHarness, CLAUDE_CODE_RUN_TIMEOUT_MS, errorReporterHarness } from "../../../../packages/shift-manager/teams/devteam/harness.mts";
import { LAB_CROWD, LAB_TREE, LAB_USERS, openLab } from "../../../../packages/shift-manager/teams/devteam/host.mts";
import { CODER_FLOW } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts";
import { EM_FLOW } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts";
// @ts-expect-error A plain ES module beside this file, with no types.
import { pause } from "./pause.mjs";

const STORE = process.env.TASK_SPEND_GOAL_STORE;
const SETUP = process.env.TASK_SPEND_GOAL_SETUP;
const HARNESS = process.env.TASK_SPEND_GOAL_HARNESS ?? "claude-code";
if (!STORE || !SETUP) throw new Error("TASK_SPEND_GOAL_STORE and TASK_SPEND_GOAL_SETUP name the store and the setup");

/** The model the coder's Claude Code is configured with; the scripted run says it runs another. */
export const CONFIGURED_MODEL = "claude-opus-4-1";

// The runner reads this line to know how this start stood.
process.stderr.write(
  `[task-spend-goal] NODE_ENV=${process.env.NODE_ENV ?? "unset"} traces=${isTraceObservabilityEnabled() ? "on" : "off"} harness=${HARNESS}\n`,
);

/** Sandbox: a project with no repository, so a run works on its files. */
export const SANDBOX = { visibility: "shared", id: "sandbox" } as const;

const roster = await readDeclaredRoster(LAB_TREE);
const workerFlowOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const em = roster.workers.find((w) => w.declared.flow === EM_FLOW);
const coderWorkerId = ((em?.declared.delegates as string[] | undefined) ?? []).find((id) => workerFlowOf(id) === CODER_FLOW);
if (coderWorkerId === undefined) throw new Error("the DevTeam tree names no coder");

const setup = () => JSON.parse(readFileSync(SETUP!, "utf8"));
const tagsIn = (text: string, marker: string) => [...text.matchAll(new RegExp(`\\[\\[${marker}:([a-z0-9-]+)\\]\\]`, "g"))].map((m) => m[1]!);
const textOf = (message: { content?: unknown } | undefined) =>
  typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");

/** The Shift Coordinator's model: each new tag in a message files one task for the coder. */
function scriptedChief(): GeneratorModel {
  const filed = new Set<string>();
  return {
    modelId: "goal/scripted-chief",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { messages: Array<{ role?: string; content?: unknown }> }) {
      const last = options.messages.at(-1);
      if (last?.role === "tool") return { text: "Filed.", finishReason: "stop" };
      const tags = tagsIn(textOf(last), "usage").filter((tag) => !filed.has(tag));
      if (tags.length === 0) return { text: "Noted.", finishReason: "stop" };
      for (const tag of tags) filed.add(tag);
      return {
        toolCalls: tags.map((tag) => ({
          toolCallId: `chief-${tag}`,
          toolName: "createTask",
          args: { goal: `Answer in one line. [[usage:${tag}]]`, assignee: coderWorkerId, input: { project: SANDBOX } },
        })),
        finishReason: "tool-calls",
      };
    },
  } as unknown as GeneratorModel;
}

/**
 * `openai/gpt-6-luna`, at 4 + 4 tokens a call. The general lead files one
 * researcher task per `[[research:<tag>]]`; a researcher's task run
 * (`[[researched:<tag>]]`) reports progress, then answers; anything else answers "ok".
 */
function scriptedLuna(id: string): GeneratorModel {
  const usage = { promptTokens: 4, completionTokens: 4, totalTokens: 8 };
  const filed = new Set<string>();
  return {
    modelId: id,
    async generate() {
      return { text: "ok", finishReason: "stop", usage };
    },
    async generateStep(options: { messages: Array<{ role?: string; content?: unknown }>; tools?: Record<string, unknown> | Array<{ name?: string }> }) {
      const all = options.messages.map(textOf).join("\n");
      const last = options.messages.at(-1);
      const toolNames = Array.isArray(options.tools) ? options.tools.map((t) => t.name ?? "") : Object.keys(options.tools ?? {});
      const named = (base: string) => toolNames.find((name) => name === base || name.startsWith(`${base}_`)) ?? base;
      const researched = tagsIn(all, "researched")[0];
      if (researched !== undefined) {
        if (last?.role === "tool") return { text: `Researched ${researched}.`, finishReason: "stop", usage };
        return {
          toolCalls: [{ toolCallId: `progress-${researched}`, toolName: named("reportProgress"), args: { statusNote: "Reading." } }],
          finishReason: "tool-calls",
          usage,
        };
      }
      if (last?.role === "tool") return { text: "Filed.", finishReason: "stop", usage };
      const tags = tagsIn(textOf(last), "research").filter((tag) => !filed.has(tag));
      if (tags.length === 0) return { text: "ok", finishReason: "stop", usage };
      for (const tag of tags) filed.add(tag);
      return {
        toolCalls: tags.map((tag) => ({
          toolCallId: `lead-${tag}`,
          toolName: named("createTask"),
          args: { goal: `Research it. [[researched:${tag}]]`, assignee: "researcher" },
        })),
        finishReason: "tool-calls",
        usage,
      };
    },
  } as unknown as GeneratorModel;
}

const CHIEF_MODEL = "anthropic/claude-haiku-5-5";
const chief = scriptedChief();
const lunas = new Map<string, GeneratorModel>();
const modelResolver = Object.assign(
  (id: string, block?: string) => {
    if (block === "coordinator-route-ask") throw new Error("no route model in this check");
    if (id === CHIEF_MODEL) return chief;
    if (!lunas.has(id)) lunas.set(id, scriptedLuna(id));
    return lunas.get(id)!;
  },
  { resolveId: (id: string) => id },
) as unknown as ModelResolver;

/** The tag in a run's prompt. */
const tagOf = (input: unknown) => /\[\[usage:([a-z0-9-]+)\]\]/.exec(typeof input === "string" ? input : JSON.stringify(input))?.[1] ?? "untagged";

/** One scripted Codex or Cursor run: its answer, its tokens, and whether it pauses before them. */
type Script = { answer: string; input: number; output: number; pause?: boolean };
const scriptOf = (vendor: "codex" | "cursor", tag: string): Script =>
  (setup()[vendor] as Record<string, Script> | undefined)?.[tag] ?? { answer: `Answered ${tag}.`, input: 0, output: 0 };

/** A Codex client whose threads answer what the setup scripts, paused before `turn.completed`. */
function scriptedCodexClient() {
  let threads = 0;
  const thread = () => {
    const id = `thr-goal-${++threads}`;
    return {
      id,
      async runStreamed(input: unknown) {
        const tag = tagOf(input);
        const script = scriptOf("codex", tag);
        return {
          events: (async function* () {
            yield { type: "thread.started", thread_id: id };
            yield { type: "turn.started" };
            yield { type: "item.completed", item: { id: `${id}-msg`, type: "agent_message", text: script.answer } };
            if (script.pause === true) await pause(setup(), `codex-${tag}`, 0);
            yield { type: "turn.completed", usage: { input_tokens: script.input, cached_input_tokens: 0, output_tokens: script.output } };
          })(),
        };
      },
    };
  };
  return { startThread: thread, resumeThread: thread };
}

/** A Cursor client whose runs answer what the setup scripts, paused before the turn's usage. */
function scriptedCursorClient() {
  let agents = 0;
  const agent = () => {
    const agentId = `agent-goal-${++agents}`;
    return {
      agentId,
      async send(prompt: string) {
        const tag = tagOf(prompt);
        const script = scriptOf("cursor", tag);
        const usage = { inputTokens: script.input, outputTokens: script.output, cacheReadTokens: 0, cacheWriteTokens: 0 };
        return {
          id: `run-${agentId}`,
          stream: async function* () {
            yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: script.answer }] } };
            if (script.pause === true) await pause(setup(), `cursor-${tag}`, 0);
            yield { type: "usage", usage };
            yield { type: "status", status: "FINISHED" };
          },
          wait: async () => ({ status: "finished", result: script.answer, usage }),
          async cancel() {},
        };
      },
      close() {},
    };
  };
  return { create: async () => agent(), resume: async () => agent() };
}

type Feeds = { cwd: never; resume: never; onSession: never };

const harnesses: Record<string, (feeds: Feeds) => HarnessBlock> = {
  "claude-code": (feeds) => claudeCodeHarness({ ...feeds, model: CONFIGURED_MODEL } as never),
  codex: ({ cwd, resume, onSession }) =>
    codexAgent({
      cwd,
      resume,
      onSession,
      model: "gpt-5",
      resolveCodexClient: () => scriptedCodexClient() as never,
      thread: { skipGitRepoCheck: true },
    } as never) as unknown as HarnessBlock,
  cursor: ({ cwd, resume, onSession }) =>
    cursorAgent({
      cwd,
      resume,
      onSession,
      model: "composer-2",
      resolveCursorClient: () => scriptedCursorClient() as never,
    } as never) as unknown as HarnessBlock,
};
const harness = harnesses[HARNESS];
if (harness === undefined) throw new Error(`TASK_SPEND_GOAL_HARNESS "${HARNESS}" is not one of ${Object.keys(harnesses).join(", ")}`);

const lab = await openLab({
  stores: sqliteStores({ filename: STORE }),
  harness: harness as never,
  runTimeoutMs: CLAUDE_CODE_RUN_TIMEOUT_MS,
  workspace: { root: join(STORE, "..", "runs"), remotes: { allow: [] } },
  coderWorkerId,
  inventory: true,
  devtool: true,
  withoutJudge: true,
  modelResolver,
  errorReporter: { harness: errorReporterHarness },
  projects: [{ id: SANDBOX.id, title: "Sandbox", members: [LAB_USERS.member.userId, ...LAB_CROWD.map((u) => u.userId)] }],
});

export default lab.state;
