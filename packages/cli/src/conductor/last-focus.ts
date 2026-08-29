/**
 * Remember which board row the operator was on.
 *
 * The board session is durable. The selected row is not — `/quit` and a
 * later open used to land on the first row. This file is next to the
 * lab store, one per operator session.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Sidecar next to the config's `.fsdev` store. */
export function lastFocusPath(configPath: string, sessionId: string): string {
  return join(dirname(configPath), ".fsdev", `tui-focus-${sessionId}`);
}

/** The issue id (or task id) last selected, if the sidecar exists. */
export function readLastFocus(path: string): string | undefined {
  try {
    const text = readFileSync(path, "utf8").trim();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

/** Persist the selected row's issue, or its task id when it has no issue. */
export function writeLastFocus(path: string, issue: string): void {
  if (issue === "") return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${issue}\n`);
}
