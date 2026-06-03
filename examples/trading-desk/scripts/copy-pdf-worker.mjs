/**
 * Copy the installed pdfjs worker into ./public so it is served at a stable
 * static URL (`/pdf.worker.min.mjs`).
 *
 * Why: pdfjs needs its web worker, and pointing `GlobalWorkerOptions.workerSrc`
 * at `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` is
 * resolved UNRELIABLY by turbopack (Next 16's default dev bundler) — the worker
 * intermittently fails to load, leaving the PDF import dialog hung on
 * "extracting" with no server request. A file in ./public is served by Next at a
 * fixed path with no bundler indirection. Copying from the INSTALLED package
 * guarantees the worker version matches the imported pdfjs API version (a skew
 * throws at runtime). Run from `dev`/`build` so it stays in sync across
 * reinstalls and version bumps.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Resolve via package.json (always allowed by the exports map), then join the
// build path — `require.resolve` on the worker subpath can be blocked by exports.
const pkgJson = require.resolve("pdfjs-dist/package.json");
const workerSrc = join(dirname(pkgJson), "build", "pdf.worker.min.mjs");

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "..", "public", "pdf.worker.min.mjs");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(workerSrc, dest);
console.log(`[copy-pdf-worker] ${workerSrc} -> ${dest}`);
