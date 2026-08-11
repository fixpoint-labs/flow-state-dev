#!/usr/bin/env node
/**
 * No tracked source file carries a literal NUL byte.
 *
 * Git decides whether a blob is text or binary by sniffing its first 8000 bytes
 * for a NUL. One anywhere in that window and the file is `Bin` everywhere it
 * matters: `git diff` prints "Binary files differ" instead of the change, the
 * commit stat reads `0 insertions(+), 0 deletions(-)`, and the PR view offers no
 * diff at all. The code still compiles and the tests still pass, so nothing
 * announces it — the only symptom is that reviewers, human and bot alike, are
 * shown nothing to review.
 *
 * It has already cost us. `packages/contracts/src/items/predicates.ts` was
 * committed with a NUL-wrapped sentinel at byte 1083 and landed as
 * `Bin 0 -> 3770 bytes`: its entire contents went in unreviewed. A devtool file
 * hit the same wall later and took six review findings before the diff became
 * visible.
 *
 * The trap is that it is intermittent. A NUL past byte 8000 leaves the file
 * readable, so it looks fine — until an unrelated edit shortens the file and
 * pulls the byte inside the window, and the diff vanishes with nothing in the
 * change to explain why.
 *
 * The fix is always the same: write the escape (`\u0000`), never the raw byte.
 * The runtime string is identical; only the source encoding differs.
 *
 * No dependencies, so CI runs it without an install.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

/**
 * How many leading bytes git inspects before deciding text vs binary. Used only
 * to tell an already-broken file from a latent one in the report; both fail.
 */
const GIT_BINARY_SNIFF_BYTES = 8000;

/**
 * Extensions this guard checks — an allowlist of formats that are source text
 * by definition, deliberately not a denylist of binary ones.
 *
 * A denylist fails open: the next image, font, or archive format someone commits
 * fires a false alarm, and a guard that cries wolf on a real `.png` is a guard
 * people learn to skip. This list contains no binary format, so a legitimate
 * fixture (`apps/docs/static/img/logo.png` carries a NUL at byte 8, as every PNG
 * does) is never even opened.
 *
 * Adding a format here is a deliberate choice: only add one where a NUL is
 * always a mistake rather than sometimes the payload. The key is a *format*,
 * and a format goes in whether or not the repo happens to track one today —
 * `.jsx` and `.cjs` have never had a file. Listing a format's siblings up front
 * is what keeps the guard from silently going quiet the day someone adds the
 * first `.cts`.
 *
 * Deliberately absent, and why:
 *   - `.png` and any other binary format — the reason this is an allowlist.
 *   - `.ofx` / `.qfx` — third-party import fixtures, where a malformed byte is
 *     plausibly the thing under test rather than a mistake.
 *   - `.example` (`.env*.example`) — a naming convention, not a format.
 *   - `LICENSE` and the `.claude/*` symlinks — extensionless, so an
 *     extension-keyed allowlist cannot reach them at all.
 */
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".mdc",
  ".css",
  ".yml",
  ".yaml",
  ".html",
  ".svg",
  ".sql",
  ".sh",
  ".py"
]);

/** Every file git tracks, NUL-delimited so paths with spaces survive. */
function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { maxBuffer: 1e9 })
    .toString("utf8")
    .split("\u0000")
    .filter((line) => line.length > 0);
}

const offenders = [];

for (const file of trackedFiles()) {
  if (!SOURCE_EXTENSIONS.has(extname(file))) continue;

  let contents;
  try {
    // A gitlink (submodule) lists as a tracked path but stats as a directory.
    if (statSync(file).isDirectory()) continue;
    contents = readFileSync(file);
  } catch {
    // Listed but not present — a path staged for deletion, or a broken link.
    // Nothing to inspect, and this guard is not the place to complain about it.
    continue;
  }

  const at = contents.indexOf(0);
  if (at !== -1) offenders.push({ file, at, size: contents.length });
}

if (offenders.length === 0) {
  console.log("✓ no tracked source file contains a literal NUL byte");
  process.exit(0);
}

console.error(
  `\n✗ ${offenders.length} tracked source file(s) contain a literal NUL byte:\n`
);
for (const { file, at, size } of offenders) {
  const hidden = at < GIT_BINARY_SNIFF_BYTES;
  console.error(
    `    ${file}` +
      `\n      NUL at byte ${at} of ${size} — ` +
      (hidden
        ? `inside git's ${GIT_BINARY_SNIFF_BYTES}-byte window, so this file's diff is ALREADY hidden`
        : `past git's ${GIT_BINARY_SNIFF_BYTES}-byte window, so the diff still renders — for now`)
  );
}

console.error(
  `\n  Why this fails the build, when the code is valid and the tests pass:` +
    `\n` +
    `\n  Git sniffs a file's first ${GIT_BINARY_SNIFF_BYTES} bytes for a NUL and, finding one,` +
    `\n  treats the whole file as binary. Its diff stops rendering — "Binary files` +
    `\n  differ", a stat of "0 insertions(+), 0 deletions(-)", and no reviewable` +
    `\n  change in the PR. Nothing else breaks, which is the problem: the change` +
    `\n  ships without anyone having been shown it.` +
    `\n` +
    `\n  A NUL past the window is not safe either, only quiet. Any later edit that` +
    `\n  shortens the file drags it inside, and the diff disappears with nothing in` +
    `\n  that change to point at the cause.` +
    `\n` +
    `\n  Fix: write the escape sequence instead of the raw byte. The runtime value` +
    `\n  is identical — this is an encoding change to the source text, not to the` +
    `\n  string your code builds.` +
    `\n` +
    `\n      const SEP = "\\u0000";                  // not a literal NUL` +
    `\n      const key = \`\${a}\\u0000\${b}\`;          // not a literal NUL\n`
);
process.exit(1);
