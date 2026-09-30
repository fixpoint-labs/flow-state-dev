/**
 * The chat-agent's up-front skill activator must see the bundled skills on the
 * very first turn of a fresh session.
 *
 * The activator runs before the main generator, so it can't lean on the skills
 * binding's lazy seeding: unless it seeds the catalog itself, every tier
 * (slash, keyword, classifier) scans an empty collection on turn 1 and a
 * `/tech-brief` typed as the first message silently does nothing. This drives
 * the exported activator block against an empty skills collection — the state
 * of a brand-new user — and asserts the slash tier activates the skill.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { defineSkillsCollection } from "@flow-state-dev/orchestration";
import { mockGenerator, testSequencer } from "@flow-state-dev/testing";
import { z } from "zod";
import { skillActivatorBlock } from "../flows/chat-agent/shared/capabilities/features";

const messageInput = z.object({ message: z.string() }).passthrough();

// In the flow, the skills library installs the user-scoped `skills` collection.
// Here a no-op step declares the same collection so the harness wires it, and
// nothing has been written to it yet: a brand-new user's first turn.
const declareSkillsCollection = handler({
  name: "declare-skills-collection",
  inputSchema: messageInput,
  resources: { skills: defineSkillsCollection({ scope: "user" }) },
  execute: () => undefined,
});

const firstTurn = sequencer({ name: "first-turn", inputSchema: messageInput })
  .tap(declareSkillsCollection)
  .tap(skillActivatorBlock);

describe("chat-agent skill activator", () => {
  it("activates a bundled skill from `/name` on the first turn of a fresh session", async () => {
    // The classifier tier only runs if the slash tier missed. It abstains, so
    // a miss shows up as "nothing activated" rather than a missing-mock error.
    const classifier = mockGenerator({
      name: "skill-classifier",
      script: [{ structuredOutput: { reasoning: "no match", activeSkills: [] } }],
    });

    const result = await testSequencer(firstTurn, {
      input: { message: "/tech-brief what changed in React 19?" },
      generators: { "skill-classifier": classifier },
    });

    expect(result.error).toBeNull();
    expect(result.state.session.activeSkills).toEqual([
      expect.objectContaining({
        name: "tech-brief",
        source: "slash",
        input: "what changed in React 19?",
      }),
    ]);
  });
});
