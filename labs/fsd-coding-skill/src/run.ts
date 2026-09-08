/**
 * Skill entry: boot the host and run one declared door.
 *
 *   pnpm --filter @flow-state-dev/fsd-coding-skill implement -- --task "..."
 *   pnpm --filter @flow-state-dev/fsd-coding-skill fix-fsd -- --repro "..."
 */
import type { HarnessRunHandle } from "@flow-state-dev/core/types";
import { parseArgs, runCli, CliUsageError } from "./cli";

const parsed = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
})();

const hint = "Call fix-fsd with the same --harness and this repro before retrying once.";
try {
  const { result, door } = await runCli(parsed);
  // These four doors return the selected adapter's handle, including vendor extras.
  const output = result.output as (HarnessRunHandle & { failureMessage?: string | null }) | undefined;
  const ok = result.error === undefined && output?.status === "completed" && output.outcome === "finished";
  console.log(JSON.stringify({
    ok,
    door,
    output,
    ...(!ok ? {
      error: result.error?.message ?? output?.failureMessage ?? "Harness did not finish successfully.",
      ...(result.error === undefined ? {} : { details: result.error }),
      hint,
    } : {}),
  }, null, 2));
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    door: parsed.door,
    error: error instanceof Error ? error.message : String(error),
    details: error,
    hint,
  }, null, 2));
  process.exitCode = 1;
}
