/**
 * `FixtureDataSource` — reads `fixtures/{TICKER}/{YYYY-MM-DD}/{tool-name}.json`
 * and stamps `source: "fixture"` on the returned payload.
 *
 * Each fixture file is a JSON object that already conforms to the matching
 * tool output schema (minus the source tag, which we add). Missing fixtures
 * raise `FixtureMissingError` so the caller surfaces a structured tool
 * error instead of a parse blow-up.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  type DataSource,
  type ToolInput,
  type ToolOutput,
  type ToolName,
  FixtureMissingError,
  fixtureFileName,
} from "./data-source";

// `import.meta.url` resolves regardless of bundler — `dist/` builds and the
// Next.js server bundle both end up co-located with the fixtures via the
// relative path below.
const HERE = path.dirname(fileURLToPath(import.meta.url));
// blocks/tools/ is four levels deep relative to the example root.
const FIXTURE_ROOT = path.resolve(HERE, "../../../../../fixtures");

export type FixtureDataSourceOptions = {
  /** Override the fixture root for tests. */
  rootDir?: string;
};

export class FixtureDataSource implements DataSource {
  readonly mode = "fixture" as const;
  readonly #rootDir: string;

  constructor(options: FixtureDataSourceOptions = {}) {
    this.#rootDir = options.rootDir ?? FIXTURE_ROOT;
  }

  async #load<T extends ToolName>(
    tool: T,
    ticker: string,
    date: string,
  ): Promise<ToolOutput<T>> {
    const filePath = path.join(this.#rootDir, ticker, date, fixtureFileName(tool));
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new FixtureMissingError(tool, ticker, date);
      }
      throw err;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { ...parsed, source: "fixture" } as ToolOutput<T>;
  }

  async get_balance_sheet(input: ToolInput<"get_balance_sheet">) {
    return this.#load("get_balance_sheet", input.ticker, input.date);
  }
  async get_income_statement(input: ToolInput<"get_income_statement">) {
    return this.#load("get_income_statement", input.ticker, input.date);
  }
  async get_cashflow(input: ToolInput<"get_cashflow">) {
    return this.#load("get_cashflow", input.ticker, input.date);
  }
  async get_fundamentals(input: ToolInput<"get_fundamentals">) {
    return this.#load("get_fundamentals", input.ticker, input.date);
  }
  async get_price_history(input: ToolInput<"get_price_history">) {
    return this.#load("get_price_history", input.ticker, input.date);
  }
  async compute_indicators(input: ToolInput<"compute_indicators">) {
    return this.#load("compute_indicators", input.ticker, input.date);
  }
  async search_news(input: ToolInput<"search_news">) {
    return this.#load("search_news", input.ticker, input.date);
  }
  async get_macro_indicators(input: ToolInput<"get_macro_indicators">) {
    // Macro fixtures are date-keyed but ticker-agnostic — store under a
    // sentinel ticker dir so the path layout stays uniform.
    return this.#load("get_macro_indicators", "_macro", input.date);
  }
  async get_social_sentiment(input: ToolInput<"get_social_sentiment">) {
    return this.#load("get_social_sentiment", input.ticker, input.date);
  }
  async get_reddit_mentions(input: ToolInput<"get_reddit_mentions">) {
    return this.#load("get_reddit_mentions", input.ticker, input.date);
  }
}
