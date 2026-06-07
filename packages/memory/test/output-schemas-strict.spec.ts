/**
 * Regression spec for OpenAI strict-mode compatibility on every generator
 * output schema shipped by `@flow-state-dev/memory`.
 *
 * `assertStrictCompatible()` (from `@flow-state-dev/core`) runs the framework's
 * strict transform and then fails if any construct OpenAI's strict
 * structured-output mode rejects survives (a reachable `z.record`, a non-literal
 * `z.union`). Generators already call it at definition; this spec asserts the
 * shipped schema constants directly so a constant drifting out of compatibility
 * fails with a named signal before it is wired to a generator. See BP-016.
 */
import { describe, expect, it } from 'vitest'
import { assertStrictCompatible } from '@flow-state-dev/core'
import type { ZodTypeAny } from 'zod'
import { observationsSchema } from '../src/working-memory-blocks'
import { digestOutputSchema } from '../src/digest-blocks'
import {
  consolidationOutputSchema,
  pruneOutputSchema,
  unifiedObservationsSchema,
} from '../src/memory-system-blocks'
import { filterOutputSchema } from '../src/tools/strategies/llm-filter-strategy'

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
    it(`${name} is strict-compatible`, () => {
      expect(() => assertStrictCompatible(schema, name)).not.toThrow()
    })
  }
})
