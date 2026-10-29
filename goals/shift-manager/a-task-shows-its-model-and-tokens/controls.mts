/**
 * The goal's seven controls. Each is a scratch patch applied as the Lab under
 * test loads the module (`goals/lib/module-patch.mjs`); nothing is written to
 * the checkout. Every control must fail the assertions it names, or the check
 * can't see what the control removes.
 */
import type { ModulePatch } from "../../lib/module-patch.mts";

export const CONTROL_NAMES = ["end-only", "zero-unreported", "last-attempt-only", "config-model", "from-traces", "add-result", "by-session"] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the assertions that must go red, and its patches. */
export interface Control {
  name: ControlName;
  assertions: string[];
  patches: ModulePatch[];
  does: string;
}

const ENGINE_CONTEXT = "packages/engine/src/context/createExecutionContext.ts";
const TASK_REQUEST = "packages/orchestration/src/task-board/task-request.ts";
const SPEND = "packages/orchestration/src/tasks/spend.ts";
const CLAUDE_CODE = "packages/claude-code/src/sdk/agent.ts";

export const CONTROLS: Record<ControlName, Control> = {
  "end-only": {
    name: "end-only",
    assertions: ["b:rising"],
    patches: [{ module: TASK_REQUEST, from: String.raw`export const SPEND_TICK_MS = 2_000;`, to: "export const SPEND_TICK_MS = 3_600_000;" }],
    does: "no spend is written while a run works: the row moves only at a request's end",
  },
  "zero-unreported": {
    name: "zero-unreported",
    assertions: ["c:null"],
    patches: [
      { module: SPEND, from: String.raw`inputTokens: reportedAny \? input : null,`, to: "inputTokens: input," },
      { module: SPEND, from: String.raw`outputTokens: reportedAny \? output : null,`, to: "outputTokens: output," },
    ],
    does: "tokens nothing has reported read as 0",
  },
  "last-attempt-only": {
    name: "last-attempt-only",
    assertions: ["d:1500"],
    patches: [{ module: SPEND, from: String.raw`for \(const entry of requests\) \{`, to: "for (const entry of requests.slice(-1)) {" }],
    does: "a task counts only its latest request, as a run link names only the latest attempt",
  },
  "config-model": {
    name: "config-model",
    assertions: ["b:model"],
    patches: [
      {
        module: CLAUDE_CODE,
        from: String.raw`if \(typeof message\.model === "string" && message\.model !== ""\) spendModel = message\.model;`,
        to: "void 0;",
      },
    ],
    does: "the model shown is the one the worker's harness is configured with, not the one the run named",
  },
  "from-traces": {
    name: "from-traces",
    assertions: ["e:same-numbers"],
    patches: [
      {
        module: ENGINE_CONTEXT,
        from: String.raw`onGeneratorModelResult: \(payload\) => requestSpendLedger\.addModelResult\(payload\),`,
        to: "onGeneratorModelResult: (payload) => { if (isTraceObservabilityEnabled()) requestSpendLedger.addModelResult(payload); },",
      },
    ],
    does: "model calls are counted only where traces carry usage: never in production",
  },
  "add-result": {
    name: "add-result",
    assertions: ["b:exact", "f:equal"],
    patches: [
      {
        module: SPEND,
        from: String.raw`addRequestSpendSource\(all, source\) as TaskSpendSource\[\], was\.settled\)`,
        to: "addRequestSpendSource(all, source) as TaskSpendSource[], [...was.settled, ...(was.live ?? [])])",
      },
    ],
    does: "an ending's spend is added on top of the running total the row already shows",
  },
  "by-session": {
    name: "by-session",
    assertions: ["g:own-only"],
    patches: [
      {
        module: TASK_REQUEST,
        // A ticket made for each row, as a writer that targets rows by worker would: the row's own fence can't tell.
        from: String.raw`await recordSpend\.call\(record\.ref, record\.ticket\.taskId, \{ requestId, part, spend, writer: record\.writer, admittedAt: record\.admittedAt \}, \{ claim: record\.ticket \}\);`,
        to: 'for (const t of record.ref.list().filter((t) => t.status === "in_progress" && t.assignee === record.ref.get(record.ticket.taskId)?.assignee)) await recordSpend.call(record.ref, t.id, { requestId, part, spend, writer: record.writer, admittedAt: record.admittedAt }, { claim: { ...record.ticket, taskId: t.id, createdAt: t.createdAt, incarnationId: t.incarnationId } });',
      },
    ],
    does: "a request's spend is written to every task its worker is running, not to the one it was admitted for",
  },
};

/** Where the harness loads the Agent SDK from: pointed at the scripted one. */
export function sdkSeam(scriptedSdkUrl: string): ModulePatch {
  return {
    module: "packages/claude-code/src/sdk/sdk-client.ts",
    from: String.raw`const SDK_MODULE = "@anthropic-ai/claude-agent-sdk";`,
    to: `const SDK_MODULE = ${JSON.stringify(scriptedSdkUrl)};`,
  };
}
