/**
 * The checkout's `start` and `dev` scripts: the `shift-manager` command over
 * this repository's `fsd` profile (`teams/devteam/fsd.fsdev.config.mts`) unless
 * `--config` names another Lab, DevTeam's (`teams/devteam/fsdev.config.mts`)
 * among them.
 *
 *     pnpm --filter @flow-state-dev/shift-manager start   # the built pages, rebuilt first when stale
 *     pnpm --filter @flow-state-dev/shift-manager dev     # --dev: pages from source through Vite
 *
 * Without `--dev` or `--assets`, the built pages are checked against the
 * source files they record (`scripts/build-inputs.mjs`) and rebuilt when any
 * changed: a page built before a change to its source reads keys the Lab no
 * longer publishes, and shows empty screens as if the Lab had no data. That
 * check reads repository paths, so it lives here, not in the command.
 *
 * Repository only: not in the published package.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { staleBuildInputs } from "../../../scripts/build-inputs.mjs";
import { EXIT_CONFIG_ERROR } from "@flow-state-dev/fsdev";
import { startHarness } from "../teams/devteam/harness.mts";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(PACKAGE, "../..");
const FSD = join(PACKAGE, "teams", "devteam", "fsd.fsdev.config.mts");
const PAGES = join(PACKAGE, "dist-client");

const args = process.argv.slice(2);
const has = (flag: string) => args.some((a) => a === flag || a.startsWith(`${flag}=`));

if (!has("--dev") && !has("--assets")) {
  const stale = existsSync(join(PAGES, "index.html")) ? staleBuildInputs(PAGES, REPO) : "they aren't built";
  if (stale !== undefined) {
    process.stderr.write(`Building Shift Manager's pages first: ${stale}.\n`);
    const build = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: PACKAGE, stdio: ["ignore", "inherit", "inherit"] });
    if (build.status !== 0) {
      process.stderr.write("Shift Manager's pages failed to build. Run: pnpm --filter @flow-state-dev/shift-manager build\n");
      process.exit(EXIT_CONFIG_ERROR);
    }
  }
}

// `--dev` serves the Lab under a supervisor that waits for a file change when
// the Lab fails to load, so the `fsd` profile's refusal of a missing Claude
// credential would never end the command. Asked here first, before the
// supervisor starts, the refusal exits. Only here: the re-run below carries
// `--config`, and the profile asks again when the Lab opens.
if (!has("--config") && has("--dev")) {
  try {
    await startHarness("claude-code", { log: () => {} });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(EXIT_CONFIG_ERROR);
  }
}

// `--dev` re-runs this file with the same arguments, so the config is pinned in them.
if (!has("--config")) process.argv.push("--config", FSD);
await import("../cli/bin.ts");
