/**
 * Evented-actors pipeline — stigmergic multi-agent coordination.
 *
 * Actors produce granular entries (observations, findings, challenges) that
 * trigger other actors via topic-based watch patterns. The reactive chain
 * creates data-dependent fan-out: 1 request → N observations → N×M findings →
 * N×M×K challenges. The mesh's reEmit mechanism appends entries and dispatches
 * matching actors automatically; a synthesizer integrates the full chain.
 */
import { generator, sequencer } from "@flow-state-dev/core";
import {
  createEventActorsWorkspace,
  actor,
  eventActors,
} from "@flow-state-dev/patterns/eventActors";
import { z } from "zod";
import { loadPrompt } from "../../../shared/prompts";
import type { PipelineConfig } from "./config";

const rbExplorerPrompt = loadPrompt("run/thinking-styles/prompts/rb-explorer.prompt.md");
const rbAnalystPrompt = loadPrompt("run/thinking-styles/prompts/rb-analyst.prompt.md");
const rbChallengerPrompt = loadPrompt("run/thinking-styles/prompts/rb-challenger.prompt.md");
const rbSynthesizerPrompt = loadPrompt("run/thinking-styles/prompts/rb-synthesizer.prompt.md");

const rbEntrySchema = z.object({
  type: z.string(),
  topic: z.string(),
  body: z.any(),
});

// Shared output schema for actors that produce re-emittable entries.
// Wrapped in an object because the AI SDK requires top-level "type: object".
// The pattern's normalizeToEntries() unwraps { entries: [...] } automatically.
const entryOutputSchema = z.object({
  entries: z.array(z.object({
    type: z.string(),
    topic: z.string(),
    body: z.string(),
  })),
});

// Helper: build the user prompt from the triggering entry + blackboard context.
function rbUserPrompt(input: any, ctx: any): string {
  const state = ctx.resources.eventedActors.state as {
    entries: Array<{ type: string; topic: string; body: string }>;
  };
  const entries = state?.entries ?? [];
  const body = typeof input === "string"
    ? input
    : (input.body ?? JSON.stringify(input));

  const prior = entries
    .filter((e: any) => e.type !== "request")
    .map((e: any) => `[${e.type}:${e.topic}] ${e.body}`)
    .join("\n\n");

  return prior
    ? `Entry: ${body}\n\nPrior entries on the blackboard:\n${prior}`
    : `Entry: ${body}`;
}

/** Build the `evented-actors-thinking` pipeline from the resolved router config. */
export function createEventedActorsPipeline(config: PipelineConfig) {
  const { modelId, context, workerContext, uses, workerUses, history, instructions } = config;

  const rb = createEventActorsWorkspace({ name: "reactive", entries: rbEntrySchema });

  // Explorer — watches requests, produces granular observations.
  const rbExplorer = actor({
    name: "rb-explorer",
    watch: ["request:**"],
    block: generator({
      name: "rb-explorer-gen",
      model: modelId,
      outputSchema: entryOutputSchema,
      resources: { eventedActors: rb.workspace },
      ...(workerUses ? { uses: workerUses as any } : {}),
      context: workerContext,
      history,
      search: true,
      prompt: rbExplorerPrompt.prompt,
      user: rbUserPrompt,
    }),
  });

  // Analyst — watches observations, produces findings (structured analysis).
  // Fires once per observation, so N observations → N analyst invocations.
  const rbAnalyst = actor({
    name: "rb-analyst",
    watch: ["observation:**"],
    block: generator({
      name: "rb-analyst-gen",
      model: modelId,
      outputSchema: entryOutputSchema,
      resources: { eventedActors: rb.workspace },
      ...(workerUses ? { uses: workerUses as any } : {}),
      context: workerContext,
      history,
      search: true,
      prompt: rbAnalystPrompt.prompt,
      user: rbUserPrompt,
    }),
  });

  // Challenger — watches findings, produces challenges.
  // Fires once per finding, stress-testing each conclusion.
  const rbChallenger = actor({
    name: "rb-challenger",
    watch: ["finding:**"],
    block: generator({
      name: "rb-challenger-gen",
      model: modelId,
      outputSchema: entryOutputSchema,
      resources: { eventedActors: rb.workspace },
      ...(workerUses ? { uses: workerUses as any } : {}),
      context: workerContext,
      history,
      search: true,
      prompt: rbChallengerPrompt.prompt,
      user: rbUserPrompt,
    }),
  });

  const rbMesh = eventActors({
    name: "reactive-thinking",
    workspace: rb,
    actors: [rbExplorer, rbAnalyst, rbChallenger],
    concurrency: 3,
    reEmit: true,
    maxDepth: 3,
  });

  const rbSynthesizer = generator({
    name: "rb-synthesizer",
    model: modelId,
    outputSchema: z.string(),
    resources: { eventedActors: rb.workspace },
    ...(uses ? { uses: uses as any } : {}),
    context,
    history,
    search: true,
    prompt: [instructions, rbSynthesizerPrompt.prompt],
    itemVisibility: { client: true, history: true },
    activeStatusMessage: "Synthesizing all of the findings...",
    user: (_input: any, ctx: any) => {
      const state = ctx.resources.eventedActors.state as {
        entries: Array<{ type: string; topic: string; body: string }>;
      };
      const entries = state?.entries ?? [];
      const request = entries.find((e) => e.type === "request");
      const observations = entries.filter((e) => e.type === "observation");
      const findings = entries.filter((e) => e.type === "finding");
      const challenges = entries.filter((e) => e.type === "challenge");

      const parts: string[] = [];
      if (request) parts.push(`## Original Question\n${request.body}`);
      if (observations.length) {
        parts.push(`## Observations (${observations.length})\n` +
          observations.map((o) => `### ${o.topic}\n${o.body}`).join("\n\n"));
      }
      if (findings.length) {
        parts.push(`## Findings (${findings.length})\n` +
          findings.map((f) => `### ${f.topic}\n${f.body}`).join("\n\n"));
      }
      if (challenges.length) {
        parts.push(`## Challenges (${challenges.length})\n` +
          challenges.map((c) => `### ${c.topic}\n${c.body}`).join("\n\n"));
      }
      return parts.join("\n\n---\n\n") || "No contributions were gathered.";
    },
  });

  return sequencer({
    name: "evented-actors-thinking",
    inputSchema: z.any(),
  })
    .map((input: any) => ({
      type: "request",
      topic: "query",
      body: input.message ?? input,
    }))
    .step(rbMesh.emit)
    .step(rbSynthesizer);
}
