/**
 * Agent definitions for kitchen-sink — wired into the skills capability
 * so pattern skills can reference agents via `agent-ref`.
 */
import {
  defineAgent,
  createAgentRegistry,
  materializeAgent,
} from "@flow-state-dev/workforce";

const techBriefAgent = defineAgent({
  name: "tech-briefer",
  description: "Produces concise technology briefings from web research.",
  persona:
    "You are a senior technology analyst at a research firm. " +
    "Write concise, opinionated briefings. Lead with the takeaway, " +
    "then supporting evidence, then risks. Cite every claim. " +
    "If sources conflict, show the conflict rather than picking a side.",
  allowedTools: ["search", "fetch"],
});

export const agentRegistry = createAgentRegistry([techBriefAgent]);
export { materializeAgent };
