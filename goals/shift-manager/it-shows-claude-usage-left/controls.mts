/**
 * The goal's four controls, and the one fault every run carries. Each is a
 * scratch patch applied as the Lab under test loads the module
 * (`goals/lib/module-patch.mjs`); nothing is written to the checkout.
 */
import type { ModulePatch } from "../../lib/module-patch.mts";

export const CONTROL_NAMES = ["no-scale", "absent-as-zero", "fan-out", "read-replaces-run"] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the assertions that must go red, and its patches. */
export interface Control {
  name: ControlName;
  assertions: string[];
  patches: ModulePatch[];
  does: string;
}

const CLAUDE_USAGE = "packages/claude-code/src/sdk/usage.ts";
const USAGE = "packages/harness-manager/src/harness-usage.ts";

export const CONTROLS: Record<ControlName, Control> = {
  "no-scale": {
    name: "no-scale",
    assertions: ["b:91"],
    patches: [{ module: CLAUDE_USAGE, from: String.raw`Math\.round\(utilization \* 1000\) / 10`, to: "utilization" }],
    does: "Claude Code's fraction is stored as sent, not scaled to a percent",
  },
  "absent-as-zero": {
    name: "absent-as-zero",
    assertions: ["a:no-number"],
    patches: [
      {
        module: CLAUDE_USAGE,
        from: String.raw`const usedPercent = fraction \? Math\.round\(utilization \* 1000\) / 10 : null;`,
        to: "const usedPercent = fraction ? Math.round(utilization * 1000) / 10 : 0;",
      },
    ],
    does: "an event with no percent is stored as 0%",
  },
  "fan-out": {
    name: "fan-out",
    assertions: ["d:no-claude-window"],
    patches: [{ module: USAGE, from: String.raw`scope: "user",`, to: 'scope: "org",' }],
    does: "the usage record is one row for the whole org, so a run writes everyone's",
  },
  "read-replaces-run": {
    name: "read-replaces-run",
    assertions: ["e:keeps-the-runs-window"],
    patches: [
      {
        module: USAGE,
        from: String.raw`const kept = step === "rebind" \? \[\] : stored\.windows\.filter\(\(window\) => window\.origin === "run"\);`,
        to: "const kept: typeof stored.windows = [];",
      },
    ],
    does: "a look replaces every window, the run's too",
  },
};

/**
 * The write that throws, for leg f: a window named `goal_write_throws` fails
 * in the one writer, as a store that is down would. Every run carries it, so
 * every other window is written as shipped.
 */
export const FAULTS: ModulePatch[] = [
  {
    module: USAGE,
    from: String.raw`const record = await rowOf\(ctx, harness\);`,
    to:
      'if (typeof harnessOrReport !== "string" && harnessOrReport.window.id === "goal_write_throws") throw new Error("goal: the usage write failed"); ' +
      "const record = await rowOf(ctx, harness);",
  },
];

/** Where the harness loads the Agent SDK from: pointed at the scripted one. */
export function sdkSeam(scriptedSdkUrl: string): ModulePatch {
  return {
    module: "packages/claude-code/src/sdk/sdk-client.ts",
    from: String.raw`const SDK_MODULE = "@anthropic-ai/claude-agent-sdk";`,
    to: `const SDK_MODULE = ${JSON.stringify(scriptedSdkUrl)};`,
  };
}
