import type { FetchProviderAdapter, FetchResult } from "../types";
import { htmlToMarkdown } from "../../_internal/html-to-markdown";
import {
  blockedUrlFetchError,
  httpFetchError,
  responseTooLargeFetchError,
  transportFetchError,
  truncateBody,
} from "../errors";
import { BlockedUrlError } from "../../_internal/public-url";
import { fetchValidated, ResponseTooLargeError } from "../../_internal/fetch-validated";

export const builtinFetchAdapter: FetchProviderAdapter = {
  name: "builtin",
  async fetch(url, options): Promise<FetchResult> {
    let response: Response;
    let finalUrl: string;
    let readBody: () => Promise<string>;

    try {
      ({ response, finalUrl, readBody } = await fetchValidated(url, { signal: options.signal }));
    } catch (cause) {
      // A blocked destination is a policy refusal — permanent, so non-retryable,
      // and its own `errorType` rather than a transport class. Everything else
      // — DNS, the socket, the deadline, an over-long redirect chain — is a
      // transport failure and keeps the shaping callers already expect, so
      // `ENOTFOUND`/`EAI_AGAIN` still classify as network and stay retryable.
      if (cause instanceof BlockedUrlError) throw blockedUrlFetchError("builtin", url, cause);
      throw transportFetchError("builtin", url, cause);
    }

    if (!response.ok) {
      // The status decides the error and its retry; a body that cannot be read
      // (too large, reset mid-read) only loses the excerpt.
      const excerpt = await readBody().then(truncateBody, () => "");
      throw httpFetchError("builtin", finalUrl, response, excerpt);
    }

    let body: string;
    try {
      body = await readBody();
    } catch (cause) {
      if (cause instanceof ResponseTooLargeError) {
        throw responseTooLargeFetchError("builtin", url, cause);
      }
      throw transportFetchError("builtin", url, cause);
    }

    const contentType = response.headers.get("content-type") ?? "text/html";
    const parsed = htmlToMarkdown(body, finalUrl);

    return {
      url: finalUrl,
      title: parsed.title,
      markdown: parsed.markdown,
      metadata: {
        statusCode: response.status,
        contentType,
        wordCount: parsed.wordCount,
      },
      source: "builtin" as const,
    };
  },
};
