/**
 * The harness kit: coding harnesses for workforce's workers.
 *
 * An app lists `harnesses({ workspace })` beside `workforce(…)` and fills the
 * kit's `harnesses` slot with harness values (`codexHarness()`,
 * `cursorHarness()`; Claude Code's kit fills it itself). It contributes to
 * workforce:
 *
 * - `coder`, the one coding worker flow, to `workerFlows`: every coding
 *   worker names it in its `flow:` line and picks its harness in `harness:`.
 *   An app with a coding flow of its own switches it off
 *   (`harnesses(…).without(workforce.slots.workerFlows, "coder")`).
 * - which harnesses can run here, to `uses`, so a worker files coding work
 *   only on a ready one.
 *
 * It serves one flow of its own, `harnesses`, whose `readiness` view has one
 * row per harness filled, read with no session; `{ refresh: true }` checks
 * them again. With `logReadiness`, it checks them at start and logs a table.
 *
 * Only this subpath imports workforce: the package root never does.
 */
import { defineFlow, defineKit, slot } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { workforce } from "@flow-state-dev/workforce/kit";
import type { WorkspaceHost } from "@flow-state-dev/workspace";
import { z } from "zod";
import { harnessSchema, type Harness } from "../harness";
import {
  formatHarnessReadiness,
  harnessReadiness,
  harnessReadinessCapability,
  harnessReadinessView,
  type HarnessReadinessRead,
} from "../readiness";
import { CODER_FLOW, coderWorkerFlow, type CoderFlowOptions } from "./coder-flow";

/** The flow the kit serves its views on. */
export const HARNESSES_FLOW = "harnesses";

/** The harness kit's config: where runs work, and the coding worker flow's policy. */
export type HarnessesConfig = CoderFlowOptions & {
  /** Check every harness at start and log the rows as a table, never awaited: a missing sign-in never stops the app. Default false. */
  logReadiness?: boolean;
};

const configSchema: z.ZodType<HarnessesConfig, z.ZodTypeDef, HarnessesConfig> = z
  .object({
    workspace: z.custom<WorkspaceHost>((value) => typeof value === "object" && value !== null, {
      message: "`workspace` is the host a run works in (`localWorkspaceHost(…)`)",
    }),
    defaultHarness: z.string().min(1).optional(),
    review: z.boolean().optional(),
    pullRequests: z.boolean().optional(),
    judge: z.boolean().optional(),
    checks: z
      .object({ commands: z.array(z.string()).readonly(), timeoutMs: z.number().int().positive().optional() })
      .optional(),
    project: z.boolean().optional(),
    runTimeoutMs: z.number().int().positive().optional(),
    logReadiness: z.boolean().optional(),
  })
  .strict();

/**
 * One readiness read per filled slot: the capability `contributes` adds and
 * the view `install` serves read the same kept rows.
 */
const readinessOf = (() => {
  const reads = new WeakMap<object, HarnessReadinessRead>();
  return (filled: Readonly<Record<string, Harness>>): HarnessReadinessRead => {
    let read = reads.get(filled);
    if (read === undefined) {
      read = harnessReadiness(
        Object.fromEntries(
          Object.values(filled).map((harness) => [
            harness.id,
{ label: harness.label ?? harness.id, check: harness.readiness },
          ]),
        ),
      );
      reads.set(filled, read);
    }
    return read;
  };
})();

/**
 * Coding harnesses, as a kit. Requires workforce.
 *
 * @example
 *   createFlowState({
 *     kits: [workforce({ agent: { model } }), harnesses({ workspace, defaultHarness: "cursor" })],
 *     fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] },
 *   });
 */
export const harnesses = defineKit({
  name: "harnesses",
  requires: [workforce],
  config: configSchema,
  slots: { harnesses: slot.keyed(harnessSchema) },
  contributes: ({ config, slots }) => {
    const filled = slots.harnesses;
    const readiness = readinessOf(filled);
    return {
      [workforce.slots.workerFlows]: { [CODER_FLOW]: coderWorkerFlow(config, filled, (id) => readiness.refusal(id)) },
      [workforce.slots.uses]: [harnessReadinessCapability(readiness)],
    };
  },
  install: ({ config, slots }) => {
    const readiness = readinessOf(slots.harnesses);
    if (config.logReadiness === true) void readiness.read().then((entries) => console.log(formatHarnessReadiness(entries)));
    const flow = defineFlow({
      kind: HARNESSES_FLOW,
      views: { readiness: harnessReadinessView(readiness) },
    } as never)({ id: HARNESSES_FLOW } as never) as unknown as FlowInstance;
    return { flows: [flow] };
  },
});
