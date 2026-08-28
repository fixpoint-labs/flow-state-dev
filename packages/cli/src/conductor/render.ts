/**
 * Paint one frame. Pure: view + size → string. The loop writes it; tests
 * assert on it. A frame that cannot be produced from a fixture is a frame
 * nobody can pin.
 */
import { HELP_TEXT } from "./parse";
import { slashMenu } from "./slash";
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
  fileHref,
  fileText,
  formatClock,
  link,
  outcomeColor,
  pad,
  paint,
  shorten,
  shortenToolLine,
  statusColor,
  truncate,
  visibleWidth,
  wrap,
} from "./theme";
import {
  activityForView,
  currentFindHit,
  failureReason,
  findMatches,
  rowFailed,
  rowRunning,
  selectedFailure,
  currentPlanItem,
  fileFromToolLine,
  selectedFiles,
  selectedHunk,
  selectedNow,
  selectedPlan,
  selectedQuestion,
  selectedRow,
  selectedRequestId,
  selectedRunningRequestId,
  transcriptBody,
  visibleLive,
  type StatusRow,
  type ViewState,
} from "./types";

/** Visible URL, shortened; OSC-8 so a supporting terminal can open the full one. */
function prText(url: string, width: number): string {
  return link(url, shorten(url, width));
}

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
  const meta = state.busy || runBandOpen(state) ? "" : renderMeta(state, cols);
  const menu = renderSlashMenu(state, cols);
  const prompt = renderPrompt(state, cols);
  const footer = renderFooter(state, cols);
  const reserved =
    lineCount(header) +
    lineCount(table) +
    lineCount(band) +
    lineCount(meta) +
    lineCount(menu) +
    lineCount(prompt) +
    lineCount(footer);
  const leftover = Math.max(4, rows - reserved);
  const activity = renderActivity(state, cols, leftover, band !== "");

  return fit(
    [header, table, band, meta, activity, menu, prompt, footer].filter((s) => s !== "").join("\n"),
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
  const fail = renderFailBand(state, cols);
  if (fail !== "") return fail;
  return renderRunBand(state, cols);
}

function renderAskBand(state: ViewState, cols: number): string {
  const question = selectedQuestion(state);
  if (question === undefined) return "";
  const more = selectedRow(state)?.questions.length ?? 0;
  const inner = Math.max(20, cols - 8);
  const body = wrap(question.text, inner).slice(0, 3);
  const hint = [
    question.question,
    more > 1 ? `${state.questionIndex + 1}/${more}` : undefined,
    ...renderUsageBits(selectedRow(state)),
    "type to answer",
  ]
    .filter((bit) => bit !== undefined && bit !== "")
    .join("  ·  ");
  return [
    rule(cols, MAUVE),
    ` ${paint(MAUVE + BOLD, "ASK")}`,
    ...body.map((line) => ` ${paint(BOLD + INK, line)}`),
    ` ${dim(hint)}`,
    ...renderAttemptStrip(state, inner),
    rule(cols, MAUVE),
  ].join("\n");
}

/**
 * Compact "what that attempt was doing" — PR, last tool, files, last
 * hunk, current todo. ASK and FAIL keep this on the reserved band so it
 * still shows when inspect is hidden (busy, or a tall transcript).
 */
function renderAttemptStrip(state: ViewState, inner: number): string[] {
  const lines: string[] = [];
  const prUrl = selectedRow(state)?.run?.prUrl;
  if (prUrl) lines.push(` ${dim(prText(prUrl, inner))}`);
  const now = selectedNow(state);
  if (now !== undefined && now !== "") {
    const cwd = selectedRow(state)?.run?.workspacePath ?? null;
    lines.push(` ${dim(paintToolNow(now, inner, cwd))}`);
  }
  lines.push(...renderFileLines(state, inner));
  lines.push(...renderHunkLines(state, inner, { onlyCurrent: true }));
  lines.push(...renderPlanLines(state, inner, { onlyCurrent: true }));
  return lines;
}

function renderFailBand(state: ViewState, cols: number): string {
  const failure = selectedFailure(state);
  if (failure === undefined) return "";
  const row = selectedRow(state);
  const inner = Math.max(20, cols - 8);
  const body = wrap(failure.reason, inner).slice(0, 4);
  const id = selectedRequestId(state);
  const hint = [
    row?.issue ?? row?.taskId ?? "row",
    id,
    ...renderUsageBits(row),
    "w retries",
  ]
    .filter((bit) => bit !== undefined && bit !== "")
    .join("  ·  ");
  return [
    rule(cols, RUST),
    ` ${paint(RUST + BOLD, "FAIL")}`,
    ...body.map((line) => ` ${paint(BOLD + INK, line)}`),
    ` ${dim(hint)}`,
    ...renderAttemptStrip(state, inner),
    rule(cols, RUST),
  ].join("\n");
}

function renderRunBand(state: ViewState, cols: number): string {
  const row = selectedRow(state);
  if (row === undefined || !rowRunning(row)) return "";
  const inner = Math.max(20, cols - 8);
  const branch = row.run?.branch;
  const tree = row.run?.workspacePath;
  const id = selectedRunningRequestId(state);
  const body: string[] = [];
  if (branch) body.push(truncate(branch, inner));
  if (tree) body.push(fileText(tree, inner));
  const hintBits = [
    ...renderUsageBits(row),
    id !== undefined ? `${id}  ·  x stops` : "no request id yet",
  ];
  if (row.run?.prUrl) body.push(prText(row.run.prUrl, inner));
  const hint = hintBits.join("  ·  ");
  const now = selectedNow(state);
  const nowLine =
    now !== undefined && now !== ""
      ? ` ${paint(GOLD, paintToolNow(now, inner, tree ?? null))}`
      : "";
  const fileLines = renderFileLines(state, inner);
  const hunkLines = renderHunkLines(state, inner);
  const planLines = renderPlanLines(state, inner);
  return [
    rule(cols, ACCENT),
    ` ${paint(ACCENT + BOLD, "RUN")}`,
    ...body.map((line) => ` ${paint(BOLD + INK, line)}`),
    ` ${dim(hint)}`,
    ...(nowLine !== "" ? [nowLine] : []),
    ...fileLines,
    ...hunkLines,
    ...planLines,
    rule(cols, ACCENT),
  ].join("\n");
}

const FILE_MAX = 3;
const FILE_EXPANDED_MAX = 12;
const HUNK_BAND_MAX = 3;
const HUNK_EXPANDED_MAX = 16;

function renderFileLines(state: ViewState, inner: number): string[] {
  const files = selectedFiles(state);
  if (files.length === 0) return [];
  const cap = state.filesExpanded ? FILE_EXPANDED_MAX : FILE_MAX;
  const shown = files.slice(-cap);
  const hidden = files.length - shown.length;
  const cwd = selectedRow(state)?.run?.workspacePath ?? null;
  const lines = shown.map((file) => ` ${dim(fileText(file, inner, cwd))}`);
  if (hidden > 0) lines.unshift(` ${dim(`… ${hidden} more`)}`);
  return lines;
}

function renderHunkLines(
  state: ViewState,
  inner: number,
  opts: { onlyCurrent?: boolean } = {},
): string[] {
  const hunk = selectedHunk(state);
  if (hunk.length === 0) return [];
  const cap = opts.onlyCurrent === true || !state.hunksExpanded ? HUNK_BAND_MAX : HUNK_EXPANDED_MAX;
  const shown = hunk.slice(-cap);
  const hidden = hunk.length - shown.length;
  const lines = shown.map((line) => {
    const clipped = shorten(line, inner);
    if (line.startsWith("+ ")) return ` ${paint(TEAL, clipped)}`;
    if (line.startsWith("- ")) return ` ${paint(RUST, clipped)}`;
    return ` ${dim(clipped)}`;
  });
  if (hidden > 0) lines.unshift(` ${dim(`… ${hidden} more`)}`);
  return lines;
}

function renderPlanLines(
  state: ViewState,
  inner: number,
  opts: { onlyCurrent?: boolean } = {},
): string[] {
  const plan = selectedPlan(state);
  if (plan.length === 0) return [];
  if (opts.onlyCurrent === true || !state.planExpanded) {
    const current = currentPlanItem(plan);
    if (current === undefined) return [];
    const done = plan.filter((item) => item.mark === "x").length;
    const mark = `[${current.mark}]`;
    const label = truncate(current.text, Math.max(12, inner - 10));
    const count = dim(`${done}/${plan.length}`);
    const painted =
      current.mark === "·"
        ? `${paint(GOLD, mark)} ${paint(BOLD + INK, label)}`
        : current.mark === "x"
          ? `${paint(TEAL, mark)} ${dim(label)}`
          : `${dim(mark)} ${dim(label)}`;
    return [` ${painted}  ${count}`];
  }
  const shown = plan.slice(0, 4);
  const lines = shown.map((item) => {
    const mark = `[${item.mark}]`;
    const label = truncate(item.text, inner);
    if (item.mark === "·") return ` ${paint(GOLD, mark)} ${paint(BOLD + INK, label)}`;
    if (item.mark === "x") return ` ${paint(TEAL, mark)} ${dim(label)}`;
    return ` ${dim(mark)} ${dim(label)}`;
  });
  if (plan.length > shown.length) {
    lines.push(` ${dim(`… ${plan.length - shown.length} more`)}`);
  }
  return lines;
}

function renderMeta(state: ViewState, cols: number): string {
  const row = selectedRow(state);
  if (row === undefined) {
    return `${rule(cols, INK_3)}\n${dim("  select a row to inspect it")}`;
  }
  if (selectedQuestion(state) !== undefined) {
    return renderRunBits(row, cols);
  }
  if (selectedFailure(state) !== undefined) {
    return renderRunBits(row, cols, { omitReason: true });
  }
  const title = `${row.issue ?? "?"} / ${row.phase ?? "?"}`;
  const lines = [
    rule(cols, INK_3),
    ` ${paint(BOLD + INK, title)}   ${paint(statusColor(row.status), row.status)}   ${dim(`attempt ${row.attempts}`)}`,
    ` ${dim("ask")}      ${dim("none open")}`,
  ];
  const run = renderRunBits(row, cols);
  return joinBlocks(lines.join("\n"), run, renderSelectedSummary(state, cols));
}

function renderRunBits(row: StatusRow, cols: number, opts: { omitReason?: boolean } = {}): string {
  const lines: string[] = [];
  if (row.run !== null) {
    const bits = [
      row.run.outcome !== null ? paint(outcomeColor(row.run.outcome), row.run.outcome) : dim("no outcome yet"),
    ];
    if (row.run.reason && !opts.omitReason) bits.push(truncate(row.run.reason, Math.max(20, cols - 28)));
    if (row.run.usage !== null) {
      bits.push(`${fmtTokens(row.run.usage.inputTokens)}→${fmtTokens(row.run.usage.outputTokens)}`);
    }
    if (row.run.costUsd !== null) bits.push(`$${row.run.costUsd.toFixed(3)}`);
    lines.push(` ${dim("run")}      ${bits.join(dim(" · "))}`);
    if (row.run.branch) {
      lines.push(` ${dim("branch")}   ${truncate(row.run.branch, cols - 12)}`);
    }
    if (row.run.workspacePath) {
      lines.push(` ${dim("tree")}     ${fileText(row.run.workspacePath, cols - 12)}`);
    }
    if (row.run.prUrl) {
      lines.push(` ${dim("pr")}       ${prText(row.run.prUrl, cols - 12)}`);
    }
    if (row.run.sessionId) {
      lines.push(` ${dim("session")}  ${truncate(row.run.sessionId, cols - 12)}`);
    }
    if (row.run.childSessionId) {
      lines.push(` ${dim("child")}    ${truncate(row.run.childSessionId, cols - 12)}`);
    }
    if (row.run.finalMessage && !opts.omitReason) {
      for (const wrapped of wrap(row.run.finalMessage, cols - 4).slice(0, 2)) {
        lines.push(` ${dim("·")} ${wrapped}`);
      }
    }
  }
  if (row.feedback && !opts.omitReason) {
    lines.push(` ${dim("feedback")} ${truncate(row.feedback, cols - 12)}`);
  }
  return lines.join("\n");
}

/**
 * What the selected attempt did — files, plan, last tool, request id.
 * The RUN band already holds these while the row is in flight; after
 * it settles they stay here so the board still shows that attempt.
 */
function renderSelectedSummary(state: ViewState, cols: number): string {
  if (selectedRequestId(state) === undefined) return "";
  const inner = Math.max(20, cols - 8);
  const lines: string[] = [];
  const id = selectedRequestId(state);
  if (id !== undefined) lines.push(` ${dim("request")}  ${id}`);
  const run = selectedRow(state)?.run;
  if (run?.sessionId) lines.push(` ${dim("session")}  ${truncate(run.sessionId, inner)}`);
  if (run?.childSessionId) lines.push(` ${dim("child")}    ${truncate(run.childSessionId, inner)}`);
  const prUrl = run?.prUrl;
  if (prUrl) lines.push(` ${dim("pr")}       ${prText(prUrl, inner)}`);
  const now = selectedNow(state);
  if (now !== undefined && now !== "") {
    lines.push(` ${dim("last")}     ${paintToolNow(now, inner, run?.workspacePath ?? null)}`);
  }
  lines.push(...renderFileLines(state, inner));
  lines.push(...renderHunkLines(state, inner));
  lines.push(...renderPlanLines(state, inner));
  return lines.join("\n");
}

function joinBlocks(...blocks: string[]): string {
  return blocks.filter((block) => block !== "").join("\n");
}

function renderActivity(
  state: ViewState,
  cols: number,
  height: number,
  underBand = false,
): string {
  const following = state.scroll === 0;
  const live = visibleLive(state);
  const hits = findMatches(state);
  const currentHit = currentFindHit(state);
  const finding = state.find !== null && state.find !== "";
  const heading = ` ${dim("TRANSCRIPT")}${
    finding
      ? hits.length === 0
        ? dim(`  ·  find · "${state.find}"  no matches`)
        : dim(`  ·  find · "${state.find}"  ${(Math.min(Math.max(0, state.findAt), hits.length - 1) + 1)}/${hits.length}`)
      : following
        ? live !== null
          ? dim("  ·  live")
          : dim("  ·  follow")
        : dim(`  ·  ${state.scroll} back`)
  }`;
  const width = Math.max(16, cols - 10);
  const cwd = selectedRow(state)?.run?.workspacePath ?? null;
  const body: { text: string; itemIndex: number | null }[] = [];
  activityForView(state).forEach((item, itemIndex) => {
    const wrapped = wrapActivityLine(item.text, width);
    const current = currentHit?.itemIndex === itemIndex;
    wrapped.forEach((line, i) => {
      const painted = linkFileLine(
        item.text,
        finding ? highlightFind(line, state.find!, current) : paintHunkLine(line),
        cwd,
      );
      const clock = current && i === 0 ? paint(GOLD, formatClock(item.at)) : dim(formatClock(item.at));
      body.push({
        text: i === 0 ? ` ${clock}  ${painted}` : `         ${painted}`,
        itemIndex,
      });
    });
  });
  const lastText = activityForView(state).at(-1)?.text;
  if (following && !finding && live !== null && live !== lastText) {
    const wrapped = wrapActivityLine(live, width);
    wrapped.forEach((line, i) => {
      const painted = linkFileLine(live, paint(GOLD, line), cwd);
      body.push({
        text: i === 0 ? ` ${paint(GOLD, "··")}  ${painted}` : `         ${painted}`,
        itemIndex: null,
      });
    });
  }
  const chrome = underBand ? 1 : 2;
  const window = height - chrome;
  if (window <= 0) {
    return underBand ? heading : `${rule(cols, INK_3)}\n${heading}`;
  }
  const lines = body.map((row) => row.text);
  const maxScroll = Math.max(0, lines.length - window);
  let scroll = Math.min(state.scroll, maxScroll);
  if (finding && currentHit !== undefined) {
    const pin = body.findIndex((row) => row.itemIndex === currentHit.itemIndex);
    if (pin >= 0) {
      const start = Math.max(
        0,
        Math.min(pin - Math.floor((window - 1) / 2), Math.max(0, lines.length - window)),
      );
      scroll = Math.max(0, lines.length - window - start);
    }
  }
  const start = Math.max(0, lines.length - window - scroll);
  const visible = lines.slice(start, start + window);
  const pad = Math.max(0, window - visible.length);
  const filler =
    pad > 0 && visible.length === 0
      ? [` ${dim("nothing yet. a wake writes here as it runs.")}`, ...Array.from({ length: pad - 1 }, () => "")]
      : Array.from({ length: pad }, () => "");
  const top = underBand ? [] : [rule(cols, INK_3)];
  return [...top, heading, ...filler, ...visible].join("\n");
}

const SLASH_MENU_MAX = 6;

function renderSlashMenu(state: ViewState, cols: number): string {
  if (state.inputMode !== "command") return "";
  const menu = slashMenu(state);
  if (menu.length === 0) return "";
  const at = Math.max(0, Math.min(state.slashAt, menu.length - 1));
  const start = Math.max(
    0,
    Math.min(at - Math.floor((SLASH_MENU_MAX - 1) / 2), Math.max(0, menu.length - SLASH_MENU_MAX)),
  );
  const shown = menu.slice(start, start + SLASH_MENU_MAX);
  const inner = Math.max(16, cols - 4);
  const lines = shown.map((item, i) => {
    const index = start + i;
    const body = truncate(`${item.label}  ${item.hint}`, inner);
    const line = ` ${body}`;
    return index === at ? paint(SELECT_BG + BOLD + GOLD, padLine(line, cols)) : dim(padLine(line, cols));
  });
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
  } else if (state.inputMode === "find") {
    prefix = paint(GOLD, "❯ find ");
    placeholder = dim("text in this row's transcript · Enter keeps · Esc clears");
  }
  const shown = state.input === "" && state.inputMode === "command" ? placeholder : state.input + paint(ACCENT, "█");
  return `${rule(cols)}\n ${prefix}${truncate(shown, cols - 12)}${notice}`;
}

function renderFooter(state: ViewState, cols: number): string {
  const q = selectedQuestion(state);
  const fail = selectedFailure(state);
  const running = selectedRunningRequestId(state) !== undefined;
  const finding = state.find !== null;
  const slashing = state.inputMode === "command" && slashMenu(state).length > 0;
  const listed = selectedPlan(state).length > 0;
  const moreFiles = selectedFiles(state).length > FILE_MAX;
  const moreHunks = selectedHunk(state).length > HUNK_BAND_MAX;
  const filesKey = moreFiles ? "  ·  f files" : "";
  const hunksKey = moreHunks && q === undefined ? "  ·  h hunk" : "";
  const keys = slashing
    ? "Tab complete  ·  ↑/↓ choose  ·  Enter  ·  Esc"
    : finding
    ? "n older  ·  N newer  ·  Esc clear  ·  /find  ·  j/k  ·  ?  ·  q"
    : q
      ? `click/j/k  ·  a answer${filesKey}  ·  /find  ·  r  ·  w  ·  /  ·  ?  ·  q`
      : fail !== undefined
        ? listed
          ? `click/j/k  ·  w retry  ·  t list${filesKey}${hunksKey}  ·  /find  ·  r  ·  /  ·  ?  ·  q`
          : `click/j/k  ·  w retry${filesKey}${hunksKey}  ·  /find  ·  r  ·  s seed  ·  /  ·  ?  ·  q`
        : running
          ? `click/j/k  ·  x stop  ·  t list${filesKey}${hunksKey}  ·  /find  ·  r  ·  w  ·  /  ·  ?  ·  q`
          : listed
            ? `click/j/k  ·  t list${filesKey}${hunksKey}  ·  /find  ·  r  ·  w  ·  /  ·  ?  ·  q`
            : `click/j/k  ·  s seed${filesKey}${hunksKey}  ·  /find  ·  r  ·  w  ·  /  ·  ?  ·  q`;
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
  const visible = visibleWidth(text);
  if (visible >= cols) return text;
  return text + " ".repeat(cols - visible);
}

/** OSC-8 on a Write / Edit / Read line so a supporting terminal can open the file. */
function linkFileLine(original: string, painted: string, cwd?: string | null): string {
  const file = fileFromToolLine(original);
  if (file === undefined) return painted;
  const href = fileHref(file, cwd);
  return href === undefined ? painted : link(href, painted);
}

function paintToolNow(now: string, inner: number, cwd?: string | null): string {
  return linkFileLine(now, shortenToolLine(now, inner), cwd);
}

function lineCount(block: string): number {
  if (block === "") return 0;
  return block.split("\n").length;
}

/** RUN band is up — the checkout lives there, so meta would only steal transcript. */
function runBandOpen(state: ViewState): boolean {
  if (selectedQuestion(state) !== undefined) return false;
  if (selectedFailure(state) !== undefined) return false;
  const row = selectedRow(state);
  return row !== undefined && rowRunning(row);
}

function wrapActivityLine(text: string, width: number): string[] {
  const body = transcriptBody(text);
  const pad = text.slice(0, text.length - body.length);
  if (
    body.startsWith("+ ") ||
    body.startsWith("- ") ||
    body.startsWith("… ") ||
    (text.startsWith("  ") && !body.startsWith("tool · ") && !body.startsWith("sub · "))
  ) {
    return [text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`];
  }
  if (body.startsWith("tool · ") || /^[A-Z][A-Za-z]+ \S/.test(body)) {
    return [`${pad}${shortenToolLine(body, Math.max(8, width - pad.length))}`];
  }
  return wrap(text, width);
}

/** Paint every occurrence of `query` in `line`. The current hit is bolder. */
function highlightFind(line: string, query: string, current: boolean): string {
  if (query === "") return paintHunkLine(line);
  const hay = line.toLowerCase();
  const needle = query.toLowerCase();
  let out = "";
  let from = 0;
  let at = hay.indexOf(needle, from);
  if (at < 0) return paintHunkLine(line);
  while (at >= 0) {
    const before = line.slice(from, at);
    out += before === "" ? "" : paintHunkLine(before);
    out += paint(current ? GOLD + BOLD : GOLD, line.slice(at, at + needle.length));
    from = at + needle.length;
    at = hay.indexOf(needle, from);
  }
  const rest = line.slice(from);
  return rest === "" ? out : out + paintHunkLine(rest);
}

function paintHunkLine(line: string): string {
  if (line.startsWith("+ ")) return paint(TEAL, line);
  if (line.startsWith("- ")) return paint(RUST, line);
  if (line.startsWith("… ") || line.startsWith("  ")) return dim(line);
  return line;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

/** Token counts and spend for the reserved-band hint. Empty when status had none. */
function renderUsageBits(row: StatusRow | undefined): string[] {
  const bits: string[] = [];
  if (row?.run?.usage) {
    bits.push(`${fmtTokens(row.run.usage.inputTokens)}→${fmtTokens(row.run.usage.outputTokens)}`);
  }
  if (row?.run?.costUsd !== null && row?.run?.costUsd !== undefined) {
    bits.push(`$${row.run.costUsd.toFixed(3)}`);
  }
  return bits;
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
    lines.push(...renderHeadlessAttempt(row));
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

/** Request id, branch, and pull-request URL under a headless row. */
function renderHeadlessAttempt(row: StatusRow): string[] {
  const extra: string[] = [];
  if (row.run?.prUrl) extra.push(`  ${row.run.prUrl}`);
  if (row.run?.requestId) extra.push(`  @ ${row.run.requestId}`);
  if (row.run?.branch) extra.push(`  ${row.run.branch}`);
  return extra;
}

/** One-line watch tick, then the same attempt extras `status` prints. */
export function renderWatchLine(rows: StatusRow[]): string {
  if (rows.length === 0) return "watch · no rows";
  return rows
    .map((row) => {
      const ask = row.questions.length > 0 ? ` ask=${row.questions.length}` : "";
      const outcome = row.run?.outcome != null ? ` ${row.run.outcome}` : "";
      const fail =
        rowFailed(row) && row.questions.length === 0 ? ` · ${failureReason(row)}` : "";
      const head = `${row.issue ?? row.taskId} ${row.status}${outcome}${ask}${fail}`;
      return [head, ...renderHeadlessAttempt(row)].join("\n");
    })
    .join("\n");
}

export function watchExitCode(rows: StatusRow[]): number {
  if (rows.length === 0) return 1;
  if (rows.some((r) => r.questions.length > 0)) return 2;
  if (rows.every((r) => r.status === "completed")) return 0;
  if (rows.some(rowFailed)) return 1;
  return 3;
}
