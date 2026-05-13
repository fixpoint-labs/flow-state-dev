/**
 * Fixture loader. Reads `fixtures/{TICKER}/{YYYY-MM-DD}/{tool-name}.json` and
 * stamps `source: "fixture"`. Used only in fixture mode; live tools never
 * call this.
 *
 * Macro indicators are ticker-agnostic — they live under a `_macro` sentinel
 * ticker directory so the path layout stays uniform.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  FixtureMissingError,
  fixtureFileName,
  type ToolName,
  type ToolOutput,
} from "../phase-1/tools/schemas";

// Anchor at `process.cwd()`, which Next.js dev / Next.js build / vitest all
// set to the trading-desk package directory. `import.meta.url` is unreliable
// here because Turbopack rewrites it to a virtual path during bundling, so a
// relative walk via the file location lands inside `.next/`.
const FIXTURE_ROOT = path.resolve(process.cwd(), "fixtures");

export type LoadFixtureOptions = {
  /** Override the fixture root for tests. */
  rootDir?: string;
};

export async function loadFixture<T extends ToolName>(
  tool: T,
  args: { ticker?: string; date: string },
  options: LoadFixtureOptions = {},
): Promise<ToolOutput<T>> {
  const ticker = args.ticker ?? "_macro";
  const filePath = path.join(
    options.rootDir ?? FIXTURE_ROOT,
    ticker,
    args.date,
    fixtureFileName(tool),
  );
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FixtureMissingError(tool, ticker, args.date);
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return { ...parsed, source: "fixture" } as ToolOutput<T>;
}
