/**
 * FIX-1364 POC — does per-seat durable memory already fall out of composition,
 * or is it the L1 gap the agent-kind contract's C4 says it is?
 *
 * Two seats of one collection flow, one end user, one shared store. The
 * control case (isolation off) is what makes the result meaningful.
 *
 * Full write-up, result and the incidental testFlow finding: ./README.md
 *
 * Run:  pnpm tsx spec-poc/FIX-1364-seat-memory-isolation/run.ts
 *
 * Throwaway. Never merges; closes with the spec PR.
 */

import { defineFlow, handler } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import {
  addSemanticFact,
  createSemanticMemoryResource,
} from "@flow-state-dev/memory";
import { z } from "zod";

const USER_ID = "one-human";

/** Write a fact into whatever semantic-memory cell this seat resolves to. */
const remember = handler({
  name: "remember",
  inputSchema: z.object({ content: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (input, ctx) => {
    const ref = ctx.resources.get("semanticMemory");
    await addSemanticFact(ref, {
      content: input.content,
      confidence: 1,
      category: "identity",
      sourceEpisodeIds: [],
    });
    return { ok: true };
  },
});

/** Read back every fact this seat can see. */
const recall = handler({
  name: "recall",
  inputSchema: z.object({}),
  outputSchema: z.object({ contents: z.array(z.string()) }),
  execute: async (_input, ctx) => {
    const ref = ctx.resources.get("semanticMemory");
    const facts = (ref.state?.facts ?? []) as Array<{ content: string }>;
    return { contents: facts.map((f) => f.content) };
  },
});

/**
 * An agent-SHAPED kind: a collection (seats are instances), carrying memory's
 * own user-scoped resource, composed the ordinary way. Deliberately no
 * generator — the question is about storage keys, and a model call would only
 * add nondeterminism.
 */
function buildKind(isolateUserState: boolean) {
  return defineFlow({
    kind: `poc-agent-${isolateUserState ? "isolated" : "shared"}`,
    cardinality: "collection",
    isolateUserState,
    resources: { semanticMemory: createSemanticMemoryResource("user") },
    actions: {
      remember: { inputSchema: z.object({ content: z.string() }), block: remember },
      recall: { inputSchema: z.object({}), block: recall },
    },
  });
}


/**
 * Write a session record that names its owning flow INSTANCE, which is what
 * `ownsRecord` needs for a collection kind. `testFlow` only seeds when the id
 * is absent, so seeding first wins.
 */
async function seedOwnedSession(
  stores: ReturnType<typeof createInMemoryStores>,
  sessionId: string,
  seat: { id?: string },
  flowKind: string,
) {
  const now = new Date().toISOString();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind,
      flowId: seat.id,
      userId: USER_ID,
      orgId: undefined,
      metadata: undefined,
      latestRequestId: undefined,
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
    } as never,
    "any",
  );
}

async function runCase(isolateUserState: boolean) {
  const kind = buildKind(isolateUserState);
  // One registry for BOTH seats — sharing the store is the whole point.
  const stores = createInMemoryStores();

  const seatA = (kind as any)({ id: "engineering.lead" });
  const seatB = (kind as any)({ id: "engineering.designer" });

  // Sessions are pre-seeded naming their owning instance: testFlow omits
  // flowId, which makes a collection flow's run refuse. See README.
  await seedOwnedSession(stores, "sess-a", seatA, kind.kind);
  await seedOwnedSession(stores, "sess-b", seatB, kind.kind);

  const wrote = await testFlow({
    sessionId: "sess-a",
    flow: seatA,
    action: "remember",
    userId: USER_ID,
    input: { content: "the human prefers dark mode" },
    stores,
  });
  if (wrote.error) throw wrote.error;

  const readBackA = await testFlow({
    sessionId: "sess-a",
    flow: seatA,
    action: "recall",
    userId: USER_ID,
    input: {},
    stores,
  });
  if (readBackA.error) throw readBackA.error;

  const readBackB = await testFlow({
    sessionId: "sess-b",
    flow: seatB,
    action: "recall",
    userId: USER_ID,
    input: {},
    stores,
  });
  if (readBackB.error) throw readBackB.error;

  const seenByA = (readBackA.output as { contents: string[] }).contents;
  const seenByB = (readBackB.output as { contents: string[] }).contents;
  return { seenByA, seenByB };
}

async function main() {
  console.log("FIX-1364 — does per-seat durable memory fall out of composition?\n");

  const isolated = await runCase(true);
  const shared = await runCase(false);

  console.log("Case 1 — isolateUserState: true");
  console.log("  seat A (wrote) sees:", isolated.seenByA);
  console.log("  seat B (other)  sees:", isolated.seenByB);
  console.log("");
  console.log("Case 2 — isolateUserState: false   (control)");
  console.log("  seat A (wrote) sees:", shared.seenByA);
  console.log("  seat B (other)  sees:", shared.seenByB);
  console.log("");

  const aKeptItsOwn = isolated.seenByA.length === 1;
  const bIsSeparate = isolated.seenByB.length === 0;
  const controlShares = shared.seenByB.length === 1;

  const verdict =
    aKeptItsOwn && bIsSeparate && controlShares
      ? "SEPARABLE — `isolateUserState: true` gives each seat its own durable memory.\n" +
        "           C4's gap is real but NARROWER than stated: it is the DEFAULT, not a\n" +
        "           missing primitive. No new isolation primitive is needed."
      : !controlShares
        ? "INCONCLUSIVE — the control did not share, so the harness is not discriminating.\n" +
          "               Do not read case 1 as isolation."
        : "NOT SEPARABLE — composition does not separate seats. C4's gap stands as written.";

  console.log("VERDICT:", verdict);
}

main().catch((err) => {
  console.error("POC FAILED TO RUN:", err);
  process.exit(1);
});
