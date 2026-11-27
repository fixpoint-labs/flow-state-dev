/**
 * Kitchen Sink's half of the coding-brief goal: one turn of a harness session,
 * through Kitchen Sink's own `kitchenSinkHarnessFlow`, with an agent that only
 * records the prompt it was handed. Prints `{ "prompts": [...] }` on stdout.
 *
 * Run by `run.mts` from inside the tree it grades (this checkout or a commit's
 * own), so every import below resolves to that tree. The host's settings
 * (`KITCHEN_SINK_HARNESS_WORKSPACE`, `KITCHEN_SINK_HARNESS_CHECKS`,
 * `XDG_STATE_HOME`) come from the environment, as on a real server.
 */
import { DEFAULT_ORG_ID, handler } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/harness";
import { runAction } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { z } from "zod";
import { kitchenSinkHarnessFlow } from "../../../apps/kitchen-sink/lib/harness-session-flow.ts";

const KIND = "claude-code-session";
const SESSION = "s-coding-brief";
const prompts: string[] = [];

/** The harness: it records its prompt and finishes, so the turn's checks run after it as on a real turn. */
const recording = () =>
  handler({
    name: "recording-harness",
    inputSchema: z.object({ prompt: z.string() }).passthrough(),
    execute: async (input: { prompt: string }) => {
      prompts.push(input.prompt);
      return { source: "goal/recording", status: "completed", sessionId: null, url: null, dispatchedAt: Date.now(), outcome: "finished", finalMessage: "Recorded." };
    },
  }) as unknown as HarnessBlock;

const stores = createInMemoryStores();
const now = Date.now();
await stores.session.set(
  SESSION,
  { id: SESSION, flowKind: KIND, userId: "devuser", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "goal-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
  "any" as never,
);
const result = (await runAction({
  flow: kitchenSinkHarnessFlow({ kind: KIND, agent: recording }),
  actionName: "turn",
  input: { prompt: process.env.GOAL_PROMPT ?? "Change check.mjs so it exits 0." },
  userId: "devuser",
  orgId: DEFAULT_ORG_ID,
  sessionId: SESSION,
  stores,
  runtimeConfig: {},
} as never)) as { error?: unknown };
process.stdout.write(`${JSON.stringify({ prompts, error: result.error === undefined ? null : String((result.error as Error).message ?? result.error) })}\n`);
process.exit(0);
