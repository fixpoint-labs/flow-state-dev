/**
 * Headless controller for the non-binary HITL shapes — a clarifying question, a
 * flat form, or a single/multi selection (FIX-849).
 *
 * Where `useApproval` owns the binary approve/reject gate, this hook owns the
 * `submit`/`skip` path: it holds the in-progress form value, derives renderable
 * fields from the suspension's `resumeSchema` (bounded to a flat object of
 * scalars + enums), validates the value with a small dependency-free checker, and
 * resolves through the same streaming transport so the continuation renders live.
 *
 * Schema scope is deliberately bounded: only a flat object of scalars/enums (or a
 * single top-level scalar/enum) derives fields here. Nested objects, arrays of
 * objects, and unions return no fields and are expected to route to an
 * author-supplied `render.component` renderer instead (see ItemRenderer dispatch).
 *
 * Transport precedence mirrors `useApproval`:
 *   1. SuspensionResolverProvider → stream the continuation into the chat view
 *   2. self-contained recovery client (non-streaming fallback)
 */
import { useCallback, useMemo, useState } from "react";
import { createRecoveryClient } from "@flow-state-dev/client";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { ResumeAction, SuspensionStatus } from "@flow-state-dev/core/types";
import { useFlowContext } from "../context/FlowContext";
import { useSuspensionResolver } from "../context/SuspensionResolver";
import { resolveApprovalOutcome, type ApprovalOutcome } from "./useApproval";

// ---------------------------------------------------------------------------
// Schema → fields (bounded)
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
 * Pick the default card shape for a suspension from its `reason` and
 * `resumeSchema`. Shared by the built-in `ItemRenderer` dispatch and the polished
 * UI dispatcher so the two surfaces never diverge: `human_approval` → approval;
 * `human_input` → form (flat object) / selection (enum) / question (everything
 * else, including a schema richer than the bounded set). Pure — no hooks.
 */
export function suspensionShape(item: {
  reason: string;
  resumeSchema?: Record<string, unknown>;
}): SuspensionShape {
  if (item.reason !== "human_input") return "approval";
  const analysis = analyzeResumeSchema(item.resumeSchema);
  if (analysis !== null && analysis.kind === "object") return "form";
  if (analysis !== null && (analysis.kind === "enum" || analysis.kind === "enum-multi")) {
    return "selection";
  }
  return "question";
}

// ---------------------------------------------------------------------------
// Value seeding, coercion, validation
// ---------------------------------------------------------------------------

/** A blank control value for a given kind (controlled-input friendly). */
function blankValue(kind: SuspensionValueKind): unknown {
  switch (kind) {
    case "boolean":
      return false;
    case "enum-multi":
      return [];
    case "object":
      return {};
    default:
      return "";
  }
}

/** Seed the initial form value from `item.data` (if shaped) or schema blanks. */
function seedValue(
  analysis: { kind: SuspensionValueKind; fields: SchemaField[] },
  data: Record<string, unknown> | undefined
): unknown {
  if (analysis.kind === "object") {
    const seeded: Record<string, unknown> = {};
    for (const field of analysis.fields) {
      const provided = data?.[field.key];
      seeded[field.key] = provided !== undefined ? provided : blankValue(field.kind);
    }
    return seeded;
  }
  return blankValue(analysis.kind);
}

/** Coerce a control value to the JSON type its schema expects (numbers, mainly). */
function coerceForKind(kind: SuspensionValueKind, value: unknown): unknown {
  if (kind === "number") {
    if (value === "" || value === undefined || value === null) return undefined;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}

/** True when a control value is "empty" for required-ness purposes. */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Bounded, dependency-free validation of the form value against the analyzed
 * schema. Mirrors the path-keyed error shape the server returns, so a field can
 * pin its own error. The server re-validates with the full JSON-Schema validator;
 * this is the fast client-side gate, not the source of truth.
 */
function validateValue(
  analysis: { kind: SuspensionValueKind; fields: SchemaField[]; options?: string[] },
  value: unknown
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (analysis.kind === "object") {
    const obj = (value ?? {}) as Record<string, unknown>;
    for (const field of analysis.fields) {
      const v = obj[field.key];
      if (field.required && isEmpty(v)) {
        errors[field.key] = "Required";
        continue;
      }
      if (isEmpty(v)) continue;
      if (field.kind === "number" && Number.isNaN(Number(v))) {
        errors[field.key] = "Must be a number";
      } else if (field.kind === "enum" && field.options !== undefined && !field.options.includes(String(v))) {
        errors[field.key] = "Not a valid option";
      } else if (field.kind === "enum-multi" && Array.isArray(v) && field.options !== undefined) {
        if (v.some((entry) => !field.options!.includes(String(entry)))) {
          errors[field.key] = "Contains an invalid option";
        }
      }
    }
    return errors;
  }

  // Top-level scalar/enum. A declared enum is treated as required (the author
  // asked for one of a fixed set); free-text strings are not.
  if (analysis.kind === "enum" && isEmpty(value)) {
    errors.value = "Required";
  } else if (analysis.kind === "number" && !isEmpty(value) && Number.isNaN(Number(value))) {
    errors.value = "Must be a number";
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Options for {@link useSuspensionForm}. */
export interface UseSuspensionFormOptions {
  /** Whether a matching `suspension_resume` item has already arrived. */
  isResolved?: boolean;
  /** How the suspension resolved, when known — drives the receipt outcome. */
  resolution?: SuspensionStatus;
}

/** Return value of {@link useSuspensionForm}. */
export interface UseSuspensionFormResult {
  /** The value kind this suspension expects (drives which control to render). */
  kind: SuspensionValueKind;
  /** Current form value: an object for `kind:"object"`, else a scalar/array. */
  value: unknown;
  /** Replace the whole form value. */
  setValue: (next: unknown) => void;
  /** Set one property of an object-shaped value (no-op for scalar kinds). */
  setField: (key: string, next: unknown) => void;
  /** Fields derived from a flat object schema (empty for scalar/enum kinds). */
  fields: SchemaField[];
  /** Options for a top-level `enum` / `enum-multi` selection. */
  options?: string[];
  /** Path-keyed validation errors (field key, or `"value"` for a scalar). */
  errors: Record<string, string>;
  /** True when the value validates and no resume is in flight or done. */
  canSubmit: boolean;
  /** Whether a Skip control should render (the suspension permits `skip`). */
  canSkip: boolean;
  /** Validate, then resolve with `action:"submit"` and the coerced payload. */
  submit: () => Promise<void>;
  /** Resolve with `action:"skip"` (no payload). */
  skip: () => Promise<void>;
  /** True while a submit/skip resume is in flight. */
  isResolving: boolean;
  /** True once resolved (by this hook or an external `isResolved`). */
  resolved: boolean;
  /** The resolved status when known. */
  resolution?: SuspensionStatus;
  /** Icon + label for the resolved receipt. */
  outcome: ApprovalOutcome;
  /** Last resume error message, or null. */
  error: string | null;
}

/**
 * Drive a non-binary suspension (question / form / selection). Reads the
 * suspension's `resumeSchema` for field derivation and `allow` for which actions
 * are permitted, and resolves through the streaming resolver (or the recovery
 * client fallback). When the schema is richer than a flat object of scalars/enums
 * the `fields` list is empty — render a custom component instead.
 */
export function useSuspensionForm(
  item: SuspensionItem,
  options: UseSuspensionFormOptions = {}
): UseSuspensionFormResult {
  const { isResolved = false, resolution } = options;
  const { flowKind, baseUrl, userId } = useFlowContext();
  const streamingResolve = useSuspensionResolver();

  const analysis = useMemo(
    () => analyzeResumeSchema(item.resumeSchema) ?? { kind: "string" as SuspensionValueKind, fields: [] },
    [item.resumeSchema]
  );

  const [value, setValue] = useState<unknown>(() => seedValue(analysis, item.data));
  const [pending, setPending] = useState<ResumeAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localResolution, setLocalResolution] = useState<SuspensionStatus | null>(null);

  const recoveryClient = useMemo(() => createRecoveryClient({ baseUrl }), [baseUrl]);

  const allow = item.allow ?? ["approve", "reject"];
  const canSkip = allow.includes("skip");
  const isResolving = pending !== null;
  const resolved = isResolved || localResolution !== null;

  const errors = useMemo(() => validateValue(analysis, value), [analysis, value]);
  const canSubmit = !resolved && !isResolving && Object.keys(errors).length === 0;

  const setField = useCallback((key: string, next: unknown) => {
    setValue((prev: unknown) => ({ ...(prev as Record<string, unknown>), [key]: next }));
  }, []);

  /** Build the submit payload, coercing control values to their schema types. */
  const buildPayload = useCallback((): unknown => {
    if (analysis.kind === "object") {
      const obj = (value ?? {}) as Record<string, unknown>;
      const payload: Record<string, unknown> = {};
      for (const field of analysis.fields) {
        const coerced = coerceForKind(field.kind, obj[field.key]);
        if (coerced !== undefined) payload[field.key] = coerced;
      }
      return payload;
    }
    return coerceForKind(analysis.kind, value);
  }, [analysis, value]);

  const send = useCallback(
    async (action: ResumeAction, data?: unknown) => {
      if (isResolving || resolved) return;
      setPending(action);
      setError(null);
      try {
        if (streamingResolve !== null) {
          await streamingResolve({
            suspensionId: item.suspensionId,
            requestId: item.requestId,
            action,
            data
          });
        } else {
          if (flowKind === undefined || flowKind.length === 0) {
            throw new Error(
              "Cannot resume without flowKind on <FlowProvider> or a SuspensionResolverProvider."
            );
          }
          await recoveryClient.resumeSuspension(flowKind, item.requestId, {
            suspensionId: item.suspensionId,
            action,
            data,
            resumedBy: userId
          });
        }
        setLocalResolution(action === "skip" ? "skipped" : "submitted");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resume suspension");
      } finally {
        setPending(null);
      }
    },
    [isResolving, resolved, streamingResolve, flowKind, recoveryClient, userId, item.suspensionId, item.requestId]
  );

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    await send("submit", buildPayload());
  }, [canSubmit, send, buildPayload]);

  const skip = useCallback(async () => {
    await send("skip");
  }, [send]);

  const resolvedStatus: SuspensionStatus | undefined = localResolution ?? resolution;

  return {
    kind: analysis.kind,
    value,
    setValue,
    setField,
    fields: analysis.fields,
    options: analysis.options,
    errors,
    canSubmit,
    canSkip,
    submit,
    skip,
    isResolving,
    resolved,
    resolution: resolvedStatus,
    outcome: resolveApprovalOutcome(resolvedStatus),
    error
  };
}
