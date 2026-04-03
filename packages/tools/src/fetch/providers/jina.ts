import type { FetchProviderAdapter, FetchResult } from "../types";

export const jinaFetchAdapter: FetchProviderAdapter = {
  name: "jina",
  async fetch(url, options): Promise<FetchResult> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (options.apiKey) {
      headers["Authorization"] = `Bearer ${options.apiKey}`;
    }

    const response = await globalThis.fetch(`https://r.jina.ai/${url}`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(
        `Jina Reader error: ${response.status} ${response.statusText}`
      );
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
        description: data.data?.description ?? undefined,
        wordCount: markdown.split(/\s+/).filter(Boolean).length,
      },
      source: "jina" as const,
    };
  },
};
