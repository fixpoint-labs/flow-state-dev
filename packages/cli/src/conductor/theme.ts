/**
 * ANSI helpers. The palette follows the Conductor Atlas so the terminal
 * surface and the design page read as the same object.
 */

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const REVERSE = "\x1b[7m";
export const UNDERLINE = "\x1b[4m";

/** Atlas accent — indigo. */
export const ACCENT = "\x1b[38;5;67m";
/** Atlas code / exists — teal. */
export const TEAL = "\x1b[38;5;72m";
/** Atlas prose / waiting — gold. */
export const GOLD = "\x1b[38;5;178m";
/** Atlas human / question — mauve. */
export const MAUVE = "\x1b[38;5;132m";
/** Atlas gone / failed — rust. */
export const RUST = "\x1b[38;5;167m";
export const INK = "\x1b[38;5;252m";
export const INK_2 = "\x1b[38;5;245m";
export const INK_3 = "\x1b[38;5;240m";
export const SURFACE = "\x1b[48;5;236m";
export const SELECT_BG = "\x1b[48;5;237m";

export function paint(code: string, text: string): string {
  return `${code}${text}${RESET}`;
}

export function bold(text: string): string {
  return paint(BOLD, text);
}

export function dim(text: string): string {
  return paint(DIM + INK_2, text);
}

export function accent(text: string): string {
  return paint(ACCENT, text);
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

/**
 * Keep the end of a long token. A path's filename stays visible
 * when the checkout prefix will not fit.
 */
export function elideEnd(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `…${text.slice(-(width - 1))}`;
}

/** Paths keep the filename; everything else keeps the start. */
export function shorten(text: string, width: number): string {
  return text.includes("/") ? elideEnd(text, width) : truncate(text, width);
}

/**
 * A tool subject: a path-only token keeps the filename; a command
 * (spaces) keeps the start even when it contains a slash.
 */
export function shortenSubject(text: string, width: number): string {
  if (text.includes("/") && !/\s/.test(text)) return elideEnd(text, width);
  return truncate(text, width);
}

/**
 * Keep the tool name and, for a path subject, the filename.
 * `tool · Write /long/prefix/file.ts` → `tool · Write …/file.ts`
 */
export function shortenToolLine(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  const prefixed = text.startsWith("tool · ") ? "tool · " : "";
  const rest = prefixed === "" ? text : text.slice(prefixed.length);
  const space = rest.indexOf(" ");
  if (space < 0) return shortenSubject(text, width);
  const name = rest.slice(0, space);
  const subject = rest.slice(space + 1);
  const prefix = `${prefixed}${name} `;
  const remain = width - prefix.length;
  if (remain <= 0) return elideEnd(text, width);
  return `${prefix}${shortenSubject(subject, remain)}`;
}

export function pad(text: string, width: number, align: "left" | "right" = "left"): string {
  const visible = visibleWidth(text);
  if (visible >= width) return truncate(stripAnsi(text), width);
  const gap = " ".repeat(width - visible);
  return align === "right" ? gap + text : text + gap;
}

/**
 * Wrap visible text in an OSC-8 hyperlink. A supporting terminal
 * opens `url` on click. The wrapper is not part of the visible width.
 * Only http(s) and file URLs; a URL that would break the sequence stays plain.
 */
export function link(url: string, text: string): string {
  if (!/^(https?:\/\/|file:\/\/)/i.test(url) || /[\x00-\x1f]/.test(url)) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/**
 * `file://` href for a path the run touched. An absolute path is enough.
 * A relative path needs the run's checkout, or there is nothing to open.
 */
export function fileHref(path: string, cwd?: string | null): string | undefined {
  if (path === "" || /[\x00-\x1f]/.test(path)) return undefined;
  const abs = path.startsWith("/")
    ? path
    : cwd != null && cwd.startsWith("/")
      ? `${cwd.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`
      : undefined;
  if (abs === undefined || !abs.startsWith("/") || /[\x00-\x1f]/.test(abs)) return undefined;
  return `file://${encodeURI(abs)}`;
}

/** Visible path, shortened; OSC-8 so a supporting terminal can open the file. */
export function fileText(path: string, width: number, cwd?: string | null): string {
  const shown = shorten(path, width);
  const href = fileHref(path, cwd);
  return href === undefined ? shown : link(href, shown);
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

/** Wrap on spaces; a single long token is hard-sliced. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [];
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }
    const next = current === "" ? word : `${current} ${word}`;
    if (next.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current !== "") lines.push(current);
  return lines.length === 0 ? [""] : lines;
}

export function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return TEAL;
    case "in_progress":
      return ACCENT;
    case "awaiting_review":
    case "parked":
      return MAUVE;
    case "pending":
      return GOLD;
    case "errored":
    case "cancelled":
      return RUST;
    default:
      return INK_2;
  }
}

export function outcomeColor(outcome: string | null): string {
  switch (outcome) {
    case "succeeded":
      return TEAL;
    case "running":
      return ACCENT;
    case "failed":
      return RUST;
    default:
      return INK_3;
  }
}

export function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Compact age from `at` to `now`: `8s`, `3m`, `2h`, `5d`. Floor, not
 * round — a 59-second gap is still `59s`.
 */
export function formatAge(at: number, now: number = Date.now()): string {
  const ms = Math.max(0, now - at);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** A running row with no write for this long is painted as stalled. */
export const STALL_AFTER_MS = 30_000;
