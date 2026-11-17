// FIX-2129.
/**
 * Pure suspension-status leaf types consumed by the item taxonomy, and the one
 * test of whether a suspension waits for a user. The full
 * suspension record/filter machinery (and its serialization concerns) stays
 * in `core/types/suspension.ts`, which re-exports these from here.
 */

/** Lifecycle status of a suspension. `pending` is the sole non-terminal state. */
export type SuspensionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "submitted"
  | "skipped"
  | "timed_out"
  | "expired"
  // FIX-1816.
  /**
   * A person stopped the parked turn. Absent on records written
   * before it existed; a reader that does not know it treats it as resolved.
   */
  | "stopped"
  // FIX-2129.
  /**
   * The suspension's task was cancelled while it waited, or the board
   * cancelled this one stop. The block reads it and runs to its
   * end. A reader that does not know it treats it as resolved.
   */
  | "cancelled";

/**
 * Why a block suspended. The well-known reasons are enumerated; the open
 * `string & {}` arm lets callers carry custom reasons without losing
 * autocomplete on the known set.
 */
export type SuspensionReason =
  | "user_approval"
  | "user_input"
  | "external_event"
  | (string & {});

/**
 * The resolution actions a resumer can send to the resume endpoint. `approve`
 * and `reject` are the original binary outcomes; `submit` carries a validated
 * payload (a question answer, a form, a selection); `skip` declines an optional
 * step so the run continues with a default. A leaf type so the item taxonomy
 * (`SuspensionItem.allow`) can reference it without depending on `core`.
 */
export type ResumeAction = "approve" | "reject" | "submit" | "skip";

// FIX-2129.
/**
 * What a suspension for a user asks for (`ctx.suspendForUser`):
 *
 * - `approval`: a yes or a no. At a deadline, a no.
 * - `review`: a verdict on work the user looks at.
 * - `input`: an answer the code reads on its next line.
 *
 * Never a question: a question with a task holds its task instead.
 */
export type SuspendForUserKind = "approval" | "review" | "input";

// FIX-2770.
/**
 * Every stored reason that waits for a user: the two current names and the
 * `human_*` names core 0.2.0 stored. The set {@link isUserSuspension} reads,
 * exported so a store's SQL predicate reads the same one.
 */
export const USER_SUSPENSION_REASONS: readonly string[] = Object.freeze([
  "user_approval",
  "user_input",
  "human_approval", // retired-name-refusal: a stop core 0.2.0 stored
  "human_input" // retired-name-refusal: a stop core 0.2.0 stored
]);

const USER_REASONS: ReadonlySet<string> = new Set(USER_SUSPENSION_REASONS);

/** A reason core 0.2.0 stored under its old `human_*` name, read as the `user_*` one. */
function currentReason(reason: string): string {
  if (reason === "human_approval") return "user_approval"; // retired-name-refusal: a stop core 0.2.0 stored
  if (reason === "human_input") return "user_input"; // retired-name-refusal: a stop core 0.2.0 stored
  return reason;
}

/**
 * Whether a suspension waits for a user: the one predicate every reader keys
 * on (the claim gate, the answer route, the Inbox). True for a
 * `ctx.suspendForUser` stop and for a raw `ctx.suspend` with `user_approval` or
 * `user_input`. `external_event` and a custom reason (the open `string & {}`
 * arm of {@link SuspensionReason}) are never a user's. A stop core 0.2.0
 * stored under its old `human_*` reason is a user's.
 */
export function isUserSuspension(suspension: { readonly reason: string }): boolean {
  return USER_REASONS.has(suspension.reason);
}

/**
 * The kind of a user's suspension: its own `kind`, or, on a record that
 * carries none (a raw `ctx.suspend`), read from its reason: `user_approval`
 * an approval, `user_input` input. `undefined` for a suspension that does
 * not wait for a user.
 */
export function suspendForUserKindOf(suspension: {
  readonly reason: string;
  readonly kind?: SuspendForUserKind | undefined;
}): SuspendForUserKind | undefined {
  if (!isUserSuspension(suspension)) return undefined;
  if (suspension.kind !== undefined) return suspension.kind;
  return currentReason(suspension.reason) === "user_approval" ? "approval" : "input";
}

// FIX-849; FIX-2770 (moved here from react's form hook).
// ---------------------------------------------------------------------------
// The card a suspension draws, read from its schema
// ---------------------------------------------------------------------------

/** The value shapes the bounded renderers understand. */
export type SuspensionValueKind =
  | "object"
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "enum-multi";

/** A single renderable field derived from a flat object `resumeSchema`. */
export interface SchemaField {
  /** Property key in the form value object. */
  key: string;
  /** Human label — the schema's `title` if present, else the key. */
  label: string;
  /** The control kind to render. */
  kind: SuspensionValueKind;
  /** Whether the schema marks this property required. */
  required: boolean;
  /** Option values for `enum` / `enum-multi` fields. */
  options?: string[];
  /** Optional helper text from the schema's `description`. */
  description?: string;
}

type JsonSchema = Record<string, unknown>;

/** Classify a single property schema into one of the bounded scalar/enum kinds. */
function classifyProperty(prop: JsonSchema): { kind: SuspensionValueKind; options?: string[] } | null {
  const type = prop.type;
  const enumValues = Array.isArray(prop.enum) ? (prop.enum as unknown[]).map(String) : undefined;
  if (type === "array") {
    const items = prop.items as JsonSchema | undefined;
    const itemEnum = items !== undefined && Array.isArray(items.enum)
      ? (items.enum as unknown[]).map(String)
      : undefined;
    if (itemEnum !== undefined) return { kind: "enum-multi", options: itemEnum };
    return null; // arrays of non-enum / objects are out of bounds
  }
  if (enumValues !== undefined) return { kind: "enum", options: enumValues };
  if (type === "number" || type === "integer") return { kind: "number" };
  if (type === "boolean") return { kind: "boolean" };
  if (type === "string") return { kind: "string" };
  return null;
}

/**
 * Analyze a `resumeSchema` into the value kind and (for flat objects) its fields.
 * Returns `kind: "object"` with the field list for a flat object of supported
 * scalars/enums; a single scalar/enum kind for a top-level scalar; or `null` when
 * the schema is out of bounds (nested/array-of-object/union) — the caller then
 * routes to a custom renderer. A `undefined` schema is treated as a free-text
 * string (the clarifying-question default).
 */
export function analyzeResumeSchema(
  schema: JsonSchema | undefined
): { kind: SuspensionValueKind; fields: SchemaField[]; options?: string[] } | null {
  if (schema === undefined) return { kind: "string", fields: [] };

  if (schema.type === "object") {
    const properties = schema.properties as Record<string, JsonSchema> | undefined;
    if (properties === undefined) return null;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const fields: SchemaField[] = [];
    for (const [key, prop] of Object.entries(properties)) {
      const classified = classifyProperty(prop);
      if (classified === null) return null; // any unsupported property → custom renderer
      fields.push({
        key,
        label: typeof prop.title === "string" ? prop.title : key,
        kind: classified.kind,
        required: required.has(key),
        options: classified.options,
        description: typeof prop.description === "string" ? prop.description : undefined
      });
    }
    return { kind: "object", fields };
  }

  const classified = classifyProperty(schema);
  if (classified === null) return null;
  return { kind: classified.kind, fields: [], options: classified.options };
}

/** The default card a suspension dispatches to. */
export type SuspensionShape = "approval" | "question" | "selection" | "form";

/**
 * Pick the default card shape for a suspension from its `reason`, `allow`, and
 * `resumeSchema`. Shared by react's built-in `ItemRenderer` dispatch, the
 * polished UI dispatcher and the server's read of a user's pending
 * suspensions, so they never diverge:
 *  - `user_approval` → approval.
 *  - `user_input` whose permitted actions don't include `submit` → approval.
 *    This covers a legacy record persisted before `allow` existed (the resume
 *    route treats a missing `allow` as binary approve/reject) and an explicitly
 *    binary `user_input` gate — rendering a submit-only card for either would
 *    show a button the server 409s.
 *  - otherwise `user_input` → form (flat object) / selection (enum) / question
 *    (everything else, including a schema richer than the bounded set).
 * Pure.
 */
export function suspensionShape(item: {
  reason: string;
  resumeSchema?: Record<string, unknown>;
  allow?: ResumeAction[];
}): SuspensionShape {
  if (currentReason(item.reason) !== "user_input") return "approval";
  // No submit path → render the binary approval card so the gate stays resolvable.
  if (item.allow === undefined || !item.allow.includes("submit")) return "approval";
  const analysis = analyzeResumeSchema(item.resumeSchema);
  if (analysis !== null && analysis.kind === "object") return "form";
  if (analysis !== null && (analysis.kind === "enum" || analysis.kind === "enum-multi")) {
    return "selection";
  }
  return "question";
}
