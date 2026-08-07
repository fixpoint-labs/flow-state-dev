import type { FetchProviderAdapter, FetchResult } from "../types";
import { htmlToMarkdown } from "../../_internal/html-to-markdown";
import { httpFetchError, readTruncatedBody, transportFetchError } from "../errors";
import { BlockedUrlError } from "../../_internal/public-url";
import { fetchValidated } from "../../_internal/fetch-validated";

export const builtinFetchAdapter: FetchProviderAdapter = {
  name: "builtin",
  async fetch(url, _options): Promise<FetchResult> {
    let response: Response;
    let finalUrl: string;

    try {
      ({ response, finalUrl } = await fetchValidated(url));
    } catch (cause) {
      // A blocked destination is a policy refusal: permanent, and retrying just
      // refuses again, so it stays a bare non-retryable error. Everything else
      // — the guard's DNS lookup, the socket, an over-long redirect chain — is a
      // transport failure and keeps the shaping callers already expect, so
      // `ENOTFOUND`/`EAI_AGAIN` still classify as network and stay retryable.
      if (cause instanceof BlockedUrlError) throw cause;
      throw transportFetchError("builtin", url, cause);
    }

    if (!response.ok) {
      throw httpFetchError(
        "builtin",
        finalUrl,
        response,
        await readTruncatedBody(response),
      );
    }

    const html = await response.text();
    const contentType = response.headers.get("content-type") ?? "text/html";
    const parsed = htmlToMarkdown(html, finalUrl);

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
