/**
 * Goal check — two concurrent execution contexts patching one durable resource
 * both land.
 *
 * Real path, no mocking, out of CI. Two independent `createExecutionContext`
 * calls over ONE SQLite-backed store, exactly as two concurrent requests in one
 * Node process are, each patching a DIFFERENT field of the same resource key.
 * Nothing about the concurrency is simulated: the contexts are real, their
 * per-context caches and write queues are real, and the store is a real file.
 *
 * The different-field detail is the whole point. A same-field race passes under
 * a value-only design that never merges, so a check that patched one field
 * would go green against code that still drops writes. See goal.md.
 *
 * Run: pnpm tsx goals/resource-concurrency/two-contexts-patching-one-resource-both-land/run.mts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core/types";
import { createExecutionContext } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { runGoal, stripIntentOverrides, type GoalResult } from "../../lib/index.mts";

// No generator/model intents declared by this flow (goal.md's Model field is
// n/a); clear pinned overrides so the model resolver doesn't throw.
stripIntentOverrides();

const spine = defineResource({
  scope: "session",
  stateSchema: z.object({}).passthrough(),
  default: {}
});

function makeFlow() {
  return defineFlow({
    kind: "resource-cas-goal",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({ name: "noop", resources: { spine }, execute: () => "ok" })
      }
    }
  })();
}

/**
 * The fields each context writes. Held out from the assertion logic: the check
 * derives what it expects from this table rather than hardcoding a shape, so
 * swapping in different field names/values still grades a correct
 * implementation correctly.
 */
const WRITERS = [
  { requestId: "req_a", field: "claimedBy", value: "worker-a" },
  { requestId: "req_b", field: "note", value: "in progress" },
  { requestId: "req_c", field: "attempts", value: 3 }
] as const;

async function main(): Promise<GoalResult> {
  const dir = mkdtempSync(join(tmpdir(), "fsd-resource-cas-"));
  const stores = createSQLiteStores({ filename: join(dir, "goal.db") });
  const failures: string[] = [];

  try {
    // Each context is built BEFORE any of them writes, so all three hold the
    // same pre-race view of the key — which is what makes this a race rather
    // than a sequence.
    const contexts = await Promise.all(
      WRITERS.map((w) =>
        createExecutionContext({
          flow: makeFlow(),
          actionName: "run",
          requestId: w.requestId,
          sessionId: "sess_goal",
          userId: "user_goal",
          stores
        })
      )
    );

    await Promise.all(
      contexts.map((ctx, i) =>
        (ctx.resources.spine as { patchState(u: JsonObject): Promise<void> }).patchState({
          [WRITERS[i]!.field]: WRITERS[i]!.value
        })
      )
    );

    // Assert on the DURABLE row, read back through a fresh store connection —
    // not on any context's in-memory cache, which can look correct while the
    // persisted value has lost a field.
    stores.close();
    const reopened = createSQLiteStores({ filename: join(dir, "goal.db") });
    const row = await reopened.resourceState.get("session", "sess_goal", "spine");
    reopened.close();

    if (row === undefined) {
      failures.push("no live resource row after three concurrent patches");
      return { failures, evidence: "" };
    }

    const state = row.state as Record<string, unknown>;
    for (const w of WRITERS) {
      if (state[w.field] !== w.value) {
        failures.push(
          `field "${w.field}" written by ${w.requestId} is ${JSON.stringify(
            state[w.field]
          )}, expected ${JSON.stringify(w.value)} — that context's write was lost`
        );
      }
    }

    // The version is the independent witness: three committed writes to a key
    // that did not exist must leave it at 3. A merge that somehow produced the
    // right fields with fewer committed writes did not go through CAS.
    if (row.version !== WRITERS.length) {
      failures.push(
        `version is ${row.version}, expected ${WRITERS.length} — one write per committed patch`
      );
    }

    return {
      failures,
      evidence:
        `${WRITERS.length} concurrent execution contexts each patched a different field of ` +
        `session resource "spine" on one SQLite file; the reopened durable row is ` +
        `${JSON.stringify(state)} at version ${row.version}`
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void runGoal(main);
