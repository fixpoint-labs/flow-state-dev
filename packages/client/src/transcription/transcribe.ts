/**
 * Isomorphic transcription client that POSTs audio to the server /api/flows/transcribe endpoint.
 */
import { buildFlowApiUrl, requestJson, resolveFetch } from "../internal/http";
import type { ClientFetch } from "../types";

export type TranscribeOptions = {
  baseUrl?: string;
  fetcher?: ClientFetch;
};

export type TranscribeRequest = {
  audio: Uint8Array | Blob;
  mediaType?: string;
  language?: string;
  model?: string;
  userId: string;
};

export type TranscribeResponse = {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    text: string;
    start: number;
    end: number;
  }>;
};

/**
 * Sends audio to the server transcription endpoint and returns the transcribed text.
 */
export async function transcribe(
  request: TranscribeRequest,
  options?: TranscribeOptions
): Promise<TranscribeResponse> {
  const fetcher = resolveFetch(options?.fetcher);

  const audioBytes =
    request.audio instanceof Uint8Array
      ? request.audio
      : new Uint8Array(await request.audio.arrayBuffer());

  const base64 = uint8ArrayToBase64(audioBytes);

  return requestJson<TranscribeResponse>({
    fetcher,
    url: buildFlowApiUrl({
      baseUrl: options?.baseUrl,
      path: "/api/flows/transcribe"
    }),
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        audio: base64,
        mediaType: request.mediaType ?? "audio/webm",
        language: request.language,
        model: request.model,
        userId: request.userId
      })
    }
  });
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
