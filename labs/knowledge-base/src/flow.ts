// ---------------------------------------------------------------------------
// The incubation lab's runnable example flow (`fsdev run knowledge ...`).
//
// Two actions exercise the knowledgeBase capability end to end:
//   - `explore` — a model-free handler: mount an OKF bundle, then list the
//     concepts it imported. This is the goal-check seam — it proves the
//     capability wiring (resources + fns) executes through the real CLI without
//     needing model credentials.
//   - `ask` — a generator that navigates the mounted concepts with the glob /
//     grep / search tools the capability installs, to answer a question. The
//     agent path; requires a configured model (see fsdev.config.ts).
// ---------------------------------------------------------------------------

import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { createKnowledgeBaseCapability } from "./capability";

/** Default bundle for `explore`: the lab's checked-in sample OKF bundle. */
const SAMPLE_BUNDLE = new URL("../sample-bundle", import.meta.url).pathname;

const kb = createKnowledgeBaseCapability();

/** Mount an OKF bundle into the session's concept collection and list the result. */
const explore = handler({
  name: "explore",
  inputSchema: z.object({
    bundleDir: z.string().nullable().default(null).describe("OKF bundle directory; defaults to the sample bundle"),
  }),
  outputSchema: z.object({
    imported: z.number(),
    concepts: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  // A handler only needs the capability's resources + fns; the index/search
  // presets contribute generator-only context/tools, so turn them off here.
  uses: [kb.presets({ index: false, search: false })],
  execute: async (input, ctx: any) => {
    const dir = input.bundleDir ?? SAMPLE_BUNDLE;
    const { imported, warnings } = await ctx.cap.knowledgeBase.importBundle(dir);
    const concepts = await ctx.cap.knowledgeBase.listConcepts();
    return { imported, concepts, warnings };
  },
});

/** Seed the sample bundle for a self-contained `research` run (state-mutation only). */
const seedSample = handler({
  name: "seedSample",
  inputSchema: z.object({ question: z.string() }),
  uses: [kb.presets({ index: false, search: false })],
  execute: async (_input, ctx: any) => {
    await ctx.cap.knowledgeBase.importBundle(SAMPLE_BUNDLE);
  },
});

/** Answer a question by navigating the mounted concepts with the nav tools. */
const ask = generator({
  name: "ask",
  model: "intent/chat",
  uses: [kb],
  prompt:
    "You are a librarian for a knowledge base of markdown concepts. The <knowledge> " +
    "context lists what is available. Use globResources to find concepts by path, " +
    "grepResourceContent to search bodies, and searchResources to rank by relevance, " +
    "then answer using the concept content. Cite the concept paths you used.",
  inputSchema: z.object({ question: z.string() }),
  user: (input) => input.question,
  itemVisibility: { client: true, history: true },
});

// Self-contained agent path: seed the sample bundle, then let the generator
// navigate it. `.tap()` runs the seed for its side effect and forwards the
// original `{ question }` to the generator (BP-012 / BP-014).
const research = sequencer({ name: "research", inputSchema: z.object({ question: z.string() }) })
  .tap(seedSample)
  .step(ask);

const knowledgeFlow = defineFlow({
  kind: "knowledge",
  requireUser: true,
  actions: {
    explore: { block: explore },
    research: { block: research, userMessage: (input) => input.question },
  },
  resources: { concepts: kb.collection },
});

export default knowledgeFlow({ id: "default" });
