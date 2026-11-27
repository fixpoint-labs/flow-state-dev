import type { HarnessReadinessChipRow } from "../components/flow-state/harness-readiness";

/**
 * A coding harness by the name a worker's `harness:` line and a run's spend
 * both use (`claude-code`, `codex`, `cursor`), as the screen names it.
 */
const HARNESS_NAME: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor" };

/** The screen's name for a harness; one the lab doesn't know shows as it is spelled. */
export const harnessName = (harness: string) => HARNESS_NAME[harness] ?? harness;

/** Whether a coding task can run on a harness: ready, not ready, or a check that got no answer. */
export type HarnessStatus = "ready" | "not-ready" | "unknown";

/** A row's state; a check that got no answer is unknown, never "not ready". The one place that rule lives: the pill, the picker and the context bar all read it. */
export const harnessState = (chip: HarnessReadinessChipRow): HarnessStatus => (chip.ready ? "ready" : chip.unanswered ? "unknown" : "not-ready");

/** Each state's dot: green ready, amber not ready, grey for a check that got no answer. */
export const HARNESS_DOT: Record<HarnessStatus, string> = { ready: "bg-success", "not-ready": "bg-warning", unknown: "bg-presence-idle" };

/** Each state in words, for a label or a menu row. */
export const HARNESS_STATUS_WORDS: Record<HarnessStatus, string> = { ready: "ready", "not-ready": "not ready", unknown: "not checked" };

/**
 * The warning for coding on `harness`, or `undefined` when there is nothing to
 * warn about: no chips yet, a harness the chips don't list, one that is ready,
 * or one whose check got no answer (an unanswered check isn't evidence it fails).
 * Otherwise the harness, its label, why it can't run, and the harnesses that can.
 */
export function harnessWarning(chips: readonly HarnessReadinessChipRow[] | undefined, harness: string | undefined) {
  if (chips === undefined || harness === undefined) return undefined;
  const chip = chips.find((c) => c.harness === harness);
  if (chip === undefined || harnessState(chip) !== "not-ready") return undefined;
  return { harness, label: chip.label, why: chip.remedy ?? chip.reason, ready: chips.filter((c) => c.ready) };
}
