/**
 * The lines the sidebar and Chief of Staff derive for design v2's form: the
 * footer's initials, a message's clock time, and the suggestions above Chief
 * of Staff's composer, each from what the Lab holds and nothing else.
 */
import { describe, expect, it } from "vitest";
import type { LoadedSnapshot } from "../src/lib/derive";
import { toBoardRow, toSeat, toWorkstream, type Ask, type BoardRow } from "../src/lib/reads";
import { chiefOfStaffSuggestions, clockTime, initialsOf, streamMark } from "../src/lib/shell";
import { isChiefOfStaffWorking, startChiefOfStaffWork } from "../src/lib/working";

const ORG = "acme";

describe("the footer's initials (v2:110)", () => {
  it("takes a letter from each of the first two words, dropping a one-letter prefix", () => {
    expect(initialsOf("u_devforce_lab")).toBe("DL");
    expect(initialsOf("mara.kim")).toBe("MK");
  });

  it("keeps a one-letter word that isn't a prefix, and reads a one-word id by its first two letters", () => {
    expect(initialsOf("u")).toBe("U");
    expect(initialsOf("mara")).toBe("MA");
  });

  it("never draws an empty square", () => {
    expect(initialsOf("__")).toBe("?");
  });
});

describe("a message's time (v2:135)", () => {
  it("is 24-hour HH:MM", () => {
    expect(clockTime(new Date(2026, 9, 2, 9, 5).getTime())).toBe("09:05");
    expect(clockTime(new Date(2026, 9, 2, 22, 41).getTime())).toBe("22:41");
  });
});

/** Two workstreams, `eng.desk` (coder) and `eng.side` (reviewer), with `rows` and `asks`. */
function snapshotOf(rows: BoardRow[], asks: Ask[]): LoadedSnapshot {
  const seats = [toSeat({ id: "eng.coder", kind: "worker" }, ORG)!, toSeat({ id: "eng.reviewer", kind: "worker" }, ORG)!];
  return {
    readAt: 0,
    sessions: [],
    orgId: ORG,
    inventory: {
      ok: true,
      value: {
        seats,
        workstreams: [
          toWorkstream({ id: "eng.desk", kind: "channel", members: ["eng.coder"] })!,
          toWorkstream({ id: "eng.side", kind: "channel", members: ["eng.reviewer"] })!,
        ],
      },
    },
    boards: {
      "eng.desk": { ok: true, value: { refs: ["eng.desk.work"], rows: rows.filter((r) => r.channelId === "eng.desk") } },
      "eng.side": { ok: true, value: { refs: ["eng.side.work"], rows: rows.filter((r) => r.channelId === "eng.side") } },
    },
    asks: { ok: true, value: asks },
    resources: { ok: true, value: [] },
  } as unknown as LoadedSnapshot;
}
const row = (channel: string, id: string, status: string): BoardRow => toBoardRow(`${channel}.work`, channel, id, { id, title: id, status, assignee: null });
const ask = (seatId: string): Ask =>
  ({ sessionId: `s_${seatId}`, seatId, flowId: seatId, parentSessionId: null, kind: "approval", item: { suspensionId: `q_${seatId}` }, since: 0, unanswerable: null }) as unknown as Ask;

describe("Chief of Staff's suggestions (v2:174, 1421-1422)", () => {
  it("asks what blocks the stream that needs the person, ahead of one that only runs", () => {
    const snapshot = snapshotOf([row("eng.desk", "a", "in_progress")], [ask("eng.reviewer")]);
    expect(chiefOfStaffSuggestions(snapshot)).toEqual(["What's blocking #eng.side?", "Who's on call?"]);
  });

  it("falls back to the first stream running when nothing needs the person", () => {
    const snapshot = snapshotOf([row("eng.side", "a", "in_progress")], []);
    expect(chiefOfStaffSuggestions(snapshot)).toEqual(["What's blocking #eng.side?", "Who's on call?"]);
  });

  it("names no stream when none needs the person or runs", () => {
    expect(chiefOfStaffSuggestions(snapshotOf([row("eng.desk", "a", "done")], []))).toEqual(["Who's on call?"]);
  });
});

describe("the chief of staff's working state (v2:55, 168, 1424)", () => {
  it("stays lit until every line in flight has settled, so an early line can't clear a later one", () => {
    expect(isChiefOfStaffWorking()).toBe(false);
    const first = startChiefOfStaffWork();
    const second = startChiefOfStaffWork();
    first();
    expect(isChiefOfStaffWorking()).toBe(true);
    first();
    expect(isChiefOfStaffWorking()).toBe(true);
    second();
    expect(isChiefOfStaffWorking()).toBe(false);
  });
});

describe("a workstream's mark (v2:1183-1184)", () => {
  const ok = (value: number) => ({ ok: true as const, value });
  it("is needs-you over running, running over nothing", () => {
    expect(streamMark({ needsYou: 1, running: ok(2) })).toBe("needs");
    expect(streamMark({ needsYou: 0, running: ok(2) })).toBe("run");
    expect(streamMark({ needsYou: null, running: ok(0) })).toBeNull();
    expect(streamMark({ needsYou: 0, running: { ok: false, failure: { message: "boards offline" } } })).toBeNull();
  });
});
