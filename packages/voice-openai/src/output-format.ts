/**
 * Maps caller-supplied `SpeakOptions.outputFormat` strings onto OpenAI's
 * `response_format` values, and onto MIME media types the returned
 * `SpeakResult.mediaType` field carries.
 *
 * Unknown formats throw `VoiceError({ kind: "format_unsupported" })`
 * synchronously so callers fail fast at the provider boundary rather than
 * after the network round-trip.
 */

import { VoiceError } from "@flow-state-dev/core";

const ALLOWED = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;

type OpenAIResponseFormat = (typeof ALLOWED)[number];

const MIME: Record<OpenAIResponseFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg; codecs=opus",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  // OpenAI's PCM output is 24 kHz 16-bit little-endian mono.
  pcm: "audio/pcm;rate=24000",
};

/**
 * Validates and normalizes a caller-supplied output format. Returns `"mp3"`
 * when the caller doesn't specify one (matches OpenAI's own default and the
 * pre-`VoiceProvider` pipeline behaviour).
 */
export function mapOutputFormat(format: string | undefined): OpenAIResponseFormat {
  if (format === undefined) return "mp3";
  if ((ALLOWED as readonly string[]).includes(format)) {
    return format as OpenAIResponseFormat;
  }
  throw new VoiceError({
    kind: "format_unsupported",
    provider: "openai",
    message: `outputFormat "${format}" is not supported by OpenAI TTS. Allowed: ${ALLOWED.join(", ")}.`,
  });
}

/** MIME media type for an OpenAI response format. */
export function mediaTypeForFormat(format: OpenAIResponseFormat): string {
  return MIME[format];
}
