import type { SearchProviderAdapter, SearchOutput } from "../types";

export const exaAdapter: SearchProviderAdapter = {
  name: "exa",
  async search(query, options): Promise<SearchOutput> {
    let ExaModule: any;
    try {
      ExaModule = await import("exa-js");
    } catch {
      throw new Error(
        "Install exa-js to use the Exa search provider: npm install exa-js"
      );
    }

    const Exa = ExaModule.default ?? ExaModule.Exa;
    const client = new Exa(options.apiKey);
    const response = await client.searchAndContents(query, {
      numResults: options.maxResults,
      type: "auto",
      text:
        options.searchDepth === "advanced"
          ? true
          : { maxCharacters: 500 },
      highlights: true,
    });

    return {
      query,
      results: (response.results ?? []).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.highlights?.[0] ?? r.text?.slice(0, 300) ?? "",
        content:
          options.searchDepth === "advanced"
            ? (r.text ?? undefined)
            : undefined,
        score: r.score ?? undefined,
        publishedDate: r.publishedDate ?? undefined,
        source: "exa" as const,
      })),
    };
  },
};
