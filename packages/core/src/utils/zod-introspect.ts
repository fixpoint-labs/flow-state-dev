/**
 * Best-effort Zod schema introspection. Returns the top-level keys of a
 * `ZodObject` schema, or `undefined` when the schema is anything else
 * (union, discriminated union, effects, primitives, null/undefined).
 *
 * Used at build time to validate `expose` / `exclude` field lists against a
 * state schema. Callers MUST treat `undefined` as "skip validation" rather
 * than "no keys" — the silent-skip contract is what lets `expose` work
 * against schemas that the framework can't reflect into.
 */
export function introspectStateKeys(stateSchema: unknown): Set<string> | undefined {
  if (stateSchema === null || stateSchema === undefined) return undefined;
  const schema = stateSchema as { _def?: { typeName?: string }; shape?: unknown };
  if (schema._def?.typeName !== "ZodObject") return undefined;
  const shape = typeof schema.shape === "function"
    ? (schema as unknown as { shape: () => Record<string, unknown> }).shape()
    : (schema.shape as Record<string, unknown> | undefined);
  if (shape === undefined || shape === null || typeof shape !== "object") return undefined;
  return new Set(Object.keys(shape));
}
