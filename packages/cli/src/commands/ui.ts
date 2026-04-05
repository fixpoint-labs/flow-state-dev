/**
 * `fsdev ui` command — manage Flow State UI registry components.
 *
 * Delegates to the shadcn CLI for component installation, using the
 * Flow State UI registry as the source.
 */
import type { Command } from "commander";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { EXIT_SUCCESS, EXIT_EXECUTION_ERROR, EXIT_CONFIG_ERROR } from "../exit-codes";

const DEFAULT_REGISTRY_URL = "https://ui.flow-state.dev/r";

interface RegistryItem {
  name: string;
  title: string;
  description: string;
  categories: string[];
}

interface RegistryManifest {
  name: string;
  items: RegistryItem[];
}

/**
 * Try to load registry manifest from a local path or URL.
 * Returns null if unavailable (network or file not found).
 */
async function loadManifest(registryUrl: string): Promise<RegistryManifest | null> {
  // Local file path
  if (!registryUrl.startsWith("http")) {
    const indexPath = resolve(registryUrl, "index.json");
    if (existsSync(indexPath)) {
      return JSON.parse(readFileSync(indexPath, "utf-8"));
    }
    return null;
  }

  // Remote URL
  try {
    const response = await fetch(`${registryUrl}/index.json`);
    if (!response.ok) return null;
    return await response.json() as RegistryManifest;
  } catch {
    return null;
  }
}

export function registerUiCommand(program: Command) {
  const ui = program
    .command("ui")
    .description("Manage Flow State UI components");

  ui.command("add")
    .description("Add a component from the Flow State UI registry")
    .argument("<components...>", "Component names (e.g., message, conversation)")
    .option("--registry <url>", "Registry URL or local path", DEFAULT_REGISTRY_URL)
    .option("--cwd <dir>", "Working directory for installation", process.cwd())
    .action(async (components: string[], options: { registry: string; cwd: string }) => {
      for (const component of components) {
        const itemUrl = options.registry.startsWith("http")
          ? `${options.registry}/${component}.json`
          : resolve(options.registry, `${component}.json`);

        console.log(`Installing ${component}...`);

        const result = spawnSync("npx", ["shadcn@latest", "add", itemUrl], {
          stdio: "inherit",
          cwd: options.cwd,
          shell: true,
        });
        if ((result.status ?? 1) !== 0) {
          console.error(`Failed to install ${component}.`);
          process.exitCode = EXIT_EXECUTION_ERROR;
          return;
        }
      }

      process.exitCode = EXIT_SUCCESS;
    });

  ui.command("list")
    .description("List available components from the registry")
    .option("--registry <url>", "Registry URL or local path", DEFAULT_REGISTRY_URL)
    .option("--category <cat>", "Filter by category")
    .action(async (options: { registry: string; category?: string }) => {
      const manifest = await loadManifest(options.registry);

      if (!manifest) {
        console.error(
          "Could not load registry manifest.",
          options.registry.startsWith("http")
            ? "Check your network connection."
            : `File not found: ${resolve(options.registry, "index.json")}`
        );
        process.exitCode = EXIT_CONFIG_ERROR;
        return;
      }

      let items = manifest.items;
      if (options.category) {
        items = items.filter((item) =>
          item.categories.includes(options.category!)
        );
      }

      if (items.length === 0) {
        console.log("No components found.");
        process.exitCode = EXIT_SUCCESS;
        return;
      }

      console.log(`\n${manifest.name} — ${items.length} component(s)\n`);

      const maxNameLen = Math.max(...items.map((i) => i.name.length));
      for (const item of items) {
        const name = item.name.padEnd(maxNameLen + 2);
        console.log(`  ${name}${item.description}`);
      }
      console.log();

      process.exitCode = EXIT_SUCCESS;
    });
}
