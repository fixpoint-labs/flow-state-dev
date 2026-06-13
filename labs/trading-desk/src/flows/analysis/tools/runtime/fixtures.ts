/**
 * Fixture loader. Reads `fixtures/{TICKER}/{SNAPSHOT}/{tool-name}.json` and
 * stamps `source: "fixture"`. Used only in fixture mode; live tools never
 * call this.
 *
 * The requested `date` is ignored for path resolution — fixtures are a
 * single pinned snapshot, not a date-indexed series. Each fixture JSON
 * carries its own `asOf` field reflecting the data's actual date, which the
 * caller sees in the returned payload.
 *
 * Macro indicators are ticker-agnostic and live under a `_macro` sentinel
 * ticker directory so the path layout stays uniform.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { APP_ROOT } from "../../lib/app-root";
import {
  FixtureMissingError,
  fixtureFileName,
  type ToolName,
  type ToolOutput,
} from "../schemas";

// Anchored at the package root resolved in `lib/app-root.ts` (module-relative
// first, cwd fallback for Turbopack-bundled runtimes), so fixture loading
// works from any working directory — not just the app dir.
export const FIXTURE_ROOT = path.join(APP_ROOT, "fixtures");

export const FIXTURE_SNAPSHOT = "2026-05-06";

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
    FIXTURE_SNAPSHOT,
    fixtureFileName(tool),
  );
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FixtureMissingError(tool, ticker, FIXTURE_SNAPSHOT);
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return { ...parsed, source: "fixture" } as ToolOutput<T>;
}
