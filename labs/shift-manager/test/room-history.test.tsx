// @vitest-environment happy-dom
/**
 * Opening a room costs reads in proportion to the log of its length, not to
 * its whole history: the view starts at the room's newest page and reads
 * older pages only when asked ("Load earlier").
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomView } from "../src/surfaces/Project";
import { findRoomEnd, readRoomEarlier, readRoomTail, ROOM_PAGE, type RoomLine, type RoomPage } from "../src/lib/talk";

afterEach(() => cleanup());

/**
 * A room of `end` committed lines answering `read { after }` as the Lab does:
 * the lines in (after, min(end, after + ROOM_PAGE)], tombstones dropped, and
 * that bound as the next cursor. Counts every read.
 */
function stubRoom(end: number, tombstone: (seq: number) => boolean = () => false) {
  const reads: number[] = [];
  const page = async (after: number): Promise<RoomPage> => {
    reads.push(after);
    const through = Math.min(end, after + ROOM_PAGE);
    if (through <= after) return { lines: [], nextCursor: after, charter: "", seats: [] };
    const lines: RoomLine[] = [];
    for (let seq = after + 1; seq <= through; seq += 1) {
      if (!tombstone(seq)) lines.push({ projectId: "desk", seq, userId: "u", author: null, body: `line ${seq}`});
    }
    return { lines, nextCursor: through, charter: "", seats: [] };
  };
  return { page, reads };
}

describe("finding the room's end", () => {
  it("takes a number of reads that grows with the log of the room's length", async () => {
    for (const end of [0, 1, 199, 200, 201, 450, 1_000, 4_321, 100_000]) {
      const room = stubRoom(end);
      expect(await findRoomEnd(room.page)).toBe(end);
      // Draining from cursor 0 would take end / ROOM_PAGE + 1 reads.
      expect(room.reads.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(end / ROOM_PAGE + 2)) + 2);
    }
  });

  it("the opening read is the newest page, at 100,000 lines in a handful of reads", async () => {
    const room = stubRoom(100_000);
    const tail = await readRoomTail(room.page);
    expect(tail.cursor).toBe(100_000);
    expect(tail.floor).toBe(100_000 - ROOM_PAGE);
    expect(tail.lines.map((l) => l.seq)).toEqual(Array.from({ length: ROOM_PAGE }, (_, i) => 100_000 - ROOM_PAGE + 1 + i));
    expect(room.reads.length).toBeLessThan(40);
  });

  it("steps back past pages that hold only tombstones, a bounded number of them", async () => {
    // The newest 450 lines were all removed.
    const room = stubRoom(2_000, (seq) => seq > 1_550);
    const tail = await readRoomTail(room.page);
    expect(tail.cursor).toBe(2_000);
    expect(tail.lines.at(-1)?.seq).toBe(1_550);
    expect(tail.floor).toBe(1_400);

    // A room that is tombstones all the way down ends at the bound, not at 0.
    const gone = stubRoom(100_000, () => true);
    const empty = await readRoomTail(gone.page);
    expect(empty.lines).toEqual([]);
    expect(empty.floor).toBeGreaterThan(0);
    const before = gone.reads.length;
    const earlier = await readRoomEarlier(gone.page, empty.floor);
    expect(earlier.lines).toEqual([]);
    expect(earlier.floor).toBeLessThan(empty.floor);
    expect(gone.reads.length - before).toBeLessThanOrEqual(5);
  });

  it("an earlier page ends where the shown lines begin, and stops at the room's start", async () => {
    const room = stubRoom(250);
    const earlier = await readRoomEarlier(room.page, 50);
    expect(earlier.lines.map((l) => l.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(earlier.floor).toBe(0);
  });
});

describe("the room view (BR-23)", () => {
  it("opens on the newest page in a bounded number of reads, and Load earlier shows the page before it", async () => {
    const room = stubRoom(5_000);
    render(<RoomView sessionId="talk-1" page={room.page} post={async () => undefined} />);
    await screen.findByText("line 5000");
    const onOpen = room.reads.length;
    // Draining from cursor 0 is 26 reads.
    expect(onOpen).toBeLessThanOrEqual(16);
    expect(screen.queryByText("line 4800")).toBeNull();
    expect(screen.getByText("line 4801")).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByTestId("room-earlier")));
    await screen.findByText("line 4800");
    expect(screen.getByText("line 4601")).toBeTruthy();
    expect(screen.queryByText("line 4600")).toBeNull();
    expect(room.reads.length - onOpen).toBe(1);
  });

  it("a quiet open room stops reading after a bounded burst, and focus re-arms it (DECISIONS Q3)", async () => {
    vi.useFakeTimers();
    try {
      const room = stubRoom(3);
      render(<RoomView sessionId="talk-1" page={room.page} post={async () => undefined} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(screen.getByText("line 3")).toBeTruthy();
      // An hour of a quiet room left open: a timer that never stops would read ~240 times.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 60_000);
      });
      const afterHour = room.reads.length;
      expect(afterHour).toBeLessThanOrEqual(12);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 60_000);
      });
      expect(room.reads.length).toBe(afterHour);

      // Focus reads at once and arms another bounded burst.
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(room.reads.length).toBeGreaterThan(afterHour);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 60_000);
      });
      expect(room.reads.length - afterHour).toBeLessThanOrEqual(10);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("a failed read re-arms the loop, so the room catches up once the Lab answers again", () => {
    /** A room lines can be added to, whose reads fail while `down`. */
    function liveRoom() {
      const state = { end: 1, down: false, reads: 0 };
      const page = async (after: number): Promise<RoomPage> => {
        state.reads += 1;
        if (state.down) throw new Error("the Lab is restarting");
        const through = Math.min(state.end, after + ROOM_PAGE);
        if (through <= after) return { lines: [], nextCursor: after, charter: "", seats: [] };
        const lines = Array.from({ length: through - after }, (_, i): RoomLine => {
          const seq = after + 1 + i;
          return { projectId: "desk", seq, userId: "u", author: null, body: `line ${seq}` };
        });
        return { lines, nextCursor: through, charter: "", seats: [] };
      };
      return { state, page };
    }
    const tick = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    it("Retry after a failed read arms a burst, not one read", async () => {
      vi.useFakeTimers();
      try {
        const room = liveRoom();
        render(<RoomView sessionId="talk-1" page={room.page} post={async () => undefined} />);
        await tick(10);
        room.state.down = true;
        // Focus reads, fails, and the burst rests on its failures.
        await act(async () => window.dispatchEvent(new Event("focus")));
        await tick(60 * 60_000);
        expect(screen.getByTestId("room-failure")).toBeTruthy();

        room.state.down = false;
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
        await tick(10);
        // A seat answers a few seconds later: the re-armed burst picks it up.
        room.state.end = 2;
        await tick(30_000);
        expect(screen.getByText("line 2")).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("a post whose read-back fails still wakes the loop for the seats' answers", async () => {
      vi.useFakeTimers();
      try {
        const room = liveRoom();
        render(<RoomView sessionId="talk-1" page={room.page} post={async () => undefined} />);
        await tick(60 * 60_000); // opened, and resting
        room.state.down = true;
        fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "hello" } });
        await act(async () => fireEvent.click(screen.getByTestId("composer-send")));
        await tick(10);
        expect(screen.getByText(/reading it back failed/)).toBeTruthy();

        room.state.down = false;
        room.state.end = 3;
        await tick(30_000);
        expect(screen.getByText("line 3")).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("a room that fits on one page shows everything and no Load earlier", async () => {
    const room = stubRoom(3);
    render(<RoomView sessionId="talk-1" page={room.page} post={async () => undefined} />);
    await screen.findByText("line 1");
    expect(screen.queryByTestId("room-earlier")).toBeNull();
  });
});
