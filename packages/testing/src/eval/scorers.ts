import { deepEqual } from "@flow-state-dev/core/helpers";
import type { ZodTypeAny } from "zod";
import type { Scorer, ScoreResult } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getField(obj: unknown, field: string): unknown {
  if (obj == null || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[field];
}

function resolvePath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function passResult(reason?: string): ScoreResult {
  return { score: 1, passed: true, reason };
}

function failResult(reason?: string): ScoreResult {
  return { score: 0, passed: false, reason };
}

/** Structural equality for eval fixtures; maps deepEqual throws (depth cap, non-JSON) to "not equal". */
function evalValuesEqual(a: unknown, b: unknown): boolean {
  try {
    return deepEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// exactMatch
// ---------------------------------------------------------------------------

export function exactMatch<TOutput = unknown>(field?: string): Scorer<TOutput> {
  return {
    name: field ? `exactMatch(${field})` : "exactMatch",
    score({ output, expected }) {
      if (expected === undefined) {
        return failResult("No expected value provided");
      }
      const a = field !== undefined ? getField(output, field) : output;
      const b = field !== undefined ? getField(expected, field) : expected;
      return evalValuesEqual(a, b)
        ? passResult()
        : failResult(
            `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
          );
    },
  };
}

// ---------------------------------------------------------------------------
// schemaValid
// ---------------------------------------------------------------------------

export function schemaValid<TOutput = unknown>(
  schema: ZodTypeAny,
): Scorer<TOutput> {
  return {
    name: "schemaValid",
    score({ output }) {
      const result = schema.safeParse(output);
      if (result.success) {
        return passResult();
      }
      const issues = result.error.issues
        .map(
          (i: { path: (string | number)[]; message: string }) =>
            `${i.path.join(".")}: ${i.message}`,
        )
        .join("; ");
      return failResult(issues);
    },
  };
}

// ---------------------------------------------------------------------------
// contains
// ---------------------------------------------------------------------------

export function contains<TOutput = unknown>(
  substring: string,
): Scorer<TOutput> {
  return {
    name: `contains(${JSON.stringify(substring)})`,
    score({ output }) {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      const found = text.toLowerCase().includes(substring.toLowerCase());
      return found
        ? passResult()
        : failResult(`Output does not contain ${JSON.stringify(substring)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// jsonPath
// ---------------------------------------------------------------------------

export function jsonPath<TOutput = unknown>(
  path: string,
  expected: unknown,
): Scorer<TOutput> {
  return {
    name: `jsonPath(${path})`,
    score({ output }) {
      const value = resolvePath(output, path);
      return evalValuesEqual(value, expected)
        ? passResult()
        : failResult(
            `At path "${path}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`,
          );
    },
  };
}

// ---------------------------------------------------------------------------
// threshold
// ---------------------------------------------------------------------------

export function threshold<TOutput = unknown>(
  field: string,
  min: number,
  max?: number,
): Scorer<TOutput> {
  return {
    name: max !== undefined ? `threshold(${field}, ${min}-${max})` : `threshold(${field}, >=${min})`,
    score({ output }) {
      const value = getField(output, field);
      if (typeof value !== "number") {
        return failResult(
          `Field "${field}" is not a number: ${JSON.stringify(value)}`,
        );
      }
      const aboveMin = value >= min;
      const belowMax = max === undefined || value <= max;
      if (aboveMin && belowMax) {
        return passResult();
      }
      return failResult(
        max !== undefined
          ? `Expected ${field} in [${min}, ${max}], got ${value}`
          : `Expected ${field} >= ${min}, got ${value}`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// custom
// ---------------------------------------------------------------------------

export function custom<TOutput = unknown>(
  name: string,
  fn: Scorer<TOutput>["score"],
): Scorer<TOutput> {
  return { name, score: fn };
}

// ---------------------------------------------------------------------------
// allOf
// ---------------------------------------------------------------------------

export function allOf<TOutput = unknown>(
  ...scorers: Scorer<TOutput>[]
): Scorer<TOutput> {
  return {
    name: `allOf(${scorers.map((s) => s.name).join(", ")})`,
    async score(args) {
      const results = await Promise.all(scorers.map((s) => s.score(args)));
      const minScore = Math.min(...results.map((r) => r.score));
      const allPassed = results.every((r) => r.passed);
      const failedReasons = results
        .filter((r) => !r.passed && r.reason)
        .map((r) => r.reason);
      return {
        score: minScore,
        passed: allPassed,
        reason: failedReasons.length > 0 ? failedReasons.join("; ") : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// anyOf
// ---------------------------------------------------------------------------

export function anyOf<TOutput = unknown>(
  ...scorers: Scorer<TOutput>[]
): Scorer<TOutput> {
  return {
    name: `anyOf(${scorers.map((s) => s.name).join(", ")})`,
    async score(args) {
      const results = await Promise.all(scorers.map((s) => s.score(args)));
      const maxScore = Math.max(...results.map((r) => r.score));
      const anyPassed = results.some((r) => r.passed);
      if (anyPassed) {
        const passing = results.find((r) => r.passed);
        return {
          score: maxScore,
          passed: true,
          reason: passing?.reason,
        };
      }
      const allReasons = results
        .filter((r) => r.reason)
        .map((r) => r.reason);
      return {
        score: maxScore,
        passed: false,
        reason:
          allReasons.length > 0
            ? `All failed: ${allReasons.join("; ")}`
            : "All scorers failed",
      };
    },
  };
}
