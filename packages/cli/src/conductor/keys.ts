/**
 * Key decoding and the TUI reducer.
 *
 * The loop is I/O. This file is the behaviour: given a view and a key, what
 * is the next view, and does anything need to be dispatched. Tests drive it
 * without a terminal.
 */
import { parseCommand, type ParseResult } from "./parse";
import {
  clampSelected,
  pageTranscript,
  selectedQuestion,
  selectedQuestions,
  selectedRow,
  selectedRunningRequestId,
  scrollTranscript,
  type InputMode,
  type OperatorCommand,
  type ViewState,
} from "./types";

export type Key =
  | { type: "char"; value: string }
  | { type: "enter" }
  | { type: "escape" }
  | { type: "backspace" }
  | { type: "up" }
  | { type: "down" }
  | { type: "left" }
  | { type: "right" }
  | { type: "tab" }
  | { type: "ctrl"; value: string }
  | { type: "click"; col: number; row: number }
  | { type: "wheel"; delta: number }
  | { type: "pageup" }
  | { type: "pagedown" };

export type Effect =
  | { type: "dispatch"; command: OperatorCommand }
  | { type: "quit" }
  | { type: "refresh" };

export interface KeyResult {
  state: ViewState;
  effect?: Effect;
}

/**
 * Decode a raw-mode stdin chunk into keys. A paste arrives as many printable
 * chars; an arrow is one CSI sequence. Incomplete CSI at the end of a chunk
 * is returned as `rest` so the loop can prepend it to the next read.
 */
export function decodeKeys(chunk: string, pending = ""): { keys: Key[]; rest: string } {
  const input = pending + chunk;
  const keys: Key[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    const code = ch.charCodeAt(0);
    if (ch === "\x1b") {
      if (i + 1 >= input.length) return { keys, rest: input.slice(i) };
      if (input[i + 1] === "[") {
        if (i + 2 >= input.length) return { keys, rest: input.slice(i) };
        const third = input[i + 2];
        if (third === "<") {
          let j = i + 3;
          while (j < input.length && input[j] !== "M" && input[j] !== "m") j += 1;
          if (j >= input.length) return { keys, rest: input.slice(i) };
          const [btnRaw, colRaw, rowRaw] = input.slice(i + 3, j).split(";");
          const btn = Number(btnRaw);
          const col = Number(colRaw);
          const row = Number(rowRaw);
          i = j + 1;
          if (input[j] === "M" && Number.isFinite(btn) && Number.isFinite(col) && Number.isFinite(row)) {
            if (btn === 64) keys.push({ type: "wheel", delta: -1 });
            else if (btn === 65) keys.push({ type: "wheel", delta: 1 });
            else if (btn === 0) keys.push({ type: "click", col, row });
          }
          continue;
        }
        if (third === "A") {
          keys.push({ type: "up" });
          i += 3;
          continue;
        }
        if (third === "B") {
          keys.push({ type: "down" });
          i += 3;
          continue;
        }
        if (third === "C") {
          keys.push({ type: "right" });
          i += 3;
          continue;
        }
        if (third === "D") {
          keys.push({ type: "left" });
          i += 3;
          continue;
        }
        if (third === "3" || third === "5" || third === "6") {
          if (i + 3 >= input.length) return { keys, rest: input.slice(i) };
          if (input[i + 3] === "~") {
            if (third === "3") keys.push({ type: "backspace" });
            else if (third === "5") keys.push({ type: "pageup" });
            else keys.push({ type: "pagedown" });
            i += 4;
            continue;
          }
        }
        // Unknown CSI — drop the ESC and keep going.
        i += 1;
        continue;
      }
      keys.push({ type: "escape" });
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      keys.push({ type: "enter" });
      i += 1;
      continue;
    }
    if (ch === "\t") {
      keys.push({ type: "tab" });
      i += 1;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      keys.push({ type: "backspace" });
      i += 1;
      continue;
    }
    if (code < 32) {
      if (code >= 1 && code <= 26) {
        keys.push({ type: "ctrl", value: String.fromCharCode(code + 96) });
      }
      i += 1;
      continue;
    }
    keys.push({ type: "char", value: ch });
    i += 1;
  }
  return { keys, rest: "" };
}

export function applyKey(state: ViewState, key: Key): KeyResult {
  if (state.help && (key.type === "escape" || key.type === "char" || key.type === "enter" || key.type === "click")) {
    if (key.type === "char" && key.value === "?") {
      return { state: { ...state, help: false } };
    }
    return { state: { ...state, help: false } };
  }

  const scrolling =
    key.type === "wheel" ||
    key.type === "pageup" ||
    key.type === "pagedown" ||
    (key.type === "ctrl" && (key.value === "u" || key.value === "d"));
  if (state.busy && key.type !== "ctrl" && !scrolling) {
    return { state };
  }

  if (key.type === "ctrl" && key.value === "t") {
    return { state: { ...state, planExpanded: !state.planExpanded } };
  }
  if (key.type === "ctrl" && key.value === "c") {
    if (selectedRunningRequestId(state) !== undefined) {
      return { state, effect: { type: "dispatch", command: { kind: "abort" } } };
    }
    return { state, effect: { type: "quit" } };
  }
  if (key.type === "pageup" || (key.type === "ctrl" && key.value === "u")) {
    return { state: pageTranscript(state, 1) };
  }
  if (key.type === "pagedown" || (key.type === "ctrl" && key.value === "d")) {
    return { state: pageTranscript(state, -1) };
  }
  if (key.type === "wheel") {
    return { state: scrollTranscript(state, key.delta < 0 ? 1 : -1) };
  }

  if (state.inputMode !== "command") {
    return applyEditing(state, key);
  }

  if (state.input !== "") {
    return applyEditing(state, key);
  }

  switch (key.type) {
    case "up":
      return { state: moveRow(state, -1) };
    case "down":
      return { state: moveRow(state, 1) };
    case "left":
      return { state: moveQuestion(state, -1) };
    case "right":
      return { state: moveQuestion(state, 1) };
    case "char":
      return applyIdleChar(state, key.value);
    case "click":
      return applyClick(state, key.row);
    case "enter": {
      const question = selectedQuestion(state);
      if (question !== undefined) {
        return beginAnswer(state, question.question);
      }
      return { state };
    }
    case "escape":
      return { state: { ...state, notice: null, help: false } };
    default:
      return { state };
  }
}

function applyIdleChar(state: ViewState, value: string): KeyResult {
  switch (value) {
    case "j":
      return { state: moveRow(state, 1) };
    case "k":
      return { state: moveRow(state, -1) };
    case "[":
      return { state: moveQuestion(state, -1) };
    case "]":
      return { state: moveQuestion(state, 1) };
    case "q":
      return { state, effect: { type: "quit" } };
    case "?":
      return { state: { ...state, help: true } };
    case "r":
      return { state, effect: { type: "refresh" } };
    case "w":
      return { state, effect: { type: "dispatch", command: { kind: "wake" } } };
    case "t":
      return { state: { ...state, planExpanded: !state.planExpanded } };
    case "x":
      if (selectedRunningRequestId(state) === undefined) {
        return { state: { ...state, notice: "nothing running to stop" } };
      }
      return { state, effect: { type: "dispatch", command: { kind: "abort" } } };
    case "a": {
      const question = selectedQuestion(state);
      if (question === undefined) {
        return { state: { ...state, notice: "nothing to answer on this row" } };
      }
      return beginAnswer(state, question.question);
    }
    case "s":
      return { state: { ...state, inputMode: "seed", input: "", notice: "issue id, then Enter" } };
    case "/":
      return { state: { ...state, input: "/", notice: null } };
    default:
      if (value.trim() === "") return { state };
      // Typing on a row that asked something starts an answer. That is the
      // Grok-shaped door: you do not have to remember `a` or a slash verb.
      if (selectedQuestion(state) !== undefined) {
        const started = beginAnswer(state, selectedQuestion(state)!.question);
        return applyEditing(started.state, { type: "char", value });
      }
      return { state: { ...state, input: value } };
  }
}

function applyEditing(state: ViewState, key: Key): KeyResult {
  switch (key.type) {
    case "char":
      return { state: { ...state, input: state.input + key.value } };
    case "backspace":
      if (state.input === "") {
        return cancelEdit(state);
      }
      return { state: { ...state, input: state.input.slice(0, -1) } };
    case "escape":
      return cancelEdit(state);
    case "enter":
      return submitEdit(state);
    case "up":
    case "down":
      return { state };
    default:
      return { state };
  }
}

function cancelEdit(state: ViewState): KeyResult {
  return {
    state: {
      ...state,
      input: "",
      inputMode: "command",
      answering: null,
      notice: null,
    },
  };
}

function submitEdit(state: ViewState): KeyResult {
  if (state.inputMode === "answer") {
    const text = state.input.trim();
    const question = state.answering;
    if (question === null || text === "") {
      return { state: { ...state, notice: "type a reply, or Esc to cancel" } };
    }
    return {
      state: { ...state, input: "", inputMode: "command", answering: null, notice: null },
      effect: { type: "dispatch", command: { kind: "answer", question, text } },
    };
  }
  if (state.inputMode === "seed") {
    const issue = state.input.trim();
    if (issue === "") {
      return { state: { ...state, notice: "type an issue id, or Esc to cancel" } };
    }
    return {
      state: { ...state, input: "", inputMode: "command", notice: null },
      effect: { type: "dispatch", command: { kind: "seed", issue } },
    };
  }

  const line = state.input.trim();
  if (line === "" || line === "/") {
    return { state: { ...state, input: "" } };
  }
  const parsed: ParseResult = parseCommand(line);
  if (!parsed.ok) {
    return { state: { ...state, notice: parsed.message, input: "" } };
  }
  const command = parsed.command;
  const cleared: ViewState = { ...state, input: "", notice: null };
  if (command.kind === "help") return { state: { ...cleared, help: true } };
  if (command.kind === "quit") return { state: cleared, effect: { type: "quit" } };
  if (command.kind === "refresh") return { state: cleared, effect: { type: "refresh" } };
  if (command.kind === "status" || command.kind === "watch") {
    const issue = command.issue;
    if (issue === undefined || issue === "") {
      return { state: cleared, effect: { type: "refresh" } };
    }
    const index = rowIndexForIssue(state, issue);
    if (index < 0) {
      return {
        state: { ...cleared, notice: `no row for ${issue}` },
        effect: { type: "refresh" },
      };
    }
    return { state: selectRow(cleared, index), effect: { type: "refresh" } };
  }
  return { state: cleared, effect: { type: "dispatch", command } };
}

function rowIndexForIssue(state: ViewState, issue: string): number {
  const want = issue.toLowerCase();
  return state.rows.findIndex((row) => {
    if (row.taskId.toLowerCase() === want) return true;
    if (row.issue !== null && row.issue.toLowerCase() === want) return true;
    return false;
  });
}

function selectRow(state: ViewState, index: number): ViewState {
  const next = clampSelected({
    ...state,
    selected: index,
    questionIndex: 0,
    notice: null,
  });
  if (next.selected === state.selected) return next;
  return { ...next, scroll: 0 };
}

function moveRow(state: ViewState, delta: number): ViewState {
  if (state.rows.length === 0) return state;
  return selectRow(state, state.selected + delta);
}

function moveQuestion(state: ViewState, delta: number): ViewState {
  const questions = selectedQuestions(state);
  if (questions.length === 0) return state;
  const next = Math.max(0, Math.min(state.questionIndex + delta, questions.length - 1));
  return { ...state, questionIndex: next };
}

function beginAnswer(state: ViewState, question: string): KeyResult {
  return {
    state: {
      ...state,
      inputMode: "answer" satisfies InputMode,
      answering: question,
      input: "",
      notice: `answering ${question}`,
    },
  };
}

/**
 * 1-based screen row of the first table data row. The header is two lines
 * (title + rule), then the column labels. A click on that band selects.
 */
export const TABLE_DATA_ORIGIN = 4;

function applyClick(state: ViewState, screenRow1: number): KeyResult {
  if (state.inputMode !== "command" || state.input !== "") return { state };
  const index = screenRow1 - TABLE_DATA_ORIGIN;
  if (index < 0 || index >= state.rows.length) return { state };
  return { state: selectRow(state, index) };
}

/**
 * Keep the selected row across a board rewrite. A previous `taskId` wins —
 * that is the row the operator is looking at. `preferIssue` is only the
 * first-paint focus (`tui <issue>` / `start <issue>`).
 */
export function rowAfterRefresh(
  state: ViewState,
  preferIssue?: string | null,
  previousTaskId?: string,
): ViewState {
  if (previousTaskId !== undefined && previousTaskId !== "") {
    const index = state.rows.findIndex((row) => row.taskId === previousTaskId);
    if (index >= 0) {
      return clampSelected(index === state.selected ? state : { ...state, selected: index });
    }
  }
  if (preferIssue !== null && preferIssue !== undefined && preferIssue !== "") {
    const index = state.rows.findIndex((row) => row.issue === preferIssue);
    if (index >= 0) {
      if (index === state.selected) return clampSelected(state);
      return clampSelected({ ...state, selected: index, scroll: 0 });
    }
  }
  return clampSelected(state);
}
