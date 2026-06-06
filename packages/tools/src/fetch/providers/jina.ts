import type { FetchProviderAdapter, FetchResult } from "../types";
import { httpFetchError, readTruncatedBody, transportFetchError } from "../errors";

export const jinaFetchAdapter: FetchProviderAdapter = {
  name: "jina",
  async fetch(url, options): Promise<FetchResult> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (options.apiKey) {
      headers["Authorization"] = `Bearer ${options.apiKey}`;
    }

    let response: Response;
    try {
      response = await globalThis.fetch(`https://r.jina.ai/${url}`, {
        headers,
      });
    } catch (cause) {
      throw transportFetchError("jina", url, cause);
    }

    if (!response.ok) {
      throw httpFetchError("jina", url, response, await readTruncatedBody(response));
    }

    const data = (await response.json()) as {
      data?: {
        title?: string;
        content?: string;
        description?: string;
      };
    };

    const markdown = data.data?.content ?? "";

    return {
      url,
      title: data.data?.title ?? "",
      markdown,
      metadata: {
        statusCode: response.status,
        contentType: "text/html",
        description: data.data?.description,
        wordCount: markdown.split(/\s+/).filter(Boolean).length,
      },
      source: "jina" as const,
    };
  },
};
