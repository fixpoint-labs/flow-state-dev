/**
 * The goal's host: the Teammates lab's own host (`labs/teammates/host.mts`) on
 * its own workers, served on `GOAL_PORT`, with only the model scripted. Each
 * worker step's prompt is appended to `GOAL_PROMPTS` as one JSON line, so the
 * goal reads what the model was handed, never what the adapter called.
 *
 * Run by `run.mts`, which applies the control's patch to this process.
 */
import { appendFileSync } from "node:fs";
import { serve } from "@flow-state-dev/node";
import type { ModelResolver } from "@flow-state-dev/core/types";
// The labs' test support is a CommonJS module to this process (no `"type": "module"` above it).
import support from "../../../labs/test-support/contract.ts";
import { openTeammates } from "../../../labs/teammates/host.mts";

const need = (key: string) => {
  const value = process.env[key];
  if (value === undefined || value === "") throw new Error(`host: ${key} is unset`);
  return value;
};
const prompts = need("GOAL_PROMPTS");

const model = (support as typeof import("../../../labs/test-support/contract.ts")).scriptedModels(
  {
    "agent-answer": ({ said, step }) => {
      if (step === 0) appendFileSync(prompts, `${JSON.stringify({ said })}\n`);
      return { text: "Noted." };
    },
    "memory/observe": () => ({ output: { items: [] } }),
  },
  () => ({ text: "ok" }),
) as ModelResolver;

const state = await openTeammates({
  store: need("GOAL_STORE"),
  model: "test/scripted",
  userId: "alice",
  workdir: need("GOAL_WORKDIR"),
  runsRoot: need("GOAL_RUNS"),
  scriptedHarnessStepMs: 50,
  modelResolver: model,
});
const handle = await serve(await (state as unknown as { getRouter(): Promise<never> }).getRouter(), {
  port: Number(need("GOAL_PORT")),
  host: "127.0.0.1",
  handleSignals: true,
  shutdownGraceMs: 200,
});
console.log(`ready on ${handle.port}`);
