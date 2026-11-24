/**
 * The goal's host: the Teammates lab's own host (`labs/teammates/host.mts`) on
 * its own workers, served on `GOAL_PORT`, with only the model scripted, and
 * each request taken as the user it is signed in as (`signedInUser`), so Alice
 * and Bob are two users of one organization. Each
 * worker step's prompt is appended to `GOAL_PROMPTS` as one JSON line, so the
 * goal reads what the model was handed, never what the adapter called.
 *
 * Run by `run.mts`, which applies the control's patch to this process.
 */
import { appendFileSync } from "node:fs";
import { serve } from "@flow-state-dev/node";
import type { ModelResolver } from "@flow-state-dev/core/types";
import * as contractModule from "../../../labs/test-support/contract.ts";
import { openTeammates } from "../../../labs/teammates/host.mts";
import { signedInUser } from "../lab.mts";

// `contract.ts` sits under no `type: module` package, so tsx loads it as CommonJS: its functions
// are then on the default export, not named ones.
const { scriptedModels } = ((contractModule as { default?: typeof contractModule }).default ?? contractModule) as typeof contractModule;

const need = (key: string) => {
  const value = process.env[key];
  if (value === undefined || value === "") throw new Error(`host: ${key} is unset`);
  return value;
};
const prompts = need("GOAL_PROMPTS");

const model = scriptedModels(
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
  // The `one-user` control: every request is Alice, as the lab's own host takes it.
  ...(process.env.GOAL_ONE_USER === "1" ? {} : { user: signedInUser }),
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
