/**
 * `fsdev migrate` — run a one-time store repair against a deployment's own
 * configured stores.
 *
 * A migration that has an algorithm and no way to invoke it is a migration that
 * never runs, and the fail-closed reader it exists to unblock then refuses
 * forever. This is the invocation point: one subcommand per repair, named after
 * what it repairs, run by an operator against the app's committed
 * `fsdev.config.*` so it reaches the real stores rather than a scratch registry.
 *
 * It is deliberately not a startup hook. A sweep that fires on every cold start
 * scans the whole session store on a serverless platform for one deploy's worth
 * of benefit, and gives an operator no way to see what it did.
 *
 * Today there is exactly one repair. The command exists as a group rather than
 * a bare verb because the next one will want the same config loading, the same
 * exit codes and the same "say what changed" reporting, and a second top-level
 * command would grow a second copy of all three.
 */
import type { Command } from "commander";
import { backfillSessionKind } from "@flow-state-dev/engine";
import { resolveRuntimeSource } from "../resolve-runtime";
import { CliError } from "../resolve-block";
import { collectValues } from "../cli-options";
import { EXIT_CONFIG_ERROR, EXIT_EXECUTION_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";

interface MigrateCommandOptions {
  /** Explicit `--config <path>`. Migrations always require a committed config. */
  config?: string;
  /** Explicit `--dotenv <path>` entries, loaded before the cwd `.env.local` walk-up. */
  dotenv?: string[];
  /** Limit the sweep to one tenant. Omitted sweeps every tenant. */
  tenant?: string;
  /** Override the working directory (defaults to `process.cwd()`). For tests. */
  cwd?: string;
}

/** Registers the `migrate` subcommand group on the given commander program. */
export function registerMigrateCommand(program: Command): void {
  const migrate = program
    .command("migrate")
    .description("Run a one-time store repair against this app's configured stores");

  migrate
    .command("session-kind")
    .description(
      "Classify session records written before session kinds existed, so they can send and receive messages"
    )
    .option("--config <path>", "Path to an fsdev config file (default: fsdev.config.{ts,mts,js,mjs} in cwd)")
    .option("--dotenv <path>", "Load a specific .env file (repeatable, resolved from cwd)", collectValues, undefined)
    .option("--tenant <id>", "Limit the sweep to one tenant (default: every tenant)")
    .action(async (options: MigrateCommandOptions) => {
      try {
        await executeMigrateSessionKindCommand(options);
      } catch (err) {
        if (err instanceof CliError) {
          process.stderr.write(err.message + "\n");
          process.exitCode = err.exitCode;
          return;
        }
        process.stderr.write(
          `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
        );
        process.exitCode = EXIT_INTERNAL_ERROR;
      }
    });
}

/** Core execution logic for `fsdev migrate session-kind`, separated for testability. */
export async function executeMigrateSessionKindCommand(
  options: MigrateCommandOptions
): Promise<void> {
  const resolved = await resolveRuntimeSource({
    cwd: options.cwd,
    config: options.config ?? true,
    dotenv: options.dotenv,
    requireConfig: true
  });
  if (resolved.source !== "config") {
    // Unreachable: `requireConfig` makes a non-config resolution throw. Narrows
    // the union, and fails loudly if that invariant ever changes.
    throw new CliError("fsdev migrate requires a committed fsdev config.", EXIT_CONFIG_ERROR);
  }

  try {
    const { stores } = await resolved.flowState.getRuntime();
    const result = await backfillSessionKind(stores, {
      ...(options.tenant !== undefined ? { tenantId: options.tenant } : {})
    });

    process.stdout.write(
      `Examined ${result.examined} session(s): ` +
        `${result.stamped} classified, ${result.alreadyStamped} already classified.\n`
    );

    // A row that lost every CAS is still refused by the relay door, so this is
    // a non-zero exit rather than a line in a summary someone skims. Re-running
    // is the remedy and the message says so — the sweep is idempotent, and a row
    // that lost to a live writer usually wins on the next pass.
    if (result.unrepaired.length > 0) {
      process.stderr.write(
        `${result.unrepaired.length} session(s) could not be classified because ` +
          `another writer held them throughout. Run this command again.\n` +
          result.unrepaired.map((id) => `  ${id}\n`).join("")
      );
      throw new CliError(
        `${result.unrepaired.length} session(s) were left unclassified.`,
        EXIT_EXECUTION_ERROR
      );
    }
  } finally {
    // The command owns the FlowState for its whole life — nothing takes it over
    // the way `serve` hands it to a server handle — so it disposes it on every
    // exit, including the unrepaired-rows failure above.
    await resolved.flowState.dispose().catch(() => {});
  }
}
