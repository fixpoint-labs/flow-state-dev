/**
 * Record-mode fixture recorder. Persists live tool payloads into the
 * date-addressed fixture corpus (`{rootDir}/{ticker|_macro}/{date}/
 * {fixtureFileName(tool)}`) so a record run grows the snapshot set that
 * fixture mode replays. The payload is zod-parsed through the tool's output
 * schema before writing, so the file holds exactly what the pipeline
 * consumed — unknown keys stripped, defaults applied — and schema drift
 * fails loudly at record time, not replay time.
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { z } from "zod";
import {
  fixtureFileName,
  toolOutputSchemas,
  type ToolName,
  type ToolOutput,
} from "../schemas";
import { assertFixtureDate, FIXTURE_ROOT } from "./fixtures";

/**
 * Serialize a payload deterministically: recursive key sort (arrays keep
 * order), 2-space indent, trailing newline. The recorder owns serialization
 * end to end — no formatter pass.
 */
export function stableSerialize(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

/** Recursively sort object keys; arrays preserve order, primitives pass
 *  through untouched. Pure structural normalization for `stableSerialize`. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
}

export interface RecordFixtureOptions {
  /** Override the fixture root for tests — same seam as `loadFixture`. */
  rootDir?: string;
}

/**
 * Persist a live tool payload into the fixture corpus layout:
 * `{rootDir}/{ticker ?? "_macro"}/{args.date}/{fixtureFileName(tool)}`.
 * Writes the zod-parsed payload (the tool's output schema `.parse`) so the
 * file holds exactly what the pipeline consumed. Throws if `args.date` is
 * not YYYY-MM-DD (before any filesystem access). Write failures propagate —
 * in record mode an unrecorded payload is a failed run, not a warning.
 *
 * Concurrent identical writes (parallel analysts sharing a tool after the
 * inflight-collapsed fetch) target the same path with identical bytes —
 * benign, last write wins with the same content. Plain write, no
 * temp-file/rename: fixtures are git-tracked dev artifacts; git is the
 * safety net.
 */
export async function recordFixture<T extends ToolName>(
  tool: T,
  args: { ticker?: string; date: string },
  payload: ToolOutput<T>,
  options: RecordFixtureOptions = {},
): Promise<void> {
  assertFixtureDate(args.date);
  const schema: z.ZodTypeAny = toolOutputSchemas[tool];
  const parsed: unknown = schema.parse(payload);
  const dir = path.join(
    options.rootDir ?? FIXTURE_ROOT,
    args.ticker ?? "_macro",
    args.date,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fixtureFileName(tool)), stableSerialize(parsed), "utf8");
}
