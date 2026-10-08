// The research-team flow — one flow, two actions, one per path the guide
// walks. Register it with fsdev (see ../fsdev.config.ts) and each action is a
// `fsdev run research-team <action>` away.
//
//   research             → the static code-first board (deterministic, no model)
//   researchCompetitors  → runtime fan-out via a router (deterministic, no model)
//
// Both run with no API key — their workers are plain handlers — so the tests
// exercise them end-to-end.
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { researchBoard } from "./board";
import { researchRouter } from "./research-router";

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
  },
  session: { stateSchema: z.object({}) },
});

export default researchTeamFlow();
