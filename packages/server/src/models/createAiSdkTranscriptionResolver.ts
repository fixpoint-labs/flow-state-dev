/**
 * Wraps AI SDK `transcribe` into the framework's TranscriptionModel interface.
 * Follows the same adapter pattern as createAiSdkModelResolver.
 */
import { experimental_transcribe as transcribe } from "ai";
import type {
  TranscriptionModel,
  TranscriptionResolver,
  TranscriptionResult
} from "@flow-state-dev/core/types";

export type ResolveAiSdkTranscriptionModel = (modelId: string) => unknown;

function createTranscriptionModelFromAiSdk(
  modelId: string,
  transcriptionModel: unknown
): TranscriptionModel {
  return {
    modelId,

    async transcribe(options): Promise<TranscriptionResult> {
      const result = await (transcribe as any)({
        model: transcriptionModel as any,
        audio: options.audio
      });

      return {
        text: result.text,
        language: result.language ?? undefined
      };
    }
  };
}

/**
 * Wraps an AI SDK transcription model instance into a framework TranscriptionModel.
 */
export function wrapAiSdkTranscriptionModel(
  transcriptionModel: unknown,
  modelId?: string
): TranscriptionModel {
  const resolvedId =
    modelId ??
    (typeof (transcriptionModel as Record<string, unknown>)?.modelId === "string"
      ? (transcriptionModel as Record<string, unknown>).modelId as string
      : "unknown");

  return createTranscriptionModelFromAiSdk(resolvedId, transcriptionModel);
}

/**
 * Creates a framework TranscriptionResolver backed by AI SDK `transcribe`.
 */
export function createAiSdkTranscriptionResolver(
  resolveTranscriptionModel: ResolveAiSdkTranscriptionModel
): TranscriptionResolver {
  return (modelId: string) =>
    createTranscriptionModelFromAiSdk(modelId, resolveTranscriptionModel(modelId));
}
