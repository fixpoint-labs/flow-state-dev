# Wave 1.l — CLI Scaffolding + `fsdev block` Command

## 1. Objective

Bootstrap the `packages/cli` package and implement the first command: `fsdev block <specifier>`. This establishes the CLI foundation that downstream commands (`fsdev run`, `fsdev eval`) and Claude skills depend on.

This is Batch 1 of CLI work. No dependencies on other new work.

## 2. Canonical inputs

1. The implementation plan — Wave L intent
2. `docs/architecture/overview.md` — Package structure and dependency graph
3. `docs/contributing/architecture-reference.md` — Locked contracts (CLI boundary: uses core + server + testing, never react or client)
4. `packages/core/src/types/block.ts` — `BlockDefinition` interface, `BlockKind`, `BlockConfig`
5. `packages/testing/src/runtime/createTestContext.ts` — `createTestContext()` harness and `TestContextRuntime`
6. FIX-211 issue description — acceptance criteria and feature shape

## 3. Scope

### In scope

- Complete `packages/cli` package scaffolding (entry point, arg parsing, shared infrastructure)
- `fsdev block <specifier>` command — isolated block execution against provided input
- Block resolution: file path → dynamic import → `BlockDefinition` validation
- Input parsing: `--input` (inline JSON) and `--input-file` (file path), mutually exclusive
- Schema validation of input and output against block's Zod schemas
- Structured JSON output (`BlockExecResult` shape)
- `--model` flag for LLM model override
- Exit code contract: 0 success, 1 execution error, 2 invalid args
- Shared infrastructure modules: `resolveBlock`, `formatOutput`, `parseInputArg`
- Monorepo integration: `pnpm fsdev` script from root

### Out of scope

- `fsdev run` command (FIX-212, Batch 2)
- `fsdev eval` command (FIX-207, Batch 2)
- Claude skills (FIX-214, Batch 3)
- HTTP server mode / persistent processes
- Non-JSON output formats (table, human-readable)
- Flow discovery or registration
- Devtool integration (Wave M)

## 4. Dependencies

- Waves 1.a–1.k complete (core, server, testing packages fully functional)
- `@flow-state-dev/core` — `BlockDefinition` type, `BlockKind`, Zod schema types
- `@flow-state-dev/server` — `executeBlock` for runtime execution, `createExecutionContext`
- `@flow-state-dev/testing` — `createTestContext()` for harness setup, mock model resolver
- `tsx` — TypeScript execution without compilation step
- `commander` or `yargs` — CLI argument parsing

## 5. Task plan

### Task L-1: Package scaffolding

**Purpose:** Set up `packages/cli` with proper monorepo integration.

**Files to create or modify:**

- `packages/cli/package.json` — update: add `commander`, `tsx` dependencies; update `bin` entry to `./bin/fsdev.ts`
- `packages/cli/bin/fsdev.ts` — create: entry point with `#!/usr/bin/env tsx` shebang
- `packages/cli/src/index.ts` — update: re-export shared infrastructure
- `packages/cli/src/cli.ts` — create: commander program setup, global flags (`--format`)
- `packages/cli/tsconfig.json` — update if needed: ensure `bin/` is included
- `package.json` (root) — add `fsdev` script: `"fsdev": "pnpm --filter @flow-state-dev/cli exec tsx bin/fsdev.ts"`

**Acceptance criteria:**

- `pnpm fsdev --help` prints usage from repo root
- `packages/cli` appears in workspace and builds cleanly
- `bin/fsdev.ts` is the single entry point, delegates to commander

**Notes:**

- The existing `packages/cli/package.json` has `bin: { fsdev: "./dist/index.js" }` pointing at compiled output. For development with `tsx`, the bin entry can stay for published use, but the `pnpm fsdev` root script should invoke `tsx bin/fsdev.ts` directly so no build step is required during development.

### Task L-2: Shared infrastructure modules

**Purpose:** Build reusable utilities that `fsdev block`, `fsdev run`, and `fsdev eval` will share.

**Files to create:**

- `packages/cli/src/resolve-block.ts` — `resolveBlock(specifier: string): Promise<BlockDefinition>`
- `packages/cli/src/parse-input.ts` — `parseInputArg(options: { input?: string; inputFile?: string }): unknown`
- `packages/cli/src/format-output.ts` — `formatOutput(data: unknown, format: 'json'): string`
- `packages/cli/src/exit-codes.ts` — exit code constants and error formatter

**Detail: `resolveBlock`**

```ts
async function resolveBlock(specifier: string): Promise<BlockDefinition> {
  // 1. Resolve specifier as file path relative to cwd
  // 2. Verify file exists (exit 2 if not)
  // 3. Dynamic import via tsx runtime
  // 4. Extract default export
  // 5. Validate BlockDefinition shape: must have kind, name, run function
  //    - kind must be one of: 'handler', 'generator', 'sequencer', 'router'
  //    - name must be a non-empty string
  //    - run must be a function
  // 6. Return validated BlockDefinition
}
```

**Detail: `parseInputArg`**

```ts
function parseInputArg(options: { input?: string; inputFile?: string }): unknown {
  // 1. If both --input and --input-file provided: exit 2 with message
  // 2. If neither provided: return undefined (let schema validation catch it)
  // 3. If --input: JSON.parse (exit 2 on parse failure)
  // 4. If --input-file: read file, JSON.parse (exit 2 on read or parse failure)
}
```

**Detail: `formatOutput`**

```ts
function formatOutput(data: unknown, format: 'json'): string {
  // JSON.stringify with 2-space indent for readability
  // Future: could add 'table', 'compact' formats
}
```

**Detail: exit codes**

```ts
export const EXIT_SUCCESS = 0;
export const EXIT_EXECUTION_ERROR = 1;
export const EXIT_INVALID_ARGS = 2;
```

**Acceptance criteria:**

- `resolveBlock` handles: valid file, missing file, file without default export, default export that isn't a `BlockDefinition`
- `parseInputArg` handles: inline JSON, file path, both provided (error), neither provided
- All exit on error with appropriate exit code and message to stderr

### Task L-3: `fsdev block` command implementation

**Purpose:** Wire the `fsdev block <specifier>` command that executes a block in isolation.

**Files to create:**

- `packages/cli/src/commands/block.ts` — command definition and execution logic

**Execution flow:**

1. Parse args: `<specifier>` positional, `--input`, `--input-file`, `--model`, `--format`
2. Call `resolveBlock(specifier)` to load the block
3. Call `parseInputArg({ input, inputFile })` to get input data
4. Validate input against `block.inputSchema` if present (using Zod `.safeParse()`)
5. Create execution context via `createTestContext()` from `@flow-state-dev/testing`
6. If `--model` flag present, configure model override in the test context options
7. Execute block: `const output = await block.run(input, ctx)`
8. Validate output against `block.outputSchema` if present
9. Build `BlockExecResult` object
10. Print via `formatOutput(result, format)` to stdout
11. Exit with appropriate code

**Model override approach:**

```ts
// createTestContext accepts a models option for mock/override behavior.
// For CLI use, we need a real model resolver that respects the --model flag.
// Option A: Use createTestContext with unmockedGeneratorPolicy: 'passthrough'
//   and a custom model resolver that substitutes the model name.
// Option B: Use createExecutionContext directly from server package,
//   with a real model resolver and the --model override applied.
//
// Recommended: Option A for v1 — keeps things simple, uses existing test infra.
// The testing package's createTestContext with unmockedGeneratorPolicy: 'passthrough'
// lets unmocked generators call through to real providers.
// The --model flag maps to the models option which can override model selection.
```

**JSON output shape:**

```ts
interface BlockExecResult {
  success: boolean;
  block: {
    kind: BlockKind;    // 'handler' | 'generator' | 'sequencer' | 'router'
    name: string;
  };
  output: unknown;
  schemaValidation: {
    input: { passed: boolean; errors?: string[] };
    output: { passed: boolean; errors?: string[] };
  };
  execution: {
    durationMs: number;
    tokenUsage?: { input: number; output: number };
  };
  error?: {
    message: string;
    stack?: string;
  };
}
```

**Acceptance criteria:**

- `pnpm fsdev block src/blocks/some-block.ts --input '{...}'` executes and prints `BlockExecResult` JSON
- Schema validation runs and reports in the output (does not abort — reports errors in result)
- `--model` override is passed through to the execution context
- Execution errors are caught, reported in the result JSON, and exit code is 1
- Invalid args (missing specifier, bad JSON, both input flags) exit code 2

### Task L-4: Unit tests

**Purpose:** Verify shared infrastructure and command behavior.

**Files to create:**

- `packages/cli/test/resolve-block.test.ts`
- `packages/cli/test/parse-input.test.ts`
- `packages/cli/test/format-output.test.ts`
- `packages/cli/test/fixtures/valid-block.ts` — simple handler block with schemas
- `packages/cli/test/fixtures/no-default-export.ts` — module without default export
- `packages/cli/test/fixtures/invalid-export.ts` — default export that isn't a BlockDefinition

**Test cases for `resolveBlock`:**

- Valid block file → returns `BlockDefinition` with correct kind and name
- Missing file → throws/exits with code 2
- File with no default export → exits with code 2
- File with non-BlockDefinition default export → exits with code 2

**Test cases for `parseInputArg`:**

- `--input '{"key": "value"}'` → parsed object
- `--input-file path/to/file.json` → parsed file contents
- Both `--input` and `--input-file` → exits with code 2
- Invalid JSON in `--input` → exits with code 2
- Missing `--input-file` path → exits with code 2
- Neither provided → returns undefined

**Test cases for `formatOutput`:**

- Object → indented JSON string
- Nested object → properly formatted

**Acceptance criteria:**

- All unit tests pass via `pnpm --filter @flow-state-dev/cli test`
- Test fixtures are realistic blocks using `@flow-state-dev/core` APIs

### Task L-5: Integration test

**Purpose:** End-to-end test of the `fsdev block` command.

**Files to create:**

- `packages/cli/test/block-command.integration.test.ts`
- `packages/cli/test/fixtures/echo-handler.ts` — handler block that returns input with metadata
- `packages/cli/test/fixtures/schema-block.ts` — generator block with strict input/output schemas
- `packages/cli/test/fixtures/input-data.json` — sample input file

**Test cases:**

- Execute a handler block with inline JSON input → verify `BlockExecResult` shape, `success: true`
- Execute with `--input-file` → same result
- Execute block with schema validation → verify `schemaValidation` fields
- Execute with invalid input (fails schema) → verify `schemaValidation.input.passed: false`
- Execute with missing file specifier → exit code 2
- Execute with `--input` + `--input-file` → exit code 2
- Execute block that throws → `success: false`, `error` populated, exit code 1

**Acceptance criteria:**

- Integration tests run via `pnpm --filter @flow-state-dev/cli test`
- Tests invoke the command programmatically (import and call the command handler, not shell exec)

## 6. Deliverables and verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| CLI package scaffolding | `packages/cli/package.json`, `packages/cli/bin/fsdev.ts`, `packages/cli/src/cli.ts` | `pnpm fsdev --help` | Prints usage without error |
| Block resolution | `packages/cli/src/resolve-block.ts` | `pnpm --filter @flow-state-dev/cli test` | resolveBlock tests pass |
| Input parsing | `packages/cli/src/parse-input.ts` | `pnpm --filter @flow-state-dev/cli test` | parseInputArg tests pass |
| Output formatting | `packages/cli/src/format-output.ts` | `pnpm --filter @flow-state-dev/cli test` | formatOutput tests pass |
| `fsdev block` command | `packages/cli/src/commands/block.ts` | `pnpm --filter @flow-state-dev/cli test` | Integration tests pass |
| Monorepo integration | `package.json` (root) | `pnpm fsdev --help` from root | Works without build step |
| Type safety | all `.ts` files | `pnpm --filter @flow-state-dev/cli typecheck` | No type errors |

## 7. Wave gate checklist

- `pnpm -r typecheck` passes
- `pnpm --filter @flow-state-dev/cli test` passes
- `pnpm test` (all packages) passes — no regressions
- Architecture contract: CLI depends on `core` + `server` + `testing`, never `react` or `client`
- Exit code contract: 0 success, 1 execution error, 2 invalid args
- `BlockExecResult` JSON shape is stable (downstream skills depend on it)
- Wave changelog updated
- Wave journal updated
- Root `changelog.md` summary updated

## 8. Handoff to next wave

**This wave guarantees:**

- `packages/cli` is a working package with `tsx`-based entry point
- `fsdev block <specifier>` executes any `BlockDefinition` in isolation
- Shared infrastructure (`resolveBlock`, `parseInputArg`, `formatOutput`, exit codes) is exported and reusable
- `BlockExecResult` JSON schema is documented and tested
- `pnpm fsdev` works from the repo root without a build step

**Next waves can assume:**

- FIX-212 (`fsdev run`): can extend the CLI with a new command, reuse `parseInputArg`, `formatOutput`, and exit code infrastructure. Can import `resolveBlock` patterns for flow discovery.
- FIX-207 (`fsdev eval`): same CLI extension pattern.
- FIX-214 (Claude skills): can shell out to `fsdev block` and parse `BlockExecResult` JSON from stdout.

## 9. Implementation notes

### Package boundary

Per `docs/contributing/architecture-reference.md`, the CLI package boundary is:

> `cli` — Run/inspect/scaffold flows — Uses core + server + testing

The CLI must never import from `@flow-state-dev/client` or `@flow-state-dev/react`. It operates server-side, using the testing harness for isolated execution and the server package for full runtime execution.

### Block validation heuristic

A valid `BlockDefinition` must satisfy:

```ts
function isBlockDefinition(value: unknown): value is BlockDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'name' in value &&
    'run' in value &&
    typeof (value as any).run === 'function' &&
    ['handler', 'generator', 'sequencer', 'router'].includes((value as any).kind)
  );
}
```

This is a structural check, not a type-level check. We don't require `instanceof` because blocks are created by factory functions across packages.

### `tsx` execution model

The CLI uses `tsx` (TypeScript Execute) to run TypeScript directly without a compilation step. This means:

- `bin/fsdev.ts` has a `#!/usr/bin/env tsx` shebang
- Dynamic imports of user block files work because `tsx` handles TypeScript resolution
- No `dist/` build required for development — `pnpm fsdev` invokes `tsx` directly
- The `bin` field in `package.json` still points to `dist/` for published npm distribution

### Schema validation is non-aborting

When a block has `inputSchema` or `outputSchema`, the CLI validates using Zod's `.safeParse()`. Validation failures are **reported in the result JSON** but do **not** abort execution. This lets developers see both the validation errors and the actual execution result simultaneously. The `schemaValidation` field captures pass/fail per direction.

Exception: if `inputSchema.safeParse()` fails, the CLI should still attempt execution with the raw input. The block's own validation (if any) will catch type errors at runtime. This matches how the framework operates — schemas are descriptive, not gatekeeping.

### Token usage tracking

Token usage (`execution.tokenUsage`) is populated only for generator blocks. The CLI extracts this from the `_runtimeHooks.onGeneratorModelResult` callback on the execution context. For handler, sequencer, and router blocks, this field is omitted.
