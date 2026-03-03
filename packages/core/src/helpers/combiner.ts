import { z, type ZodTypeAny } from "zod";
import { handler } from "../blocks";

export const combinerOutputSchema = z.object({
  combined: z.unknown(),
  mergeNotes: z.array(z.string()).optional()
});

const combinerInputSchema = z.union([
  z.array(z.unknown()),
  z.object({
    artifacts: z.array(z.unknown())
  })
]);

type MergeContext = {
  notes: string[];
};

export interface CombinerConfig<
  TOutputSchema extends ZodTypeAny = typeof combinerOutputSchema
> {
  name: string;
  outputSchema?: TOutputSchema;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function dedupe(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const value of values) {
    const signature = stableSerialize(value);
    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    result.push(value);
  }

  return result;
}

function mergeArrays(current: unknown[], next: unknown[], ctx: MergeContext, path: string): unknown[] {
  const merged = dedupe([...current, ...next]);

  if (merged.length < current.length + next.length) {
    ctx.notes.push(`${path}: deduplicated array entries during merge.`);
  }

  return merged;
}

function mergeValues(current: unknown, next: unknown, ctx: MergeContext, path: string): unknown {
  if (Array.isArray(current) && Array.isArray(next)) {
    return mergeArrays(current, next, ctx, path);
  }

  if (isPlainObject(current) && isPlainObject(next)) {
    return mergeObjects(current, next, ctx, path);
  }

  if (stableSerialize(current) !== stableSerialize(next)) {
    ctx.notes.push(`${path}: conflicting values resolved by taking the later artifact.`);
  }

  return next;
}

function mergeObjects(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  ctx: MergeContext,
  path: string
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };

  for (const key of Object.keys(next)) {
    const nextPath = path === "combined" ? `combined.${key}` : `${path}.${key}`;

    if (key in merged) {
      merged[key] = mergeValues(merged[key], next[key], ctx, nextPath);
      continue;
    }

    merged[key] = next[key];
  }

  return merged;
}

function normalizeInput(input: z.infer<typeof combinerInputSchema>): unknown[] {
  return Array.isArray(input) ? input : input.artifacts;
}

function combineArtifacts(artifacts: unknown[]): { combined: unknown; mergeNotes?: string[] } {
  const ctx: MergeContext = { notes: [] };

  if (artifacts.length === 0) {
    return { combined: [], mergeNotes: ["No artifacts provided; returned an empty combined array."] };
  }

  if (artifacts.every((artifact) => Array.isArray(artifact))) {
    return {
      combined: mergeArrays([], artifacts.flat(), ctx, "combined"),
      mergeNotes: ctx.notes.length > 0 ? ctx.notes : undefined
    };
  }

  if (artifacts.every((artifact) => isPlainObject(artifact))) {
    const combined = artifacts.reduce<Record<string, unknown>>(
      (accumulator, artifact) => mergeObjects(accumulator, artifact, ctx, "combined"),
      {}
    );

    return {
      combined,
      mergeNotes: ctx.notes.length > 0 ? ctx.notes : undefined
    };
  }

  return {
    combined: dedupe(artifacts),
    mergeNotes: [
      "Mixed artifact types detected; normalized by preserving artifact order and deduplicating exact matches."
    ]
  };
}

/**
 * Factory that returns a handler block for deterministic artifact combination.
 */
export function combiner<
  TOutputSchema extends ZodTypeAny = typeof combinerOutputSchema
>(config: CombinerConfig<TOutputSchema>) {
  return handler({
    name: config.name,
    inputSchema: combinerInputSchema,
    outputSchema: config.outputSchema ?? combinerOutputSchema,
    execute: (input) => combineArtifacts(normalizeInput(input))
  });
}
