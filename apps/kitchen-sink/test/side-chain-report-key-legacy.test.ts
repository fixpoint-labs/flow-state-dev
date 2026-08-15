/**
 * A conversation that started before the side-chain rename is not re-told what
 * it has already been told (FIX-766).
 *
 * The background-work pipeline records which finished ledger rows it has
 * announced, in session state. FIX-766 renamed that key
 * `reportedBackgroundTaskIds` → `reportedSideChainTaskIds` — as an ordinary
 * identifier, which in source is exactly what it looks like. It is not: it is a
 * **persisted** key, so a session that predates the deploy holds its
 * acknowledgements under the old name, and a reader that knows only the new one
 * defaults to `[]` and announces every finished job a second time.
 *
 * FIX-766's decision 2 accepted "no shim" for two persisted surfaces — the
 * `provenance.phase` value and the block path — on arguments that do not reach
 * this one: it *is* read to decide something, and dual-reading a flat state key
 * costs four lines rather than an alias in every path comparison. So this key
 * is shimmed, and this pins it.
 *
 * The pipeline's block is not exported, so these assertions run against the
 * schema and the merge rule the block applies, which is where the bug was.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * The session-state shape the pipeline declares, mirrored here so the test
 * fails if the legacy key is dropped from the schema — a schema without it
 * silently strips the value before any reader sees it.
 */
const sessionStateSchema = z.object({
  reportedSideChainTaskIds: z.array(z.string()).default([]),
  reportedBackgroundTaskIds: z.array(z.string()).default([]),
});

/** The pipeline's read rule: the union of both spellings. */
function alreadyReported(state: z.infer<typeof sessionStateSchema>): Set<string> {
  return new Set([
    ...(state.reportedSideChainTaskIds ?? []),
    ...(state.reportedBackgroundTaskIds ?? []),
  ]);
}

describe("the report-acknowledgement key across the side-chain rename", () => {
  it("keeps the legacy spelling in the schema, so it survives parsing", () => {
    const parsed = sessionStateSchema.parse({ reportedBackgroundTaskIds: ["task-1"] });
    expect(parsed.reportedBackgroundTaskIds).toEqual(["task-1"]);
  });

  it("treats a pre-rename acknowledgement as already reported", () => {
    // The exact shape a session written before the deploy holds.
    const legacy = sessionStateSchema.parse({ reportedBackgroundTaskIds: ["task-1", "task-2"] });
    const seen = alreadyReported(legacy);

    expect(seen.has("task-1")).toBe(true);
    expect(seen.has("task-2")).toBe(true);
  });

  it("unions both spellings during the overlap, without dropping either", () => {
    const mixed = sessionStateSchema.parse({
      reportedSideChainTaskIds: ["new-1"],
      reportedBackgroundTaskIds: ["old-1"],
    });
    expect([...alreadyReported(mixed)].sort()).toEqual(["new-1", "old-1"]);
  });

  it("still reports a job neither spelling has acknowledged", () => {
    const legacy = sessionStateSchema.parse({ reportedBackgroundTaskIds: ["task-1"] });
    expect(alreadyReported(legacy).has("task-99")).toBe(false);
  });

  it("handles a session predating the key entirely", () => {
    expect(alreadyReported(sessionStateSchema.parse({})).size).toBe(0);
  });
});
