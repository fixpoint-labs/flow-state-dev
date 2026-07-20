// The research-team flow — one flow, three actions, one per path the guide
// walks. Register it with fsdev (see ../fsdev.config.ts) and each action is a
// `fsdev run research-team <action>` away.
//
//   research             → the static code-first board (deterministic, no model)
//   researchCompetitors  → runtime fan-out via a router (deterministic, no model)
//   chat                 → dispatch the pattern skills through an agent (needs a model)
//
// The first two run with no API key — their workers are plain handlers — so
// they're the ones the tests exercise end-to-end. `chat` carries the skills
// capability so a model can call `runSkill`; it needs OPENAI_API_KEY.
import { defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";
import { researchBoard } from "./board";
import { researchRouter } from "./research-router";
import { skillsCapability } from "./skills";

// A small coordinator agent. It doesn't research anything itself — it dispatches
// the matching pattern skill and surfaces the team's result.
const researchChat = generator({
  name: "research-chat",
  // Resolves through the `chat` intent declared in ../fsdev.config.ts
  // (falls back to openai/gpt-5.4-mini).
  model: "intent/chat",
  inputSchema: z.object({ message: z.string().min(1) }),
  history: true,
  uses: [skillsCapability],
  prompt:
    "You coordinate a small research team. When the user asks to research a " +
    "company, call runSkill({ name: 'research-company', input }). When they " +
    "ask who competes with something or want a comparison, call " +
    "runSkill({ name: 'competitor-analysis', input }). Pass the target as " +
    "`input`. Don't research it yourself — surface the skill's result as-is.",
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
});

export const researchTeamFlow = defineFlow({
  kind: "research-team",
  requireUser: true,
  actions: {
    // Code-first path: mount the static board's block directly. Its tasks are
    // fixed at definition time, so it takes no input.
    research: { block: researchBoard.block },

    // Runtime fan-out: the router reads { subject, competitors } and builds a
    // board with one analyzer per competitor plus a gated synthesizer.
    researchCompetitors: { block: researchRouter },

    // Skill path: a coordinator agent that dispatches the SKILL.md teams via
    // runSkill. Needs a model (OPENAI_API_KEY).
    chat: { block: researchChat, userMessage: (input) => input.message },
  },
  session: { stateSchema: z.object({}) },
});

export default researchTeamFlow({ id: "default" });
