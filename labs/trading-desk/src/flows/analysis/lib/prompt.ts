/**
 * Trading-desk prompt-file loader.
 *
 * Builds the desk's prompt loader with `@flow-state-dev/core/prompt-file/node`'s
 * `createPromptLoader` so phase prompts authored as `.md` files load consistently
 * across the trading-desk runtimes. The loader is anchored at `process.cwd()` (the trading-desk package
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
import { createPromptLoader } from "@flow-state-dev/core/prompt-file/node";

const FLOW_ROOT = path.resolve(process.cwd(), "src/flows/analysis");
const PARTIALS_DIR = path.join(FLOW_ROOT, "prompts", "_partials");

/**
 * Load a trading-desk `.md` prompt. The argument is relative to the
 * `src/flows/analysis` directory (e.g. `"phase-5/prompts/portfolio-manager.prompt.md"`);
 * the shared `prompts/_partials` directory backs every `{% render %}`. Pass
 * `{ filters }` as a second argument for per-prompt Liquid filters.
 */
export const loadPrompt = createPromptLoader(FLOW_ROOT, { partialsDir: PARTIALS_DIR });
