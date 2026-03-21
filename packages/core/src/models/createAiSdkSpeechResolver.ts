/**
 * Wraps AI SDK `generateSpeech` into the framework's SpeechModel interface.
 * Follows the same adapter pattern as createAiSdkModelResolver.
 */
import { experimental_generateSpeech as generateSpeech } from "ai";
import type {
  SpeechModel,
  SpeechResolver,
  SpeechResult
} from "../types";

export type ResolveAiSdkSpeechModel = (modelId: string) => unknown;

function createSpeechModelFromAiSdk(
  modelId: string,
  speechModel: unknown
): SpeechModel {
  return {
    modelId,

    async generate(options): Promise<SpeechResult> {
      // AI SDK experimental_generateSpeech types are not generic — the model
      // parameter expects a concrete provider type, but our resolver accepts
      // any provider. Cast through any to bridge the generic boundary.
      const result = await generateSpeech({
        model: speechModel as any,
        text: options.text,
        voice: options.voice,
        speed: options.speed,
        instructions: options.instructions,
        outputFormat: options.outputFormat
      });

      return {
        audio: result.audio.uint8Array,
        mediaType: result.audio.mediaType
      };
    }
  };
}

/**
 * Wraps an AI SDK speech model instance into a framework SpeechModel.
 */
export function wrapAiSdkSpeechModel(
  speechModel: unknown,
  modelId?: string
): SpeechModel {
  const resolvedId =
    modelId ??
    (typeof (speechModel as Record<string, unknown>)?.modelId === "string"
      ? (speechModel as Record<string, unknown>).modelId as string
      : "unknown");

  return createSpeechModelFromAiSdk(resolvedId, speechModel);
}

/**
 * Creates a framework SpeechResolver backed by AI SDK `generateSpeech`.
 */
export function createAiSdkSpeechResolver(
  resolveSpeechModel: ResolveAiSdkSpeechModel
): SpeechResolver {
  return (modelId: string) =>
    createSpeechModelFromAiSdk(modelId, resolveSpeechModel(modelId));
}
