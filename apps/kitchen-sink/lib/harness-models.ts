/**
 * What each harness mode's New session offers to pick: the models, the one
 * preselected, and why the list is short or empty when it is.
 *
 * Server only. Each list is the harness's own where its SDK can list (Claude
 * Code) and one Kitchen Sink keeps otherwise (Codex, Cursor). The mode
 * files read them (`claudeCodeModelChoices`, `codexModelChoices`,
 * `cursorModelChoices`); this module shares one read among the page loads that
 * arrive during it, keeps a list that was read in full until the server
 * restarts, and asks again on the next page load after one that wasn't.
 * Browser code imports only the types.
 *
 * Kitchen Sink never checks a picked id against the list: the harness judges
 * what it runs.
 */
import { claudeCodeModelChoices } from "./claude-code-mode";
import { codexModelChoices } from "./codex-mode";
import { cursorModelChoices } from "./cursor-mode";
import type { HarnessModeId } from "./modes";

/** One model a mode offers: the id the harness takes, and a name for a person. */
export interface HarnessModel {
  readonly id: string;
  readonly label: string;
}

/** What New session offers in one harness mode. */
export interface ModelChoices {
  /** The models to pick from. Empty: New session can't start a session, and `reason` says why. */
  readonly models: readonly HarnessModel[];
  /** The model preselected, or `null` when there is none to pick. */
  readonly defaultId: string | null;
  /** Why the list is short or empty, for a person; `null` when it is the harness's whole list. */
  readonly reason: string | null;
  /**
   * The model a session with none runs on (one stored before models could be
   * picked), or `null` when it runs on the harness's own default.
   */
  readonly fallbackId: string | null;
}

/** Each harness mode's list. */
const LISTS: Record<HarnessModeId, () => Promise<ModelChoices>> = {
  "claude-code": () => claudeCodeModelChoices(),
  codex: () => codexModelChoices(),
  cursor: () => cursorModelChoices(),
};

/** Kept on `globalThis` beside the harness gate's answer, for the same reason (`lib/harness-gate.ts`). */
const MEMO = Symbol.for("kitchen-sink.harness-models");
type Memo = typeof globalThis & { [MEMO]?: Map<HarnessModeId, Promise<ModelChoices>> };

/**
 * The models mode `id` offers. Loads during a read share it; a read with a
 * reason is dropped, so the next load asks again. `lists` is a seam for tests.
 */
export function harnessModelChoices(
  id: HarnessModeId,
  lists: Record<HarnessModeId, () => Promise<ModelChoices>> = LISTS,
): Promise<ModelChoices> {
  const memo = ((globalThis as Memo)[MEMO] ??= new Map());
  const kept = memo.get(id);
  if (kept !== undefined) return kept;
  const reading: Promise<ModelChoices> = read(lists[id]).then((choices) => {
    if (choices.reason !== null && memo.get(id) === reading) memo.delete(id);
    return choices;
  });
  memo.set(id, reading);
  return reading;
}

/** One list read, its throw turned into an empty list with the reason. */
async function read(list: () => Promise<ModelChoices>): Promise<ModelChoices> {
  try {
    return await list();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { models: [], defaultId: null, reason: `The model list can't be read: ${message}`, fallbackId: null };
  }
}

/** Forget every kept list. Tests only. */
export function resetHarnessModelChoicesForTests(): void {
  delete (globalThis as Memo)[MEMO];
}
