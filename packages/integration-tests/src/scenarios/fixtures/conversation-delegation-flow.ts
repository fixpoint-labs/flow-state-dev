/**
 * FIX-920 §7 fixture — a host generator bound to a skill that declares one
 * `context-supply: conversation` delegation agent (`historian`).
 *
 * Minimal on purpose: one skill, one agent, one scratch tool the agent can
 * call so its own intermediate tool-call item is distinguishable from the
 * final string it returns to the board (see the scenario test for why that
 * distinction matters — it is what makes output isolation checkable without
 * a real model).
 */
import { defineFlow, generator, handler } from "@flow-state-dev/core";
import type { InitialSkill } from "@flow-state-dev/core";
import { createSkillsLibrary } from "@flow-state-dev/orchestration";
import type { SkillsBindingConfig } from "@flow-state-dev/orchestration";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const scratchTool = handler({
  name: "scratch",
  description: "Jot a private scratch note (test-only tool).",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: true })
});

const teamSkill: InitialSkill = {
  name: "conversation-delegation-team",
  skillMd: [
    "---",
    "description: a small delegation team",
    "agents:",
    "  historian:",
    "    prompt: You answer using the conversation history you were given.",
    "    context-supply: conversation",
    "    tools: [scratch]",
    "---",
    "",
    "Delegate to the historian via addTask + runBoard."
  ].join("\n")
};

const skills = createSkillsLibrary({
  catalog: { scratch: scratchTool },
  initialSkills: [teamSkill],
  // Session scope keeps this fixture self-contained — no org identity/
  // persistence wiring needed for a request-scoped test flow.
  scope: "session"
});

// `createSkillsLibrary` returns the config-erased `DefinedCapability`, so
// `.with()` can't infer the binding-config shape at the call site — same
// pattern as the research-team example (see its `flow.ts`).
const skillsBinding = {
  active: ["conversation-delegation-team"]
} satisfies SkillsBindingConfig;

const host = generator({
  name: "host",
  model: "intent/chat",
  prompt: "You are the coordinator. Delegate work to your team when asked.",
  inputSchema,
  user: (input) => input.message,
  outputSchema: z.string(),
  itemVisibility: { client: true, history: true },
  history: true,
  uses: [skills.with(skillsBinding as never)],
  maxIterations: 8
});

const flow = defineFlow({
  kind: "test-conversation-delegation",
  requireUser: true,
  actions: {
    run: {
      inputSchema,
      block: host,
      userMessage: (input) => input.message
    }
  }
});

export default flow({ id: "default" });
