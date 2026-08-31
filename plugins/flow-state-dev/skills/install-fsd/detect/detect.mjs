#!/usr/bin/env node
/**
 * `node detect.mjs [directory] [--json|--prose] [--provider <KEY>]`
 *
 * The entry point the install skill runs before it decides anything. It **writes nothing** — the
 * whole point of the artifact is that every refusal is decided from state the run has not
 * modified, and a detector that cannot write is a detector that cannot break that.
 *
 * Exit codes are the only thing here that is not a projection of the report:
 *   0  nothing refuses — the report is safe to act on
 *   1  at least one refusal fired; the report names each one and its remediation
 *   2  the script was called wrongly
 *
 * A refusal is a **1**, not a crash: the report is still the deliverable and the skill still reads
 * it, because a developer needs to be told which condition failed and what would fix it.
 */
import { resolve } from "node:path";
import { PROVIDER_KEYS } from "./constants.mjs";
import { buildReport } from "./report.mjs";
import { renderReport } from "./render.mjs";

/** Parse argv into the three things this script accepts, or an error message. */
export function parseArgs(argv) {
  const options = { dir: process.cwd(), format: "json", providerKey: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json" || arg === "--prose") options.format = arg.slice(2);
    else if (arg === "--provider") {
      const key = argv[++i];
      if (key === undefined || !PROVIDER_KEYS.includes(key)) {
        return { error: `--provider takes one of ${PROVIDER_KEYS.join(", ")}` };
      }
      options.providerKey = key;
    } else if (arg.startsWith("-")) return { error: `Unknown option ${arg}` };
    else rest.push(arg);
  }
  if (rest.length > 1) return { error: "Give at most one directory." };
  if (rest.length === 1) options.dir = resolve(rest[0]);
  return { options };
}

/** Run the script. Exported so the tests drive the real entry point rather than a copy of it. */
export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    err.write(`${parsed.error}\n`);
    return 2;
  }
  const { dir, format, providerKey } = parsed.options;
  const report = buildReport(dir, { providerKey });
  out.write(format === "prose" ? `${renderReport(report)}\n` : `${JSON.stringify(report, null, 2)}\n`);
  return report.refusals.length > 0 ? 1 : 0;
}

// `import.meta.filename` rather than argv[1]: the script may be invoked through a symlink in an
// installed plugin, where the two do not match.
if (process.argv[1] !== undefined && import.meta.filename.endsWith(process.argv[1].split("/").pop())) {
  process.exitCode = main();
}
