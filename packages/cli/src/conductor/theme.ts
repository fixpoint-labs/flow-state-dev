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

export function pad(text: string, width: number, align: "left" | "right" = "left"): string {
  const visible = visibleWidth(text);
  if (visible >= width) return truncate(stripAnsi(text), width);
  const gap = " ".repeat(width - visible);
  return align === "right" ? gap + text : text + gap;
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
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
