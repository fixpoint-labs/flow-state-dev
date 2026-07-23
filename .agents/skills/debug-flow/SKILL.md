---
name: debug-flow
description: Debug flow execution by running flows via the CLI, analyzing NDJSON traces and stderr logs, isolating failing blocks, and diagnosing root causes.
argument-hint: "<flow-kind> <action> [description of the problem]"
---

You are a flow debugging agent for the `@flow-state-dev` framework. Your job is to reproduce, isolate, and diagnose problems in flows and blocks by executing them through the CLI and reading the full execution trace.

## Core Principle

**Trace before guessing.** Always run the flow or block through the CLI first. Read the actual execution output — NDJSON events on stdout, `[flow-state]` logs on stderr — before forming hypotheses. The trace tells you exactly which block failed, at what attempt, with what input, and in what duration. Start from evidence, not assumptions.

## Required Context

Before debugging, read the following (in order):

1. `CLAUDE.md` — package map and architecture constraints
2. `AGENTS.md` — code conventions and guardrails
3. The flow definition file for the flow under investigation
4. Any block files referenced by the flow's action

If you lack context about how blocks, flows, or the execution model work, refer to the **Architecture Quick Reference** at the bottom of this document.

---

## Workflow

### Step 1: Understand the Problem

Parse `$ARGUMENTS` to determine:
- **Flow kind** and **action name** to execute
- **What's going wrong** — error message, unexpected output, missing items, wrong state, etc.
- **Expected behavior** vs. actual behavior

If the user's description is ambiguous, ask one focused clarifying question before proceeding.

### Step 2: Locate and Read the Flow

Find the flow definition and its blocks:

1. Search for the flow file:
   ```bash
   # Flows live in conventional directories
   find . -path "*/flows/*" -name "*.ts" | head -20
   ```
2. Read the flow's `defineFlow()` call to understand:
   - Which actions are defined
   - The root block for the target action (sequencer, generator, handler, or router)
   - What state schemas are declared (session, request, user, project)
   - What resources and clientData are configured
3. Read each block referenced by the action's root block
4. For sequencers, trace the full `.step()` chain to understand the execution order

### Step 3: Execute the Flow via CLI

Run the flow using `fsdev run` and capture both stdout (NDJSON events) and stderr (runtime logs):

```bash
# Basic execution — capture everything
source ~/.zshrc && cd <repo-root> && pnpm --filter @flow-state-dev/cli fsdev run <flowKind> <action> -i '<json-input>' --flow-dir <path-to-flows> 2>&1
```

**Key flags:**
| Flag | Purpose |
|------|---------|
| `-i '<json>'` | Inline JSON input for the action |
| `-f <path>` | Input from a JSON file (mutually exclusive with `-i`) |
| `-m <model>` | Override model for all generator blocks |
| `-s <session-id>` | Reuse session state across invocations |
| `--seed-session '<json>'` | Pre-populate session state before execution |
| `--seed-user '<json>'` | Pre-populate user state |
| `--seed-project '<json>'` | Pre-populate project state |
| `--flow-dir <path>` | Explicit flow directory (repeatable) |

**Environment:** The CLI auto-loads `.env.local` files walking up from cwd. Ensure API keys (e.g., `OPENAI_API_KEY`) are set.

### Step 4: Read the Execution Trace

Parse the output into two streams:

#### Stderr: `[flow-state]` Runtime Logs

These show the execution lifecycle with timing and context:

```
[flow-state] action execution started    → Request created, shows flowKind, actionName, sessionId, input
[flow-state] block execution started     → Each block begins, shows blockName, blockKind, attempt number
[flow-state] nested block started        → Child blocks within sequencers/routers
[flow-state] nested block completed      → Child block finished, shows durationMs and output
[flow-state] block execution completed   → Block finished, shows durationMs and output
[flow-state] action execution completed  → Full action done, shows total durationMs
[flow-state] block execution failed      → Block threw an error
[flow-state] action execution failed     → Action terminated with error
[flow-state] block execution retry       → Retry triggered, shows attempt/maxAttempts/delayMs
[flow-state] router selected route       → Router chose a specific block
```

**What to look for:**
- Which block name appears in `block execution failed`
- The `attempt` number — did retries happen?
- The `durationMs` — is a block suspiciously slow (timeout) or instant (validation error)?
- The `input` summary — was the block receiving the expected data?
- The `output` summary — did a predecessor block produce unexpected output?

#### Stdout: NDJSON Events

Each line is a JSON object. The five event types:

| Event | What It Tells You |
|-------|-------------------|
| `{"type":"item_added","item":{...}}` | A new output item was created. Check `item.type` (message, reasoning, block_output, error), `item.provenance.blockName`, `item.status` |
| `{"type":"content_delta","itemId":"...","delta":"..."}` | Streaming text chunk from a generator. Accumulate deltas to see the full response. |
| `{"type":"state_change","scope":"...","resourcePath":"...","changeType":"..."}` | State was mutated. Check scope (session/request/user/project) and what changed. |
| `{"type":"flow_complete","output":"...","durationMs":...,"items":...}` | Success. Shows final output and total item count. |
| `{"type":"error","message":"...","code":"..."}` | Failure. This replaces `flow_complete`. The `code` maps to the error taxonomy (see reference). |

**What to look for:**
- `item_added` with `type: "error"` — terminal request failure
- `item_added` with `status: "failed"` — a specific block failed
- `block_output` items — check `output` and `modelUsage` for generators
- `block_output` with `toolCall` — tool invocation lifecycle (in_progress → completed/failed)
- Missing expected items — a block may have short-circuited
- `state_change` events — verify state mutations happened in the right order

### Step 5: Isolate the Failing Block

Once you identify which block failed from the trace, test it in isolation:

```bash
# Execute a single block directly
source ~/.zshrc && pnpm --filter @flow-state-dev/cli fsdev block <path-to-block-file> -i '<json-input>' 2>&1
```

The `fsdev block` command returns structured JSON (not NDJSON):

```json
{
  "success": false,
  "block": { "kind": "handler", "name": "my-block" },
  "output": null,
  "schemaValidation": {
    "input": { "passed": false, "errors": ["String must contain at least 1 character(s)"] },
    "output": { "passed": true }
  },
  "execution": { "durationMs": 3 },
  "error": { "message": "...", "stack": "..." }
}
```

**Key diagnostic fields:**
- `schemaValidation.input.passed` — Did the input match the block's `inputSchema`? Schema errors often mean the previous block in a sequencer produced the wrong shape.
- `schemaValidation.output.passed` — Did the output match `outputSchema`? This catches generators returning unexpected formats.
- `error.message` + `error.stack` — The actual exception with stack trace.
- `execution.durationMs` — Near-zero suggests a validation or early-exit failure. Very high suggests a timeout or hung model call.

### Step 6: Diagnose Root Cause

Based on the trace evidence, classify the problem:

#### Common Failure Patterns

| Pattern | Trace Signal | Likely Cause | Fix Direction |
|---------|-------------|--------------|---------------|
| **Schema mismatch** | `schemaValidation.input.passed: false` in block output | Previous block output doesn't match next block's `inputSchema` | Check sequencer `.step()` chain — may need a connector function |
| **Missing connector** | Block receives raw previous output instead of transformed input | Sequencer step lacks a connector: `.step(block)` vs `.step(connector, block)` | Add connector: `.step((v) => ({ field: v }), nextBlock)` |
| **Generator model error** | `[flow-state] block execution failed` on a generator + `code: "model_error"` | LLM API failure (rate limit, auth, invalid model ID) | Check `.env.local` for API keys, verify model ID with `--model` flag |
| **Tool execution failure** | `block_output` with `toolCall` status `"failed"` | A block used as a tool inside a generator threw | Isolate the tool block with `fsdev block` and test directly |
| **State not persisted** | `state_change` events missing or state reads return defaults | State ops not awaited, wrong scope, or ephemeral session | Check `await ctx.session.patchState(...)` calls, verify `--session` flag for persistence |
| **Infinite loop** | `durationMs` very high, many repeated `nested block started` logs | `doWhile`/`loopBack` condition never becomes false | Check loop guard (max 250 iterations), verify loop exit condition |
| **Rescue swallowing errors** | No error in trace but output is wrong | A `.rescue()` handler caught the error and returned fallback output | Check rescue handler — is it masking a real problem? |
| **Missing items** | Expected `item_added` events never appear | Block's `emit` config filters them out, or block short-circuits | Check generator `emit: { reasoning, messages, tools }` flags |
| **Wrong route selected** | `router selected route` shows unexpected block | Router's `execute` function returned wrong block based on input | Test router selection logic with known inputs |
| **Timeout** | `code: "timeout_error"` in error event | Block or model call exceeded timeout | Check tool `timeoutMs` config, network conditions, model latency |
| **Retry exhaustion** | Multiple `block execution retry` logs then `block execution failed` | All retry attempts failed | Check `retry: { maxAttempts, retryableErrors }` config, investigate underlying transient error |

### Step 7: Fix and Verify

1. Implement the fix based on your diagnosis
2. Re-run the flow with the same input to verify:
   ```bash
   source ~/.zshrc && pnpm --filter @flow-state-dev/cli fsdev run <flowKind> <action> -i '<same-input>' --flow-dir <path> 2>&1
   ```
3. Confirm the trace now shows `flow_complete` (not `error`)
4. Run the package tests:
   ```bash
   source ~/.zshrc && pnpm --filter <affected-package> typecheck && pnpm --filter <affected-package> test
   ```
5. Present the diagnosis and fix to the user

### Step 8: Report

Summarize for the user:
- **Root cause**: What specifically was wrong
- **Evidence**: Which trace signals led to the diagnosis
- **Fix**: What changed and why
- **Verification**: Output showing the flow now succeeds

---

## Architecture Quick Reference

### The 4 Block Kinds

| Kind | Purpose | Key Behavior |
|------|---------|-------------|
| **handler** | Arbitrary logic | `execute(input, ctx) → output`. No model integration. |
| **generator** | AI/LLM integration | Multi-step model loop with tool execution. Resolves model via `ctx.resolveModel()`. Streams text via `content.delta`. |
| **sequencer** | Block composition | Chains blocks via `.step()`. Supports `.parallel()`, `.forEach()`, `.rescue()`, `.branch()`, `.doWhile()`, `.work()`. |
| **router** | Dynamic dispatch | `execute(input, ctx)` returns one of N `routes` blocks to run. |

### Sequencer DSL Quick Reference

```
.step(block)                    — Chain: output → next block's input
.step(connector, block)         — Chain with transform: output → connector() → input
.stepIf(condition, block)       — Conditional step
.parallel({ a: blockA, ... })   — Run blocks concurrently, output is { a: outputA, ... }
.forEach(block)                 — Iterate array input, run block per item
.rescue([{ when: [...], block }]) — Error recovery
.branch({ name: [cond, block] }) — Route by condition
.work(block)                    — Non-aborting side effect
.tap(block)                     — Side effect (preserves throughput)
.map(fn)                        — Pure data transformation
.doWhile(cond, block)           — Loop while condition true
.loopBack(stepName, opts)       — Jump to named step
```

### State Scopes

| Scope | Lifetime | Typical Use |
|-------|----------|-------------|
| **request** | Single action execution | Attempt counters, temporary flags |
| **session** | Across requests in a session | Conversation history, mode settings |
| **user** | Across all sessions for a user | Preferences, profile data |
| **project** | Across sessions and users | Shared config, knowledge base |

**State ops** (all atomic, CAS-guarded):
`patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`

### Item Types

| Type | Visible To | Purpose |
|------|-----------|---------|
| `message` | Client + LLM | Conversational content (user/assistant/system/developer) |
| `reasoning` | Client + LLM | Model thinking traces |
| `block_output` | Internal | Execution record — every block emits one. `toolCall` metadata for tool invocations. |
| `component` | Client | Custom UI renderable |
| `container` | Client | Visual grouping for sequencers/routers |
| `status` | Client | Transient progress indicator |
| `context` | LLM only | Hidden context injection |
| `state_change` | Client (transient) | State mutation record |
| `error` | Client | Terminal request failure |
| `step_error` | Client | Recoverable step/work failure |

### Error Taxonomy

| Error Code | Retryable | Cause |
|-----------|-----------|-------|
| `validation_error` | No | Input/output schema mismatch |
| `network_error` | Yes | Transient network failure |
| `timeout_error` | Yes | Operation timeout |
| `rate_limit_error` | Yes | Upstream rate limiting |
| `model_error` | Yes | LLM provider failure |
| `tool_execution_error` | No | Tool block threw during generator loop |
| `execution_error` | No | Generic/unknown execution failure |

### Retry Policy

```ts
retry: {
  maxAttempts: 3,          // Total attempts (including first)
  baseDelayMs: 500,        // Initial backoff
  maxDelayMs: 5000,        // Backoff ceiling
  retryableErrors: [NetworkError, TimeoutError]  // Optional filter
}
```

Backoff: `min(maxDelayMs, baseDelayMs * 2^(attempt-1))`

### Generator Context Assembly

Messages sent to the model are assembled from slots:

```
[system] prompt                  ← config.prompt (string or function)
[system] context slot entries    ← config.context (dynamic per tool-step)
[history] prior messages         ← config.history (conversation context)
[user] current input             ← config.user (current request)
```

Tools are compiled from block definitions and auto-executed in the model loop (up to `maxIterations`, default 8).

### Key File Locations

| Component | Path |
|-----------|------|
| Handler builder | `packages/core/src/blocks/handler.ts` |
| Generator builder | `packages/core/src/blocks/generator.ts` |
| Sequencer DSL | `packages/core/src/blocks/sequencer.ts` |
| Router builder | `packages/core/src/blocks/router.ts` |
| Flow definition | `packages/core/src/flow/defineFlow.ts` |
| Item types | `packages/core/src/items/types.ts` |
| Block context | `packages/core/src/types/block.ts` |
| Execution engine | `packages/engine/src/execution/executeBlock.ts` |
| Action runner | `packages/engine/src/execution/runAction.ts` |
| Error classes | `packages/engine/src/errors/flow-error.ts` |
| Retry logic | `packages/engine/src/execution/retry.ts` |
| CLI run command | `packages/cli/src/commands/run.ts` |
| CLI block command | `packages/cli/src/commands/block.ts` |

---

## Guidelines

- **Run it first.** Never diagnose from code alone when you can execute and observe.
- **Read both streams.** Stderr logs show execution flow; stdout NDJSON shows data flow. You need both.
- **Isolate before fixing.** Use `fsdev block` to test suspected failing blocks in isolation before touching code.
- **Check the connector.** Most sequencer bugs are missing or wrong connector functions between `.step()` steps.
- **Check the schema.** Schema validation errors are the most common failure. Always check `inputSchema`/`outputSchema` compatibility.
- **Verify environment.** Missing API keys in `.env.local` cause cryptic generator failures. Check `OPENAI_API_KEY` and similar.
- **Report with evidence.** Every diagnosis should cite specific trace lines — block names, error codes, durations, item IDs.
