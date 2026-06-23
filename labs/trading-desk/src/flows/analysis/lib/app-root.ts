/**
 * Trading-desk package root, resolved once at module load.
 *
 * Both filesystem anchors in this app (the prompt loader's flow root and the
 * fixture root) hang off this directory, so the resolution decision lives in
 * exactly one place. Candidates, in order:
 *
 * 1. Module-relative — real `import.meta.url` under vitest, tsx, and
 *    `fsdev run`, from any working directory.
 * 2. `process.cwd()` — the fallback for Next.js dev/build, where Turbopack
 *    rewrites `import.meta.url` to a virtual path but pins cwd to the app
 *    package directory.
 *
 * The `expect` probe rejects bundler-rewritten URLs whose relative walk lands
 * on a real-but-wrong directory (e.g. inside `.next/`). If neither candidate
 * qualifies, `resolveBaseDir` throws at import time listing what it tried —
 * a flow that cannot locate its files must fail loudly at import, never
 * mid-run on a fabricated path.
 *
 * Placement: `lib/` is documented as IO-free utilities, but `lib/prompt.ts`
 * already reads the filesystem at import time, and this file sits next to its
 * consumers (`lib/prompt.ts`, `tools/runtime/fixtures.ts` — `tools/ → lib/`
 * imports have precedent in the catalog).
 */
import { moduleDir, resolveBaseDir } from "@flow-state-dev/core/prompt-file/node";

/** Absolute path of the `labs/trading-desk` package directory. */
export const APP_ROOT = resolveBaseDir(
  [moduleDir(import.meta.url, "../../../.."), process.cwd()],
  { expect: "src/flows/analysis" },
);
