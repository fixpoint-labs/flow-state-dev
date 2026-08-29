/**
 * Key decoding and the TUI reducer.
 *
 * The loop is I/O. This file is the behaviour: given a view and a key, what
 * is the next view, and does anything need to be dispatched. While the
 * board is working, compose still updates the view; a new action is
 * `hold` so the loop can run it when the current one finishes. Tests
 * drive it without a terminal.
 */
import { COMPOSE_HISTORY_CAP } from "./compose-history";
import { parseCommand, slashPrefix, type ParseResult } from "./parse";
import { visibleTableWindow } from "./render";
import { slashMenu } from "./slash";
import {
  applyFindQuery,
  clampSelected,
  findMatches,
  pageTranscript,
  selectedQuestion,
  selectedQuestions,
  selectedRow,
  selectedRunningRequestId,
  boardHasRunning,
  STAY_WHILE_RUNNING,
  scrollTranscript,
  stepFind,
  stepHunk,
  trimActivity,
  rowNeedsYou,
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
  | { type: "pagedown" }
  | { type: "home" }
  | { type: "end" }
  | { type: "newline" }
  | { type: "paste"; value: string };

export type Effect =
  | { type: "dispatch"; command: OperatorCommand }
  | { type: "hold"; command: OperatorCommand }
  | { type: "quit" }
  | { type: "refresh" };

export interface KeyResult {
  state: ViewState;
  effect?: Effect;
}

/**
 * Decode a raw-mode stdin chunk into keys. A paste arrives as many printable
 * chars unless the terminal wrapped it in bracketed-paste CSI; an arrow is
 * one CSI sequence. Incomplete CSI at the end of a chunk is returned as
 * `rest` so the loop can prepend it to the next read.
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
      const next = input[i + 1]!;
      if (next === "\r" || next === "\n") {
        keys.push({ type: "newline" });
        i += 2;
        continue;
      }
      if (next === "O") {
        if (i + 2 >= input.length) return { keys, rest: input.slice(i) };
        if (input[i + 2] === "H") keys.push({ type: "home" });
        else if (input[i + 2] === "F") keys.push({ type: "end" });
        i += 3;
        continue;
      }
      if (next === "[") {
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
        if (input.startsWith("\x1b[200~", i)) {
          const start = i + 6;
          const end = input.indexOf("\x1b[201~", start);
          if (end < 0) return { keys, rest: input.slice(i) };
          keys.push({ type: "paste", value: normalizePaste(input.slice(start, end)) });
          i = end + 6;
          continue;
        }
        if (input.startsWith("\x1b[201~", i)) {
          i += 6;
          continue;
        }
        if (input.startsWith("\x1b[27;2;13~", i)) {
          keys.push({ type: "newline" });
          i += 11;
          continue;
        }
        if (input.startsWith("\x1b[13;2u", i)) {
          keys.push({ type: "newline" });
          i += 7;
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
        if (third === "H") {
          keys.push({ type: "home" });
          i += 3;
          continue;
        }
        if (third === "F") {
          keys.push({ type: "end" });
          i += 3;
          continue;
        }
        if (third === "1" || third === "3" || third === "4" || third === "5" || third === "6" || third === "7" || third === "8") {
          if (i + 3 >= input.length) return { keys, rest: input.slice(i) };
          if (input[i + 3] === "~") {
            if (third === "3") keys.push({ type: "backspace" });
            else if (third === "5") keys.push({ type: "pageup" });
            else if (third === "6") keys.push({ type: "pagedown" });
            else if (third === "1" || third === "7") keys.push({ type: "home" });
            else keys.push({ type: "end" });
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
    if (ch === "\r") {
      keys.push({ type: "enter" });
      i += 1;
      continue;
    }
    if (ch === "\n") {
      keys.push({ type: "newline" });
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

function normalizePaste(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function applyKey(state: ViewState, key: Key, now: number = Date.now()): KeyResult {
  const result = reduceKey(state, key, now);
  if (state.busy && result.effect?.type === "dispatch") {
    return {
      state: { ...result.state, notice: "queued — runs when this action finishes" },
      effect: { type: "hold", command: result.effect.command },
    };
  }
  return result;
}

function reduceKey(state: ViewState, key: Key, now: number): KeyResult {
  if (state.help && (key.type === "escape" || key.type === "char" || key.type === "enter" || key.type === "click")) {
    if (key.type === "char" && key.value === "?") {
      return { state: { ...state, help: false } };
    }
    return { state: { ...state, help: false } };
  }

  if (key.type === "ctrl" && key.value === "t") {
    return { state: { ...state, planExpanded: !state.planExpanded } };
  }
  if (key.type === "ctrl" && key.value === "c") {
    if (selectedRunningRequestId(state) !== undefined) {
      return { state, effect: { type: "dispatch", command: { kind: "abort" } } };
    }
    if (boardHasRunning(state.rows)) {
      return { state: { ...state, notice: STAY_WHILE_RUNNING } };
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
      return applyIdleChar(state, key.value, now);
    case "paste":
      return applyIdlePaste(state, key.value);
    case "click":
      return applyClick(state, key.row);
    case "newline":
    case "enter": {
      const question = selectedQuestion(state);
      if (question !== undefined) {
        return beginAnswer(state, question.question);
      }
      return { state };
    }
    case "escape":
      if (state.find !== null) {
        return { state: { ...state, find: null, findAt: 0, notice: null, help: false } };
      }
      return { state: { ...state, notice: null, help: false } };
    default:
      return { state };
  }
}

/**
 * On a waiting row, letters start the reply. `?` / `/` stay help and
 * slash; `[` `]` `{` `}` still walk questions and attention. `n` / `N`
 * still step an open find.
 */
const WAITING_ROW_BINDS = new Set(["?", "/", "[", "]", "{", "}"]);

function applyIdleChar(state: ViewState, value: string, now: number): KeyResult {
  if (state.find !== null && (value === "n" || value === "N")) {
    return { state: stepFind(state, value === "n" ? -1 : 1) };
  }
  if (selectedQuestion(state) !== undefined && !WAITING_ROW_BINDS.has(value)) {
    return idleFallback(state, value);
  }
  const running = selectedRunningRequestId(state) !== undefined;
  // Letters talk. Keep `s` as seed, `r` as refresh, `x` as abort on a
  // running row, and f/h/e/H as view toggles. Arrows move rows; /wake
  // /quit stay the verbs. Ctrl-T still expands the plan.
  if (
    /^[A-Za-z]$/.test(value) &&
    value !== "s" &&
    value !== "r" &&
    value !== "f" &&
    value !== "h" &&
    value !== "e" &&
    value !== "H" &&
    !(value === "x" && running)
  ) {
    return idleFallback(state, value);
  }
  switch (value) {
    case "[":
      return { state: moveQuestion(state, -1) };
    case "]":
      return { state: moveQuestion(state, 1) };
    case "?":
      return { state: { ...state, help: true } };
    case "f":
      return { state: { ...state, filesExpanded: !state.filesExpanded } };
    case "h":
      return { state: { ...state, hunksExpanded: !state.hunksExpanded } };
    case "e":
      return { state: { ...state, peekExpanded: !state.peekExpanded } };
    case "H":
      return { state: stepHunk(state, 1) };
    case "x":
      return { state, effect: { type: "dispatch", command: { kind: "abort" } } };
    case "{":
      return { state: moveAttention(state, -1, now) };
    case "}":
      return { state: moveAttention(state, 1, now) };
    case "s":
      return {
        state: {
          ...state,
          inputMode: "seed",
          input: "",
          caret: 0,
          notice: "issue id, then Ctrl-J and the ticket",
        },
      };
    case "r":
      return { state, effect: { type: "refresh" } };
    case "/":
      return { state: { ...state, input: "/", slashAt: 0, caret: 1, notice: null } };
    default:
      return idleFallback(state, value);
  }
}

function idleFallback(state: ViewState, value: string): KeyResult {
  if (value.trim() === "") return { state };
  // Typing on a row that asked something starts an answer. That is the
  // Grok-shaped door: you do not have to remember `a` or a slash verb.
  if (selectedQuestion(state) !== undefined) {
    const started = beginAnswer(state, selectedQuestion(state)!.question);
    return applyEditing(started.state, { type: "char", value });
  }
  return { state: withInput(state, value) };
}

function applyIdlePaste(state: ViewState, value: string): KeyResult {
  if (value === "") return { state };
  if (selectedQuestion(state) !== undefined) {
    const started = beginAnswer(state, selectedQuestion(state)!.question);
    return applyEditing(started.state, { type: "paste", value });
  }
  return { state: withInput(state, value) };
}

function applyEditing(state: ViewState, key: Key): KeyResult {
  if (state.inputMode === "find") return applyFindEdit(state, key);
  const menu = slashMenu(state);
  switch (key.type) {
    case "char":
      return { state: insertText(state, key.value) };
    case "newline":
      return { state: insertText(state, "\n") };
    case "paste":
      return { state: insertText(state, key.value) };
    case "home":
      return { state: { ...state, caret: lineBounds(state.input, state.caret).start } };
    case "end":
      return { state: { ...state, caret: lineBounds(state.input, state.caret).end } };
    case "ctrl":
      if (key.value === "a") {
        return { state: { ...state, caret: lineBounds(state.input, state.caret).start } };
      }
      if (key.value === "e") {
        return { state: { ...state, caret: lineBounds(state.input, state.caret).end } };
      }
      if (key.value === "j") return { state: insertText(state, "\n") };
      return { state };
    case "backspace":
      if (state.input === "") {
        return cancelEdit(state);
      }
      if (state.caret <= 0) return { state };
      return {
        state: {
          ...withInput(
            state,
            state.input.slice(0, state.caret - 1) + state.input.slice(state.caret),
            state.caret - 1,
          ),
          slashAt: 0,
          draftAt: null,
          draftHold: null,
        },
      };
    case "left":
      return { state: { ...state, caret: Math.max(0, state.caret - 1) } };
    case "right":
      return { state: { ...state, caret: Math.min(state.input.length, state.caret + 1) } };
    case "escape":
      return cancelEdit(state);
    case "tab":
      return completeSlash(state, false);
    case "enter":
      if (menu.length > 0 && slashPrefix(state.input) !== "") {
        return completeSlash(state, true);
      }
      return submitEdit(state);
    case "up":
      if (menu.length > 0) {
        return {
          state: { ...state, slashAt: (state.slashAt - 1 + menu.length) % menu.length },
        };
      }
      return { state: moveComposeLine(state, -1) ?? walkDraft(state, -1) };
    case "down":
      if (menu.length > 0) {
        return { state: { ...state, slashAt: (state.slashAt + 1) % menu.length } };
      }
      return { state: moveComposeLine(state, 1) ?? walkDraft(state, 1) };
    default:
      return { state };
  }
}

/**
 * Fill in the selected slash item. Tab leaves the line. Enter runs it
 * when the item needs no more typing.
 */
function completeSlash(state: ViewState, submit: boolean): KeyResult {
  const menu = slashMenu(state);
  if (menu.length === 0) {
    return submit ? submitEdit(state) : { state };
  }
  const at = Math.max(0, Math.min(state.slashAt, menu.length - 1));
  const item = menu[at]!;
  const next: ViewState = withInput({ ...state, slashAt: 0 }, item.fill);
  if (submit && !item.needsMore) return submitEdit(next);
  return { state: next };
}

function applyFindEdit(state: ViewState, key: Key): KeyResult {
  switch (key.type) {
    case "char": {
      const input = state.input + key.value;
      return { state: applyFindQuery(withInput(state, input), input) };
    }
    case "paste": {
      const input = state.input + key.value.replace(/\n/g, " ");
      return { state: applyFindQuery(withInput(state, input), input) };
    }
    case "backspace": {
      if (state.input === "") return clearFind(state);
      const input = state.input.slice(0, -1);
      return { state: applyFindQuery(withInput(state, input), input) };
    }
    case "escape":
      return clearFind(state);
    case "enter": {
      const hits = findMatches(state);
      return {
        state: {
          ...withInput(state, ""),
          inputMode: "command",
          notice:
            state.find !== null && hits.length === 0 ? `no matches for ${state.find}` : null,
        },
      };
    }
    default:
      return { state };
  }
}

function clearFind(state: ViewState): KeyResult {
  return {
    state: {
      ...withInput(state, ""),
      inputMode: "command",
      find: null,
      findAt: 0,
      notice: null,
    },
  };
}

function cancelEdit(state: ViewState): KeyResult {
  return {
    state: {
      ...withInput(state, ""),
      inputMode: "command",
      answering: null,
      slashAt: 0,
      notice: null,
      draftAt: null,
      draftHold: null,
    },
  };
}

function withInput(state: ViewState, input: string, caret: number = input.length): ViewState {
  return { ...state, input, caret: Math.max(0, Math.min(caret, input.length)) };
}

function insertText(state: ViewState, text: string): ViewState {
  if (text === "") return state;
  const input = state.input.slice(0, state.caret) + text + state.input.slice(state.caret);
  return {
    ...withInput(state, input, state.caret + text.length),
    slashAt: 0,
    draftAt: null,
    draftHold: null,
  };
}

function lineBounds(input: string, caret: number): { start: number; end: number; col: number } {
  const at = Math.max(0, Math.min(caret, input.length));
  const start = input.lastIndexOf("\n", at - 1) + 1;
  const nl = input.indexOf("\n", at);
  const end = nl < 0 ? input.length : nl;
  return { start, end, col: at - start };
}

/** Move the caret to the previous or next compose line. `null` means walk history instead. */
function moveComposeLine(state: ViewState, direction: -1 | 1): ViewState | null {
  const { start, end, col } = lineBounds(state.input, state.caret);
  if (direction < 0) {
    if (start === 0) return null;
    const prevEnd = start - 1;
    const prevStart = state.input.lastIndexOf("\n", prevEnd - 1) + 1;
    return { ...state, caret: prevStart + Math.min(col, prevEnd - prevStart) };
  }
  if (end === state.input.length) return null;
  const nextStart = end + 1;
  const nextNl = state.input.indexOf("\n", nextStart);
  const nextEnd = nextNl < 0 ? state.input.length : nextNl;
  return { ...state, caret: nextStart + Math.min(col, nextEnd - nextStart) };
}

const DRAFT_CAP = COMPOSE_HISTORY_CAP;

/** Keep a submitted compose line. Consecutive duplicates stay one entry. */
function rememberDraft(state: ViewState, text: string): ViewState {
  const line = text.trim();
  const reset: ViewState = { ...state, draftAt: null, draftHold: null };
  if (line === "") return reset;
  if (reset.drafts[reset.drafts.length - 1] === line) return reset;
  const drafts = [...reset.drafts, line];
  return {
    ...reset,
    drafts: drafts.length <= DRAFT_CAP ? drafts : drafts.slice(-DRAFT_CAP),
  };
}

/** ↑ older, ↓ newer. The first ↑ stashes the unsent line; past newest restores it. */
function walkDraft(state: ViewState, direction: -1 | 1): ViewState {
  if (state.drafts.length === 0) return state;
  if (state.draftAt === null) {
    if (direction === 1) return state;
    return withInput(
      {
        ...state,
        draftHold: state.input,
        draftAt: state.drafts.length - 1,
      },
      state.drafts[state.drafts.length - 1]!,
    );
  }
  const next = state.draftAt + direction;
  if (next < 0) return state;
  if (next >= state.drafts.length) {
    return withInput(
      { ...state, draftAt: null, draftHold: null },
      state.draftHold ?? "",
    );
  }
  return withInput({ ...state, draftAt: next }, state.drafts[next]!);
}

function submitEdit(state: ViewState): KeyResult {
  if (state.inputMode === "answer") {
    const text = state.input.trim();
    const question = state.answering;
    if (question === null || text === "") {
      return { state: { ...state, notice: "type a reply, or Esc to cancel" } };
    }
    return {
      state: {
        ...withInput(rememberDraft(state, text), ""),
        inputMode: "command",
        answering: null,
        notice: null,
      },
      effect: { type: "dispatch", command: { kind: "answer", question, text } },
    };
  }
  if (state.inputMode === "seed") {
    const lines = state.input.split("\n");
    const issue = (lines[0] ?? "").trim();
    const brief = lines.slice(1).join("\n").trim();
    if (issue === "") {
      return { state: { ...state, notice: "type an issue id, or Esc to cancel" } };
    }
    return {
      state: {
        ...withInput(rememberDraft(state, state.input.trim()), ""),
        inputMode: "command",
        notice: null,
      },
      effect: {
        type: "dispatch",
        command: { kind: "seed", issue, ...(brief !== "" ? { brief } : {}) },
      },
    };
  }

  const line = state.input.trim();
  if (line === "" || line === "/") {
    return { state: { ...withInput(state, ""), draftAt: null, draftHold: null } };
  }
  const parsed: ParseResult = parseCommand(line);
  if (!parsed.ok) {
    return { state: { ...withInput(state, ""), notice: parsed.message, draftAt: null, draftHold: null } };
  }
  const command = parsed.command;
  const remembered = command.kind === "find" ? state : rememberDraft(state, line);
  const cleared: ViewState = { ...withInput(remembered, ""), slashAt: 0, notice: null };
  if (command.kind === "help") return { state: { ...cleared, help: true } };
  if (command.kind === "quit") return { state: cleared, effect: { type: "quit" } };
  if (command.kind === "refresh") return { state: cleared, effect: { type: "refresh" } };
  if (command.kind === "find") {
    const query = command.query ?? "";
    if (query === "") {
      return {
        state: {
          ...cleared,
          inputMode: "find",
          input: "",
          notice: "type to search the transcript",
        },
      };
    }
    const next = applyFindQuery(cleared, query);
    const hits = findMatches(next);
    return {
      state: {
        ...next,
        notice: hits.length === 0 ? `no matches for ${query}` : null,
      },
    };
  }
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
  const jumped = trimActivity({
    ...next,
    scroll: 0,
    planExpanded: false,
    filesExpanded: false,
    hunksExpanded: false,
    peekExpanded: false,
    hunkAt: 0,
  });
  if (jumped.find === null) return jumped;
  return applyFindQuery(jumped, jumped.find);
}

function moveRow(state: ViewState, delta: number): ViewState {
  if (state.rows.length === 0) return state;
  return selectRow(state, state.selected + delta);
}

/** Next or previous row that asked, failed, or has gone silent. */
function moveAttention(state: ViewState, direction: 1 | -1, now: number): ViewState {
  const n = state.rows.length;
  if (n === 0) return state;
  const needsYou = (row: (typeof state.rows)[number]) => rowNeedsYou(row, state.activity, now);
  if (!state.rows.some(needsYou)) {
    return { ...state, notice: "nothing waiting, failed, or stalled" };
  }
  for (let step = 1; step <= n; step += 1) {
    const index = (((state.selected + direction * step) % n) + n) % n;
    if (needsYou(state.rows[index]!)) return selectRow(state, index);
  }
  return state;
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
      caret: 0,
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
  const { start, end } = visibleTableWindow(state.rows.length, state.selected);
  const index = screenRow1 - TABLE_DATA_ORIGIN + start;
  if (index < start || index >= end) return { state };
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
    const index = state.rows.findIndex(
      (row) => row.issue === preferIssue || row.taskId === preferIssue,
    );
    if (index >= 0) {
      if (index === state.selected) return clampSelected(state);
      return clampSelected({ ...state, selected: index, scroll: 0 });
    }
  }
  return clampSelected(state);
}
