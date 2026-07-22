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
import type { SkillsBindingConfig } from "@flow-state-dev/orchestration";
import { z } from "zod";
import { researchBoard } from "./board";
import { researchRouter } from "./research-router";
import { skillsLibrary } from "./skills";

// `createSkillsLibrary` returns the config-erased `DefinedCapability`, so
// `.with()` can't infer the binding-config shape at the call site. Author the
// binding as a checked `SkillsBindingConfig` literal, then hand it to `.with()`
// (the cast only bridges the erased signature — the object is still validated
// against the type, and again by the binding schema at runtime).
const skillsBinding = {
  active: ["research-company", "competitor-analysis"],
} satisfies SkillsBindingConfig;

// A small coordinator agent. It doesn't research anything itself — it activates
// the matching skill, calls that skill's board-backed tool, and surfaces the
// team's result.
const researchChat = generator({
  name: "research-chat",
  // Resolves through the `chat` intent declared in ../fsdev.config.ts
  // (falls back to openai/gpt-5.4-mini).
  model: "intent/chat",
  inputSchema: z.object({ message: z.string().min(1) }),
  history: true,
  // Both skills are preloaded, so their bodies (and the board tools they list
  // under `allowed-tools`) are available from turn one.
  uses: [skillsLibrary.with(skillsBinding as never)],
  prompt:
    "You coordinate a small research team. When the user asks to research a " +
    "company, call researchCompany({ topic }). When they ask who competes with " +
    "something or want a comparison, name the competitors yourself and call " +
    "analyzeCompetitors({ topic, competitors }). Don't research it yourself — " +
    "surface the tool's result as-is.",
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
});

export const researchTeamFlow = defineFlow({
  kind: "research-team",
  requireUser: true,
  actions: {
    // Code-first path: mount the static board's block directly. Its tasks are
    // fixed at definition time, so it takes no input.
    research: { block: researchBoard.drain },

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
