/**
 * Regression spec for OpenAI strict-mode compatibility on every generator
 * output schema shipped by `@flow-state-dev/memory`.
 *
 * The framework's `makeSchemaStrict()` strips `optional` / `default` /
 * `nullable` wrappers, but it does NOT transform `z.record()`, `z.union()`,
 * or other patterns OpenAI's strict structured-output mode rejects. This
 * spec walks each post-strict schema and fails if any of those patterns
 * survive — the class of bug BP-016 exists to prevent.
 *
 * See BP-016 (docs/contributing/best-practices.md) for the rules these
 * checks enforce. The walker is copied from
 * `labs/trading-desk/test/output-schemas-strict.spec.ts` so each
 * package guards itself independently.
 */
import { describe, expect, it } from 'vitest'
import { makeSchemaStrict } from '@flow-state-dev/core'
import type { ZodTypeAny } from 'zod'
import { observationsSchema } from '../src/working-memory-blocks'
import { digestOutputSchema } from '../src/digest-blocks'
import {
  consolidationOutputSchema,
  pruneOutputSchema,
  unifiedObservationsSchema,
} from '../src/memory-system-blocks'
import { filterOutputSchema } from '../src/tools/strategies/llm-filter-strategy'

type Issue = { path: string; reason: string }

/**
 * Walk a Zod schema (already passed through `makeSchemaStrict`) and collect
 * any node that would cause OpenAI strict mode to reject the resulting JSON
 * schema:
 *
 *  - Object-shape properties still wrapped in `ZodOptional` / `ZodDefault`
 *    (key dropped from `required`).
 *  - `ZodRecord` anywhere (open-keyed map → `additionalProperties: true`).
 *  - `ZodUnion` that isn't an enum-style union of literals (ambiguous
 *    `required` set across variants). Discriminated unions over differing
 *    shapes share the same JSON-schema problem and are flagged too.
 */
function findStrictViolations(schema: ZodTypeAny, path = '$'): Issue[] {
  const def = (schema as any)._def
  const typeName = def?.typeName as string | undefined
  const issues: Issue[] = []

  switch (typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
      issues.push({
        path,
        reason: `${typeName} survived makeSchemaStrict — would drop key from required`,
      })
      issues.push(...findStrictViolations(def.innerType, path))
      break

    case 'ZodNullable':
      issues.push(...findStrictViolations(def.innerType, path))
      break

    case 'ZodRecord':
      issues.push({
        path,
        reason: 'ZodRecord becomes additionalProperties=true; OpenAI strict rejects open maps',
      })
      break

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (def.options ?? []) as ZodTypeAny[]
      const allLiterals = options.every(
        (o) => ((o as any)._def?.typeName as string | undefined) === 'ZodLiteral',
      )
      if (!allLiterals) {
        issues.push({
          path,
          reason: `${typeName} of non-literal variants — strict mode requires uniform property set`,
        })
      }
      options.forEach((opt, i) => {
        issues.push(...findStrictViolations(opt, `${path}|${i}`))
      })
      break
    }

    case 'ZodObject': {
      const shape = def.shape() as Record<string, ZodTypeAny>
      for (const [key, value] of Object.entries(shape)) {
        issues.push(...findStrictViolations(value, `${path}.${key}`))
      }
      break
    }

    case 'ZodArray':
      issues.push(...findStrictViolations(def.type, `${path}[]`))
      break

    case 'ZodEffects':
      issues.push(...findStrictViolations(def.schema, path))
      break

    // Primitives, enums, literals, etc. are always strict-mode safe.
    default:
      break
  }

  return issues
}

const cases: Array<[string, ZodTypeAny]> = [
  ['working-memory observationsSchema', observationsSchema],
  ['digest digestOutputSchema', digestOutputSchema],
  ['memory-system unifiedObservationsSchema', unifiedObservationsSchema],
  ['memory-system consolidationOutputSchema', consolidationOutputSchema],
  ['memory-system pruneOutputSchema', pruneOutputSchema],
  ['llm-filter filterOutputSchema', filterOutputSchema],
]

describe('Generator output schemas are OpenAI strict-mode compatible', () => {
  for (const [name, schema] of cases) {
    it(`${name} survives makeSchemaStrict + walker with no violations`, () => {
      const strict = makeSchemaStrict(schema)
      const issues = findStrictViolations(strict)
      if (issues.length > 0) {
        const formatted = issues.map((i) => `  ${i.path}: ${i.reason}`).join('\n')
        throw new Error(`${name} would fail OpenAI strict mode:\n${formatted}`)
      }
      expect(issues).toEqual([])
    })
  }
})
