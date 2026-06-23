/**
 * Shared Liquid filters for chat-agent `.prompt.md` templates.
 *
 * Registered on the flow's prompt loader (`shared/prompts.ts`) so a `<system>`
 * / `<user>` block can pipe block input through a typed TypeScript formatter.
 * TS prepares the data; the template presents it.
 *
 * Why view builders, not per-field access: the prompt engine renders under
 * `strictVariables`, so a template that reads an absent optional field directly
 * (`{{ input.feedback }}` when there's no feedback) throws. The robust pattern
 * is a filter that takes the whole (always-present) `input` and returns a view
 * object whose keys are ALWAYS present — `null` when absent — so the template's
 * `{% if %}` guards never touch an undefined variable. Adding a rendered value
 * means adding a field to the view (+ a line in the template); reusable shape
 * helpers like `normalizeDeps` are shared across every worker's view builder.
 */
import type { PromptFileFilters } from "@flow-state-dev/core/prompt-file";

/**
 * A prior task's result, normalized for a template `{% for %}` loop. The raw
 * dep is either a plain string or a structured `{ summary, sources }` object;
 * both collapse to this shape so the template renders without shape-checking.
 */
export interface NormalizedDep {
  /** The dependency's task id (the `deps` map key). */
  id: string;
  /** Prose body — the dep's `summary`, or the raw string / JSON fallback. */
  summary: string;
  /** Cited sources, already filtered to entries that carry a usable URL. */
  sources: Array<{ title: string; url: string }>;
}

/**
 * Normalize a supervisor worker's `deps` record into a flat, template-ready
 * list. Each value may be a raw string or a `{ summary, sources }` result; both
 * collapse to `{ id, summary, sources }`, with sources filtered to those that
 * have a non-empty URL. Non-record input (undefined / null) yields `[]`.
 */
export function normalizeDeps(deps: unknown): NormalizedDep[] {
  if (deps === null || typeof deps !== "object") return [];
  return Object.entries(deps as Record<string, unknown>).map(([id, value]) => {
    if (value === null || typeof value !== "object") {
      return {
        id,
        summary: typeof value === "string" ? value : JSON.stringify(value),
        sources: [],
      };
    }
    const obj = value as { summary?: unknown; sources?: unknown };
    const summary =
      typeof obj.summary === "string" ? obj.summary : JSON.stringify(value);
    const sources = (Array.isArray(obj.sources) ? obj.sources : [])
      .filter(
        (s): s is { title?: string; url: string } =>
          typeof (s as { url?: unknown })?.url === "string" &&
          (s as { url: string }).url.length > 0,
      )
      .map((s) => ({
        title: typeof s.title === "string" ? s.title : "",
        url: s.url,
      }));
    return { id, summary, sources };
  });
}

/**
 * The supervisor worker's `<user>` view model. Every key is always present so
 * the template's `{% if %}` guards never read an undefined variable under
 * `strictVariables`; absent optional values are `null` (not `""`, which Liquid
 * treats as truthy).
 */
export interface SupervisorWorkerView {
  goal: string;
  /**
   * Resolved task context: the first-class `context`, else a legacy string
   * `input` (FIX-827 transitional fallback), else `null`.
   */
  context: string | null;
  priorTasks: NormalizedDep[];
  feedback: string | null;
}

/** Build the supervisor worker's `<user>` view from raw block input. */
export function supervisorWorkerView(input: unknown): SupervisorWorkerView {
  const i = (input ?? {}) as {
    goal?: unknown;
    context?: unknown;
    input?: unknown;
    deps?: unknown;
    feedback?: unknown;
  };
  const context =
    typeof i.context === "string"
      ? i.context
      : typeof i.input === "string"
        ? i.input
        : null;
  return {
    goal: typeof i.goal === "string" ? i.goal : "",
    context,
    priorTasks: normalizeDeps(i.deps),
    feedback:
      typeof i.feedback === "string" && i.feedback.length > 0
        ? i.feedback
        : null,
  };
}

/**
 * Liquid filters available to every chat-agent prompt template.
 *
 * `supervisorWorkerView` is the supervisor worker's view builder; `normalizeDeps`
 * is the reusable shape helper other workers' view builders compose with.
 */
export const promptFilters: PromptFileFilters = {
  supervisorWorkerView: (value: unknown) => supervisorWorkerView(value),
  normalizeDeps: (value: unknown) => normalizeDeps(value),
};
