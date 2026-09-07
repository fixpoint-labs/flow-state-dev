/**
 * Skill entry: boot the host and run one declared door.
 *
 *   pnpm --filter @flow-state-dev/fsd-coding-skill implement -- --task "..."
 *   pnpm --filter @flow-state-dev/fsd-coding-skill fix-fsd -- --repro "..."
 */
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

const { result, door } = await runCli(parsed);

if (result.error !== undefined) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        door,
        error: result.error.message,
        hint: "Call the fixFsd door with this repro before retrying the original door.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      door,
      output: result.output,
    },
    null,
    2,
  ),
);
