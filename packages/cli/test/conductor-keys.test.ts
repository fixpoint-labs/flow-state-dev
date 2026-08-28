import { describe, expect, it } from "vitest";
import { applyKey, decodeKeys } from "../src/conductor/keys";
import { emptyView, type StatusRow, type ViewState } from "../src/conductor/types";

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

function board(rows: StatusRow[]): ViewState {
  return { ...emptyView("epic"), rows };
}

describe("decodeKeys", () => {
  it("decodes arrows, enter, and a paste of printable chars", () => {
    expect(decodeKeys("\x1b[A").keys).toEqual([{ type: "up" }]);
    expect(decodeKeys("\r").keys).toEqual([{ type: "enter" }]);
    expect(decodeKeys("ab").keys).toEqual([
      { type: "char", value: "a" },
      { type: "char", value: "b" },
    ]);
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

  it("dispatches slash commands from the prompt", () => {
    let state = board([row("FIX-1")]);
    state = applyKey(state, { type: "char", value: "/" }).state;
    for (const ch of "wake") {
      state = applyKey(state, { type: "char", value: ch }).state;
    }
    const submitted = applyKey(state, { type: "enter" });
    expect(submitted.effect).toEqual({ type: "dispatch", command: { kind: "wake" } });
  });

  it("does not move the board while an action is in flight", () => {
    const state = { ...board([row("FIX-1"), row("FIX-2")]), busy: true };
    const next = applyKey(state, { type: "char", value: "j" });
    expect(next.state.selected).toBe(0);
    expect(next.effect).toBeUndefined();
  });
});
