/**
 * Pure form ↔ payload mapping for the thesis editor (FIX-760). The dialog stays
 * dumb: it holds raw input strings and delegates the load-bearing mapping —
 * pre-filling from an existing record, and building the `saveThesis` action
 * input — to these tested pure helpers (the `aggregate.ts` / `ledger-row-model`
 * precedent: logic lives in node-testable functions, components only render).
 *
 * Real-money discipline: a blank optional field maps to `null`, never a
 * fabricated value; an unparseable number maps to `null` (the server re-validates
 * with `thesisInputSchema`, so the client validation is deliberately light).
 */
import {
  thesisInputSchema,
  type ThesisInputFields,
  type ThesisRecord,
  type TimeHorizon,
  type Tripwire,
  type TripwireKind,
} from "@/src/flows/portfolio/thesis-schema";

/** A tripwire row as the editor holds it: every field is a raw string so an
 *  in-progress, not-yet-numeric row never throws. */
export type TripwireDraft = {
  kind: TripwireKind;
  note: string;
  level: string;
  byDate: string;
};

/** The editor's full draft state — raw strings, one per field. */
export type ThesisFormState = {
  entryRationale: string;
  invalidationConditions: string;
  timeHorizon: TimeHorizon | "";
  targetPrice: string;
  stopPrice: string;
  tripwires: TripwireDraft[];
};

/** The empty draft for a brand-new thesis (no existing record). */
export function emptyThesisForm(): ThesisFormState {
  return {
    entryRationale: "",
    invalidationConditions: "",
    timeHorizon: "",
    targetPrice: "",
    stopPrice: "",
    tripwires: [],
  };
}

/** Pre-fill the draft from an existing thesis record (the edit path). Numbers
 *  render as their string form; `null`s become empty strings so the inputs are
 *  blank, not "null". */
export function thesisRecordToForm(record: ThesisRecord): ThesisFormState {
  return {
    entryRationale: record.entryRationale,
    invalidationConditions: record.invalidationConditions ?? "",
    timeHorizon: record.timeHorizon ?? "",
    targetPrice: record.targetPrice === null ? "" : String(record.targetPrice),
    stopPrice: record.stopPrice === null ? "" : String(record.stopPrice),
    tripwires: record.tripwires.map((t) => ({
      kind: t.kind,
      note: t.note,
      level: t.level === null ? "" : String(t.level),
      byDate: t.byDate ?? "",
    })),
  };
}

/** Parse an optional numeric field. Blank/whitespace → null; otherwise the
 *  parsed number, or null when unparseable (the server re-validates). */
function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** A draft tripwire is kept only if it carries a note; the note is what makes a
 *  tripwire an observable. A note-less row is the user's empty scaffold, dropped
 *  on save. */
function formTripwireToTripwire(draft: TripwireDraft): Tripwire | null {
  const note = draft.note.trim();
  if (note.length === 0) return null;
  const byDate = draft.byDate.trim();
  return {
    kind: draft.kind,
    note,
    level: parseOptionalNumber(draft.level),
    byDate: byDate.length === 0 ? null : byDate,
  };
}

/**
 * Build the `saveThesis` action input from the draft + the holding's ticker. The
 * ticker is canonicalized upper-case (the household × ticker key matches the
 * holdings rows). Empty optional fields collapse to null.
 *
 * `existingSourceSessionId` carries the originating-report link THROUGH an edit:
 * editing a thesis that was adopted from a report must NOT erase its
 * `sourceSessionId` (the repository update writes whatever is passed). A
 * hand-written thesis has none, so it defaults to null; the `adoptThesis` derive
 * path sets it server-side and a later Portfolio edit preserves it here.
 */
export function buildSaveThesisPayload(
  ticker: string,
  form: ThesisFormState,
  existingSourceSessionId: string | null = null,
): ThesisInputFields {
  const invalidation = form.invalidationConditions.trim();
  return {
    ticker: ticker.trim().toUpperCase(),
    entryRationale: form.entryRationale.trim(),
    invalidationConditions: invalidation.length === 0 ? null : invalidation,
    tripwires: form.tripwires
      .map(formTripwireToTripwire)
      .filter((t): t is Tripwire => t !== null),
    timeHorizon: form.timeHorizon === "" ? null : form.timeHorizon,
    targetPrice: parseOptionalNumber(form.targetPrice),
    stopPrice: parseOptionalNumber(form.stopPrice),
    sourceSessionId: existingSourceSessionId,
  };
}

/** Whether the draft is savable: entry rationale is required and non-empty (the
 *  one client gate; the server enforces the rest). Drives the Save button's
 *  disabled state. */
export function canSaveThesis(form: ThesisFormState): boolean {
  return form.entryRationale.trim().length > 0;
}

/**
 * Validate the built payload against the SAME `thesisInputSchema` the action
 * re-validates server-side, returning the first human-readable error (field-
 * prefixed) or null when valid. The dialog calls this on save so an input the
 * server would reject — a nonpositive target/stop price, more than 20 tripwires —
 * keeps the editor open instead of dispatching, closing, and silently losing the
 * draft to a stream failure the UI never sees (`sendAction` resolves at
 * stream-attach, before the validation failure surfaces). `canSaveThesis` gates
 * the blank-form case (empty rationale); this covers the typed-but-invalid case.
 */
export function thesisFormError(
  ticker: string,
  form: ThesisFormState,
  existingSourceSessionId: string | null = null,
): string | null {
  const result = thesisInputSchema.safeParse(
    buildSaveThesisPayload(ticker, form, existingSourceSessionId),
  );
  if (result.success) return null;
  const issue = result.error.issues[0];
  const field = issue.path.join(".");
  return field.length > 0 ? `${field}: ${issue.message}` : issue.message;
}
