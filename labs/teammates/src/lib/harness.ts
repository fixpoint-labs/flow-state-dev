/**
 * A coding harness by the name a worker's `harness:` line and a run's spend
 * both use (`claude-code`, `codex`, `cursor`), as the screen names it.
 */
const HARNESS_NAME: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor" };

/** The screen's name for a harness; one the lab doesn't know shows as it is spelled. */
export const harnessName = (harness: string) => HARNESS_NAME[harness] ?? harness;
