/**
 * The checkout's `start` and `dev` scripts: the `shift-manager` command over
 * this repository's DevTeam profile (`teams/devteam/fsdev.config.mts`) unless
 * `--config` names another Lab, the `fsd` profile
 * (`teams/devteam/fsd.fsdev.config.mts`) among them.
 *
 *     pnpm --filter @flow-state-dev/shift-manager start   # the built pages, rebuilt first when stale
 *     pnpm --filter @flow-state-dev/shift-manager dev     # --dev: pages from source through Vite
 *     pnpm shift-manager:dev --config packages/shift-manager/teams/devteam/fsd.fsdev.config.mts   # the fsd profile, from the repository root
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
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { staleBuildInputs } from "../../../scripts/build-inputs.mjs";
import { EXIT_CONFIG_ERROR } from "@flow-state-dev/fsdev";
import { startHarness, type HarnessChoice } from "../teams/devteam/harness.mts";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(PACKAGE, "../..");
const DEVTEAM = join(PACKAGE, "teams", "devteam", "fsdev.config.mts");
const FSD = join(PACKAGE, "teams", "devteam", "fsd.fsdev.config.mts");
/** Each of this repository's profiles, and the coder it starts with when `DEVFORCE_LAB_HARNESS` names none. */
const PROFILE_CODER = new Map<string, HarnessChoice>([
  [DEVTEAM, "stub"],
  [FSD, "claude-code"],
]);
/** Set by `fsdev dev --watch` (`dev-watch.ts`) on the child it re-runs this file as. */
const WATCH_CHILD_ENV = "FSDEV_DEV_WATCH_CHILD";
const PAGES = join(PACKAGE, "dist-client");

const args = process.argv.slice(2);
const has = (flag: string) => args.some((a) => a === flag || a.startsWith(`${flag}=`));

/** The `--config` value given, in either form, or `undefined`. */
function configArg(): string | undefined {
  const at = args.findIndex((a) => a === "--config" || a.startsWith("--config="));
  if (at === -1) return undefined;
  return args[at]!.startsWith("--config=") ? args[at]!.slice("--config=".length) : args[at + 1];
}
const given = configArg();
// Resolved as the command resolves it: from where it was typed.
const config = given === undefined ? DEVTEAM : isAbsolute(given) ? given : resolve(process.env.INIT_CWD ?? process.cwd(), given);

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
// the Lab fails to load, so a profile's refusal of a missing Claude credential
// would never end the command. Asked here first, before the supervisor starts,
// with the coder the profile being opened would pick, the refusal exits. Only
// in the parent: the watched child's profile asks again when the Lab opens.
// Another Lab's config picks its own coder, so it isn't asked here.
const coder = PROFILE_CODER.get(config);
if (has("--dev") && process.env[WATCH_CHILD_ENV] === undefined && coder !== undefined) {
  try {
    await startHarness(coder, { log: () => {} });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(EXIT_CONFIG_ERROR);
  }
}

// `--dev` re-runs this file with the same arguments, so the config is pinned in them.
if (!has("--config")) process.argv.push("--config", DEVTEAM);
await import("../cli/bin.ts");
