/**
 * FIX-1364 POC part 2 — is a separate `resources` option needed at all?
 *
 * Codex argued the option is redundant: a capability contributes its declared
 * resources to the generator, and `defineFlow` merges every action block's
 * declarations, so `uses: [mem]` alone should install memory's stores.
 *
 * That contradicts the memory README, which teaches spreading
 * `{...mem.sessionResources, ...mem.userResources}` onto `defineFlow`. So it
 * gets run, because it decides whether a ratified §6 Decision keeps three
 * doors or two.
 *
 * Run:  pnpm tsx spec-poc/FIX-1364-seat-memory-isolation/resources-bubble.ts
 *
 * Throwaway. Never merges; closes with the spec PR.
 */

import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { createMemoryCapability } from "@flow-state-dev/memory";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const mem = createMemoryCapability({
  model: "openai/gpt-5.4-mini",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

/** Reports which memory stores this block can actually reach at runtime. */
const probe = handler({
  name: "probe",
  inputSchema: z.string(),
  outputSchema: z.object({ reachable: z.array(z.string()) }),
  execute: (_input, ctx) => {
    const reachable: string[] = [];
    for (const key of ["workingMemory", "semanticMemory", "episodicMemory"]) {
      try {
        if (ctx.resources.get(key) !== undefined) reachable.push(key);
      } catch {
        /* not declared — that is the answer, not an error */
      }
    }
    return { reachable };
  },
});

const answer = generator({
  name: "answer",
  inputSchema,
  // The capability is the ONLY thing installing memory here.
  uses: [mem],
  prompt: () => "you are a worker",
  model: () => "intent/chat",
  user: (input: { message: string }) => input.message,
});

const run = sequencer({ name: "run", inputSchema })
  .step(answer)
  .step(probe);

/** NOTE: no `resources:` on defineFlow. That absence is the experiment. */
const flow = defineFlow({
  kind: "poc-bubble",
  actions: { run: { inputSchema, block: run } },
});

async function main() {
  console.log("FIX-1364 — does `uses:` alone install a capability's resources?\n");

  const result = await testFlow({
    flow: flow as never,
    action: "run",
    userId: "u1",
    input: { message: "hi" },
    stores: createInMemoryStores(),
    generators: {
      answer: mockGenerator({ name: "answer", script: [{ text: "ok" }] }),
    },
    unmockedGeneratorPolicy: "error",
  });

  if (result.error) {
    console.error("run failed:", result.error.message);
    process.exit(1);
  }

  const reachable = (result.output as { reachable: string[] }).reachable;
  console.log("Stores reachable with NO `resources:` on defineFlow:", reachable);
  console.log("");
  console.log(
    "VERDICT:",
    reachable.length >= 3
      ? "REDUNDANT — `uses:` alone installs the capability's resources.\n" +
        "         A separate `resources` option has no consumer; drop it."
      : reachable.length === 0
        ? "REQUIRED — nothing resolved, so resources must be declared explicitly.\n" +
          "         Keep the `resources` option."
        : `PARTIAL — only ${reachable.join(", ")} resolved. Investigate before deciding.`,
  );
}

main().catch((err) => {
  console.error("POC FAILED TO RUN:", err);
  process.exit(1);
});
