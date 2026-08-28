import { describe, expect, it } from "vitest";
import { applyKey, decodeKeys, rowAfterRefresh } from "../src/conductor/keys";
import { applyStatus } from "../src/conductor/loop";
import {
  ACTIVITY_CAP,
  applyFindQuery,
  emptyView,
  findMatches,
  pushActivity,
  type StatusRow,
  type ViewState,
} from "../src/conductor/types";

function row(issue: string, questions = 0): StatusRow {
  return {
    taskId: `${issue}--implement`,
    issue,
    phase: "implement",
    status: questions > 0 ? "awaiting_review" : "in_progress",
    attempts: 1,
    feedback: null,
    run: null,
    questions: Array.from({ length: questions }, (_, i) => ({
      question: `${issue}/implement/1/q${i}`,
      text: `question ${i}`,
      attempt: 1,
      askedAt: null,
    })),
  };
}

function runningRow(issue: string): StatusRow {
  return {
    ...row(issue),
    status: "in_progress",
    run: {
      attempt: 1,
      taskId: `${issue}--implement`,
      workspacePath: "/tmp/ws",
      branch: `conductor/${issue}--implement`,
      outcome: "running",
      reason: null,
      sessionId: "sess",
      finalMessage: null,
      usage: null,
      costUsd: null,
      childSessionId: "child-1",
      requestId: `req-${issue}`,
      updatedAt: Date.now(),
    },
  };
}

function board(rows: StatusRow[]): ViewState {
  return { ...emptyView("epic"), rows };
}

describe("decodeKeys", () => {
  it("decodes arrows, enter, and a paste of printable chars", () => {
    expect(decodeKeys("\x1b[A").keys).toEqual([{ type: "up" }]);
    expect(decodeKeys("\r").keys).toEqual([{ type: "enter" }]);
    expect(decodeKeys("\n").keys).toEqual([{ type: "newline" }]);
    expect(decodeKeys("ab").keys).toEqual([
      { type: "char", value: "a" },
      { type: "char", value: "b" },
    ]);
  });

  it("decodes an SGR click and a wheel tick", () => {
    expect(decodeKeys("\x1b[<0;12;5M").keys).toEqual([{ type: "click", col: 12, row: 5 }]);
    expect(decodeKeys("\x1b[<65;1;1M").keys).toEqual([{ type: "wheel", delta: 1 }]);
    expect(decodeKeys("\x1b[5~").keys).toEqual([{ type: "pageup" }]);
    expect(decodeKeys("\x1b[6~").keys).toEqual([{ type: "pagedown" }]);
    expect(decodeKeys("\x1b[H").keys).toEqual([{ type: "home" }]);
    expect(decodeKeys("\x1b[F").keys).toEqual([{ type: "end" }]);
    expect(decodeKeys("\x1b[27;2;13~").keys).toEqual([{ type: "newline" }]);
    expect(decodeKeys("\x1b[13;2u").keys).toEqual([{ type: "newline" }]);
    expect(decodeKeys("\x1b\r").keys).toEqual([{ type: "newline" }]);
  });

  it("decodes a bracketed paste as one insert, including newlines", () => {
    expect(decodeKeys("\x1b[200~hello\r\nworld\x1b[201~").keys).toEqual([
      { type: "paste", value: "hello\nworld" },
    ]);
    const first = decodeKeys("\x1b[200~hel");
    expect(first.keys).toEqual([]);
    expect(decodeKeys("lo\x1b[201~", first.rest).keys).toEqual([{ type: "paste", value: "hello" }]);
  });

  it("holds an incomplete CSI so the next chunk can finish it", () => {
    const first = decodeKeys("\x1b[");
    expect(first.keys).toEqual([]);
    expect(decodeKeys("A", first.rest).keys).toEqual([{ type: "up" }]);
  });
});

describe("applyKey", () => {
  it("moves the selection with j/k and starts an answer with a", () => {
    const state = board([row("FIX-1", 1), row("FIX-2")]);
    const down = applyKey(state, { type: "char", value: "j" });
    expect(down.state.selected).toBe(1);
    const up = applyKey(down.state, { type: "char", value: "k" });
    expect(up.state.selected).toBe(0);
    const answer = applyKey(up.state, { type: "char", value: "a" });
    expect(answer.state.inputMode).toBe("answer");
    expect(answer.state.answering).toBe("FIX-1/implement/1/q0");
  });

  it("jumps to the next waiting or failed row with }, and wraps with {", () => {
    const failed: StatusRow = {
      ...row("FAIL-1"),
      status: "pending",
      run: {
        attempt: 2,
        taskId: "FAIL-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/FAIL-1--implement",
        outcome: "failed",
        reason: "Not logged in",
        sessionId: "sess",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: null,
        requestId: "req-fail-1",
        updatedAt: 1,
      },
    };
    const state = board([runningRow("LIVE-1"), row("FIX-1", 1), failed]);
    const next = applyKey(state, { type: "char", value: "}" });
    expect(next.state.selected).toBe(1);
    expect(next.state.rows[1]?.issue).toBe("FIX-1");
    const after = applyKey(next.state, { type: "char", value: "}" });
    expect(after.state.selected).toBe(2);
    const wrap = applyKey(after.state, { type: "char", value: "}" });
    expect(wrap.state.selected).toBe(1);
    const back = applyKey(wrap.state, { type: "char", value: "{" });
    expect(back.state.selected).toBe(2);
    const quiet = applyKey(board([runningRow("LIVE-1")]), { type: "char", value: "}" });
    expect(quiet.state.selected).toBe(0);
    expect(quiet.state.notice).toBe("nothing waiting, failed, or stalled");
    const fromAsk = applyKey(board([row("FIX-1", 1), failed]), { type: "char", value: "}" });
    expect(fromAsk.state.selected).toBe(1);
    expect(fromAsk.state.inputMode).toBe("command");
  });

  it("jumps to a running row that has gone silent", () => {
    const now = 1_700_000_030_000;
    const fresh = runningRow("LIVE-1");
    fresh.run = { ...fresh.run!, updatedAt: now - 8_000 };
    const stale = runningRow("LIVE-2");
    stale.run = { ...stale.run!, updatedAt: now - 45_000 };
    const jumped = applyKey(board([fresh, stale]), { type: "char", value: "}" }, now);
    expect(jumped.state.selected).toBe(1);
    expect(jumped.state.rows[1]?.issue).toBe("LIVE-2");
    const still = applyKey(board([fresh]), { type: "char", value: "}" }, now);
    expect(still.state.selected).toBe(0);
    expect(still.state.notice).toBe("nothing waiting, failed, or stalled");
  });

  it("treats typing on a waiting row as composing the answer, and Enter dispatches it", () => {
    const state = board([row("FIX-1", 1)]);
    const typed = applyKey(state, { type: "char", value: "y" });
    expect(typed.state.inputMode).toBe("answer");
    expect(typed.state.input).toBe("y");
    const more = applyKey(typed.state, { type: "char", value: "es" });
    // decodeKeys would split "es"; applyKey sees one char at a time.
    const done = applyKey(
      { ...typed.state, input: "yes" },
      { type: "enter" },
    );
    expect(done.effect).toEqual({
      type: "dispatch",
      command: { kind: "answer", question: "FIX-1/implement/1/q0", text: "yes" },
    });
  });

  it("completes a slash verb with Tab and runs it with Enter", () => {
    let state = board([row("FIX-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    state = applyKey(state, { type: "char", value: "w" }).state;
    expect(state.input).toBe("/w");
    const tabbed = applyKey(state, { type: "tab" });
    expect(tabbed.state.input).toBe("/wake");
    expect(tabbed.effect).toBeUndefined();
    const ran = applyKey(tabbed.state, { type: "enter" });
    expect(ran.effect).toEqual({ type: "dispatch", command: { kind: "wake" } });
  });

  it("leaves a trailing space when the completed verb needs an argument", () => {
    let state = board([row("FIX-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "see") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const tabbed = applyKey(state, { type: "tab" });
    expect(tabbed.state.input).toBe("/seed ");
    expect(tabbed.effect).toBeUndefined();
    const entered = applyKey({ ...state, input: "/see", slashAt: 0 }, { type: "enter" });
    expect(entered.state.input).toBe("/seed ");
    expect(entered.effect).toBeUndefined();
  });

  it("moves the slash selection with arrows", () => {
    let state = board([row("FIX-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    state = applyKey(state, { type: "char", value: "s" }).state;
    expect(state.slashAt).toBe(0);
    const down = applyKey(state, { type: "down" });
    expect(down.state.slashAt).toBe(1);
    const tabbed = applyKey(down.state, { type: "tab" });
    expect(tabbed.state.input).toBe("/seed ");
  });

  it("completes a board issue id after /status", () => {
    let state = board([row("FIX-1"), row("FIX-2")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "status ") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    expect(state.input).toBe("/status ");
    const down = applyKey(state, { type: "down" });
    const tabbed = applyKey(down.state, { type: "tab" });
    expect(tabbed.state.input).toBe("/status FIX-2");
    const jumped = applyKey(tabbed.state, { type: "enter" });
    expect(jumped.state.selected).toBe(1);
    expect(jumped.effect).toEqual({ type: "refresh" });
  });

  it("offers a running issue first after /abort", () => {
    const pending = { ...row("FIX-1"), status: "pending" };
    let state = board([pending, runningRow("LIVE-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "abort ") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const tabbed = applyKey(state, { type: "tab" });
    expect(tabbed.state.input).toBe("/abort LIVE-1");
  });

  it("completes an open question id after /answer and leaves a space", () => {
    let state = board([row("FIX-1", 1)]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "answer ") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const tabbed = applyKey(state, { type: "tab" });
    expect(tabbed.state.input).toBe("/answer FIX-1/implement/1/q0 ");
    expect(tabbed.effect).toBeUndefined();
  });

  it("clears a bare slash on Enter instead of running the first verb", () => {
    let state = board([row("FIX-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    const submitted = applyKey(state, { type: "enter" });
    expect(submitted.state.input).toBe("");
    expect(submitted.effect).toBeUndefined();
  });

  it("dispatches slash commands from the prompt", () => {
    let state = board([row("FIX-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "wake") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const submitted = applyKey(state, { type: "enter" });
    expect(submitted.effect).toEqual({ type: "dispatch", command: { kind: "wake" } });
  });

  it("dispatches an unslashed line as talk", () => {
    let state = board([row("FIX-1")]);
    // Idle `r` is refresh — start with a letter that is not a board key.
    for (const ch of "please retry the failed rows") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const submitted = applyKey(state, { type: "enter" });
    expect(submitted.effect).toEqual({
      type: "dispatch",
      command: { kind: "steer", message: "please retry the failed rows" },
    });
    expect(submitted.state.drafts).toEqual(["please retry the failed rows"]);
  });

  it("walks prior compose lines with ↑/↓, and idle ↑ still moves rows", () => {
    const rows = [row("FIX-1"), row("FIX-2")];
    const idle = applyKey({ ...board(rows), selected: 1 }, { type: "up" });
    expect(idle.state.selected).toBe(0);
    expect(idle.state.input).toBe("");

    let state: ViewState = {
      ...board(rows),
      drafts: ["seed LAB-1", "please retry the failed rows"],
    };
    for (const ch of "new draft") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    expect(state.selected).toBe(0);
    const older = applyKey(state, { type: "up" });
    expect(older.state.input).toBe("please retry the failed rows");
    expect(older.state.draftHold).toBe("new draft");
    expect(older.state.selected).toBe(0);
    const oldest = applyKey(older.state, { type: "up" });
    expect(oldest.state.input).toBe("seed LAB-1");
    const stop = applyKey(oldest.state, { type: "up" });
    expect(stop.state.input).toBe("seed LAB-1");
    const newer = applyKey(oldest.state, { type: "down" });
    expect(newer.state.input).toBe("please retry the failed rows");
    const live = applyKey(newer.state, { type: "down" });
    expect(live.state.input).toBe("new draft");
    expect(live.state.draftAt).toBeNull();
    expect(live.state.draftHold).toBeNull();
  });

  it("remembers answers and seed ids, skips find and empty, and Esc keeps the list", () => {
    const waiting = board([row("FIX-1", 1)]);
    const answering = applyKey(waiting, { type: "char", value: "a" }).state;
    const typed = { ...answering, input: "ship the smaller cut" };
    const sent = applyKey(typed, { type: "enter" });
    expect(sent.state.drafts).toEqual(["ship the smaller cut"]);
    const again = applyKey({ ...sent.state, inputMode: "answer", answering: "FIX-1/implement/1/q0", input: "ship the smaller cut" }, { type: "enter" });
    expect(again.state.drafts).toEqual(["ship the smaller cut"]);

    const seeding = applyKey(board([row("FIX-1")]), { type: "char", value: "s" }).state;
    const seeded = applyKey({ ...seeding, input: "LAB-9" }, { type: "enter" });
    expect(seeded.state.drafts).toEqual(["LAB-9"]);

    let find = applyKey({ ...seeded.state, input: "" }, { type: "char", value: "/" }).state;
    for (const ch of "find hunk") {
      find = applyKey(find, { type: "char", value: ch }).state;
    }
    const found = applyKey(find, { type: "enter" });
    expect(found.state.drafts).toEqual(["LAB-9"]);
    expect(found.state.find).toBe("hunk");

    const composing = applyKey({ ...found.state, input: "x", find: null }, { type: "up" });
    expect(composing.state.input).toBe("LAB-9");
    const cancelled = applyKey(composing.state, { type: "escape" });
    expect(cancelled.state.drafts).toEqual(["LAB-9"]);
    expect(cancelled.state.input).toBe("");
    expect(cancelled.state.draftAt).toBeNull();
    expect(cancelled.state.draftHold).toBeNull();

    const empty = applyKey({ ...cancelled.state, input: "   " }, { type: "enter" });
    expect(empty.state.drafts).toEqual(["LAB-9"]);
  });

  it("moves the compose caret with ←/→ and inserts in the middle", () => {
    const idle = applyKey({ ...board([row("FIX-1", 2)]), questionIndex: 1 }, { type: "left" });
    expect(idle.state.questionIndex).toBe(0);
    expect(idle.state.input).toBe("");

    let state = board([row("FIX-1")]);
    for (const ch of "bc") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    expect(state.input).toBe("bc");
    expect(state.caret).toBe(2);
    const left = applyKey(state, { type: "left" });
    expect(left.state.input).toBe("bc");
    expect(left.state.caret).toBe(1);
    const inserted = applyKey(left.state, { type: "char", value: "X" });
    expect(inserted.state.input).toBe("bXc");
    expect(inserted.state.caret).toBe(2);
    const deleted = applyKey(inserted.state, { type: "backspace" });
    expect(deleted.state.input).toBe("bc");
    expect(deleted.state.caret).toBe(1);
    const end = applyKey(deleted.state, { type: "right" });
    expect(end.state.caret).toBe(2);
  });

  it("inserts a compose line with newline, and Enter still sends", () => {
    let state = board([row("FIX-1")]);
    for (const ch of "please") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    state = applyKey(state, { type: "newline" }).state;
    for (const ch of "retry") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    expect(state.input).toBe("please\nretry");
    expect(state.caret).toBe("please\nretry".length);
    const up = applyKey(state, { type: "up" });
    expect(up.state.input).toBe("please\nretry");
    expect(up.state.caret).toBe("retry".length);
    const home = applyKey(up.state, { type: "home" });
    expect(home.state.caret).toBe(0);
    const sent = applyKey(state, { type: "enter" });
    expect(sent.effect).toEqual({
      type: "dispatch",
      command: { kind: "steer", message: "please\nretry" },
    });
    expect(sent.state.drafts).toEqual(["please\nretry"]);
  });

  it("pastes into compose without sending, including on a waiting row", () => {
    const idle = applyKey(board([row("FIX-1")]), { type: "paste", value: "please\nretry" });
    expect(idle.state.input).toBe("please\nretry");
    expect(idle.effect).toBeUndefined();
    const waiting = applyKey(board([row("FIX-1", 1)]), { type: "paste", value: "ship\nit" });
    expect(waiting.state.inputMode).toBe("answer");
    expect(waiting.state.input).toBe("ship\nit");
    expect(waiting.effect).toBeUndefined();
  });

  it("moves to the start and end of the current compose line with Ctrl-A / Ctrl-E", () => {
    const state = {
      ...board([row("FIX-1")]),
      input: "please\nretry",
      caret: "please\nre".length,
    };
    const start = applyKey(state, { type: "ctrl", value: "a" });
    expect(start.state.caret).toBe("please\n".length);
    const end = applyKey(start.state, { type: "ctrl", value: "e" });
    expect(end.state.caret).toBe("please\nretry".length);
  });

  it("keeps at most fifty submitted compose lines", () => {
    let state: ViewState = {
      ...board([row("FIX-1")]),
      drafts: Array.from({ length: 50 }, (_, i) => `line-${i}`),
    };
    for (const ch of "please retry the overflow") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const sent = applyKey(state, { type: "enter" });
    expect(sent.state.drafts).toHaveLength(50);
    expect(sent.state.drafts[0]).toBe("line-1");
    expect(sent.state.drafts.at(-1)).toBe("please retry the overflow");
  });

  it("selects the clicked table row", () => {
    const state = board([row("FIX-1", 1), row("FIX-2")]);
    const clicked = applyKey(state, { type: "click", col: 8, row: 5 });
    expect(clicked.state.selected).toBe(1);
  });

  it("jumps the transcript to the tail when the selected row changes", () => {
    const state = { ...board([row("FIX-1"), row("FIX-2")]), scroll: 12 };
    const down = applyKey(state, { type: "char", value: "j" });
    expect(down.state.selected).toBe(1);
    expect(down.state.scroll).toBe(0);

    const already = applyKey({ ...down.state, scroll: 8 }, { type: "click", col: 8, row: 5 });
    expect(already.state.selected).toBe(1);
    expect(already.state.scroll).toBe(8);

    const other = applyKey({ ...down.state, scroll: 8 }, { type: "click", col: 8, row: 4 });
    expect(other.state.selected).toBe(0);
    expect(other.state.scroll).toBe(0);
  });

  it("scrolls the transcript with the wheel and PageUp, including while busy", () => {
    const state = board([row("FIX-1")]);
    const up = applyKey(state, { type: "wheel", delta: -1 });
    expect(up.state.scroll).toBe(1);
    expect(up.state.selected).toBe(0);
    const page = applyKey(up.state, { type: "pageup" });
    expect(page.state.scroll).toBe(9);
    const busy = applyKey({ ...state, busy: true }, { type: "pagedown" });
    expect(busy.state.scroll).toBe(0);
  });

  it("lets you change rows while an action is in flight, and holds a new wake", () => {
    const state = { ...board([row("FIX-1"), row("FIX-2")]), busy: true };
    const next = applyKey(state, { type: "char", value: "j" });
    expect(next.state.selected).toBe(1);
    expect(next.effect).toBeUndefined();
    const wake = applyKey(state, { type: "char", value: "w" });
    expect(wake.state.selected).toBe(0);
    expect(wake.effect).toEqual({ type: "hold", command: { kind: "wake" } });
    expect(wake.state.notice).toMatch(/queued/);
  });

  it("lets you start an answer while an action is in flight", () => {
    const state = { ...board([row("FIX-1", 1)]), busy: true };
    const typed = applyKey(state, { type: "char", value: "l" });
    expect(typed.state.inputMode).toBe("answer");
    expect(typed.state.input).toBe("l");
    expect(typed.effect).toBeUndefined();
    const sent = applyKey({ ...typed.state, input: "leave the symlink" }, { type: "enter" });
    expect(sent.effect).toEqual({
      type: "hold",
      command: { kind: "answer", question: "FIX-1/implement/1/q0", text: "leave the symlink" },
    });
  });

  it("stops the selected running row with x or Ctrl-C, and quits when nothing is running", () => {
    const running = board([runningRow("LIVE-1")]);
    expect(applyKey(running, { type: "char", value: "x" }).effect).toEqual({
      type: "dispatch",
      command: { kind: "abort" },
    });
    expect(applyKey(running, { type: "ctrl", value: "c" }).effect).toEqual({
      type: "dispatch",
      command: { kind: "abort" },
    });

    const idle = board([row("FIX-1", 1)]);
    const idleX = applyKey(idle, { type: "char", value: "x" });
    expect(idleX.state.notice).toBe("nothing running to stop");
    expect(idleX.effect).toBeUndefined();
    expect(applyKey(idle, { type: "ctrl", value: "c" }).effect).toEqual({ type: "quit" });
  });

  it("selects a row with /status <issue> and still refreshes", () => {
    let state = board([row("FIX-1"), row("FIX-2")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "status FIX-2") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const submitted = applyKey(state, { type: "enter" });
    expect(submitted.state.selected).toBe(1);
    expect(submitted.state.rows[submitted.state.selected]?.issue).toBe("FIX-2");
    expect(submitted.effect).toEqual({ type: "refresh" });
  });

  it("keeps the selection on /status with no issue", () => {
    const state = { ...board([row("FIX-1"), row("FIX-2")]), selected: 1 };
    let typed = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "status") {
      typed = applyKey(typed, { type: "char", value: ch }).state;
    }
    const submitted = applyKey(typed, { type: "enter" });
    expect(submitted.state.selected).toBe(1);
    expect(submitted.state.notice).toBeNull();
    expect(submitted.effect).toEqual({ type: "refresh" });
  });

  it("says so when /status names a row that is not on the board", () => {
    let state = board([row("FIX-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "status MISSING") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const submitted = applyKey(state, { type: "enter" });
    expect(submitted.state.selected).toBe(0);
    expect(submitted.state.notice).toBe("no row for MISSING");
    expect(submitted.effect).toEqual({ type: "refresh" });
  });

  it("applies /find immediately and steps with n / N", () => {
    const state = {
      ...board([row("FIX-1")]),
      activity: [
        { at: 1, text: "tool · Write src/alpha.ts" },
        { at: 2, text: "tool · Read src/beta.ts" },
        { at: 3, text: "tool · Write src/gamma.ts" },
      ],
    };
    let typed = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "find src/") {
      typed = applyKey(typed, { type: "char", value: ch }).state;
    }
    const found = applyKey(typed, { type: "enter" });
    expect(found.effect).toBeUndefined();
    expect(found.state.inputMode).toBe("command");
    expect(found.state.find).toBe("src/");
    expect(findMatches(found.state)).toHaveLength(3);
    expect(found.state.findAt).toBe(2);

    const older = applyKey(found.state, { type: "char", value: "n" });
    expect(older.state.findAt).toBe(1);
    const olderStill = applyKey(older.state, { type: "char", value: "n" });
    expect(olderStill.state.findAt).toBe(0);
    const wrap = applyKey(olderStill.state, { type: "char", value: "n" });
    expect(wrap.state.findAt).toBe(2);
    const newer = applyKey(wrap.state, { type: "char", value: "N" });
    expect(newer.state.findAt).toBe(0);
  });

  it("opens a live find prompt for /find with no query, and Esc clears it", () => {
    let state = board([row("FIX-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "find") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const opened = applyKey(state, { type: "enter" });
    expect(opened.state.inputMode).toBe("find");
    expect(opened.effect).toBeUndefined();

    const typed = applyKey(opened.state, { type: "char", value: "f" });
    expect(typed.state.find).toBe("f");
    const cleared = applyKey(typed.state, { type: "escape" });
    expect(cleared.state.find).toBeNull();
    expect(cleared.state.inputMode).toBe("command");
  });

  it("does not start an answer with n when find is on", () => {
    const waiting = board([row("FIX-1", 1)]);
    const finding = applyFindQuery(
      { ...waiting, activity: [{ at: 1, text: "status · parked" }] },
      "parked",
    );
    const stepped = applyKey(finding, { type: "char", value: "n" });
    expect(stepped.state.inputMode).toBe("command");
    expect(stepped.state.find).toBe("parked");

    const answering = applyKey(waiting, { type: "char", value: "n" });
    expect(answering.state.inputMode).toBe("answer");
    expect(answering.state.input).toBe("n");
  });

  it("clears find with Esc from the idle board", () => {
    const finding = { ...board([row("FIX-1")]), find: "foo", findAt: 0 };
    const cleared = applyKey(finding, { type: "escape" });
    expect(cleared.state.find).toBeNull();
    expect(cleared.state.findAt).toBe(0);
  });

  it("says so when /find matches nothing", () => {
    let state = board([row("FIX-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "find missing") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const submitted = applyKey(state, { type: "enter" });
    expect(submitted.state.find).toBe("missing");
    expect(submitted.state.notice).toBe("no matches for missing");
  });

  it("toggles the RUN-band todo list with t or Ctrl-T", () => {
    const state = board([runningRow("LIVE-1")]);
    const opened = applyKey(state, { type: "char", value: "t" });
    expect(opened.state.planExpanded).toBe(true);
    expect(opened.effect).toBeUndefined();
    const closed = applyKey(opened.state, { type: "ctrl", value: "t" });
    expect(closed.state.planExpanded).toBe(false);
  });

  it("collapses the todo list when the selected row changes", () => {
    const state = { ...board([runningRow("LIVE-1"), runningRow("LIVE-2")]), planExpanded: true };
    const moved = applyKey(state, { type: "char", value: "j" });
    expect(moved.state.selected).toBe(1);
    expect(moved.state.planExpanded).toBe(false);
  });

  it("toggles the file list with f and collapses it when the row changes", () => {
    const state = board([runningRow("LIVE-1"), runningRow("LIVE-2")]);
    const opened = applyKey(state, { type: "char", value: "f" });
    expect(opened.state.filesExpanded).toBe(true);
    expect(opened.effect).toBeUndefined();
    const moved = applyKey(opened.state, { type: "char", value: "j" });
    expect(moved.state.selected).toBe(1);
    expect(moved.state.filesExpanded).toBe(false);
  });

  it("cycles older hunks with H and resets when the row changes", () => {
    const live1 = runningRow("LIVE-1");
    const live2 = runningRow("LIVE-2");
    const stack = [
      { file: "src/a.ts", lines: ["+ a"] },
      { file: "src/b.ts", lines: ["+ b"] },
    ];
    const state = {
      ...board([live1, live2]),
      childHunks: { "req-LIVE-1": stack, "req-LIVE-2": stack },
    };
    const older = applyKey(state, { type: "char", value: "H" });
    expect(older.state.hunkAt).toBe(1);
    expect(older.effect).toBeUndefined();
    const wrap = applyKey(older.state, { type: "char", value: "H" });
    expect(wrap.state.hunkAt).toBe(0);
    const moved = applyKey(older.state, { type: "char", value: "j" });
    expect(moved.state.selected).toBe(1);
    expect(moved.state.hunkAt).toBe(0);
  });

  it("toggles the last Read peek with e and collapses it when the row changes", () => {
    const state = board([runningRow("LIVE-1"), runningRow("LIVE-2")]);
    const opened = applyKey(state, { type: "char", value: "e" });
    expect(opened.state.peekExpanded).toBe(true);
    expect(opened.effect).toBeUndefined();
    const moved = applyKey(opened.state, { type: "char", value: "j" });
    expect(moved.state.selected).toBe(1);
    expect(moved.state.peekExpanded).toBe(false);
  });

  it("toggles the last hunk with h and collapses it when the row changes", () => {
    const state = board([runningRow("LIVE-1"), runningRow("LIVE-2")]);
    const opened = applyKey(state, { type: "char", value: "h" });
    expect(opened.state.hunksExpanded).toBe(true);
    expect(opened.effect).toBeUndefined();
    const moved = applyKey(opened.state, { type: "char", value: "j" });
    expect(moved.state.selected).toBe(1);
    expect(moved.state.hunksExpanded).toBe(false);
  });

  it("expands the hunk while an action is in flight, and does not dispatch", () => {
    const state = { ...board([runningRow("LIVE-1")]), busy: true };
    const opened = applyKey(state, { type: "char", value: "h" });
    expect(opened.state.hunksExpanded).toBe(true);
    expect(opened.effect).toBeUndefined();
  });

  it("trims the unselected request when the row changes", () => {
    let state = board([runningRow("LIVE-1"), runningRow("LIVE-2")]);
    for (let i = 0; i < ACTIVITY_CAP + 5; i += 1) {
      state = pushActivity(state, `early-${i}`, i, "req-LIVE-1");
    }
    expect(state.activity.filter((item) => item.requestId === "req-LIVE-1")).toHaveLength(
      ACTIVITY_CAP + 5,
    );
    const moved = applyKey(state, { type: "char", value: "j" });
    const trimmed = moved.state.activity.filter((item) => item.requestId === "req-LIVE-1");
    expect(trimmed).toHaveLength(ACTIVITY_CAP);
    expect(trimmed[0]?.text).toBe("early-5");
  });
});

describe("findMatches", () => {
  it("is case-insensitive and stays on the selected row's transcript", () => {
    const state = {
      ...board([runningRow("LIVE-1"), runningRow("LIVE-2")]),
      selected: 0,
      activity: [
        { at: 1, text: "tool · Write src/Alpha.ts", requestId: "req-LIVE-1" },
        { at: 2, text: "tool · Write src/beta.ts", requestId: "req-LIVE-2" },
      ],
      find: "alpha",
    };
    const hits = findMatches(state);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.itemIndex).toBe(0);
    expect(state.activity[0]!.text.slice(hits[0]!.start, hits[0]!.end)).toBe("Alpha");
    expect(findMatches({ ...state, find: "beta" })).toEqual([]);
    expect(findMatches({ ...state, selected: 1, find: "beta" })).toHaveLength(1);
  });
});

describe("rowAfterRefresh / applyStatus", () => {
  it("focuses an issue on first paint and does not snap back after the operator moves", () => {
    const live1 = row("LIVE-1");
    const live2 = row("LIVE-2");
    const focused = rowAfterRefresh({ ...emptyView("epic"), rows: [live1, live2] }, "LIVE-2");
    expect(focused.selected).toBe(1);

    const moved = { ...focused, selected: 0, scroll: 4 };
    const polled = applyStatus(moved, { rows: [live1, live2] }, 2);
    expect(polled.selected).toBe(0);
    expect(polled.scroll).toBe(4);
  });

  it("keeps the selected task when two rows share an issue", () => {
    const review: StatusRow = { ...row("FIX-1"), taskId: "FIX-1--review", phase: "review" };
    const implement = row("FIX-1");
    const looking = { ...emptyView("epic"), rows: [review, implement], selected: 1, scroll: 2 };
    const polled = applyStatus(looking, { rows: [review, implement] }, 3);
    expect(polled.selected).toBe(1);
    expect(polled.rows[polled.selected]?.taskId).toBe("FIX-1--implement");
    expect(polled.scroll).toBe(2);
  });
});
