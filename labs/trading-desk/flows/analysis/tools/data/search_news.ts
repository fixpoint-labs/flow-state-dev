/**
 * Recent company-relevant news headlines. Live: Finnhub `/company-news`
 * (14-day window). Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { fetchFinnhubCompanyNews, hasFinnhubKey } from "@/lib/providers/finnhub";
import { resolveToolPayload } from "../runtime/resolve";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const search_news = handler({
  name: "search_news",
  description: "Recent company-relevant news headlines for a ticker.",
  inputSchema: toolInputSchemas.search_news,
  outputSchema: toolOutputSchemas.search_news,
  execute: async (input, ctx) => {
    return resolveToolPayload("search_news", input, ctx, async () => {
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubCompanyNews(input); } catch {}
      }
      return emptyPayload("search_news", input);
    });
  },
});
