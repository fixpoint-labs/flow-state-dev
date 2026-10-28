/**
 * The bugs this check plants, in a file the reporter's harness can read.
 */
import type { GeneratorModel } from "@flow-state-dev/core/types";
import { commitScriptedWork } from "../../../packages/shift-manager/teams/devteam/harness.mts";
import type { StubRun } from "../../../packages/shift-manager/teams/devteam/harness-stub.mts";

/** A project as the Shift Coordinator's model sees it. */
export interface KnownProject {
  id: string;
  title: string;
  /** The repository's URL, when the project has one. */
  repository?: string;
}

/** The text of one message's content, whatever shape it came in. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part as { text?: string }).text ?? "").join("");
  return "";
}

/** Where a project's code is hosted. */
function repositoryHostOf(project: KnownProject): string {
  // The planted bug: a project with no repository has nothing to split.
  return project.repository!.split("/")[2] ?? "";
}

/**
 * The Shift Coordinator's model, with the coordinator bug planted.
 *
 * @param modelId The id the Lab resolved for it: the Shift Coordinator's own `model:`.
 * @param projects The projects the Lab holds.
 */
export function plantedCoordinatorModel(modelId: string, projects: readonly KnownProject[]): GeneratorModel {
  return {
    modelId,
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options) {
      const messages = options.messages as Array<{ role: string; content: unknown }>;
      const last = messages.at(-1);
      // After a tool's result, the turn is done.
      if (last?.role === "tool") return { text: "Done.", finishReason: "stop" };
      const said = textOf([...messages].reverse().find((m) => m.role === "user")?.content).trim();
      const dispatch = /^dispatch\s+(\{[\s\S]*\})\s*$/.exec(said);
      if (dispatch !== null) {
        return {
          toolCalls: [{ toolCallId: `t-${Date.now()}`, toolName: "createTask", args: JSON.parse(dispatch[1]!) }],
          finishReason: "tool-calls",
        };
      }
      const post = /^post to ([a-z.-]+):/i.exec(said);
      if (post !== null) {
        return {
          // Routed as a task (FIX-2083): the delegate reads the message as written.
          toolCalls: [
            {
              toolCallId: `t-${Date.now()}`,
              toolName: "createTask",
              args: { goal: "Answer this message", assignee: post[1]!, session: "ongoing", resultTo: "conversation" },
            },
          ],
          finishReason: "tool-calls",
        };
      }
      const burst = /^burst:\s*([a-z]+)/i.exec(said);
      if (burst !== null) throw new Error(`The ${burst[1]!.toLowerCase()} upstream refused the request`);
      const named = projects.find((p) => said.toLowerCase().includes(p.id) || said.toLowerCase().includes(p.title.toLowerCase()));
      if (named !== undefined) {
        return { text: `${named.title}'s code is hosted on ${repositoryHostOf(named)}.`, finishReason: "stop" };
      }
      return { text: "Noted.", finishReason: "stop" };
    },
  } as GeneratorModel;
}

/** Throw when a message contains `[post-bug]`; every other turn is `real`. */
export function plantedAgentModel(real: GeneratorModel): GeneratorModel {
  const tripped = (options: unknown) =>
    ((options as { messages?: Array<{ content: unknown }> }).messages ?? []).some((m) => textOf(m.content).includes("[post-bug]"));
  const broken = new Error("The agent's notes index is empty: cannot summarize 0 documents");
  return new Proxy(real, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function" || key === "constructor") return value;
      return (...args: unknown[]) => {
        if (tripped(args[0])) throw broken;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

const attemptsByGoal = new Map<string, number>();

/** The task line a coder's prompt carries its goal on, for counting its attempts. */
function goalOf(prompt: string): string {
  return /\[(harness-bug|flaky|gives-up)\][^\n]*/.exec(prompt)?.[0] ?? prompt.slice(0, 200);
}

/**
 * What the coder's scripted harness does in its checkout, with the harness
 * bugs planted.
 */
export function plantedCoderRun(run: StubRun): void {
  const goal = goalOf(run.prompt);
  const attempt = (attemptsByGoal.get(goal) ?? 0) + 1;
  attemptsByGoal.set(goal, attempt);
  if (run.prompt.includes("[harness-bug]")) {
    throw new Error("The coder's checkout has no build script: npm run build exited 1");
  }
  if (run.prompt.includes("[flaky]") && attempt === 1) {
    throw new Error("The coder's checkout was locked by another process");
  }
  if (run.prompt.includes("[gives-up]")) return;
  commitScriptedWork(run);
}

/** The status the coder's harness reports for a run: errored for a run that gave up. */
export function plantedCoderStatus(run: StubRun): "completed" | "errored" {
  return run.prompt.includes("[gives-up]") ? "errored" : "completed";
}
