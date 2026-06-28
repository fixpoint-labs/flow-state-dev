# Best Practices — Generators & Prompts

Situational BPs for generator output schemas, prompt construction, and model
calls. Load this file when writing or editing generators or prompt formatters.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-016: Generator outputSchemas must be OpenAI strict-compatible

- Status: Active
- Date: 2026-05-11 (definition-time enforcement added 2026-06-07)
- Scope: Generators — output schemas.
- Rule:
  - Generator `outputSchema` values must serialize to JSON schema OpenAI strict mode accepts. Enforced automatically: `generator()` calls `assertStrictCompatible(outputSchema)` at construction and throws `StrictSchemaError` (naming the offending path) at definition, not on the first live call.
  - **No `z.record()`** reachable from a generator output (serializes to `additionalProperties: true`). Use a fixed-shape `z.object({...})`; for dynamic keys use `z.array(z.object({ key, value }))` and convert at the writer seam.
  - **No `z.optional()` / `z.default()`** on outputs (they drop the key from `required`). Use `z.nullable()`.
  - **No `z.union([...])`** of differently-shaped variants (conflicting `required` sets). Collapse to one nullable shape, or split into separate generators.
  - To assert a bare schema constant in a test, import `assertStrictCompatible` from `@flow-state-dev/core` and call it — no copied walker.

### BP-017: Use the generator `context` slot for typed, segmented prompts

- Status: Active
- Date: 2026-05-13
- Scope: Generators — prompt construction.
- Rule:
  - Build prompts via the generator's `context: { tagName: fn }` slot, not a hand-built multi-section `user:` string. Each key becomes an XML tag; values resolve at render time with typed `ctx` (session state, resources).
  - Reserve `user:` for the short trailing instruction, not concatenated section dumps.
  - When the same key is contributed by the block's own `context` plus capabilities installed via `uses`, the framework aggregates them in one tag — no name conflict.

### BP-018: Shared prompt formatters live in `lib/`

- Status: Active
- Date: 2026-05-13
- Scope: Prompts — shared formatters.
- Rule:
  - When two or more blocks format the same shape of data into a prompt, lift the formatter into a `lib/format.ts` leaf module and import it from each consumer. Single-consumer formatters stay in that block's file; the bar is "two or more consumers."
  - Before hand-rolling a formatter, reach for `@flow-state-dev/core/prompt` composers (`section`, `list`, `keyValues`, `table`, `entries`, `codeBlock`, `join`, `when`) — or, inside `.md` templates, the `fsd_keyValues` / `fsd_list` / `fsd_table` / `fsd_json` filters. Only write a shared formatter for shapes these don't cover.

<!-- BP-032 withdrawn during review (too framework-internal; app code uses generator() blocks, not the raw model SDK). The runtime-contract paths it named live in BP-035. Numbers are not reused. -->
