/**
 * Trading-desk prompt-file loader.
 *
 * Builds the desk's prompt loader with `@flow-state-dev/core/prompt-file/node`'s
 * `createPromptLoader` so phase prompts authored as `.md` files load consistently
 * across the trading-desk runtimes.
 *
 * Resolution rule: `loadPrompt` paths are relative to the flow root
 * (`src/flows/analysis`), which is anchored at the package directory resolved
 * in `lib/app-root.ts` — module-relative first, `process.cwd()` fallback for
 * bundled Next.js runtimes. Resolution therefore never depends on the
 * invoker's working directory: importing this flow from the repo root
 * (`fsdev run`), a test runner, or a consumer-repo script all resolve the
 * same files as `next dev` does.
 *
 * All phase prompts share one partials directory (`prompts/_partials`), so the
 * output-schema preamble that was previously copy-pasted across every phase's
 * `prompts.ts` now lives once as `shared-output-preamble.md` and is pulled in
 * with `{% render 'shared-output-preamble' %}`.
 */
import path from "node:path";
import { createPromptLoader } from "@flow-state-dev/core/prompt-file/node";
import { APP_ROOT } from "./app-root";

const FLOW_ROOT = path.join(APP_ROOT, "src/flows/analysis");
const PARTIALS_DIR = path.join(FLOW_ROOT, "prompts", "_partials");

/**
 * Load a trading-desk `.md` prompt. The argument is relative to the
 * `src/flows/analysis` directory (e.g. `"phase-5/prompts/portfolio-manager.prompt.md"`);
 * the shared `prompts/_partials` directory backs every `{% render %}`. Pass
 * `{ filters }` as a second argument for per-prompt Liquid filters.
 */
export const loadPrompt = createPromptLoader(FLOW_ROOT, { partialsDir: PARTIALS_DIR });
