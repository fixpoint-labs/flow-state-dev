/**
 * Held work, as the manager records it and tells a run about it.
 *
 * The workspace host does the git (`checkpoint`, `provision`, `dropHeld`). The
 * manager decides when, writes the run record around each step, and parks a
 * run whose held work disagrees with its record. This module holds the pure
 * half of that: what goes on the record, how many times a hold is tried, and
 * the words a run and its owner are shown.
 */
import type { HeldWork, HeldWorkMismatchField, RecordedHold, WorkspacePlace } from "@flow-state-dev/workspace";
import type { HeldRecord } from "./run-record";

/**
 * How many times a hold, and the record write after it, is tried before it
 * counts as failed. A hold that fails at completion fails the attempt, and the
 * retry pays for an agent turn that already did the work, so a transient store
 * error gets a few tries first.
 */
export const HOLD_TRIES = 3;
/** The wait before the second try; doubled before each one after. */
export const HOLD_BACKOFF_MS = 200;

/** Run `operation` up to {@link HOLD_TRIES} times, backing off between tries. Rethrows the last failure. */
export async function withHoldRetries<T>(operation: () => Promise<T>, retryable: (error: unknown) => boolean = () => true): Promise<T> {
  let wait = HOLD_BACKOFF_MS;
  for (let tried = 1; ; tried += 1) {
    try {
      return await operation();
    } catch (error) {
      if (tried >= HOLD_TRIES || !retryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait *= 2;
    }
  }
}

/** What the record keeps of a hold that succeeded. */
export function heldRecordOf(hold: HeldWork, attempt: number, at: number): HeldRecord {
  return {
    attempt,
    at,
    base: hold.base,
    head: hold.head,
    snapshot: hold.snapshot,
    key: hold.key,
    sha256: hold.sha256,
    bytes: hold.bytes,
    skipped: hold.skipped.map((s) => ({ path: s.path, why: s.why })),
    error: null,
    parked: false,
  };
}

/** What the record keeps of a hold that failed: the last good one, and why this one did not land. */
export function failedHeldRecord(previous: HeldRecord | null, attempt: number, at: number, error: string): HeldRecord {
  return {
    base: null,
    head: null,
    snapshot: null,
    key: null,
    sha256: null,
    bytes: null,
    skipped: [],
    parked: false,
    ...previous,
    attempt,
    at,
    error,
  };
}

/** The recorded hold in the shape `provision` takes, or `null` when no hold ever landed. */
export function recordedHoldOf(held: HeldRecord | null): RecordedHold | null {
  if (held === null || held.base === null || held.head === null || held.snapshot === null || held.key === null || held.sha256 === null) {
    return null;
  }
  return {
    base: held.base,
    head: held.head,
    snapshot: held.snapshot,
    key: held.key,
    sha256: held.sha256,
    ...(held.parked ? { parked: true } : {}),
  };
}

/** What each mismatch field means, to a person who did not build the run. */
const MISMATCH_MEANING: Record<HeldWorkMismatchField, string> = {
  scope: "the saved work is stored outside the place this run is allowed to read",
  pack: "the saved work is missing, or it is not the copy this run recorded",
  base: "the commit the run started from is no longer on the repository",
  head: "the run's last commit is not in the saved work",
  snapshot: "the run's saved files are not in the saved work",
  tree: "the files rebuilt from the saved work are not the ones the run saved",
  branch: "the saved work belongs to another branch",
  remote: "the saved work belongs to another repository",
  disabled: "this run's work was saved on another machine, and the machine it is on now is not set up to bring it back",
};

/**
 * The question a run's owner is asked when its held work cannot be used. It
 * names what disagreed, never the work's contents.
 */
export function mismatchQuestion(field: HeldWorkMismatchField, attempt: number | null): string {
  const from = attempt === null ? "" : ` at the end of attempt ${attempt}`;
  return (
    `This run's saved work${from} could not be brought back: ${MISMATCH_MEANING[field]} (${field}). ` +
    `Nothing has been changed or deleted. Answer to start the run again from its base` +
    (field === "disabled" ? "." : `, with the saved files beside it in held/ when they can be read.`)
  );
}

/**
 * What the prompt says about where this attempt's checkout came from, or
 * `undefined` when it is the same place the run always had.
 */
export function heldPromptSection(place: WorkspacePlace, held: HeldRecord | null): string | undefined {
  if (place.origin === "held") {
    return (
      `## Your checkout was rebuilt on a new machine\n\n` +
      `The machine this run was on is gone. This checkout was rebuilt from the work saved at the end of ` +
      `attempt ${held?.attempt ?? "?"}: the same commits, and the same edited, new and deleted files, left ` +
      `unstaged. Anything after that was lost. Your earlier conversation is not available here, so this is a ` +
      `fresh one: read the checkout to see where the work stands before you change it.`
    );
  }
  // After its owner answered a mismatch: from the base, with the saved files
  // beside the checkout when they could be read.
  if (held?.parked === true && place.origin !== "live") {
    return place.heldDir !== undefined
      ? `## Saved work beside the checkout\n\nThis run starts again from its base. The files saved earlier ` +
          `could not be used as they were, so they are in ${place.heldDir}, beside the checkout and not inside ` +
          `it. Take what you need from there.`
      : `## Starting again from the base\n\nThis run starts again from its base. The work saved earlier could ` +
          `not be brought back here, so there is no copy of it beside the checkout.`;
  }
  if (place.origin === "base") {
    return (
      `## Starting again from the base\n\nThis run moved to a new machine, and nothing was saved from earlier ` +
      `attempts. It starts from its base.`
    );
  }
  return undefined;
}
