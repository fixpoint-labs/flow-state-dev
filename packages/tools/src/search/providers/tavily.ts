import type { SearchProviderAdapter, SearchOutput } from "../types";

export const tavilyAdapter: SearchProviderAdapter = {
  name: "tavily",
  async search(query, options): Promise<SearchOutput> {
    let tavilyModule: any;
    try {
      tavilyModule = await import("@tavily/core");
    } catch {
      throw new Error(
        "Install @tavily/core to use the Tavily search provider: npm install @tavily/core"
      );
    }

    const client = tavilyModule.tavily({ apiKey: options.apiKey });
    const response = await client.search(query, {
      maxResults: options.maxResults,
      searchDepth: options.searchDepth,
      topic: options.topic,
      includeAnswer: true,
    });

    return {
      query,
      results: (response.results ?? []).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
        score: r.score ?? undefined,
        publishedDate: r.publishedDate ?? undefined,
        source: "tavily" as const,
      })),
      answer: response.answer ?? undefined,
    };
  },
};
