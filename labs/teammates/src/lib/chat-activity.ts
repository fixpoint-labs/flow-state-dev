import type { ConversationEntry } from "../adapter";
import { TOOL_VERB_MAP } from "../components/flow-state/tool-grouping";
import { toolBaseName } from "../components/flow-state/tool-naming";

/** Current tool activity for the answering line; never copy a step's payload or intent. */
export function chatActivity(entries: readonly ConversationEntry[], running: boolean, stale: boolean): string | undefined {
  if (!running || stale) return undefined;
  // Only the tail can describe current work. Never revive a tool from an earlier turn.
  const last = entries[entries.length - 1];
  if (last?.kind !== "steps") return undefined;
  const step = [...last.steps].reverse().find((step) => step.kind === "tool" && (step.state === "running" || step.state === "waiting"));
  if (step === undefined) return undefined;
  const base = toolBaseName(step.tool ?? "");
  // Only registry names are safe to repeat. Unknown names may themselves contain payloads.
  const name = Object.keys(TOOL_VERB_MAP).find((name) => name.toLowerCase() === base.toLowerCase()) ?? "a tool";
  return step.state === "waiting" ? `Waiting on ${name}…` : `Using ${name}…`;
}
