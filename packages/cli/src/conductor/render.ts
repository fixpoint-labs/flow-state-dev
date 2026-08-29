/**
 * Paint one frame. Pure: view + size → string. The loop writes it; tests
 * assert on it. A frame that cannot be produced from a fixture is a frame
 * nobody can pin.
 */
import { renderMarkdown } from "./markdown";
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
  elideEnd,
  fileHref,
  fileText,
  formatAge,
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
  composeDrafts,
  currentFindHit,
  failureReason,
  findMatches,
  lastActivityAt,
  rowFailed,
  rowNeedsYou,
  rowSpent,
  rowNow,
  rowRunning,
  STALL_AFTER_MS,
  selectedFailure,
  currentPlanItem,
  fileFromToolLine,
  selectedFiles,
  selectedHunk,
  selectedHunkEntry,
  selectedHunkStack,
  selectedNow,
  selectedPlan,
  selectedReadPeek,
  selectedCommandTail,
  selectedQuestion,
  selectedRow,
  selectedRequestId,
  selectedRunningRequestId,
  transcriptBody,
  visibleLive,
  type ActivityItem,
  type StatusRow,
  type ViewState,
} from "./types";

/**
 * How many table body rows stay on screen. More than this buries the prompt
 * on a normal 24-line terminal. ↑/↓ moves the window; the selected row stays
 * inside it.
 */
export const TABLE_BODY_MAX = 8;

/**
 * Wrapped question lines on the ASK band. More than this still shows
 * `… N more`; the full text is on the transcript. A 24-line board
 * shrinks toward `ASK_BODY_MIN` so leftover room still fits TRANSCRIPT.
 * When the attempt strip would still hide TRANSCRIPT, the strip yields.
 */
export const ASK_BODY_MAX = 8;

/** Fewest wrapped ASK / FAIL body lines the reserved band will keep. */
export const ASK_BODY_MIN = 2;

/**
 * Leftover rows the transcript needs when ASK or FAIL is up. Below
 * this, `renderActivity` cannot paint the TRANSCRIPT heading.
 */
export const ACTIVITY_MIN = 4;

/** Seed brief `status` carried, or null when the row never had one. */
function rowBrief(row: StatusRow | undefined): string | null {
  const brief = row?.brief;
  if (brief == null) return null;
  const trimmed = brief.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Slice of `rows` that the table paints. `end` is exclusive.
 * When everything fits, the window is the whole board.
 */
export function visibleTableWindow(
  count: number,
  selected: number,
  maxBody: number = TABLE_BODY_MAX,
): { start: number; end: number } {
  if (count <= maxBody) return { start: 0, end: count };
  const body = Math.max(1, maxBody);
  const start = Math.max(0, Math.min(Math.max(0, selected) - Math.floor((body - 1) / 2), count - body));
  return { start, end: start + body };
}

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

/**
 * Tab title so a background board is still readable. Counts match the
 * header: running, waiting, failed, working.
 */
export function conductorWindowTitle(state: ViewState): string {
  const waiting = state.rows.filter((r) => r.questions.length > 0).length;
  const live = state.rows.filter((r) => r.status === "in_progress").length;
  const failed = state.rows.filter(rowFailed).length;
  const epic = state.epicLabel.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 80);
  const repo = state.repoLabel?.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 80);
  const parts = [`conductor · ${epic}`];
  if (repo) parts.push(repo);
  if (live > 0) parts.push(`${live} running`);
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (state.busy) parts.push("working");
  return parts.join(" · ");
}

/** OSC title, terminated with ST so this is not a terminal bell. */
export function windowTitleSequence(title: string): string {
  return `\x1b]0;${title}\x1b\\`;
}

export function renderFrame(state: ViewState, size: FrameSize, now: number = Date.now()): string {
  const cols = Math.max(size.cols, MIN_COLS);
  const rows = Math.max(size.rows, MIN_ROWS);
  if (state.help) return fit(renderHelp(cols), cols, rows, 1);
  if (!state.inspect) return renderOverview(state, cols, rows, now);
  return renderInspect(state, cols, rows, now);
}

/** Rows and the prompt. The question body and transcript live on inspect. */
function renderOverview(state: ViewState, cols: number, rows: number, now: number): string {
  const header = renderHeader(state, cols);
  const table = renderTable(state, cols, now);
  const talk = renderTalkStrip(state, cols);
  const menu = renderSlashMenu(state, cols);
  const prompt = renderPrompt(state, cols);
  const footer = renderFooter(state, cols, now);
  const pinBottom = lineCount(menu) + lineCount(prompt) + lineCount(footer);
  return fit(
    [header, table, talk, menu, prompt, footer].filter((s) => s !== "").join("\n"),
    cols,
    rows,
    pinBottom,
  );
}

/** Last board-only lines (talk, seed, wake). A child transcript is inspect. */
function renderTalkStrip(state: ViewState, cols: number): string {
  const board = state.activity.filter((item) => item.requestId === undefined);
  const shown = board.slice(-8);
  const width = Math.max(16, cols - 12);
  const lines = shown.map((item) => ` ${dim(formatClock(item.at))}  ${truncate(item.text, width)}`);
  const live = state.live;
  if (live !== null && live !== shown.at(-1)?.text) {
    lines.push(` ${paint(GOLD, "··")}  ${truncate(live, width)}`);
  }
  if (lines.length === 0) return "";
  return [rule(cols, INK_3), ...lines].join("\n");
}

/** One row's question, attempt, and transcript. Esc returns to the board. */
function renderInspect(state: ViewState, cols: number, rows: number, now: number): string {
  const header = renderHeader(state, cols);
  const table = renderInspectTable(state, cols, now);
  const meta = state.busy || reservedBandOpen(state) ? "" : renderMeta(state, cols);
  const menu = renderSlashMenu(state, cols);
  const prompt = renderPrompt(state, cols);
  const footer = renderFooter(state, cols, now);
  const chrome =
    lineCount(header) +
    lineCount(table) +
    lineCount(meta) +
    lineCount(menu) +
    lineCount(prompt) +
    lineCount(footer);
  let bodyMax = ASK_BODY_MAX;
  let stripMax = Number.POSITIVE_INFINITY;
  let band = renderReservedBand(state, cols, now, bodyMax, stripMax);
  let leftover = Math.max(0, rows - chrome - lineCount(band));
  while (leftover < ACTIVITY_MIN && bodyMax > ASK_BODY_MIN) {
    bodyMax -= 1;
    band = renderReservedBand(state, cols, now, bodyMax, stripMax);
    leftover = Math.max(0, rows - chrome - lineCount(band));
  }
  while (leftover < ACTIVITY_MIN && stripMax > 0) {
    const withoutStrip = lineCount(renderReservedBand(state, cols, now, bodyMax, 0));
    const stripLines =
      stripMax === Number.POSITIVE_INFINITY
        ? Math.max(0, lineCount(band) - withoutStrip)
        : stripMax;
    if (stripLines <= 0) break;
    stripMax = stripLines - 1;
    band = renderReservedBand(state, cols, now, bodyMax, stripMax);
    leftover = Math.max(0, rows - chrome - lineCount(band));
  }
  const activity = renderActivity(state, cols, leftover, band !== "");
  const pinBottom = lineCount(menu) + lineCount(prompt) + lineCount(footer);

  return fit(
    [header, table, band, meta, activity, menu, prompt, footer].filter((s) => s !== "").join("\n"),
    cols,
    rows,
    pinBottom,
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
    ...(state.repoLabel
      ? [dim("·"), ` ${state.repoLabel} `]
      : []),
    dim("·"),
    ` ${state.rows.length} row${state.rows.length === 1 ? "" : "s"} `,
  ];
  if (state.rows.length > TABLE_BODY_MAX) {
    const { start, end } = visibleTableWindow(state.rows.length, state.selected);
    parts.push(dim("·"), dim(` ${start + 1}–${end} `));
  }
  if (live > 0) parts.push(dim("·"), paint(ACCENT, ` ${live} running `));
  if (waiting > 0) parts.push(dim("·"), paint(MAUVE, ` ${waiting} waiting `));
  if (failed > 0) parts.push(dim("·"), paint(RUST, ` ${failed} failed `));
  if (state.inspect) parts.push(dim("·"), paint(GOLD, " inspect "));
  if (state.busy) parts.push(dim("·"), paint(GOLD, " working "));
  if (state.lastRefreshAt !== null) {
    parts.push(dim("·"), dim(` ${formatClock(state.lastRefreshAt)} `));
  }
  const left = parts.join("");
  return `${padLine(left, cols)}\n${rule(cols)}`;
}

function tableLayout(cols: number): {
  issueW: number;
  phaseW: number;
  statusW: number;
  attemptW: number;
  outcomeW: number;
  askW: number;
  cols: number;
  head: string;
} {
  const issueW = Math.max(10, Math.min(16, Math.floor(cols * 0.16)));
  const phaseW = 10;
  const statusW = 16;
  const attemptW = 3;
  const chrome = 10;
  const rest = Math.max(22, cols - issueW - phaseW - statusW - attemptW - chrome);
  const outcomeW = Math.max(9, Math.min(12, Math.floor(rest * 0.3)));
  const askW = Math.max(14, rest - outcomeW);
  const head =
    "  " +
    pad(dim("ISSUE"), issueW) +
    pad(dim("PHASE"), phaseW) +
    pad(dim("STATUS"), statusW) +
    pad(dim("N"), attemptW) +
    pad(dim("OUTCOME"), outcomeW) +
    pad(dim("ASK"), askW);
  return { issueW, phaseW, statusW, attemptW, outcomeW, askW, cols, head };
}

function renderTable(state: ViewState, cols: number, now: number): string {
  const layout = tableLayout(cols);
  if (state.rows.length === 0) {
    return `${layout.head}\n${padLine(dim("  no rows. type to talk, or /seed <issue> to file one."), cols)}`;
  }
  const { start, end } = visibleTableWindow(state.rows.length, state.selected);
  const lines = state.rows.slice(start, end).map((row, i) =>
    renderTableRow(row, start + i === state.selected, layout, state, now),
  );
  return [layout.head, ...lines].join("\n");
}

/** The selected row only — inspect is one task, not the full list. */
function renderInspectTable(state: ViewState, cols: number, now: number): string {
  const layout = tableLayout(cols);
  const row = selectedRow(state);
  if (row === undefined) {
    return `${layout.head}\n${padLine(dim("  no row."), cols)}`;
  }
  return [layout.head, renderTableRow(row, true, layout, state, now)].join("\n");
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
  state: ViewState,
  now: number,
): string {
  const mark = selected ? paint(ACCENT + BOLD, "▸ ") : "  ";
  const issue = pad(row.issue ?? "—", w.issueW);
  const phase = pad(row.phase ?? "—", w.phaseW);
  const age = paintFreshness(row, state.activity, now);
  const status = pad(
    age === undefined
      ? paint(statusColor(row.status), row.status)
      : `${paint(statusColor(row.status), row.status)} ${age}`,
    w.statusW,
  );
  const attempt = pad(String(row.attempts), w.attemptW);
  const usage = rowRunning(row) ? tableUsage(row) : undefined;
  const outcome = pad(
    usage !== undefined
      ? dim(usage)
      : paint(outcomeColor(row.run?.outcome ?? null), row.run?.outcome ?? "—"),
    w.outcomeW,
  );
  const asked = row.questions[0]?.text;
  const failed = asked === undefined && rowFailed(row) ? failureReason(row) : undefined;
  const doing = asked === undefined && failed === undefined && rowRunning(row) ? rowNow(state, row) : undefined;
  const brief =
    asked === undefined && failed === undefined && (doing === undefined || doing === "")
      ? rowBrief(row)
      : null;
  const ask = pad(
    asked !== undefined
      ? paint(MAUVE, truncate(asked, w.askW))
      : failed !== undefined
        ? paint(RUST, truncate(failed, w.askW))
        : doing !== undefined && doing !== ""
          ? paint(GOLD, shortenToolLine(doing, w.askW))
          : brief !== null
            ? dim(truncate(brief, w.askW))
            : dim("·"),
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
function renderReservedBand(
  state: ViewState,
  cols: number,
  now: number,
  bodyMax = ASK_BODY_MAX,
  stripMax = Number.POSITIVE_INFINITY,
): string {
  const ask = renderAskBand(state, cols, bodyMax, stripMax);
  if (ask !== "") return ask;
  const fail = renderFailBand(state, cols, bodyMax, stripMax);
  if (fail !== "") return fail;
  return renderRunBand(state, cols, now, stripMax);
}

function renderAskBand(
  state: ViewState,
  cols: number,
  bodyMax = ASK_BODY_MAX,
  stripMax = Number.POSITIVE_INFINITY,
): string {
  const question = selectedQuestion(state);
  if (question === undefined) return "";
  const more = selectedRow(state)?.questions.length ?? 0;
  const inner = Math.max(20, cols - 8);
  const wrapped = renderMarkdown(question.text, inner);
  const body = wrapped.slice(0, bodyMax);
  const hidden = wrapped.length - body.length;
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
    bandHeading("ASK", MAUVE, hidden),
    ...renderAttemptIdentity(state, inner),
    ...body.map((line) => ` ${line}`),
    ` ${dim(hint)}`,
    ...renderAttemptStrip(state, inner).slice(0, stripMax),
    rule(cols, MAUVE),
  ].join("\n");
}

/**
 * ASK / FAIL title. `… N more` lives here so a 24-line pin cannot hide
 * that the body was clipped — the full text is on the transcript.
 */
function bandHeading(label: string, color: string, hidden: number): string {
  const title = ` ${paint(color + BOLD, label)}`;
  if (hidden <= 0) return title;
  return `${title}${dim(`  ·  … ${hidden} more`)}`;
}

/**
 * Branch, then PR URL. These sit above the ASK / FAIL body so a long
 * question cannot pin them off a 24-line board. The branch is the
 * handle after a push that could not open a pull request; a long ref
 * keeps the issue--phase suffix.
 */
function renderAttemptIdentity(state: ViewState, inner: number): string[] {
  const lines: string[] = [];
  const row = selectedRow(state);
  const branch = row?.run?.branch;
  if (branch) lines.push(` ${dim(shorten(branch, inner))}`);
  const prUrl = row?.run?.prUrl;
  if (prUrl) lines.push(` ${dim(prText(prUrl, inner))}`);
  return lines;
}

/**
 * Compact "what that attempt was doing" — last tool, files, last hunk,
 * current todo. ASK and FAIL keep this on the reserved band so it still
 * shows when inspect is hidden (busy, or a tall transcript). Identity
 * (branch, PR) is rendered above the body, not here.
 */
function renderAttemptStrip(state: ViewState, inner: number): string[] {
  const lines: string[] = [];
  const row = selectedRow(state);
  const now = selectedNow(state);
  if (now !== undefined && now !== "") {
    const cwd = row?.run?.workspacePath ?? null;
    lines.push(` ${dim(paintToolNow(now, inner, cwd))}`);
  }
  lines.push(...renderReadPeek(state, inner));
  lines.push(...renderCommandTail(state, inner));
  lines.push(...renderFileLines(state, inner));
  lines.push(...renderHunkLines(state, inner, { onlyCurrent: true }));
  lines.push(...renderPlanLines(state, inner, { onlyCurrent: true }));
  const brief = rowBrief(row);
  if (brief !== null) lines.push(` ${dim("brief")}  ${truncate(brief, inner)}`);
  return lines;
}

function renderFailBand(
  state: ViewState,
  cols: number,
  bodyMax = ASK_BODY_MAX,
  stripMax = Number.POSITIVE_INFINITY,
): string {
  const failure = selectedFailure(state);
  if (failure === undefined) return "";
  const row = selectedRow(state);
  const inner = Math.max(20, cols - 8);
  const wrapped = wrap(failure.reason, inner);
  const body = wrapped.slice(0, bodyMax);
  const hidden = wrapped.length - body.length;
  const id = selectedRequestId(state);
  const hint = [
    row?.issue ?? row?.taskId ?? "row",
    id,
    ...renderUsageBits(row),
    row !== undefined && rowSpent(row) ? "spent" : "/wake",
  ]
    .filter((bit) => bit !== undefined && bit !== "")
    .join("  ·  ");
  return [
    rule(cols, RUST),
    bandHeading("FAIL", RUST, hidden),
    ...renderAttemptIdentity(state, inner),
    ...body.map((line) => ` ${paint(BOLD + INK, line)}`),
    ` ${dim(hint)}`,
    ...renderAttemptStrip(state, inner).slice(0, stripMax),
    rule(cols, RUST),
  ].join("\n");
}

function renderRunBand(
  state: ViewState,
  cols: number,
  now: number,
  stripMax = Number.POSITIVE_INFINITY,
): string {
  const row = selectedRow(state);
  if (row === undefined || !rowRunning(row)) return "";
  const inner = Math.max(20, cols - 8);
  const branch = row.run?.branch;
  const tree = row.run?.workspacePath;
  const id = selectedRunningRequestId(state);
  const body: string[] = [];
  if (branch) body.push(shorten(branch, inner));
  if (tree) body.push(fileText(tree, inner));
  const age = paintFreshness(row, state.activity, now);
  const hintBits = [
    ...(age !== undefined ? [age] : []),
    ...renderUsageBits(row),
    id !== undefined ? `${id}  ·  x stops` : "no request id yet",
  ];
  if (row.run?.prUrl) body.push(prText(row.run.prUrl, inner));
  for (const heal of row.run?.healed ?? []) {
    body.push(paint(GOLD, `heal · ${shorten(heal, inner)}`));
  }
  const hint = hintBits.join("  ·  ");
  const doing = selectedNow(state);
  const nowLine =
    doing !== undefined && doing !== ""
      ? ` ${paint(GOLD, paintToolNow(doing, inner, tree ?? null))}`
      : "";
  const brief = rowBrief(row);
  const extras = [
    ...(nowLine !== "" ? [nowLine] : []),
    ...renderReadPeek(state, inner),
    ...renderCommandTail(state, inner),
    ...renderFileLines(state, inner),
    ...renderHunkLines(state, inner),
    ...renderPlanLines(state, inner),
    ...(brief !== null ? [` ${dim("brief")}  ${truncate(brief, inner)}`] : []),
  ].slice(0, stripMax);
  return [
    rule(cols, ACCENT),
    ` ${paint(ACCENT + BOLD, "RUN")}`,
    ...body.map((line) => ` ${paint(BOLD + INK, line)}`),
    ` ${dim(hint)}`,
    ...extras,
    rule(cols, ACCENT),
  ].join("\n");
}

const FILE_MAX = 3;
const FILE_EXPANDED_MAX = 12;
const HUNK_BAND_MAX = 3;
const HUNK_EXPANDED_MAX = 16;
const READ_BAND_MAX = 3;
const PEEK_EXPANDED_MAX = 16;

function renderReadPeek(state: ViewState, inner: number): string[] {
  const peek = selectedReadPeek(state);
  if (peek.length === 0) return [];
  const cap = state.peekExpanded ? PEEK_EXPANDED_MAX : READ_BAND_MAX;
  const shown = peek.slice(0, cap);
  const hidden = peek.length - shown.length;
  const lines = shown.map((line) => ` ${dim(shorten(line, inner))}`);
  if (hidden > 0) lines.push(` ${dim(`… ${hidden} more`)}`);
  return lines;
}

const COMMAND_BAND_MAX = 3;

function renderCommandTail(state: ViewState, inner: number): string[] {
  const tail = selectedCommandTail(state);
  if (tail.length === 0) return [];
  const cap = state.peekExpanded ? PEEK_EXPANDED_MAX : COMMAND_BAND_MAX;
  const shown = tail.slice(-cap);
  const hidden = tail.length - shown.length;
  const lines = shown.map((line) => ` ${dim(shorten(line, inner))}`);
  if (hidden > 0) lines.unshift(` ${dim(`… ${hidden} more`)}`);
  return lines;
}

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
  const stack = selectedHunkStack(state);
  const entry = selectedHunkEntry(state);
  if (stack.length > 1 && entry !== undefined) {
    const cwd = selectedRow(state)?.run?.workspacePath ?? null;
    const at = stack.length - (state.hunkAt % stack.length);
    lines.unshift(` ${dim(`${fileText(entry.file, Math.max(8, inner - 8), cwd)}  ${at}/${stack.length}`)}`);
  }
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
    return `${rule(cols, INK_3)}\n${dim("  type to talk to the coordinator, or /seed <issue>")}`;
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
  const brief = rowBrief(row);
  if (brief !== null) {
    lines.push(` ${dim("brief")}    ${truncate(brief, cols - 12)}`);
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
  if (height <= 0) return "";
  const following = state.scroll === 0;
  const live = visibleLive(state);
  const hits = findMatches(state);
  const currentHit = currentFindHit(state);
  const finding = state.find !== null && state.find !== "";
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
    const heading = transcriptHeading(state, live, following, state.scroll > 0);
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
  const heading = transcriptHeading(
    state,
    live,
    following,
    scroll === maxScroll && maxScroll > 0,
    scroll,
  );
  const start = Math.max(0, lines.length - window - scroll);
  const visible = lines.slice(start, start + window);
  const pad = Math.max(0, window - visible.length);
  const filler =
    pad > 0 && visible.length === 0
      ? [` ${dim("nothing yet. type to talk.")}`, ...Array.from({ length: pad - 1 }, () => "")]
      : Array.from({ length: pad }, () => "");
  const top = underBand ? [] : [rule(cols, INK_3)];
  return [...top, heading, ...filler, ...visible].join("\n");
}

function transcriptHeading(
  state: ViewState,
  live: string | null,
  following: boolean,
  atOldest: boolean,
  back = 0,
): string {
  const hits = findMatches(state);
  const finding = state.find !== null && state.find !== "";
  return ` ${dim("TRANSCRIPT")}${
    finding
      ? hits.length === 0
        ? dim(`  ·  find · "${state.find}"  no matches`)
        : dim(
            `  ·  find · "${state.find}"  ${Math.min(Math.max(0, state.findAt), hits.length - 1) + 1}/${hits.length}`,
          )
      : following
        ? live !== null
          ? dim("  ·  live")
          : dim("  ·  follow")
        : dim(atOldest ? "  ·  oldest" : `  ·  ${back} back`)
  }`;
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
  const selected = selectedRow(state);
  let placeholder = dim(
    selected !== undefined && rowSpent(selected)
      ? "talk to the coordinator — this row is spent"
      : state.inspect && selectedQuestion(state) !== undefined
        ? "type to answer"
        : selectedQuestion(state) !== undefined
          ? "talk · enter inspects the question · /answer"
          : selected === undefined
            ? "talk to the coordinator, or /seed <issue>"
            : state.inspect
              ? "talk to the coordinator, or /seed /wake /answer"
              : "talk · enter inspects a row · /seed /wake /answer",
  );
  if (state.inputMode === "answer") {
    prefix = paint(MAUVE, "❯ answer ");
    placeholder = dim("type the reply · Enter sends · Ctrl-J new line · Esc cancels");
  } else if (state.inputMode === "seed") {
    prefix = paint(TEAL, "❯ seed ");
    placeholder = dim("issue id · words after it are the brief · Enter files");
  } else if (state.inputMode === "find") {
    prefix = paint(GOLD, "❯ find ");
    placeholder = dim("text in this row's transcript · Enter keeps · Esc clears");
  }
  const inner = Math.max(8, cols - 12);
  const shown =
    state.input === "" ? placeholder : composeView(state.input, inner, state.caret);
  const pad = " ".repeat(visibleWidth(prefix));
  const aligned = shown
    .split("\n")
    .map((line, i) => (i === 0 ? ` ${prefix}${line}` : ` ${pad}${line}`))
    .join("\n");
  return `${rule(cols)}\n${aligned}${notice}`;
}

function renderFooter(state: ViewState, cols: number, now: number): string {
  const q = selectedQuestion(state);
  const fail = selectedFailure(state);
  const selected = selectedRow(state);
  const spent = selected !== undefined && rowSpent(selected);
  const running = selectedRunningRequestId(state) !== undefined;
  const finding = state.find !== null;
  const slashing = state.inputMode === "command" && slashMenu(state).length > 0;
  const moreFiles = selectedFiles(state).length > FILE_MAX;
  const moreHunks = selectedHunk(state).length > HUNK_BAND_MAX;
  const morePeek =
    selectedReadPeek(state).length > READ_BAND_MAX ||
    selectedCommandTail(state).length > COMMAND_BAND_MAX;
  const hunkStack = selectedHunkStack(state).length > 1;
  const filesKey = moreFiles ? "  ·  f files" : "";
  const peekKey = morePeek ? "  ·  e more" : "";
  const hunksKey =
    q === undefined
      ? `${moreHunks ? "  ·  h hunk" : ""}${hunkStack ? "  ·  H older" : ""}`
      : hunkStack
        ? "  ·  H older"
        : "";
  const working = state.busy ? "working  ·  " : "";
  const nextKey = state.rows.some((row, i) => i !== state.selected && rowNeedsYou(row, state.activity, now))
    ? "  ·  } next"
    : "";
  const composing =
    !slashing &&
    !finding &&
    (state.inputMode === "answer" || state.inputMode === "seed" || state.input !== "");
  const empty = state.rows.length === 0;
  const keys = composing
    ? `${working}${composeDrafts(state).length > 0 ? "↑ prior  ·  " : ""}Ctrl-J line  ·  Enter send  ·  Esc`
    : slashing
    ? `${working}Tab complete  ·  ↑/↓ choose  ·  Enter  ·  Esc`
    : finding
    ? `${working}n older  ·  N newer  ·  Esc clear  ·  /find  ·  ↑/↓  ·  ?  ·  /quit`
    : empty
      ? `${working}type to talk  ·  /seed  ·  /  ·  ?  ·  /quit`
    : !state.inspect
      ? q
        ? `${working}type to talk  ·  enter inspect  ·  /answer  ·  ↑/↓${nextKey}  ·  /  ·  ?  ·  /quit`
        : fail !== undefined
          ? `${working}type to talk  ·  enter inspect  ·  ↑/↓  ·  ${spent ? "spent" : "/wake"}  ·  s seed  ·  /  ·  ?  ·  /quit`
          : running
            ? `${working}type to talk  ·  enter inspect  ·  ↑/↓  ·  x stop  ·  /  ·  ?  ·  /quit`
            : `${working}type to talk  ·  enter inspect  ·  ↑/↓  ·  s seed  ·  /  ·  ?  ·  /quit`
    : q
      ? `${working}Esc board  ·  type to answer  ·  ↑/↓${nextKey}  ·  /find  ·  /  ·  ?  ·  /quit`
      : fail !== undefined
        ? `${working}Esc board  ·  type to talk  ·  ↑/↓  ·  ${spent ? "spent" : "/wake"}${filesKey}${hunksKey}${peekKey}${nextKey}  ·  /find  ·  s seed  ·  /  ·  ?  ·  /quit`
        : running
          ? `${working}Esc board  ·  type to talk  ·  ↑/↓  ·  x stop${filesKey}${hunksKey}${peekKey}${nextKey}  ·  /find  ·  /  ·  ?  ·  /quit`
          : `${working}Esc board  ·  type to talk  ·  ↑/↓${filesKey}${hunksKey}${peekKey}${nextKey}  ·  /find  ·  s seed  ·  /  ·  ?  ·  /quit`;
  return padLine(dim(` ${keys}`), cols);
}

/** How many compose lines the prompt may occupy. */
const COMPOSE_MAX_LINES = 6;

/** Multi-line compose, or a single long line windowed around the caret. */
function composeView(input: string, width: number, caret: number): string {
  if (!input.includes("\n")) return composeTail(input, width, caret);
  const lines = input.split("\n");
  let col = Math.max(0, Math.min(caret, input.length));
  let lineAt = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const len = lines[i]!.length;
    if (col <= len) {
      lineAt = i;
      break;
    }
    col -= len + 1;
    lineAt = i;
  }
  const start = Math.max(0, lineAt - COMPOSE_MAX_LINES + 1);
  return lines
    .slice(start, start + COMPOSE_MAX_LINES)
    .map((line, i) => {
      const abs = start + i;
      if (abs === lineAt) return composeTail(line, width, col);
      return line.length <= width ? line : elideEnd(line, width);
    })
    .join("\n");
}

/** Keep the caret visible. A long line windows around it; the end stays the default. */
function composeTail(input: string, width: number, caret: number): string {
  const at = Math.max(0, Math.min(caret, input.length));
  const room = Math.max(1, width - 1);
  let text: string;
  let local: number;
  if (input.length <= room) {
    text = input;
    local = at;
  } else if (at >= input.length) {
    text = elideEnd(input, room);
    local = text.length;
  } else {
    let start = Math.max(0, at - Math.floor(room * 0.75));
    if (start + room > input.length) start = Math.max(0, input.length - room);
    text = input.slice(start, start + room);
    local = at - start;
    if (start > 0) text = `…${text.slice(1)}`;
  }
  return text.slice(0, local) + paint(ACCENT, "█") + text.slice(local);
}

/**
 * Board keys for `?`. The CLI `--help` text does not fit a 24-line
 * terminal; this list does, and the last line stays when the frame is
 * shorter (`fit` pins it).
 */
const TUI_HELP_LINES = [
  "  Enter / Esc   inspect the selected row · back to the board",
  "  ↑/↓          row · while composing: lines, then prior sends",
  "  Ctrl-R       prior send, including on an empty prompt",
  "  Alt/Ctrl-←/→ word · Ctrl-W delete the previous word",
  "  PgUp/PgDn    transcript · Home/End oldest / follow (inspect)",
  "  { / }        previous / next waiting, failed, or stalled row",
  "  s            seed (first line issue, more lines brief)",
  "  r            refresh",
  "  x            stop the selected running request",
  "  f / h / e    files, last hunk, last Read or command tail",
  "  H            older hunk",
  "  Ctrl-T       todo list",
  "  /find [text] search this row's transcript",
  "  n / N        older / newer match",
  "  /quit        stop running work and leave",
  "  On the board, type to talk. Inspect a waiting row, then type the answer. /steer talks.",
  "  A new question or a finish opens inspect on that row.",
  "  Reopen lands on the row you left, and keeps the talk.",
];

function renderHelp(cols: number): string {
  const lines = [
    paint(BOLD + ACCENT, " CONDUCTOR "),
    dim("type to talk · letters talk · /quit leaves"),
    rule(cols),
    ...TUI_HELP_LINES.map((line) => dim(line)),
    "",
    dim(" any key returns"),
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

/**
 * ASK, FAIL, or RUN is up. Meta repeats that attempt and would only
 * steal the transcript — including the rest of a long question.
 */
function reservedBandOpen(state: ViewState): boolean {
  if (selectedQuestion(state) !== undefined) return true;
  if (selectedFailure(state) !== undefined) return true;
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
  if (line.replace(/^ +/, "").startsWith("think · ")) return dim(line);
  return line;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

/** Compact in→out for the table. Absent when status had no usage. */
function tableUsage(row: StatusRow): string | undefined {
  const usage = row.run?.usage;
  if (usage === undefined || usage === null) return undefined;
  return `${fmtTokens(usage.inputTokens)}→${fmtTokens(usage.outputTokens)}`;
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

/**
 * Last-write age on a running row (`8s`, `3m`). Rust after 30s so a
 * silent child is visible. Absent when the row is not running or we
 * have no timestamp.
 */
function paintFreshness(row: StatusRow, activity: readonly ActivityItem[], now: number): string | undefined {
  const label = freshnessLabel(row, activity, now);
  if (label === undefined) return undefined;
  const at = lastActivityAt(row, activity);
  const stalled = at !== null && now - at >= STALL_AFTER_MS;
  return paint(stalled ? RUST : GOLD, label);
}

function freshnessLabel(row: StatusRow, activity: readonly ActivityItem[], now: number): string | undefined {
  if (!rowRunning(row)) return undefined;
  const at = lastActivityAt(row, activity);
  if (at === null) return undefined;
  return formatAge(at, now);
}

/**
 * Pad or clip a frame to `rows`. When clipping, `pinBottom` lines from the
 * end stay — the prompt and footer. Grok never loses the input line; a tall
 * band plus a long table used to.
 */
function fit(frame: string, cols: number, rows: number, pinBottom = 0): string {
  const raw = frame.split("\n");
  let lines: string[];
  if (raw.length <= rows) {
    lines = raw;
  } else if (pinBottom <= 0) {
    lines = raw.slice(0, rows);
  } else {
    const pin = Math.min(pinBottom, rows);
    lines = [...raw.slice(0, rows - pin), ...raw.slice(-pin)];
  }
  while (lines.length < rows) lines.push(" ".repeat(cols));
  return lines.map((line) => padLine(line, cols)).join("\n");
}

/**
 * Board id and checkout name for headless stdout.
 *
 * Same strings as the TUI header (`flow.id`, then the `CONDUCTOR_REPO`
 * basename). Headless `status` prints them so leftover env cannot hide
 * which board you just read.
 */
export interface BoardIdentity {
  epic: string;
  repo?: string;
}

/** Compact board for headless stdout. No alternate screen, no spinner. */
export function renderBoardPlain(
  rows: StatusRow[],
  json: boolean,
  views?: Readonly<Record<string, ViewState>>,
  now: number = Date.now(),
  identity?: BoardIdentity,
): string {
  if (json) {
    const epic = identity?.epic.trim() ?? "";
    const repo = identity?.repo?.trim() ?? "";
    return JSON.stringify(
      {
        ...(epic !== "" ? { epic } : {}),
        ...(repo !== "" ? { repo } : {}),
        rows: rows.map((row) => jsonRow(row, viewForRow(row, views))),
      },
      null,
      2,
    );
  }
  const heading = formatBoardIdentity(identity);
  if (rows.length === 0) return `${heading}no rows\n`;
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
        headlessAsk(row, views),
    );
    lines.push(...renderHeadlessAttempt(row, viewForRow(row, views), now));
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
  return `${heading}${lines.join("\n")}\n`;
}

/**
 * Flow `id` and checkout basename, one line.
 *
 * Headless dumps prefix the board with this. The TUI writes it on the
 * main screen before the alternate buffer so `/quit` leaves it visible.
 */
export function formatBoardIdentity(identity?: BoardIdentity): string {
  const epic = identity?.epic.replace(/[\x00-\x1f\x7f]/g, "").trim() ?? "";
  if (epic === "") return "";
  const repo = identity?.repo?.replace(/[\x00-\x1f\x7f]/g, "").trim() ?? "";
  return repo === "" ? `${epic}\n` : `${epic} · ${repo}\n`;
}

/**
 * Same rule as the TUI ASK column: the question wins; a running row
 * shows its current action when we have that attempt's journal; else
 * the seed brief so a pending row still scans.
 */
function headlessAsk(
  row: StatusRow,
  views?: Readonly<Record<string, ViewState>>,
): string {
  const asked = row.questions[0]?.text;
  if (asked !== undefined) return truncate(asked, 16);
  if (rowRunning(row)) {
    const view = viewForRow(row, views);
    if (view !== undefined) {
      const doing = rowNow(view, row);
      if (doing !== undefined && doing !== "") return shortenToolLine(doing, 16);
    }
  }
  const brief = rowBrief(row);
  if (brief !== null) return truncate(brief, 16);
  return "·";
}

function viewForRow(
  row: StatusRow,
  views?: Readonly<Record<string, ViewState>>,
): ViewState | undefined {
  const id = row.run?.requestId;
  if (id === null || id === undefined || id === "" || views === undefined) return undefined;
  return views[id];
}

/**
 * Additive presenter fields on a status row. Scripts keep the board
 * shape; `now` / `files` / `hunk` / `todo` appear only when that
 * attempt's journal was loaded.
 */
function jsonRow(
  row: StatusRow,
  view?: ViewState,
): StatusRow & { now?: string; files?: string[]; hunk?: string[]; todo?: string } {
  if (view === undefined) return row;
  const now = rowNow(view, row);
  const files = selectedFiles(view);
  const hunk = selectedHunk(view).slice(-HUNK_BAND_MAX);
  const current = currentPlanItem(selectedPlan(view));
  return {
    ...row,
    ...(now !== undefined && now !== "" ? { now } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(hunk.length > 0 ? { hunk } : {}),
    ...(current !== undefined ? { todo: `[${current.mark}] ${current.text}` } : {}),
  };
}

/**
 * Last tool, files, hunk, peek/tail, and current todo — raw paths, no
 * OSC-8. A named issue always passes a journal view. A full-board
 * print passes one only for running rows.
 */
export function renderHeadlessStrip(state: ViewState): string[] {
  const extra: string[] = [];
  const now = selectedNow(state);
  if (now !== undefined && now !== "") extra.push(`  ${now}`);
  for (const line of selectedReadPeek(state).slice(0, READ_BAND_MAX)) {
    extra.push(`  ${line}`);
  }
  for (const line of selectedCommandTail(state).slice(-COMMAND_BAND_MAX)) {
    extra.push(`  ${line}`);
  }
  for (const file of selectedFiles(state).slice(-FILE_MAX)) {
    extra.push(`  ${file}`);
  }
  for (const line of selectedHunk(state).slice(-HUNK_BAND_MAX)) {
    extra.push(`  ${line}`);
  }
  const plan = selectedPlan(state);
  const current = currentPlanItem(plan);
  if (current !== undefined) {
    const done = plan.filter((item) => item.mark === "x").length;
    extra.push(`  [${current.mark}] ${current.text}  ${done}/${plan.length}`);
  }
  return extra;
}

/** Request id, branch, pull-request URL, spend, checkout, then the journal strip. */
function renderHeadlessAttempt(row: StatusRow, view?: ViewState, now: number = Date.now()): string[] {
  const extra: string[] = [];
  const age = freshnessLabel(row, view?.activity ?? [], now);
  if (age !== undefined) extra.push(`  ${age}`);
  if (row.run?.prUrl) extra.push(`  ${row.run.prUrl}`);
  if (row.run?.requestId) extra.push(`  @ ${row.run.requestId}`);
  if (row.run?.branch) extra.push(`  ${row.run.branch}`);
  if (row.run?.workspacePath) extra.push(`  ${row.run.workspacePath}`);
  const usage = renderUsageBits(row);
  if (usage.length > 0) extra.push(`  ${usage.join("  ·  ")}`);
  if (row.run?.finalMessage) {
    for (const wrapped of wrap(row.run.finalMessage, 78).slice(0, 2)) {
      extra.push(`  ${wrapped}`);
    }
  }
  const brief = rowBrief(row);
  if (brief !== null) extra.push(`  brief  ${brief}`);
  if (view !== undefined) extra.push(...renderHeadlessStrip(view));
  return extra;
}

/** One-line watch tick, then the same attempt extras `status` prints. */
export function renderWatchLine(
  rows: StatusRow[],
  views?: Readonly<Record<string, ViewState>>,
  now: number = Date.now(),
): string {
  if (rows.length === 0) return "watch · no rows";
  return rows
    .map((row) => {
      const ask = row.questions.length > 0 ? ` ask=${row.questions.length}` : "";
      const outcome = row.run?.outcome != null ? ` ${row.run.outcome}` : "";
      const fail =
        rowFailed(row) && row.questions.length === 0 ? ` · ${failureReason(row)}` : "";
      const head = `${row.issue ?? row.taskId} ${row.status}${outcome}${ask}${fail}`;
      return [head, ...renderHeadlessAttempt(row, viewForRow(row, views), now)].join("\n");
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
