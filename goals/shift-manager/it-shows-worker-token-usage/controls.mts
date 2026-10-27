/**
 * The goal's six controls. Each is a scratch patch applied as the Lab under
 * test loads the module (`goals/lib/module-patch.mjs`); nothing is written to
 * the checkout. Every control must fail the assertions it names, or the check
 * can't see what the control removes.
 */
import type { ModulePatch } from "../../lib/module-patch.mts";

export const CONTROL_NAMES = ["from-traces", "harness-only", "last-attempt-only", "cost-always", "no-user-filter", "ignore-period"] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the assertions that must go red, and its patches. */
export interface Control {
  name: ControlName;
  assertions: string[];
  patches: ModulePatch[];
  does: string;
}

const CONTEXT = "packages/engine/src/context/createExecutionContext.ts";
const USAGE = "packages/workforce/src/workers/worker-usage.ts";
const CODEX = "packages/codex/src/agent.ts";

export const CONTROLS: Record<ControlName, Control> = {
  "from-traces": {
    name: "from-traces",
    assertions: ["d:same-numbers"],
    patches: [
      {
        module: CONTEXT,
        from: String.raw`onGeneratorModelResult: \(payload\) => requestSpendLedger\.addModelResult\(payload\),`,
        to: "onGeneratorModelResult: (payload) => { if (isTraceObservabilityEnabled()) requestSpendLedger.addModelResult(payload); },",
      },
    ],
    does: "model calls are counted only where traces carry usage, as the trace-based count did: never in production",
  },
  "harness-only": {
    name: "harness-only",
    assertions: ["a:16-tokens"],
    patches: [{ module: USAGE, from: String.raw`for \(const \[model, entry\] of Object\.entries\(spend\.byModel\)\) \{`, to: "for (const [model, entry] of Object.entries({} as RequestSpend[\"byModel\"])) {" }],
    does: "a worker's record counts harness runs only, not model calls",
  },
  "last-attempt-only": {
    name: "last-attempt-only",
    assertions: ["f:1500"],
    patches: [
      {
        module: USAGE,
        from: String.raw`const sources = added\.reduce\(addSource, stored\.sources\);`,
        to: "const sources = [...stored.sources.filter((s) => !added.some((a) => a.source === s.source && a.kind === s.kind && a.billing === s.billing)), ...added];",
      },
    ],
    does: "each request's spend replaces the record's, as a run row keeps only its last attempt",
  },
  "cost-always": {
    name: "cost-always",
    assertions: ["b:no-cost", "i:no-cost"],
    patches: [
      { module: USAGE, from: String.raw`costUsd: billing === "api-key" && run\.costUsd !== null \? run\.costUsd : null,`, to: "costUsd: run.costUsd," },
      {
        module: CODEX,
        from: String.raw`costUsd: null,`,
        to: "costUsd: estimateCodexCost(usage, runModel ?? \"gpt-5.4-codex\")?.usd ?? 0.01,",
      },
    ],
    does: "every cost is shown: Claude Code's on a subscription, and Codex's price-table estimate",
  },
  "no-user-filter": {
    name: "no-user-filter",
    assertions: ["e:only-alices"],
    patches: [{ module: USAGE, from: String.raw`  scope: "user",`, to: '  scope: "org",' }],
    does: "the usage records are the org's, so every person reads everyone's",
  },
  "ignore-period": {
    name: "ignore-period",
    assertions: ["g:not-in-7-days"],
    patches: [
      { module: USAGE, from: String.raw`Array\.from\(\{ length: days \},`, to: "Array.from({ length: 1 }," },
      { module: USAGE, from: "collection\\.list\\(`\\$\\{dayOf\\(now - back \\* DAY_MS\\)\\}/`\\)", to: "collection.list()" },
    ],
    does: "the query reads every record, whatever period is asked for",
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
