/**
 * Trading-desk prompt-file loader.
 *
 * Wraps `@flow-state-dev/core/prompt-file/node`'s `createPromptLoader` so phase
 * prompts authored as `.md` files load consistently across the trading-desk
 * runtimes. The loader is anchored at `process.cwd()` (the trading-desk package
 * dir under Next.js dev/build and vitest alike) rather than `import.meta.url`,
 * which bundling makes unreliable here — see `lib/fixtures.ts` for the same
 * anchoring decision.
 *
 * All phase prompts share one partials directory (`prompts/_partials`), so the
 * output-schema preamble that was previously copy-pasted across every phase's
 * `prompts.ts` now lives once as `shared-output-preamble.md` and is pulled in
 * with `{% render 'shared-output-preamble' %}`.
 */
import path from "node:path";
import {
  createPromptLoader,
  type LoadPromptFileOptions,
} from "@flow-state-dev/core/prompt-file/node";
import type { PromptFile } from "@flow-state-dev/core/prompt-file";

const FLOW_ROOT = path.resolve(process.cwd(), "src/flows/trading-desk");
const PARTIALS_DIR = path.join(FLOW_ROOT, "prompts", "_partials");

const load = createPromptLoader(FLOW_ROOT, { partialsDir: PARTIALS_DIR });

/**
 * Load a trading-desk `.md` prompt. `relPath` is relative to the
 * `src/flows/trading-desk` directory (e.g. `"phase-5/prompts/portfolio-manager.prompt.md"`).
 * The shared `prompts/_partials` directory backs every `{% render %}`.
 */
export function loadDeskPrompt(
  relPath: string,
  options?: Pick<LoadPromptFileOptions, "filters">
): PromptFile {
  return load(relPath, options?.filters !== undefined ? { filters: options.filters } : undefined);
}
