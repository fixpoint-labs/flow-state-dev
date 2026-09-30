/**
 * Model-free check that `runFsdev` delivers a goal's `input` to the child
 * `fsdev run` byte-for-byte — `pnpm check:run-fsdev-input`.
 *
 * `runFsdev` spawns `pnpm fsdev ...`, and pnpm re-quotes the extra args into a
 * shell command line for the app's `fsdev` script. Inline `-i '<json>'` did not
 * survive that relay on every pnpm version: the repo's pinned pnpm doubled each
 * backslash, and `JSON.stringify` writes one for every `"`, `\` and newline in a
 * string. A quote then failed with `Invalid JSON in --input flag`; a newline
 * arrived as a literal `\n`. Apostrophes were reported failing the same way.
 *
 * This drives the real `runFsdev` through the real pnpm relay against a stub
 * app whose `fsdev` script parses the input exactly as the CLI does (inline
 * `--input` or `--input-file`) and writes back what it received. Each case must
 * round-trip unchanged. No flow, no model, no API key.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFsdev } from "../lib/capture.mts";

/** Inputs a real fixture plausibly contains, each hostile to some shell quoting. */
const CASES: Record<string, unknown> = {
  apostrophe: { message: "don't stop" },
  "double quote": { message: 'say "hi"' },
  backslash: { message: "C:\\path\\to" },
  newline: { message: "line one\nline two" },
  "shell expansion": { message: "costs $HOME and `echo hi` and !x" },
  unicode: { message: "naïve café — ok" },
  nested: { message: "it's", meta: { tags: ["a'b", 'c"d'], n: 3, ok: true } },
};

/**
 * The stub `fsdev`: mirrors `packages/cli/src/parse-input.ts`'s two input
 * paths, then records the parsed value (or the parse failure) to `$OUT`.
 */
const STUB = `
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const at = (flag) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
const inline = at("-i") ?? at("--input");
const file = at("-f") ?? at("--input-file");
let result;
try {
  const raw = inline ?? (file !== undefined ? readFileSync(file, "utf8") : undefined);
  result = { ok: true, value: raw === undefined ? null : JSON.parse(raw) };
} catch (err) {
  result = { ok: false, error: String(err) };
}
writeFileSync(process.env.OUT, JSON.stringify(result));
`;

const app = mkdtempSync(join(tmpdir(), "run-fsdev-input-"));
const out = join(app, "received.json");
writeFileSync(
  join(app, "package.json"),
  JSON.stringify({ name: "run-fsdev-input-stub", private: true, scripts: { fsdev: "node stub.mjs" } }),
);
writeFileSync(join(app, "stub.mjs"), STUB);

const failures: string[] = [];
try {
  for (const [name, input] of Object.entries(CASES)) {
    rmSync(out, { force: true });
    const exit = runFsdev({ app, flow: "stub", action: "run", input, silent: true, env: { OUT: out } });
    let received: { ok: boolean; value?: unknown; error?: string };
    try {
      received = JSON.parse(readFileSync(out, "utf8"));
    } catch {
      received = { ok: false, error: "the stub never ran" };
    }
    const intact = exit === 0 && received.ok && JSON.stringify(received.value) === JSON.stringify(input);
    console.log(`${intact ? "ok  " : "FAIL"} ${name}`);
    if (!intact) {
      failures.push(
        `${name}: sent ${JSON.stringify(input)}, child ${received.ok ? `received ${JSON.stringify(received.value)}` : `failed to parse: ${received.error}`} (exit ${exit})`,
      );
    }
  }
} finally {
  rmSync(app, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nrunFsdev did not deliver its input intact:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nrunFsdev delivered all ${Object.keys(CASES).length} inputs intact.`);
