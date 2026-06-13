/**
 * Fixture loader. Reads `fixtures/{TICKER}/{DATE}/{tool-name}.json` for the
 * requested `args.date` and stamps `source: "fixture"` — except a file
 * recorded as `source: "unavailable"`, which replays as `"unavailable"` so
 * a recorded provider miss stays a miss. Used only in fixture mode; live
 * tools never call this.
 *
 * The corpus is date-addressed: each `{TICKER}/{DATE}/` directory is one
 * snapshot (the curated set lives at `FIXTURE_SNAPSHOT`; record mode adds
 * more). A date with no snapshot throws `FixtureMissingError` carrying the
 * requested date — never a silent fallback to another snapshot. Each fixture
 * JSON also carries its own `asOf` field reflecting the data's actual date.
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

/** The canonical default snapshot date — the curated, checked-in corpus. */
export const FIXTURE_SNAPSHOT = "2026-05-06";

export type LoadFixtureOptions = {
  /** Override the fixture root for tests. */
  rootDir?: string;
};

/**
 * Validate a fixture date before it is used as a path segment. The date is
 * user-controlled input, so anything other than strict `YYYY-MM-DD` (e.g. a
 * `../` traversal) throws here — before any filesystem access.
 */
export function assertFixtureDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(
      `Invalid fixture date "${date}" — expected YYYY-MM-DD.`,
    );
  }
}

/**
 * Load one tool's fixture payload for the requested `args.date` snapshot
 * (`{rootDir}/{ticker}/{date}/{tool-file}.json`; no `ticker` → `_macro`).
 * Validates the date before any filesystem access; a missing file throws
 * `FixtureMissingError` carrying the requested date. The payload replays
 * with `source: "fixture"`, except a recorded `"unavailable"` is preserved.
 */
export async function loadFixture<T extends ToolName>(
  tool: T,
  args: { ticker?: string; date: string },
  options: LoadFixtureOptions = {},
): Promise<ToolOutput<T>> {
  assertFixtureDate(args.date);
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
  // Preserve recorded unavailability: a file tagged `source: "unavailable"`
  // replays as such (analysts must treat it as missing signal, not as data);
  // any provider tag (`"yahoo"`, `"finnhub"`, ...) replays as `"fixture"`.
  const source = parsed.source === "unavailable" ? "unavailable" : "fixture";
  return { ...parsed, source } as ToolOutput<T>;
}
