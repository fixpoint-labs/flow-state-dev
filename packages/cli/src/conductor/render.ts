/**
 * Paint one frame. Pure: view + size → string. The loop writes it; tests
 * assert on it. A frame that cannot be produced from a fixture is a frame
 * nobody can pin.
 */
import { HELP_TEXT } from "./parse";
import {
  ACCENT,
  BOLD,
  GOLD,
  INK,
  INK_3,
  MAUVE,
  SELECT_BG,
  TEAL,
  dim,
  formatClock,
  outcomeColor,
  pad,
  paint,
  statusColor,
  truncate,
  wrap,
} from "./theme";
import {
  selectedQuestion,
  selectedRow,
  type StatusQuestion,
  type StatusRow,
  type ViewState,
} from "./types";

const RULE = "─";

export interface FrameSize {
  cols: number;
  rows: number;
}

const MIN_COLS = 72;
const MIN_ROWS = 18;

export function renderFrame(state: ViewState, size: FrameSize): string {
  const cols = Math.max(size.cols, MIN_COLS);
  const rows = Math.max(size.rows, MIN_ROWS);
  if (state.help) return fit(renderHelp(cols), cols, rows);

  const header = renderHeader(state, cols);
  const table = renderTable(state, cols);
  const detail = renderDetail(state, cols);
  const activity = renderActivity(state, cols, 4);
  const prompt = renderPrompt(state, cols);
  const footer = renderFooter(state, cols);

  const chrome = 2; // header + footer rules live inside those helpers
  const used =
    lineCount(header) +
    lineCount(table) +
    lineCount(detail) +
    lineCount(activity) +
    lineCount(prompt) +
    lineCount(footer) +
    chrome;
  const filler = Math.max(0, rows - used);
  const gap = filler > 0 ? "\n".repeat(filler) : "";
  return fit([header, table, detail, activity, gap, prompt, footer].filter((s) => s !== "").join("\n"), cols, rows);
}

function renderHeader(state: ViewState, cols: number): string {
  const waiting = state.rows.filter((r) => r.questions.length > 0).length;
  const live = state.rows.filter((r) => r.status === "in_progress").length;
  const parts = [
    paint(BOLD + ACCENT, " FSDEV CONDUCTOR "),
    dim("·"),
    ` ${state.epicLabel} `,
    dim("·"),
    ` ${state.rows.length} row${state.rows.length === 1 ? "" : "s"} `,
  ];
  if (live > 0) parts.push(dim("·"), paint(ACCENT, ` ${live} running `));
  if (waiting > 0) parts.push(dim("·"), paint(MAUVE, ` ${waiting} waiting `));
  if (state.busy) parts.push(dim("·"), paint(GOLD, " working "));
  if (state.lastRefreshAt !== null) {
    parts.push(dim("·"), dim(` ${formatClock(state.lastRefreshAt)} `));
  }
  const left = parts.join("");
  return `${padLine(left, cols)}\n${rule(cols)}`;
}

function renderTable(state: ViewState, cols: number): string {
  const issueW = Math.max(12, Math.min(18, Math.floor(cols * 0.18)));
  const phaseW = 12;
  const statusW = 16;
  const attemptW = 8;
  const askW = 5;
  const outcomeW = Math.max(10, cols - issueW - phaseW - statusW - attemptW - askW - 10);
  const head =
    "  " +
    pad(dim("ISSUE"), issueW) +
    pad(dim("PHASE"), phaseW) +
    pad(dim("STATUS"), statusW) +
    pad(dim("ATTEMPT"), attemptW) +
    pad(dim("OUTCOME"), outcomeW) +
    pad(dim("ASK"), askW);
  if (state.rows.length === 0) {
    return `${head}\n${padLine(dim("  no rows. /seed <issue> files one and starts it."), cols)}`;
  }
  const lines = state.rows.map((row, i) =>
    renderTableRow(row, i === state.selected, { issueW, phaseW, statusW, attemptW, outcomeW, askW, cols }),
  );
  return [head, ...lines].join("\n");
}

function renderTableRow(
  row: StatusRow,
  selected: boolean,
  w: {
    issueW: number;
    phaseW: number;
    statusW: number;
    attemptW: number;
    outcomeW: number;
    askW: number;
    cols: number;
  },
): string {
  const mark = selected ? paint(ACCENT + BOLD, "▸ ") : "  ";
  const issue = pad(row.issue ?? "—", w.issueW);
  const phase = pad(row.phase ?? "—", w.phaseW);
  const status = pad(paint(statusColor(row.status), row.status), w.statusW);
  const attempt = pad(String(row.attempts), w.attemptW);
  const outcome = pad(paint(outcomeColor(row.run?.outcome ?? null), row.run?.outcome ?? "—"), w.outcomeW);
  const ask = pad(row.questions.length > 0 ? paint(MAUVE, String(row.questions.length)) : dim("·"), w.askW);
  const line = mark + issue + phase + status + attempt + outcome + ask;
  return selected ? paint(SELECT_BG, padLine(line, w.cols)) : padLine(line, w.cols);
}

function renderDetail(state: ViewState, cols: number): string {
  const row = selectedRow(state);
  const lines: string[] = [rule(cols, INK_3)];
  if (row === undefined) {
    lines.push(dim("  select a row to inspect it"));
    return lines.join("\n");
  }
  const title = `${row.issue ?? "?"} / ${row.phase ?? "?"}`;
  lines.push(` ${paint(BOLD + INK, title)}   ${paint(statusColor(row.status), row.status)}   ${dim(`attempt ${row.attempts}`)}`);
  if (row.run !== null) {
    const bits = [
      row.run.outcome !== null ? paint(outcomeColor(row.run.outcome), row.run.outcome) : dim("no outcome yet"),
    ];
    if (row.run.reason) bits.push(truncate(row.run.reason, Math.max(20, cols - 28)));
    lines.push(` ${dim("run")}      ${bits.join(dim(" · "))}`);
    if (row.run.workspacePath) lines.push(` ${dim("checkout")} ${truncate(row.run.workspacePath, cols - 12)}`);
    if (row.run.branch) lines.push(` ${dim("branch")}   ${row.run.branch}`);
    const cost: string[] = [];
    if (row.run.costUsd !== null) cost.push(`$${row.run.costUsd.toFixed(3)}`);
    if (row.run.usage !== null) {
      cost.push(`${fmtTokens(row.run.usage.inputTokens)} in / ${fmtTokens(row.run.usage.outputTokens)} out`);
    }
    if (cost.length > 0) lines.push(` ${dim("spend")}    ${cost.join(dim(" · "))}`);
    if (row.run.finalMessage) {
      for (const wrapped of wrap(row.run.finalMessage, cols - 4).slice(0, 3)) {
        lines.push(` ${dim("·")} ${wrapped}`);
      }
    }
  } else {
    lines.push(` ${dim("run")}      ${dim("no record yet")}`);
  }
  if (row.feedback) {
    lines.push(` ${dim("feedback")} ${truncate(row.feedback, cols - 12)}`);
  }

  const questions = row.questions;
  if (questions.length === 0) {
    lines.push(` ${dim("ask")}      ${dim("none open")}`);
    return lines.join("\n");
  }
  lines.push(` ${paint(MAUVE + BOLD, "QUESTIONS")}  ${dim("type to answer · [ ] to move")}`);
  questions.forEach((q, i) => {
    for (const cardLine of renderQuestionCard(q, i === state.questionIndex, cols)) {
      lines.push(cardLine);
    }
  });
  return lines.join("\n");
}

function renderQuestionCard(question: StatusQuestion, selected: boolean, cols: number): string[] {
  const inner = cols - 4;
  const id = truncate(question.question, inner - 2);
  const edge = selected ? MAUVE : INK_3;
  const top = paint(edge, ` ┌─ ${id} ${"─".repeat(Math.max(0, inner - id.length - 3))}┐`);
  const body = wrap(question.text, inner - 2).slice(0, 4);
  const mid = body.map((line) => paint(edge, " │ ") + (selected ? paint(INK, pad(line, inner - 2)) : dim(pad(line, inner - 2))) + paint(edge, " │"));
  const meta = dim(`attempt ${question.attempt}${question.askedAt !== null ? ` · ${formatClock(question.askedAt)}` : ""}`);
  const metaLine = paint(edge, " │ ") + pad(meta, inner - 2) + paint(edge, " │");
  const bot = paint(edge, ` └${"─".repeat(inner)}┘`);
  return [top, ...mid, metaLine, bot];
}

function renderActivity(state: ViewState, cols: number, max: number): string {
  if (state.activity.length === 0) return "";
  const tail = state.activity.slice(-max);
  const lines = [rule(cols, INK_3), ` ${dim("ACTIVITY")}`];
  for (const item of tail) {
    lines.push(` ${dim(formatClock(item.at))}  ${truncate(item.text, cols - 10)}`);
  }
  return lines.join("\n");
}

function renderPrompt(state: ViewState, cols: number): string {
  const notice = state.notice !== null ? `\n ${paint(GOLD, state.notice)}` : "";
  let prefix = paint(ACCENT, "❯ ");
  let placeholder = dim("/seed FIX-1   /wake   /answer <id> <text>");
  if (state.inputMode === "answer") {
    prefix = paint(MAUVE, "❯ answer ");
    placeholder = dim("type the reply · Enter sends · Esc cancels");
  } else if (state.inputMode === "seed") {
    prefix = paint(TEAL, "❯ seed ");
    placeholder = dim("issue id · Enter files and starts it");
  }
  const shown = state.input === "" && state.inputMode === "command" ? placeholder : state.input + paint(ACCENT, "█");
  return `${rule(cols)}\n ${prefix}${truncate(shown, cols - 12)}${notice}`;
}

function renderFooter(state: ViewState, cols: number): string {
  const q = selectedQuestion(state);
  const keys = q
    ? "click/j/k select  ·  a answer  ·  w wake  ·  / command  ·  r refresh  ·  ? help  ·  q quit"
    : "click/j/k select  ·  s seed  ·  w wake  ·  / command  ·  r refresh  ·  ? help  ·  q quit";
  return padLine(dim(` ${keys}`), cols);
}

function renderHelp(cols: number): string {
  const lines = [
    paint(BOLD + ACCENT, " CONDUCTOR "),
    dim("the operator surface · same verbs as the flow"),
    rule(cols),
    ...HELP_TEXT.split("\n").map((line) => (line.startsWith("  ") ? dim(line) : line)),
    "",
    dim(" any key returns to the board"),
  ];
  return lines.join("\n");
}

function rule(cols: number, color: string = INK_3): string {
  return paint(color, RULE.repeat(cols));
}

function padLine(text: string, cols: number): string {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  if (stripped.length >= cols) return text;
  return text + " ".repeat(cols - stripped.length);
}

function lineCount(block: string): number {
  if (block === "") return 0;
  return block.split("\n").length;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function fit(frame: string, cols: number, rows: number): string {
  const lines = frame.split("\n").slice(0, rows);
  while (lines.length < rows) lines.push(" ".repeat(cols));
  return lines.map((line) => padLine(line, cols)).join("\n");
}

/** Compact board for headless stdout. No alternate screen, no spinner. */
export function renderBoardPlain(rows: StatusRow[], json: boolean): string {
  if (json) return JSON.stringify({ rows }, null, 2);
  if (rows.length === 0) return "no rows\n";
  const lines = [
    pad("ISSUE", 16) + pad("PHASE", 12) + pad("STATUS", 18) + pad("ATTEMPT", 8) + pad("OUTCOME", 12) + "ASK",
  ];
  for (const row of rows) {
    lines.push(
      pad(row.issue ?? "—", 16) +
        pad(row.phase ?? "—", 12) +
        pad(row.status, 18) +
        pad(String(row.attempts), 8) +
        pad(row.run?.outcome ?? "—", 12) +
        (row.questions.length > 0 ? String(row.questions.length) : "·"),
    );
    for (const q of row.questions) {
      lines.push(`  ? ${q.question}`);
      for (const wrapped of wrap(q.text, 78)) {
        lines.push(`    ${wrapped}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function watchExitCode(rows: StatusRow[]): number {
  if (rows.length === 0) return 1;
  if (rows.some((r) => r.questions.length > 0)) return 2;
  if (rows.every((r) => r.status === "completed")) return 0;
  if (rows.some((r) => r.status === "errored" || r.status === "cancelled")) return 1;
  return 3;
}
