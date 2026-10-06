#!/usr/bin/env node
/**
 * `shift-manager` — open a Lab in Shift Manager.
 *
 *     shift-manager [--config <path>] [--port <n>] [--host <host>] [--shift <day|evening|night>]
 *                   [--dev] [--assets <dir>] [--no-open]
 *
 * A thin wrapper over `fsdev dev`'s app hook (`executeDevCommand`) with this
 * package as the app: one port serves the Lab's API under `/api/flows` and
 * Shift Manager's pages, and the DevTool runs over the same Lab on a port of
 * its own, its address handed to the page as the `fsdev-devtool-url` meta.
 * Everything about serving, the network-bind guards and `--dev`'s restarts is
 * fsdev's. What is Shift Manager's own: the default port, and the shift
 * profile, whose shift goes to the page as the `shift-manager-color-scheme`
 * meta. `--assets <dir>` is fsdev's `--app <dir>` under the name this command
 * has always had: it serves another build of the pages (the tests' stand-in
 * build, or a person's own) in place of the package's.
 *
 * `scripts/checkout.mts` (the repository's `start` and `dev`) reads `--dev`,
 * `--assets` and `--config` from the same arguments before it hands them here,
 * so a change to how one of those is spelled is a change to both.
 *
 * Paths resolve from the directory the command was typed in (`INIT_CWD`,
 * which npm and pnpm set for a script, else the working directory), and the
 * process runs there, so a Lab's relative paths land where they would under
 * `fsdev dev`.
 *
 * Without `--config`, the config is looked for in that directory as
 * `fsdev dev` looks for it; none there stops the command, naming `--config`.
 * Bad input stops it with exit code 3 before anything listens.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EXIT_CONFIG_ERROR, EXIT_INTERNAL_ERROR, executeDevCommand, locateConfig } from "@flow-state-dev/fsdev";

/** The shift profiles `--shift` picks from, one `<name>.json` each. */
const PROFILES = fileURLToPath(new URL("../profiles", import.meta.url));

/** This package's module, `index.ts` beside this file in a checkout and `index.js` in an install: the app `fsdev dev` serves. */
const APP = fileURLToPath(new URL(`./index${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

/** The environment variable `--shift` falls back to. */
const SHIFT_ENV = "SHIFT_MANAGER_SHIFT";

/** The meta tag the page reads a forced shift from (`readServedShift`). */
const SCHEME_META = "shift-manager-color-scheme";

/** A refusal: the message, and the exit code it stops the command with. */
class Refusal extends Error {
  constructor(
    message: string,
    readonly exitCode = EXIT_CONFIG_ERROR,
  ) {
    super(message);
  }
}

/**
 * The shift the shift profile `--shift` (or `SHIFT_MANAGER_SHIFT`) names, or
 * `undefined` when neither is set.
 *
 * @throws Refusal for a name with no profile, listing the known ones.
 */
function shiftName(flag: string | undefined): "day" | "evening" | "night" | undefined {
  const name = flag ?? (process.env[SHIFT_ENV]?.trim() || undefined);
  if (name === undefined) return undefined;
  const known = readdirSync(PROFILES).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)).sort();
  if (!known.includes(name)) throw new Refusal(`No shift "${name}". Known shifts: ${known.join(", ")}.`);
  const shift = (JSON.parse(readFileSync(join(PROFILES, `${name}.json`), "utf8")) as { shift?: unknown }).shift;
  if (shift !== "day" && shift !== "evening" && shift !== "night") throw new Refusal(`Shift profile ${name}.json has no shift of "day", "evening" or "night".`);
  return shift;
}

async function main(): Promise<void> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        config: { type: "string" },
        port: { type: "string", default: "4300" },
        host: { type: "string" },
        shift: { type: "string" },
        assets: { type: "string" },
        dev: { type: "boolean" },
        "no-open": { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Refusal(error instanceof Error ? error.message : String(error));
  }

  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const shift = shiftName(values.shift);
  // Found as `fsdev dev` finds it; with none, fsdev would fall back to flow discovery.
  const config = values.config ?? locateConfig({ cwd: invokedFrom });
  if (config === undefined) {
    throw new Refusal(`No fsdev config in ${invokedFrom}. Pass --config <path to the Lab's fsdev config>.`);
  }

  // Process-global: a Lab's relative paths resolve from where the command was typed.
  process.chdir(invokedFrom);
  await executeDevCommand({
    cwd: invokedFrom,
    config,
    port: values.port,
    host: values.host,
    watch: values.dev === true,
    open: values["no-open"] !== true,
    app: values.assets === undefined ? APP : resolve(invokedFrom, values.assets),
    pageMeta: shift === undefined ? undefined : { [SCHEME_META]: shift },
  });
}

main().catch((error: unknown) => {
  const code = (error as { exitCode?: unknown }).exitCode;
  if (typeof code === "number") {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(code);
  }
  process.stderr.write(`Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(EXIT_INTERNAL_ERROR);
});
