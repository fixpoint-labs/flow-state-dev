# @flow-state-dev/knowledge-hub (incubation lab)

The Knowledge Hub: an owner's personal knowledge system that captures whatever's on their mind, files it into long-term memory, and puts a standing workforce of specialist agents to work on it. This lab is the incubation slot for that concept (FIX-882–884).

Right now it is an **empty scaffold** — a single `ping` action that does nothing but echo its input, present only so the package compiles, registers, and runs end to end. The real functionality lands in the follow-on issues:

- **FIX-882** — typed capture verbs (log a thought / task / memory / goal) into a working-memory staging area, with fast initial triage.
- **FIX-883** — a cron sweeper + manager that batch-reviews staged items and routes them into long-term OKF memory and workforce agent work.
- **FIX-884** — a personal workforce roster (project manager, researcher, editor, and more) that claims routed work by acceptance criteria.

## What's here

| Piece | Where | Status |
| -- | -- | -- |
| Scaffold flow (`knowledge-hub`) with one `ping` action | `src/flow.ts` | Scaffold |
| Dev-profile config (filesystem stores, no adapters/secrets) | `fsdev.config.ts` | Scaffold |
| Smoke test | `test/flow.spec.ts` | Scaffold |

## Run it

```bash
# Run the scaffold ping action (echoes its input).
pnpm fsdev run knowledge-hub ping -i '{"message":"hello"}'

# Smoke test.
pnpm test
```

## Predecessor

The finished simple-wiki that used to hold this slot is now a frozen reference app at [`examples/knowledge-base`](../../examples/knowledge-base) — OKF import/export, concept CRUD, and a secured MCP server. The Knowledge Hub reuses that same OKF concept graph as its long-term-memory layer; the OKF code is extracted into a shared package when the first hub issue consumes it (see the example's README).
