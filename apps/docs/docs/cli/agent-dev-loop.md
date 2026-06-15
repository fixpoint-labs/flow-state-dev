---
sidebar_position: 2
title: "Agent Dev Loop"
---

# Agent Dev Loop

If you're a developer (or a coding agent) iterating on a flow, this is your loop. Edit a block, run `fsdev run`, read the NDJSON, repeat. The CLI runs the same `runAction` engine the production server uses, against the same stores, with structured events on stdout and runtime logs on stderr. No browser, no HTTP server, no mock harness.

## The loop

1. **Edit.** Change a block, sequencer, router, capability, or flow definition.
2. **Run.** `pnpm fsdev run <flow> <action> -i '<json>'` from the repo root. Pass `--session <id>` for multi-turn behavior, `--model <id>` to swap the model, `--seed-session <json|path>` to start from specific state.
3. **Read.** Stderr shows `[flow-state] *` runtime logs — the shape of execution. Stdout streams NDJSON events — `item_added`, `content_delta`, `state_change`, `flow_complete`, `error`. Pipe to `jq` for anything you want to inspect.
4. **Repeat.** Tighten the loop with `--capture <path>` if you want a single file to diff between runs.

A worked example, "I'm adding a new tool to chat-agent":

```bash
# 1. Edit flows/chat-agent/blocks/my-new-tool.ts and wire it into the pipeline.
# 2. Smoke it.
pnpm fsdev run kitchen-sink chat-agent \
  -i '{"message":"use the new tool to do X","mode":"do"}' \
  --session new-tool-test \
  --capture /tmp/chat-run.json

# 3. Read what happened.
jq -c 'select(.type=="item_added" and .item.kind=="tool_call")' /tmp/chat-run.json
```

When the app under test ships an `fsdev.config.ts`, `fsdev run` uses its models and stores instead of CLI defaults, so the loop exercises your real resolver and persistence. Run it from the app directory; config search is cwd-only. See [App Configuration](./configuration).

## Reading the output

Stderr and stdout are separate channels on purpose. Stderr is for humans and agents skimming the run; stdout is for tools that parse it.

```bash
# Final result only
pnpm fsdev run ... 2>/dev/null | jq -c 'select(.type=="flow_complete")'

# All errors
pnpm fsdev run ... 2>/dev/null | jq -c 'select(.type=="error")'

# Just the assistant message text, reconstructed from streamed deltas
pnpm fsdev run ... 2>/dev/null | jq -r 'select(.type=="content_delta") | .delta' | tr -d '\n'
```

`--quiet` silences stderr when you only want the NDJSON. `--log-level debug` adds nested-block events for tracing inside sequencers and routers.

## Useful flag combinations

| Flag | What it does | When to reach for it |
|---|---|---|
| `-i, --input <json>` | Inline action input | Every run |
| `-f, --input-file <path>` | Read input from a JSON file | Long fixtures |
| `-s, --session <id>` | Reuse session state across invocations | Multi-turn flows |
| `--seed-session <json\|path>` | Pre-populate session state | Reproducing a specific bug state |
| `--seed-user <json\|path>` | Pre-populate user-scoped state | User-memory features |
| `--seed-org <json\|path>` | Pre-populate org-scoped state | Multi-tenant features |
| `-m, --model <id>` | Override the model for every generator | Cheap iteration, forcing a path |
| `--flow-dir <path>` | Restrict flow discovery (repeatable) | Monorepo with many candidate flows |
| `--capture <path>` | Write the full structured run output to a JSON file (additive with stdout) | Diffing runs, sharing a trace |
| `--quiet` | Suppress stderr runtime logs | Piping NDJSON cleanly |
| `--log-level <level>` | `debug \| info \| warn \| error` (default: info) | `debug` to trace inside sequencers |

## When to switch tools

`fsdev run` is the right answer for flow-level changes. It is not the right answer for:

- **Pure helpers, types, or schemas** — use `pnpm test` (or `pnpm --filter <pkg> test`). Vitest is faster and asserts on values directly.
- **Component rendering, streaming display, hydration** — open the kitchen-sink app in a browser. NDJSON tells you the data is right; only a browser tells you the render is right.
- **Diagnosing a failure** — switch into the `debug-flow` skill. It has a failure-pattern matrix and the `fsdev block` isolation workflow for narrowing down which block broke.

The CLI is for verifying a change works. The skill is for figuring out why one doesn't.
