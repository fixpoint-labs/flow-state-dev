// Shared test harness: a real, in-memory concept collection.
//
// Builds a live execution context over in-memory stores and returns the
// concept collection ref so adapter tests exercise the production
// ResourceCollectionRef (state store + content store + edge slot), not a mock.

import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createExecutionContext, createInMemoryStores } from "@flow-state-dev/engine";
import { conceptCollection, type ConceptState } from "../src/concepts";

let callCounter = 0;

/**
 * A fresh concept collection backed by in-memory stores, bound to `userId`
 * (default `"user_1"`). Each call gets its own session — like a stateless
 * MCP `tools/call` — so calling this twice for the same `userId` (with the
 * same `stores`) simulates two separate requests from one principal, and
 * calling it for a different `userId` exercises per-principal isolation
 * under `scope: "user"`.
 */
export async function makeConceptCollection(
  userId: string = "user_1",
  stores = createInMemoryStores(),
): Promise<ResourceCollectionRef<ConceptState>> {
  const block = handler({
    name: "noop",
    resources: { concepts: conceptCollection },
    execute: () => "ok",
  });
  const flow = defineFlow({
    kind: "kb-test",
    actions: { run: { inputSchema: z.string(), block } },
  })();

  callCounter += 1;
  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId: `req_${callCounter}`,
    sessionId: `sess_${callCounter}`,
    userId,
    stores,
  });

  return (ctx as { resources: Record<string, unknown> }).resources
    .concepts as ResourceCollectionRef<ConceptState>;
}

/** Absolute path to the checked-in OKF fixture bundle. */
export const FIXTURE_BUNDLE = new URL("./fixtures/bundle", import.meta.url).pathname;
