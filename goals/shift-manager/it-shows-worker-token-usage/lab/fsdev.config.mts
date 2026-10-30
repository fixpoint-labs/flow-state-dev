/**
 * DevTeam, served for this goal: the DevForce lab's tree and `openLab`, with
 * the coder on Claude Code or Codex and the Error Reporter on.
 *
 * What it adds over `packages/shift-manager/teams/devteam/fsdev.config.mts`:
 *
 * - **How this start stands** (`goal-env.mts`, imported first): the clock,
 *   and production or not.
 * - **The coder's harness**, from `WORKER_USAGE_GOAL_HARNESS`: `claude-code`
 *   (`claudeCodeHarness`, with the Agent SDK scripted by `scripted-sdk.mjs`
 *   at its import seam) or `codex` (`codexAgent`, its client scripted through
 *   its `resolveCodexClient` seam and handed an API key).
 * - **The models are scripted.** The chief of staff's (`anthropic/claude-haiku-5-5`)
 *   files one task per `[[usage:<tag>]]` message and reports no usage. Every
 *   other model (`openai/gpt-6-luna`, the researcher's) answers "ok" and
 *   reports 4 input and 4 output tokens per call.
 * - **The Error Reporter** drafts with `errorReporterHarness`, on the same
 *   scripted SDK, and keeps reports: no tracker.
 * - **The store**, a SQLite file at `WORKER_USAGE_GOAL_STORE`, kept across
 *   starts.
 *
 * Nothing about the ledger, the hook, the writer, the query or the view is
 * set here.
 */
import "./goal-env.mts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codexAgent } from "@flow-state-dev/codex";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";
import type { GeneratorModel, HarnessBlock, ModelResolver } from "@flow-state-dev/core/types";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { claudeCodeHarness, CLAUDE_CODE_RUN_TIMEOUT_MS, errorReporterHarness } from "../../../../packages/shift-manager/teams/devteam/harness.mts";
import { LAB_CROWD, LAB_TREE, LAB_USERS, openLab } from "../../../../packages/shift-manager/teams/devteam/host.mts";
import { CODER_FLOW } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts";
import { EM_FLOW } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts";

const STORE = process.env.WORKER_USAGE_GOAL_STORE;
const SETUP = process.env.WORKER_USAGE_GOAL_SETUP;
const HARNESS = process.env.WORKER_USAGE_GOAL_HARNESS ?? "claude-code";
if (!STORE || !SETUP) throw new Error("WORKER_USAGE_GOAL_STORE and WORKER_USAGE_GOAL_SETUP name the store and the setup");

// The runner reads this line to know how this start stood.
process.stderr.write(
  `[worker-usage-goal] NODE_ENV=${process.env.NODE_ENV ?? "unset"} traces=${isTraceObservabilityEnabled() ? "on" : "off"} harness=${HARNESS} now=${new Date().toISOString()}\n`,
);

/** Sandbox: a project with no repository, so a run works on its files. */
export const SANDBOX = { visibility: "shared", id: "sandbox" } as const;

const roster = await readDeclaredRoster(LAB_TREE);
const workerFlowOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const em = roster.workers.find((w) => w.declared.flow === EM_FLOW);
const coderWorkerId = ((em?.declared.delegates as string[] | undefined) ?? []).find((id) => workerFlowOf(id) === CODER_FLOW);
if (coderWorkerId === undefined) throw new Error("the DevTeam tree names no coder");

/** The chief of staff's model: a tagged message files one task for the coder, once per tag. */
function scriptedChief(): GeneratorModel {
  const filed = new Set<string>();
  return {
    modelId: "goal/scripted-chief",
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
      return { toolCalls: [{ toolCallId: `chief-${tag}`, toolName: "createTask", args }], finishReason: "tool-calls" };
    },
  } as unknown as GeneratorModel;
}

/** Every other model: "ok", at 4 + 4 tokens a call. */
function scriptedTalker(id: string): GeneratorModel {
  const usage = { promptTokens: 4, completionTokens: 4, totalTokens: 8 };
  return {
    modelId: id,
    async generate() {
      return { text: "ok", finishReason: "stop", usage };
    },
    async generateStep() {
      return { text: "ok", finishReason: "stop", usage };
    },
  } as unknown as GeneratorModel;
}

const CHIEF_MODEL = "anthropic/claude-haiku-5-5";
const chief = scriptedChief();
const modelResolver = Object.assign(
  (id: string, block?: string) => {
    if (block === "coordinator-route-ask") throw new Error("no route model in this check");
    return id === CHIEF_MODEL ? chief : scriptedTalker(id);
  },
  { resolveId: (id: string) => id },
) as unknown as ModelResolver;

/** One Codex attempt, as the setup scripts it. */
type CodexAttempt = { answer: string; usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number } };

/** A Codex client whose threads answer what the setup scripts for the prompt's tag. */
function scriptedCodexClient() {
  let threads = 0;
  const thread = () => {
    const id = `thr-goal-${++threads}`;
    return {
      id,
      async runStreamed(input: unknown) {
        const prompt = typeof input === "string" ? input : JSON.stringify(input);
        const tag = /\[\[usage:([a-z0-9-]+)\]\]/.exec(prompt)?.[1] ?? "untagged";
        const { codex } = JSON.parse(readFileSync(SETUP!, "utf8")) as { codex?: Record<string, CodexAttempt> };
        const script = codex?.[tag] ?? { answer: `Answered ${tag}.`, usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } };
        return {
          events: (async function* () {
            yield { type: "thread.started", thread_id: id };
            yield { type: "turn.started" };
            yield { type: "item.completed", item: { id: `${id}-msg`, type: "agent_message", text: script.answer } };
            yield { type: "turn.completed", usage: script.usage };
          })(),
        };
      },
    };
  };
  return { startThread: thread, resumeThread: thread };
}

const codexHarness = ({ cwd, resume, onSession }: { cwd: never; resume: never; onSession: never }): HarnessBlock =>
  codexAgent({
    cwd,
    resume,
    onSession,
    client: { apiKey: "sk-goal-not-a-real-key" },
    resolveCodexClient: () => scriptedCodexClient() as never,
    thread: { skipGitRepoCheck: true },
  } as never) as unknown as HarnessBlock;

const lab = await openLab({
  stores: sqliteStores({ filename: STORE }),
  harness: HARNESS === "codex" ? (codexHarness as never) : claudeCodeHarness,
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
