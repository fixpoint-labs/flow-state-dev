/**
 * Isomorphic transcription client that POSTs audio to the server
 * /api/flows/transcribe endpoint as raw binary (no base64 encoding).
 */
import { buildFlowApiUrl, requestJson, resolveFetch } from "../internal/http";
import type { ClientFetch } from "../types";

export type TranscribeOptions = {
  baseUrl?: string;
  /**
   * Where the server mounts the flow API, after `baseUrl`. Default
   * `"/api/flows"`. Set it to the server's mount when that differs, such as
   * the Node host's `basePath`.
   */
  apiPath?: string;
  fetcher?: ClientFetch;
};

export type TranscribeRequest = {
  audio: Uint8Array | Blob;
  mediaType?: string;
  language?: string;
  userId: string;
};

export type TranscribeResponse = {
  text: string;
  language?: string;
};

/**
 * Sends audio to the server transcription endpoint as raw binary and
 * returns the transcribed text. Metadata is passed via query parameters.
 */
export async function transcribe(
  request: TranscribeRequest,
  options?: TranscribeOptions
): Promise<TranscribeResponse> {
  const fetcher = resolveFetch(options?.fetcher);
  const mediaType = request.mediaType ?? "audio/webm";

  const body =
    request.audio instanceof Blob
      ? request.audio
      : new Blob([request.audio as Uint8Array<ArrayBuffer>], { type: mediaType });

  return requestJson<TranscribeResponse>({
    fetcher,
    url: buildFlowApiUrl({
      baseUrl: options?.baseUrl,
      apiPath: options?.apiPath,
      path: "/api/flows/transcribe",
      query: {
        userId: request.userId,
        language: request.language
      }
    }),
    init: {
      method: "POST",
      headers: {
        "content-type": mediaType
      },
      body
    }
  });
}
