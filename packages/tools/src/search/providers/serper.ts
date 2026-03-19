import type { SearchProviderAdapter, SearchOutput } from "../types";

export const serperAdapter: SearchProviderAdapter = {
  name: "serper",
  async search(query, options): Promise<SearchOutput> {
    const endpoint =
      options.topic === "news"
        ? "https://google.serper.dev/news"
        : "https://google.serper.dev/search";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-API-KEY": options.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: options.maxResults }),
    });

    if (!response.ok) {
      throw new Error(
        `Serper API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const items = data.organic ?? data.news ?? [];

    return {
      query,
      results: items.slice(0, options.maxResults).map((r: any) => ({
        title: r.title ?? "",
        url: r.link ?? "",
        snippet: r.snippet ?? r.description ?? "",
        publishedDate: r.date ?? undefined,
        source: "serper" as const,
      })),
      answer: data.answerBox?.answer ?? data.answerBox?.snippet ?? undefined,
    };
  },
};
