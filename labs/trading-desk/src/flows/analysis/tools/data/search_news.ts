/**
 * Recent company-relevant news headlines. Live: Finnhub `/company-news`
 * (14-day window). Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { fetchFinnhubCompanyNews, hasFinnhubKey } from "../providers/finnhub";
import { loadFixture } from "../runtime/fixtures";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const search_news = handler({
  name: "search_news",
  description: "Recent company-relevant news headlines for a ticker.",
  inputSchema: toolInputSchemas.search_news,
  outputSchema: toolOutputSchemas.search_news,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("search_news", input);
    return getOrFetch("search_news", input, async () => {
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubCompanyNews(input); } catch {}
      }
      return emptyPayload("search_news", input);
    });
  },
});
