/**
 * `fsdev ui add <component>` command — installs components from the Flow State UI registry.
 */
import { spawnSync } from "node:child_process";
import type { Command } from "commander";
import { EXIT_INVALID_ARGS } from "../../exit-codes";

const DEFAULT_REGISTRY_BASE = "https://ui.flow-state.dev/api/registry";

export interface UIAddOptions {
  cwd?: string;
  registryBase?: string;
  dryRun?: boolean;
}

/**
 * Converts a component name into a remote registry item URL.
 */
export function toRegistryItemUrl(component: string, registryBase = DEFAULT_REGISTRY_BASE): string {
  return `${registryBase.replace(/\/$/, "")}/${component}.json`;
}

/**
 * Installs a component by shelling out to the shadcn CLI.
 */
export function runUIAdd(component: string, options: UIAddOptions = {}): number {
  if (component.trim().length === 0) {
    process.stderr.write("Component name is required.\n");
    return EXIT_INVALID_ARGS;
  }

  const url = toRegistryItemUrl(component, options.registryBase);
  const command = ["shadcn@latest", "add", url];

  if (options.dryRun) {
    process.stdout.write(`npx ${command.join(" ")}\n`);
    return 0;
  }

  const result = spawnSync("npx", command, {
    cwd: options.cwd,
    stdio: "inherit",
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  return 1;
}

/**
 * Registers `fsdev ui add` command tree.
 */
export function registerUIAddCommand(program: Command): void {
  const ui = program.command("ui").description("Flow State UI component registry commands");

  ui.command("add <component>")
    .description("Install a component from the Flow State UI shadcn registry")
    .option("--registry-base <url>", "Override registry base URL", DEFAULT_REGISTRY_BASE)
    .option("--dry-run", "Print the underlying shadcn command without running it", false)
    .action((component: string, opts: { registryBase?: string; dryRun?: boolean }) => {
      const exitCode = runUIAdd(component, {
        dryRun: opts.dryRun,
        registryBase: opts.registryBase,
      });

      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
