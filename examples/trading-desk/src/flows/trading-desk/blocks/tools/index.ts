/**
 * Aggregated tool exports for the analyst sub-agents.
 *
 * Each analyst's prompt declares which subset it can call; the generator
 * receives the matching list via the `tools` slot.
 */
export * from "./data-source";
export {
  get_balance_sheet,
  get_income_statement,
  get_cashflow,
  get_fundamentals,
} from "./fundamentals-tools";
export { get_price_history, compute_indicators } from "./prices-tools";
export { search_news, get_macro_indicators } from "./news-tools";
export { get_social_sentiment, get_reddit_mentions } from "./sentiment-tools";
