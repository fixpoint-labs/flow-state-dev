/**
 * `MultiSourceDataSource` — composes an ordered list of live `DataSource`
 * implementations. For each tool call it tries providers in order, falling
 * through to the next on `ProviderUnsupportedError` (this provider doesn't
 * implement this tool on its tier) or on any thrown error (rate limit,
 * network failure, parse error from a flaky upstream).
 *
 * The live chain is Finnhub → Yahoo. **There is no fixture floor.** If every
 * provider fails for a given tool, this returns an `emptyPayload` tagged
 * `source: "unavailable"` — serving stale fixture data labeled as "live" is
 * worse than no data because it silently corrupts the analyst's reasoning.
 *
 * Fixture mode bypasses this entirely (see `make-data-source.ts`); fixture
 * data is only ever served when the caller explicitly opts into fixture mode.
 */
import {
  type DataSource,
  type ToolInput,
  type ToolOutput,
  type ToolName,
} from "./data-source";
import { emptyPayload } from "./empty-payloads";

type ToolCaller<T extends ToolName> = (
  source: DataSource,
  input: ToolInput<T>,
) => Promise<ToolOutput<T>>;

export class MultiSourceDataSource implements DataSource {
  readonly mode = "live" as const;
  readonly providers: ReadonlyArray<DataSource>;

  constructor(providers: ReadonlyArray<DataSource>) {
    if (providers.length === 0) {
      throw new Error("MultiSourceDataSource requires at least one provider");
    }
    this.providers = providers;
  }

  async #tryChain<T extends ToolName>(
    tool: T,
    input: ToolInput<T>,
    call: ToolCaller<T>,
  ): Promise<ToolOutput<T>> {
    const errors: string[] = [];
    for (const provider of this.providers) {
      try {
        return await call(provider, input);
      } catch (err) {
        const name = (provider as { provider?: string }).provider ?? provider.mode;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${name}: ${msg}`);
        // Keep walking the chain.
      }
    }
    // Every provider failed (or didn't support this tool). Emit an empty
    // schema-valid payload tagged `unavailable` so the analyst gets honest
    // signal — no stale fixture data masquerading as live.
    if (errors.length > 0 && process.env.NODE_ENV !== "test") {
      console.warn(`[trading-desk] ${tool} unavailable: ${errors.join("; ")}`);
    }
    return emptyPayload(tool, input);
  }

  get_balance_sheet(input: ToolInput<"get_balance_sheet">) {
    return this.#tryChain("get_balance_sheet", input, (s, i) => s.get_balance_sheet(i));
  }
  get_income_statement(input: ToolInput<"get_income_statement">) {
    return this.#tryChain("get_income_statement", input, (s, i) => s.get_income_statement(i));
  }
  get_cashflow(input: ToolInput<"get_cashflow">) {
    return this.#tryChain("get_cashflow", input, (s, i) => s.get_cashflow(i));
  }
  get_fundamentals(input: ToolInput<"get_fundamentals">) {
    return this.#tryChain("get_fundamentals", input, (s, i) => s.get_fundamentals(i));
  }
  get_price_history(input: ToolInput<"get_price_history">) {
    return this.#tryChain("get_price_history", input, (s, i) => s.get_price_history(i));
  }
  compute_indicators(input: ToolInput<"compute_indicators">) {
    return this.#tryChain("compute_indicators", input, (s, i) => s.compute_indicators(i));
  }
  search_news(input: ToolInput<"search_news">) {
    return this.#tryChain("search_news", input, (s, i) => s.search_news(i));
  }
  get_macro_indicators(input: ToolInput<"get_macro_indicators">) {
    return this.#tryChain("get_macro_indicators", input, (s, i) => s.get_macro_indicators(i));
  }
  get_social_sentiment(input: ToolInput<"get_social_sentiment">) {
    return this.#tryChain("get_social_sentiment", input, (s, i) => s.get_social_sentiment(i));
  }
  get_reddit_mentions(input: ToolInput<"get_reddit_mentions">) {
    return this.#tryChain("get_reddit_mentions", input, (s, i) => s.get_reddit_mentions(i));
  }
  get_prediction_markets(input: ToolInput<"get_prediction_markets">) {
    return this.#tryChain("get_prediction_markets", input, (s, i) => s.get_prediction_markets(i));
  }
}
