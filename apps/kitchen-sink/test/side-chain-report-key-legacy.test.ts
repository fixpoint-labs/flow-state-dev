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
 * ## Why this file imports rather than mirrors
 *
 * The first version of it declared its own copy of the schema and reimplemented
 * the union locally, and was candid in its docblock about doing so. That made
 * every assertion here pass against the test file's own code: deleting the
 * legacy key from the production schema, or dropping the legacy read, left all
 * five green. A test that cannot fail when the logic changes is not a test
 * (CLAUDE.md rule 5) — and the thing it claimed to pin is a duplicate-
 * announcement bug for every pre-upgrade session.
 *
 * So the pipeline exports `reportAcknowledgementSchema` and
 * `alreadyReportedTaskIds`, and this file imports both. Removing the legacy key
 * from either now fails these tests, which is the only reason they are worth
 * running.
 */
import { describe, expect, it } from "vitest";
import {
  alreadyReportedTaskIds,
  reportAcknowledgementSchema,
} from "../flows/chat-agent/run/thinking-styles/pipelines/background-work";

describe("the report-acknowledgement key across the side-chain rename", () => {
  it("keeps the legacy spelling in the schema, so it survives parsing", () => {
    const parsed = reportAcknowledgementSchema.parse({
      reportedBackgroundTaskIds: ["task-1"],
    });
    expect(parsed.reportedBackgroundTaskIds).toEqual(["task-1"]);
  });

  it("treats a pre-rename acknowledgement as already reported", () => {
    // The exact shape a session written before the deploy holds.
    const legacy = reportAcknowledgementSchema.parse({
      reportedBackgroundTaskIds: ["task-1", "task-2"],
    });
    const seen = alreadyReportedTaskIds(legacy);

    expect(seen.has("task-1")).toBe(true);
    expect(seen.has("task-2")).toBe(true);
  });

  it("unions both spellings during the overlap, without dropping either", () => {
    const mixed = reportAcknowledgementSchema.parse({
      reportedSideChainTaskIds: ["new-1"],
      reportedBackgroundTaskIds: ["old-1"],
    });
    expect([...alreadyReportedTaskIds(mixed)].sort()).toEqual(["new-1", "old-1"]);
  });

  it("still reports a job neither spelling has acknowledged", () => {
    const legacy = reportAcknowledgementSchema.parse({
      reportedBackgroundTaskIds: ["task-1"],
    });
    expect(alreadyReportedTaskIds(legacy).has("task-99")).toBe(false);
  });

  it("handles a session predating the key entirely", () => {
    expect(alreadyReportedTaskIds(reportAcknowledgementSchema.parse({})).size).toBe(0);
  });

  it("handles absent state without throwing", () => {
    // `sessionStateSchema` defaults both keys, but the read rule is called with
    // whatever the runtime hands it; an undefined state must not throw.
    expect(alreadyReportedTaskIds(undefined).size).toBe(0);
  });
});
