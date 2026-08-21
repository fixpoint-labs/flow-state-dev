/**
 * Two env-file parsers, because there are two loaders and they do not agree on what a file says.
 *
 * A single parser was the structural defect behind three separate findings. The module claimed to
 * model two runtimes with opposite tie-breaks, and then parsed both of them with one function
 * that mirrored neither faithfully. `parseAsCli` is now an **asserted twin** of
 * `packages/cli/src/load-env.ts` (see `test/twins.test.mjs`), and `parseAsNextDev` mirrors the
 * dotenv grammar `@next/env` actually ships.
 *
 * Where they differ, measured against `@next+env@16.1.6`'s bundled dotenv:
 *
 * | input                    | our CLI                          | `next dev`               |
 * |--------------------------|----------------------------------|--------------------------|
 * | `export KEY=v`           | key is `export KEY` — KEY unset  | `KEY=v` — export stripped |
 * | `KEY: v`                 | no `=`, line skipped             | `KEY=v` — `:` separator   |
 * | `` KEY=`v` ``            | value is `` `v` `` with backticks | `KEY=v` — backticks stripped |
 * | `KEY=v # note`           | value is `v # note`              | `KEY=v` — trailing comment stripped |
 * | `KEY=$OTHER`             | the literal `$OTHER`             | **expanded**             |
 *
 * The first four are ordinary divergences and the report already models divergence. The fifth is
 * different in kind, and is handled below.
 */

/**
 * Parse the way `packages/cli/src/load-env.ts` does. **Twin — keep in step, and the test asserts
 * it.** Last assignment within a file wins, which is `Map.set` overwriting.
 */
export function parseAsCli(content) {
  const vars = new Map();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) vars.set(key, value);
  }
  return vars;
}

/**
 * dotenv's own key/value grammar, as bundled in `@next/env`. Copied from the shipped regex rather
 * than re-derived: `export ` is optional, `:` is an alternative separator, all three quote styles
 * are stripped, and an unquoted value ends at a `#`.
 */
const DOTENV_LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

/**
 * Unescaped `$` — dotenv expands `$VAR`, `${VAR}` and `${VAR:-default}`, and treats `\$` as a
 * literal. Anything matching this is a value whose meaning depends on an expansion we do not run.
 */
const EXPANSION = /(?<!\\)\$\{?[\w]+/;

/**
 * Parse the way `next dev` does, and **refuse rather than guess on expansion**.
 *
 * `@next/env`'s `processEnv` runs every parsed file through `expand()`, which resolves `$VAR`
 * against `process.env` first, then a `:-` default, then other keys in the same file, and falls
 * back to the empty string. Reproducing that faithfully means reproducing its precedence, its
 * escape handling and its last-match-first recursion — and getting any of it subtly wrong is
 * exactly the class of defect this file exists to stop.
 *
 * So a value carrying expansion syntax is reported `unreadable`, not `non-empty`. That matters
 * concretely: `FSD_DEMO_TOKEN=$DOES_NOT_EXIST` expands to the empty string, so calling it
 * non-empty would leave the demo flow rejecting every request while the report said the
 * credential was configured. Same posture as a `basePath` we cannot read statically — refuse and
 * say why.
 *
 * @returns a Map of key → `{ value, expands }`
 */
export function parseAsNextDev(content) {
  const vars = new Map();
  const normalized = content.replace(/\r\n?/gm, "\n");
  for (const match of normalized.matchAll(DOTENV_LINE)) {
    const key = match[1];
    let value = (match[2] ?? "").trim();
    const quote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
    if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    // Single quotes suppress expansion in dotenv's grammar; every other form is expanded.
    vars.set(key, { value, expands: quote !== "'" && EXPANSION.test(value) });
  }
  return vars;
}
