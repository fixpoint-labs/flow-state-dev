/**
 * Mode system-prompt resolution — the single source of truth for the four
 * mode prompts (ask / build / interview / debate).
 *
 * Before this consolidation the same mode→prose mapping was defined twice,
 * byte-identical: once as the assistant generator's `prompt` switch and once as
 * the thinking-style router's `instructions`. `resolveModePrompt` collapses
 * both into one resolver over four `.prompt.md` files, consumed by BOTH the
 * generator's `prompt` slot and the router's `instructions` slot — one source,
 * two consumers, guaranteed-identical text.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { loadPrompt } from "../../shared/prompts";
import type { Mode } from "../../shared/schemas";

// Loaded once at module init via the shared loader. `createPromptLoader` reads
// each file synchronously, so all four prompt files must exist alongside this
// module — a missing file throws `PromptFileLoadError` at import.
const MODE_FILES = {
  ask: loadPrompt("run/assistant/prompts/ask.prompt.md"),
  build: loadPrompt("run/assistant/prompts/build.prompt.md"),
  interview: loadPrompt("run/assistant/prompts/interview.prompt.md"),
  debate: loadPrompt("run/assistant/prompts/debate.prompt.md"),
} as const;

/**
 * Resolve the mode system prompt for the current turn. Used by BOTH the
 * assistant generator's `prompt` slot and the thinking-style router's
 * `instructions` slot. Renders the matching file's `<system>` body to a string;
 * unknown / absent modes fall back to `ask`.
 */
export const resolveModePrompt = (
  input: unknown,
  ctx: BlockContext,
): Promise<string> => {
  const mode = (ctx.session.state.mode as Mode) ?? "ask";
  const file = MODE_FILES[mode] ?? MODE_FILES.ask;
  return file.prompt(input, ctx);
};
