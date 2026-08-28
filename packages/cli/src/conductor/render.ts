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
  RUST,
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
  failureReason,
  rowFailed,
  selectedFailure,
  selectedQuestion,
  selectedRow,
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
  const band = renderReservedBand(state, cols);
  const meta = state.busy ? "" : renderMeta(state, cols);
  const prompt = renderPrompt(state, cols);
  const footer = renderFooter(state, cols);
  const reserved =
    lineCount(header) +
    lineCount(table) +
    lineCount(band) +
    lineCount(meta) +
    lineCount(prompt) +
    lineCount(footer);
  const leftover = Math.max(4, rows - reserved);
  const activity = renderActivity(state, cols, leftover);

  return fit(
    [header, table, band, meta, activity, prompt, footer].filter((s) => s !== "").join("\n"),
    cols,
    rows,
  );
}

function renderHeader(state: ViewState, cols: number): string {
  const waiting = state.rows.filter((r) => r.questions.length > 0).length;
  const live = state.rows.filter((r) => r.status === "in_progress").length;
  const failed = state.rows.filter(rowFailed).length;
  const parts = [
    paint(BOLD + ACCENT, " FSDEV CONDUCTOR "),
    dim("·"),
    ` ${state.epicLabel} `,
    dim("·"),
    ` ${state.rows.length} row${state.rows.length === 1 ? "" : "s"} `,
  ];
  if (live > 0) parts.push(dim("·"), paint(ACCENT, ` ${live} running `));
  if (waiting > 0) parts.push(dim("·"), paint(MAUVE, ` ${waiting} waiting `));
  if (failed > 0) parts.push(dim("·"), paint(RUST, ` ${failed} failed `));
  if (state.busy) parts.push(dim("·"), paint(GOLD, " working "));
  if (state.lastRefreshAt !== null) {
    parts.push(dim("·"), dim(` ${formatClock(state.lastRefreshAt)} `));
  }
  const left = parts.join("");
  return `${padLine(left, cols)}\n${rule(cols)}`;
}

function renderTable(state: ViewState, cols: number): string {
  const issueW = Math.max(10, Math.min(16, Math.floor(cols * 0.16)));
  const phaseW = 12;
  const statusW = 16;
  const attemptW = 8;
  const chrome = 10;
  const rest = Math.max(22, cols - issueW - phaseW - statusW - attemptW - chrome);
  const askW = Math.max(12, Math.min(24, Math.floor(rest * 0.6)));
  const outcomeW = Math.max(10, rest - askW);
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
  const asked = row.questions[0]?.text;
  const ask = pad(
    asked !== undefined ? paint(MAUVE, truncate(asked, w.askW)) : dim("·"),
    w.askW,
  );
  const line = mark + issue + phase + status + attempt + outcome + ask;
  return selected ? paint(SELECT_BG, padLine(line, w.cols)) : padLine(line, w.cols);
}

/**
 * Reserved band for the thing a person can act on. Counted in `reserved`
 * so a long transcript cannot cap it away. An open question wins; a failed
 * attempt is next.
 */
function renderReservedBand(state: ViewState, cols: number): string {
  const ask = renderAskBand(state, cols);
  if (ask !== "") return ask;
  return renderFailBand(state, cols);
}

function renderAskBand(state: ViewState, cols: number): string {
  const question = selectedQuestion(state);
  if (question === undefined) return "";
  const more = selectedRow(state)?.questions.length ?? 0;
  const inner = Math.max(20, cols - 8);
  const body = wrap(question.text, inner).slice(0, 3);
  const hint =
    more > 1
      ? `${question.question}  ·  ${state.questionIndex + 1}/${more}  ·  type to answer`
      : `${question.question}  ·  type to answer`;
  return [
    rule(cols, MAUVE),
    ` ${paint(MAUVE + BOLD, "ASK")}`,
    ...body.map((line) => ` ${paint(BOLD + INK, line)}`),
    ` ${dim(hint)}`,
    rule(cols, MAUVE),
  ].join("\n");
}

function renderFailBand(state: ViewState, cols: number): string {
  const failure = selectedFailure(state);
  if (failure === undefined) return "";
  const row = selectedRow(state);
  const inner = Math.max(20, cols - 8);
  const body = wrap(failure.reason, inner).slice(0, 4);
  const hint = `${row?.issue ?? row?.taskId ?? "row"}  ·  w retries`;
  return [
    rule(cols, RUST),
    ` ${paint(RUST + BOLD, "FAIL")}`,
    ...body.map((line) => ` ${paint(BOLD + INK, line)}`),
    ` ${dim(hint)}`,
    rule(cols, RUST),
  ].join("\n");
}

function renderMeta(state: ViewState, cols: number): string {
  const row = selectedRow(state);
  if (row === undefined) {
    return `${rule(cols, INK_3)}\n${dim("  select a row to inspect it")}`;
  }
  if (selectedQuestion(state) !== undefined || selectedFailure(state) !== undefined) {
    return renderRunBits(row, cols);
  }
  const title = `${row.issue ?? "?"} / ${row.phase ?? "?"}`;
  const lines = [
    rule(cols, INK_3),
    ` ${paint(BOLD + INK, title)}   ${paint(statusColor(row.status), row.status)}   ${dim(`attempt ${row.attempts}`)}`,
    ` ${dim("ask")}      ${dim("none open")}`,
  ];
  const run = renderRunBits(row, cols);
  return run === "" ? lines.join("\n") : `${lines.join("\n")}\n${run}`;
}

function renderRunBits(row: StatusRow, cols: number): string {
  const lines: string[] = [];
  if (row.run !== null) {
    const bits = [
      row.run.outcome !== null ? paint(outcomeColor(row.run.outcome), row.run.outcome) : dim("no outcome yet"),
    ];
    if (row.run.reason) bits.push(truncate(row.run.reason, Math.max(20, cols - 28)));
    if (row.run.workspacePath) bits.push(truncate(row.run.workspacePath, 24));
    if (row.run.costUsd !== null) bits.push(`$${row.run.costUsd.toFixed(3)}`);
    lines.push(` ${dim("run")}      ${bits.join(dim(" · "))}`);
    if (row.run.finalMessage) {
      for (const wrapped of wrap(row.run.finalMessage, cols - 4).slice(0, 2)) {
        lines.push(` ${dim("·")} ${wrapped}`);
      }
    }
  }
  if (row.feedback) {
    lines.push(` ${dim("feedback")} ${truncate(row.feedback, cols - 12)}`);
  }
  return lines.join("\n");
}

function renderActivity(state: ViewState, cols: number, height: number): string {
  const following = state.scroll === 0;
  const heading = ` ${dim("TRANSCRIPT")}${
    following
      ? state.live !== null
        ? dim("  ·  live")
        : dim("  ·  follow")
      : dim(`  ·  ${state.scroll} back`)
  }`;
  const width = Math.max(16, cols - 10);
  const body: string[] = [];
  for (const item of state.activity) {
    const wrapped = wrap(item.text, width);
    wrapped.forEach((line, i) => {
      body.push(i === 0 ? ` ${dim(formatClock(item.at))}  ${line}` : `         ${line}`);
    });
  }
  if (following && state.live !== null) {
    const wrapped = wrap(state.live, width);
    wrapped.forEach((line, i) => {
      body.push(i === 0 ? ` ${paint(GOLD, "··")}  ${paint(GOLD, line)}` : `         ${paint(GOLD, line)}`);
    });
  }
  const window = height - 2;
  if (window <= 0) return `${rule(cols, INK_3)}\n${heading}`;
  const maxScroll = Math.max(0, body.length - window);
  const scroll = Math.min(state.scroll, maxScroll);
  const start = Math.max(0, body.length - window - scroll);
  const visible = body.slice(start, start + window);
  const pad = Math.max(0, window - visible.length);
  const filler =
    pad > 0 && visible.length === 0
      ? [` ${dim("nothing yet. a wake writes here as it runs.")}`, ...Array.from({ length: pad - 1 }, () => "")]
      : Array.from({ length: pad }, () => "");
  return [rule(cols, INK_3), heading, ...filler, ...visible].join("\n");
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
  const fail = selectedFailure(state);
  const keys = q
    ? "click/j/k select  ·  a answer  ·  PgUp transcript  ·  w wake  ·  /  ·  ?  ·  q"
    : fail !== undefined
      ? "click/j/k select  ·  w retry  ·  PgUp transcript  ·  s seed  ·  /  ·  ?  ·  q"
      : "click/j/k select  ·  s seed  ·  PgUp transcript  ·  w wake  ·  /  ·  ?  ·  q";
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
        (row.questions[0] !== undefined ? truncate(row.questions[0].text, 16) : "·"),
    );
    for (const q of row.questions) {
      lines.push(`  ? ${q.question}`);
      for (const wrapped of wrap(q.text, 78)) {
        lines.push(`    ${wrapped}`);
      }
    }
    if (rowFailed(row) && row.questions.length === 0) {
      lines.push(`  ! failed`);
      for (const wrapped of wrap(failureReason(row), 78)) {
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
  if (rows.some(rowFailed)) return 1;
  return 3;
}
