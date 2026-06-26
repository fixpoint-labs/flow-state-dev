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

/** A fresh, empty concept collection backed by in-memory stores. */
export async function makeConceptCollection(): Promise<ResourceCollectionRef<ConceptState>> {
  const block = handler({
    name: "noop",
    resources: { concepts: conceptCollection },
    execute: () => "ok",
  });
  const flow = defineFlow({
    kind: "kb-test",
    actions: { run: { inputSchema: z.string(), block } },
  })();

  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores: createInMemoryStores(),
  });

  return (ctx as { resources: Record<string, unknown> }).resources
    .concepts as ResourceCollectionRef<ConceptState>;
}

/** Absolute path to the checked-in OKF fixture bundle. */
export const FIXTURE_BUNDLE = new URL("./fixtures/bundle", import.meta.url).pathname;
