// The research-team flow — one flow, three actions, one per path the guide
// walks. Register it with fsdev (see ../fsdev.config.ts) and each action is a
// `fsdev run research-team <action>` away.
//
//   research             → the static code-first board (deterministic, no model)
//   researchCompetitors  → runtime fan-out via a router (deterministic, no model)
//   chat                 → the delegation skills through a coordinator agent (needs a model)
//
// The first two run with no API key — their workers are plain handlers — so
// they're the ones the tests exercise end-to-end. `chat` binds the skills
// library; each skill defines its own team of prompt agents, so the
// coordinator gets a task board, the task tools, and runBoard. Because the
// agents are LLMs, it needs OPENAI_API_KEY.
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

// A small coordinator agent. It doesn't research anything itself — the bound
// skill defines its own team and tells the coordinator how to plan tasks on its
// board (addTask with assignees and deps), and runBoard executes the team. The
// skill runs the board.
const researchChat = generator({
  name: "research-chat",
  // Resolves through the `chat` intent declared in ../fsdev.config.ts
  // (falls back to openai/gpt-5.4-mini).
  model: "intent/chat",
  inputSchema: z.object({ message: z.string().min(1) }),
  history: true,
  // Both skills are preloaded. Each defines its own team in `agents:`, so the
  // binding installs the board-commanded delegation surface — the task tools
  // and runBoard — alongside the skill bodies.
  uses: [skillsLibrary.with(skillsBinding as never)],
  prompt:
    "You coordinate a small research team. Follow the active skill's " +
    "instructions: plan the work with addTask (assignee, deps, input), run it " +
    "with runBoard, and surface the synthesizer's report as-is. Don't research " +
    "anything yourself.",
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

    // Skill path: a coordinator agent whose SKILL.md teams (each skill defines
    // its own prompt agents) plan and run their own boards. Needs a model
    // (OPENAI_API_KEY).
    chat: { block: researchChat, userMessage: (input) => input.message },
  },
  session: { stateSchema: z.object({}) },
});

export default researchTeamFlow({ id: "default" });
