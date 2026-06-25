/**
 * Routed-specialists pipeline — multiple independent specialists contribute to a
 * shared workspace resource. A controller reads the workspace state and decides
 * which specialist to invoke next until the problem converges.
 *
 * Each specialist is a generator (system prompt from its `bb-*.prompt.md`,
 * `user:` reads the live workspace) followed by a write-back handler that
 * patches its contribution into the workspace.
 */
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { routedSpecialists, createWorkspace } from "@flow-state-dev/patterns/routedSpecialists";
import { z } from "zod";
import { loadPrompt } from "../../../shared/prompts";
import type { PipelineConfig } from "./config";

type PromptSlot = ReturnType<typeof loadPrompt>["prompt"];

const bbResearcherPrompt = loadPrompt("run/thinking-styles/prompts/bb-researcher.prompt.md");
const bbAnalystPrompt = loadPrompt("run/thinking-styles/prompts/bb-analyst.prompt.md");
const bbCriticPrompt = loadPrompt("run/thinking-styles/prompts/bb-critic.prompt.md");

/** Build the `routedSpecialists-thinking` pipeline from the resolved router config. */
export function createRoutedSpecialistsPipeline(config: PipelineConfig) {
  const { modelId, context, workerContext, uses, workerUses, history, instructions } = config;

  const workspace = createWorkspace(z.object({
    goal: z.string().default(""),
    research: z.string().optional(),
    analysis: z.string().optional(),
    critique: z.string().optional(),
  }));

  function bbSpecialist(specConfig: {
    name: string;
    field: string;
    prompt: PromptSlot;
  }) {
    const gen = generator({
      name: `${specConfig.name}-gen`,
      model: modelId,
      outputSchema: z.string(),
      resources: { workspace },
      ...(workerUses ? { uses: workerUses as any } : {}),
      context: workerContext,
      history,
      search: true,
      itemVisibility: { client: true, history: false },
      prompt: specConfig.prompt,
      user: (_input: any, ctx: any) => {
        const state = ctx.resources.workspace.state;
        return `Current workspace state:\n${JSON.stringify(state, null, 2)}`;
      },
    });

    const writeBack = handler({
      name: `${specConfig.name}-write`,
      inputSchema: z.string(),
      outputSchema: z.any(),
      resources: { workspace },
      execute: async (output: string, ctx) => {
        await ctx.resources.workspace.patchState({
          [specConfig.field]: output,
        });
        return { specialist: specConfig.name, contributed: true };
      },
    });

    return sequencer({ name: specConfig.name, inputSchema: z.any() })
      .step(gen)
      .step(writeBack);
  }

  const bbResearcher = bbSpecialist({
    name: "bb-researcher",
    field: "research",
    prompt: bbResearcherPrompt.prompt,
  });

  const bbAnalyst = bbSpecialist({
    name: "bb-analyst",
    field: "analysis",
    prompt: bbAnalystPrompt.prompt,
  });

  const bbCritic = bbSpecialist({
    name: "bb-critic",
    field: "critique",
    prompt: bbCriticPrompt.prompt,
  });

  return routedSpecialists({
    name: "routedSpecialists-thinking",
    workspace,
    specialists: {
      "bb-researcher": bbResearcher,
      "bb-analyst": bbAnalyst,
      "bb-critic": bbCritic,
    },
    instructions,
    model: modelId as any,
    context,
    uses,
    maxIterations: 8,
    maxHistory: 20,
    initialState: (input: unknown) => ({
      goal: (input as { message?: string })?.message ?? "",
    }),
    outputSchema: z.string(),
  });
}
