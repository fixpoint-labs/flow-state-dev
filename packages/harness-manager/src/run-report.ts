/**
 * The report a coding run ends with, as the brief asks for it and as a
 * browser card reads it back.
 *
 * `codingBrief` asks every run to end its last message with three sections
 * under fixed headings ({@link RUN_REPORT_ASK}): what changed, its checks
 * (each line led by how it ended), and what is worth knowing beyond the
 * change. {@link runReport} reads those sections back out of the run's
 * answer, so a review card can draw a check as a check and a note as a note.
 * The brief and the reader live together so the headings can't drift apart.
 *
 * A report is still Markdown a person can read whole: an app that draws the
 * answer as it is loses nothing. Browser-safe: it imports nothing.
 */

/** The three headings, as the brief spells them and the reader finds them. */
export const RUN_REPORT_HEADINGS = { changed: "What changed", checks: "Checks", notes: "Worth knowing" } as const;

/** How a check the run reports ended, as the line's first word(s) say it. */
export type RunReportCheckStatus = "passed" | "failed" | "pre-existing" | "not done";

const STATUSES: readonly RunReportCheckStatus[] = ["passed", "failed", "pre-existing", "not done"];

/** The report the brief asks for. */
export const RUN_REPORT_ASK = [
  "End your last message with this report, under these Markdown headings, in this order:",
  "",
  `## ${RUN_REPORT_HEADINGS.changed}`,
  "A sentence or two on what the change does, then a short bullet per part.",
  "",
  `## ${RUN_REPORT_HEADINGS.checks}`,
  "One bullet per check: each command you ran with its result, and each check you could not do and why.",
  `Start each bullet with how it ended: ${STATUSES.map((s) => `\`${s}:\``).join(", ")} (failing before your change too).`,
  "For example: `- passed: pnpm typecheck — no errors`.",
  "",
  `## ${RUN_REPORT_HEADINGS.notes}`,
  "One bullet per thing a reviewer should know beyond the change: a debt you left, a follow-up worth filing, something odd you saw. Leave the section out when there is none.",
].join("\n");

/** One check line of a run's report: how it ended, and the rest of the line in Markdown. */
export interface RunReportCheck {
  /** `null` when the line didn't start with one of the statuses. */
  status: RunReportCheckStatus | null;
  /** The line after its status, such as "pnpm typecheck — no errors". */
  text: string;
}

/** A run's report, read from its answer. */
export interface RunReport {
  /** What changed, in Markdown; `null` when the answer has no such section. */
  changed: string | null;
  /** Each check line, in order. */
  checks: RunReportCheck[];
  /** Each "worth knowing" line, in Markdown. */
  notes: string[];
}

const HEADING = /^#{1,4}\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

type Section = keyof typeof RUN_REPORT_HEADINGS;

/** Which report section a heading opens, by its words, any case and trailing colon aside. */
function sectionOf(heading: string): Section | null {
  const words = heading.replace(/[:*_`]/g, "").trim().toLowerCase();
  for (const [key, title] of Object.entries(RUN_REPORT_HEADINGS) as Array<[Section, string]>) {
    if (words === title.toLowerCase()) return key;
  }
  return null;
}

/** A section's bullets, each with its wrapped lines joined; text outside a bullet is its own line. */
function bulletsOf(lines: readonly string[]): string[] {
  const items: string[] = [];
  let open = false;
  for (const line of lines) {
    if (line.trim() === "") {
      open = false;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      items.push(bullet[1]!.trim());
      open = true;
    } else if (open && /^\s+/.test(line)) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    } else {
      items.push(line.trim());
      open = false;
    }
  }
  return items.filter((item) => item !== "");
}

/** A check line's status, read off its start ("passed:", "**Failed** —"), and the rest. */
function checkOf(item: string): RunReportCheck {
  const plain = item.replace(/^\*\*([^*]+)\*\*/, "$1").replace(/^`([^`]+)`/, "$1");
  for (const status of STATUSES) {
    const match = new RegExp(`^${status.replace(" ", "[ -]")}\\s*[:—–-]\\s*`, "i").exec(plain);
    if (match) return { status, text: plain.slice(match[0].length).trim() };
  }
  return { status: null, text: item };
}

/**
 * A run's answer read as its report: the sections under the brief's headings.
 * `null` when the answer has none of them, so a caller shows the answer whole.
 * Text before the first heading counts toward What changed when that section
 * is missing, so a report that only opens with prose still reads.
 */
export function runReport(answer: string | null | undefined): RunReport | null {
  if (answer == null) return null;
  const sections: Partial<Record<Section, string[]>> = {};
  const before: string[] = [];
  let current: string[] | null = before;
  let found = false;
  let fence = false;
  for (const line of answer.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = fence ? null : HEADING.exec(line);
    if (heading) {
      const section = sectionOf(heading[1]!);
      if (section !== null) {
        found = true;
        current = sections[section] = [];
        continue;
      }
      // Another heading inside What changed stays part of it; elsewhere it ends the section.
      if (current !== sections.changed && current !== before) current = null;
    }
    current?.push(line);
  }
  if (!found) return null;
  const changed = (sections.changed ?? before).join("\n").trim();
  return {
    changed: changed === "" ? null : changed,
    checks: bulletsOf(sections.checks ?? []).map(checkOf),
    notes: bulletsOf(sections.notes ?? []),
  };
}
