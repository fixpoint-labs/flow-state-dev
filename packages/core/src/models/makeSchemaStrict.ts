/**
 * Transforms a Zod schema so all object properties become required.
 *
 * OpenAI's structured output API requires every property in the JSON schema's
 * `required` array. Zod's `.optional()` and `.default()` both omit properties
 * from `required`, causing OpenAI to reject the schema. This utility strips
 * those wrappers so the JSON schema sent to the provider has all properties
 * required.
 *
 * The *original* schema is still used for response validation via
 * `schema.safeParse()`, which applies `.default()` values automatically.
 * This means authors can write natural Zod schemas with defaults and
 * optionals — the framework handles the provider constraint transparently.
 */
import { z, type ZodTypeAny } from "zod";
import {
  getZodTypeName,
  getZodInnerType,
  getZodArrayElement,
  getZodObjectShape,
  getZodUnionOptions,
  getZodRecordValueType,
} from "../helpers/zod-introspect";
import { StrictSchemaError, type StrictViolation } from "../errors/strict-schema-error";

export type { StrictViolation } from "../errors/strict-schema-error";

/**
 * Recursively unwraps ZodOptional, ZodDefault, and ZodEffects wrappers from a
 * single schema node, returning the innermost non-optional/non-default type.
 *
 * ZodEffects (from `.superRefine()` / `.refine()` / `.transform()`) is
 * unwrapped to its inner schema — the runtime refinements only run against
 * the original schema during response validation, so dropping them for the
 * strict-provider schema is safe.
 */
function unwrapOptionalAndDefault(schema: ZodTypeAny): ZodTypeAny {
  const typeName = getZodTypeName(schema);

  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    return unwrapOptionalAndDefault(getZodInnerType(schema)!);
  }

  if (typeName === "ZodEffects") {
    return unwrapOptionalAndDefault(getZodInnerType(schema)!);
  }

  if (typeName === "ZodNullable") {
    return unwrapOptionalAndDefault(getZodInnerType(schema)!);
  }

  if (typeName === "ZodObject") {
    return buildStrictSchema(schema);
  }

  if (typeName === "ZodArray") {
    const elementType = getZodArrayElement(schema)!;
    const strictElement = unwrapOptionalAndDefault(elementType);
    if (strictElement !== elementType) {
      return z.array(strictElement);
    }
    return schema;
  }

  return schema;
}

/**
 * Returns a copy of a ZodObject schema where every property is required
 * (no `.optional()`, `.default()`, or `.superRefine()` wrappers hiding
 * nested objects). Nested objects and arrays are handled recursively.
 *
 * Non-object schemas are returned as-is — this is a no-op for primitives,
 * strings, enums, etc.
 */
/** Options for {@link makeSchemaStrict}. */
export interface MakeSchemaStrictOptions {
  /**
   * When `true`, after building the strict schema, walk it and throw a
   * {@link StrictSchemaError} if any construct OpenAI strict mode rejects
   * survives (a reachable `z.record`, or a non-literal `z.union`). Defaults to
   * `false` — transform only, no validation.
   */
  validate?: boolean;
  /** Label prefixed onto a thrown error's message (e.g. a generator name). */
  label?: string;
}

export function makeSchemaStrict(
  schema: ZodTypeAny,
  options?: MakeSchemaStrictOptions,
): ZodTypeAny {
  const strict = buildStrictSchema(schema);
  if (options?.validate) {
    const violations = findStrictViolations(strict);
    if (violations.length > 0) {
      throw new StrictSchemaError(violations, options.label);
    }
  }
  return strict;
}

/** The structural transform half of {@link makeSchemaStrict} (no validation). */
function buildStrictSchema(schema: ZodTypeAny): ZodTypeAny {
  const rootTypeName = getZodTypeName(schema);
  if (rootTypeName === "ZodEffects") {
    return buildStrictSchema(getZodInnerType(schema)!);
  }

  if (rootTypeName !== "ZodObject") {
    return schema;
  }

  const shape = getZodObjectShape(schema)!;
  const newShape: Record<string, ZodTypeAny> = {};

  for (const [key, value] of Object.entries(shape)) {
    newShape[key] = unwrapOptionalAndDefault(value);
  }

  return z.object(newShape);
}

/**
 * Walk a Zod schema (already passed through the strict transform) and collect
 * every node OpenAI strict structured-output mode would reject:
 *
 *  - `ZodOptional` / `ZodDefault` survivors — would drop a key from `required`.
 *    These are stripped from reachable object properties by the transform, so a
 *    survivor only appears inside a record value or union variant (already
 *    flagged); reported anyway as defense-in-depth.
 *  - `ZodRecord` anywhere — serializes to `additionalProperties: true`.
 *  - `ZodUnion` / `ZodDiscriminatedUnion` that isn't an enum-style union of
 *    literals — variants produce conflicting `required` sets.
 *
 * Primitives, enums, and literals are always strict-safe (the default case).
 */
function findStrictViolations(schema: ZodTypeAny, path = "$"): StrictViolation[] {
  const typeName = getZodTypeName(schema);
  const issues: StrictViolation[] = [];

  switch (typeName) {
    case "ZodOptional":
    case "ZodDefault": {
      issues.push({
        path,
        typeName,
        reason: "survived the strict transform and would drop the key from required",
      });
      const inner = getZodInnerType(schema);
      if (inner) issues.push(...findStrictViolations(inner, path));
      break;
    }

    case "ZodNullable": {
      const inner = getZodInnerType(schema);
      if (inner) issues.push(...findStrictViolations(inner, path));
      break;
    }

    case "ZodRecord": {
      issues.push({
        path,
        typeName,
        reason: "additionalProperties=true — OpenAI strict mode rejects open-keyed maps",
      });
      // Recurse into the value type so a nested violation (e.g. a union inside
      // the record's value object) surfaces in the same throw rather than on a
      // second `generator()` call after the record is restructured. `[*]` marks
      // the open value position, distinct from an array's `[]`.
      const valueType = getZodRecordValueType(schema);
      if (valueType) issues.push(...findStrictViolations(valueType, `${path}[*]`));
      break;
    }

    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = getZodUnionOptions(schema) ?? [];
      const allLiterals = options.every((o) => getZodTypeName(o) === "ZodLiteral");
      if (!allLiterals) {
        issues.push({
          path,
          typeName,
          reason: "non-literal variants produce conflicting required sets — collapse to one shape or split the generator",
        });
      }
      // Walk into each variant anyway so nested issues surface.
      options.forEach((opt, i) => {
        issues.push(...findStrictViolations(opt, `${path}|${i}`));
      });
      break;
    }

    case "ZodObject": {
      const shape = getZodObjectShape(schema) ?? {};
      for (const [key, value] of Object.entries(shape)) {
        issues.push(...findStrictViolations(value, `${path}.${key}`));
      }
      break;
    }

    case "ZodArray": {
      const element = getZodArrayElement(schema);
      if (element) issues.push(...findStrictViolations(element, `${path}[]`));
      break;
    }

    case "ZodEffects": {
      const inner = getZodInnerType(schema);
      if (inner) issues.push(...findStrictViolations(inner, path));
      break;
    }

    default:
      break;
  }

  return issues;
}

/**
 * Throw a {@link StrictSchemaError} if `schema`, after the strict transform,
 * still contains a construct OpenAI strict structured-output mode rejects. A
 * no-op on a compatible schema. `label` (e.g. a generator name) is prefixed
 * onto the thrown message.
 *
 * Authors can call this in a test, but generators call it automatically at
 * definition (see `generator()`), so a bad output schema fails at import. The
 * error's `violations` carry the offending path and Zod type for each issue.
 */
export function assertStrictCompatible(schema: ZodTypeAny, label?: string): void {
  makeSchemaStrict(schema, { validate: true, label });
}
