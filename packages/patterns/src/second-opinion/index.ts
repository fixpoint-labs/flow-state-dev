/**
 * Second-opinion kit: a blocking draft, critique, audit, and synthesis flow.
 *
 * The kit composes the public debate and response-auditor patterns. Internal
 * model output is hidden from clients; only the synthesis that runs after the
 * blocking audit is client-visible.
 */
import { defineFlow, defineKit, generator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  createDebateTranscript,
  createDebater,
  createJudge,
  createSynthesize,
  debate,
  type DebateRawOutput,
} from "../debate";
import { AnalyzerResultSchema, responseAuditor } from "../response-auditor";

const hidden = { client: false, history: false } as const;

/** Configuration for {@link secondOpinion}. */
export interface SecondOpinionConfig {
  /** Model that writes the initial answer. */
  draftModel: string;
  /** Independent model that critiques, audits, and synthesizes the answer. */
  reviewModel: string;
  /** Number of draft/critique rounds. Defaults to one. */
  maxRounds?: number;
  /** Additional blocking response-auditor analyzers. */
  analyzers?: BlockDefinition<any, any>[];
  /** Optional judge override for the debate. */
  judge?: BlockDefinition<any, any>;
  /** Optional final answer synthesizer. */
  synthesizer?: BlockDefinition<any, any>;
  /** Flow kind served by the kit. Defaults to `second-opinion`. */
  flowKind?: string;
}

const blockSchema = z.custom<BlockDefinition<any, any>>(
  (value) => typeof value === "object" && value !== null,
  { message: "an analyzer or override must be a block" },
);

const configSchema: z.ZodType<SecondOpinionConfig, z.ZodTypeDef, SecondOpinionConfig> = z
  .object({
    draftModel: z.string().min(1),
    reviewModel: z.string().min(1),
    maxRounds: z.number().int().positive().max(4).optional(),
    analyzers: z.array(blockSchema).optional(),
    judge: blockSchema.optional(),
    synthesizer: blockSchema.optional(),
    flowKind: z.string().min(1).optional(),
  })
  .strict();

const inputSchema = z.object({ message: z.string().min(1) });

/** Build the plain agent flow installed by the second-opinion kit. */
export function createSecondOpinionFlow(config: SecondOpinionConfig) {
  const transcript = createDebateTranscript();
  const draft = createDebater({
    name: "second-opinion",
    agentName: "drafter",
    stance: "Write the best direct answer to the user's question.",
    role: "Primary answer drafter",
    maxRounds: config.maxRounds ?? 1,
    transcript,
    model: config.draftModel,
    itemVisibility: hidden,
  });
  const criticCall = createDebater({
    name: "second-opinion",
    agentName: "critic",
    stance: "Check the draft for errors, omissions, unsupported claims, and unsafe advice.",
    role: "Independent critical reviewer",
    maxRounds: config.maxRounds ?? 1,
    transcript,
    model: config.reviewModel,
    itemVisibility: hidden,
  });
  const criticUnavailable = handler({
    name: "second-opinion-critic-unavailable",
    inputSchema: z.unknown(),
    outputSchema: z.string(),
    execute: (error, ctx) => {
      if (ctx.signal.aborted) throw error;
      return "The independent critic was unavailable; the remaining audit must check the draft directly.";
    },
  });
  const critic = criticCall.rescue([{ block: criticUnavailable }]);
  const judgeCall =
    config.judge ??
    createJudge({
      name: "second-opinion",
      transcript,
      stances: [
        "Write the best direct answer to the user's question.",
        "Check the draft for errors, omissions, unsupported claims, and unsafe advice.",
      ],
      model: config.reviewModel,
      itemVisibility: hidden,
    });
  const judgeUnavailable = handler({
    name: "second-opinion-judge-unavailable",
    inputSchema: z.unknown(),
    outputSchema: z.object({
      verdict: z.string(),
      winner: z.string().nullable(),
      reasoning: z.string(),
    }),
    execute: (error, ctx) => {
      if (ctx.signal.aborted) throw error;
      return {
        verdict: "Use the draft only after the blocking response audit.",
        winner: null,
        reasoning: "The debate judge was unavailable, so no judge conclusion was trusted.",
      };
    },
  });
  const judge = judgeCall.rescue([{ block: judgeUnavailable }]);

  const deliberation = debate({
    name: "second-opinion-deliberation",
    maxRounds: config.maxRounds ?? 1,
    transcript,
    debaters: [
      { name: "drafter", stance: "Draft", block: draft },
      { name: "critic", stance: "Critique", block: critic },
    ],
    judge,
    synthesizer: false,
    debaterVisibility: hidden,
    judgeVisibility: hidden,
    verdictVisibility: hidden,
  });

  const defaultAnalyzer = generator({
    name: "second-opinion-analyzer",
    model: config.reviewModel,
    inputSchema: z.object({ userInput: z.string(), response: z.string() }),
    outputSchema: AnalyzerResultSchema,
    itemVisibility: hidden,
    prompt: [
      "Independently audit the proposed answer before it is shown.",
      "Return one analyzer result. Set shouldSurface when a material problem remains.",
    ],
    user: (input) => `Question: ${input.userInput}\n\nProposed answer and review:\n${input.response}`,
  });
  const auditor = responseAuditor({
    analyzers: config.analyzers ?? [defaultAnalyzer],
    threshold: 0.3,
    annotationVisibility: hidden,
  });
  const synthesis =
    config.synthesizer ??
    createSynthesize({
      name: "second-opinion",
      model: config.reviewModel,
      itemVisibility: { client: true, history: true },
    });

  const guarded = sequencer({ name: "second-opinion-answer", inputSchema })
    .map((input) => ({ question: input.message }))
    .step(deliberation)
    .tap(
      (result: DebateRawOutput) => ({
        userInput: result.question,
        response: JSON.stringify({ verdict: result.verdict, transcript: result.transcript }),
      }),
      auditor,
    )
    .step(synthesis);

  return defineFlow({
    kind: config.flowKind ?? "second-opinion",
    requireUser: true,
    actions: {
      ask: {
        inputSchema,
        block: guarded,
        userMessage: (input) => input.message,
      },
    },
  })();
}

/**
 * Install a second-opinion agent flow with one config object.
 *
 * The kit has no workforce dependency and can be installed in a plain app.
 */
export const secondOpinion = defineKit({
  name: "second-opinion",
  config: configSchema,
  install: ({ config }) => ({ flows: [createSecondOpinionFlow(config)] }),
});
