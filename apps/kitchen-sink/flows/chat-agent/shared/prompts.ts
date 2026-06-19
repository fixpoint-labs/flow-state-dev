/**
 * chat-agent prompt-file loader.
 *
 * Builds the flow's `.prompt.md` loader with
 * `@flow-state-dev/core/prompt-file/node`'s `createPromptLoader`, mirroring
 * `labs/trading-desk/src/flows/analysis/lib/prompt.ts`. Paths passed to
 * `loadPrompt` are relative to the chat-agent flow root (e.g.
 * `"run/assistant/prompts/ask.prompt.md"`).
 *
 * Resolution rule (the Next.js-safe part): the flow root is resolved
 * module-relative first, with a `process.cwd()`-derived fallback. Turbopack /
 * webpack rewrite `import.meta.url` to a virtual scheme in the browser build,
 * so a bare module walk breaks under `pnpm dev`; the `process.cwd()` candidate
 * carries that case (Next.js pins cwd to the app package). The `expect: "flow.ts"`
 * probe rejects a candidate that resolves into build output.
 */
import path from "node:path";
import {
  createPromptLoader,
  moduleDir,
  resolveBaseDir,
} from "@flow-state-dev/core/prompt-file/node";

const FLOW_ROOT = resolveBaseDir(
  [moduleDir(import.meta.url, ".."), path.resolve(process.cwd(), "flows/chat-agent")],
  { expect: "flow.ts" },
);

/**
 * Load a chat-agent `.prompt.md` file. The argument is relative to the
 * `flows/chat-agent` directory (e.g.
 * `"run/thinking-styles/prompts/supervisor-worker.prompt.md"`). Returns a
 * `PromptFile` whose `.prompt` slot renders the `<system>` body.
 */
export const loadPrompt = createPromptLoader(FLOW_ROOT);
