/**
 * Perplexity Sonar grounding adapter.
 *
 * Dispatches a query to the Perplexity Sonar model via the OpenAI-compatible chat
 * completions API with built-in web search. Extracts citations from the response and
 * normalizes them as search results. This is the same pattern as the Gemini grounding
 * fallback — an AI-synthesized answer with source URLs rather than raw ranked results.
 *
 * Uses the `sonar` model by default. Same API key as the Perplexity Search API.
 */

import type { SearchProviderAdapter, SearchOutput } from "../types";

export const perplexitySonarAdapter: SearchProviderAdapter = {
  name: "perplexity-sonar",
  async search(query, options): Promise<SearchOutput> {
    const response = await globalThis.fetch(
      "https://api.perplexity.ai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: query }],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Perplexity Sonar API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content ?? "";
    const citations: string[] = data.citations ?? [];

    return {
      query,
      results: citations.slice(0, options.maxResults).map((url: string) => ({
        title: "",
        url,
        snippet: "",
        source: "perplexity-sonar" as const,
      })),
      answer: answer || undefined,
    };
  },
};
