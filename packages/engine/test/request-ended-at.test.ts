/**
 * "When did this request end" has one answer everywhere it is read: the
 * status route, a replayed stream's terminal event, the stream's synthesized
 * terminal event and the checkpoint sweeper. An aborted or failed run stamps
 * its own field, not `completedAtMs`; a reader that forgets one dates the end
 * of an interrupted run by whatever last touched the record.
 */
import { describe, expect, it } from "vitest";
import { terminalAtMs } from "../src/stores/request-ended-at";
import { buildReplayEvents } from "../src/routes/route-utils";
import type { RequestRecord } from "../src/stores/types";

const started = 1_000;
const record = (over: Partial<RequestRecord>): RequestRecord =>
  ({
    id: "req_1",
    flowKind: "chat",
    actionName: "run",
    userId: "u",
    source: "http",
    status: "completed",
    startedAtMs: started,
    state: {},
    version: 0,
    createdAt: started,
    updatedAt: started + 9_000,
    ...over
  }) as RequestRecord;

describe("terminalAtMs", () => {
  it("reads the stamp each way of ending writes", () => {
    expect(terminalAtMs(record({ status: "completed", completedAtMs: started + 1 }))).toBe(started + 1);
    expect(terminalAtMs(record({ status: "failed", failedAtMs: started + 2 }))).toBe(started + 2);
    expect(terminalAtMs(record({ status: "aborted", abortedAt: started + 3 }))).toBe(started + 3);
  });

  it("has no end for a request still running or held, whatever an earlier stop stamped", () => {
    expect(terminalAtMs(record({ status: "in_progress", abortedAt: started + 3, completedAtMs: started + 1 }))).toBeUndefined();
    expect(terminalAtMs(record({ status: "suspended", completedAtMs: started + 1 }))).toBeUndefined();
  });

  it("has none for a record that carries no stamp", () => {
    expect(terminalAtMs(record({ status: "aborted" }))).toBeUndefined();
  });
});

describe("a replayed aborted request", () => {
  it("dates its terminal event when it was aborted, not when the record was last written", () => {
    const events = buildReplayEvents(record({ status: "aborted", abortedAt: started + 3 }));
    // The status event is the replay's last.
    expect(events.at(-1)?.ts).toBe(started + 3);
  });
});
