/**
 * Moderated-debate pipeline — two agents argue opposing positions, a moderator
 * drives the rounds, and the pattern's default synthesizer projects the raw
 * debate output into a single primary-agent response.
 *
 * The debaters are configured by `stance` / `role` (not custom prompt files),
 * so there's no `.prompt.md` to load here. We can't reuse the assistant
 * generator as the synthesizer because it expects the flow's input shape while
 * `debate()` calls the synthesizer with `DebateRawOutput`.
 */
import {
  debate,
  createModerator,
  createDebateTranscript,
} from "@flow-state-dev/patterns/debate";
import type { PipelineConfig } from "./config";

/** Build the `kitchen-sink-debate` pipeline from the resolved router config. */
export function createDebatePipeline(config: PipelineConfig) {
  const { modelId, context, workerContext, uses, workerUses, instructions } = config;

  const debateTranscript = createDebateTranscript();
  const debateRosterNames = ["advocate", "skeptic"] as const;

  return debate({
    name: "kitchen-sink-debate",
    transcript: debateTranscript,
    debaters: [
      {
        name: "advocate",
        stance: "Argue for the proposition.",
        role: "Argues in favor of the proposition under discussion.",
      },
      {
        name: "skeptic",
        stance: "Argue against the proposition.",
        role: "Argues against the proposition under discussion.",
      },
    ],
    maxRounds: 2,
    model: modelId as any,
    moderator: createModerator({
      name: "kitchen-sink-debate",
      rosterNames: [...debateRosterNames],
      transcript: debateTranscript,
      ...(modelId !== undefined ? { model: modelId as any } : {}),
      context: workerContext,
      ...(workerUses ? { uses: workerUses as any } : {}),
    }),
    context,
    ...(uses ? { uses: uses as any } : {}),
    instructions,
  });
}
