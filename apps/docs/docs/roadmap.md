---
sidebar_position: 1
---

# Roadmap

This is a living document. Priorities may shift based on Wave 1–3 learnings and community feedback.

## Shipped (Wave 1)

- **Core block system** — All four block kinds (handler, generator, sequencer, router)
- **SSE streaming** — Sequence-number resume, item/content model
- **4-scope state model** — Request, session, user, project with resources, template rendering, and contentFile support
- **Eval framework** — evalBlock, evalFlow, analyzerScorer (LLM-as-judge)
- **CLI harness** — fsdev block, fsdev run with streaming NDJSON output
- **DevTool inspector app** — Real-time flow visualization, trace view, session state panels, replay controls
- **npm publishing** — Changesets + CI
- **Examples** — Kitchen Sink and Hello Chat
- **External agent SDK integration research** — Claude Code SDK wrapping

## In Progress (Wave 1)

- **Execution trace system** — Full block lifecycle event depth for the DevTool trace view
- **Transient block output** — Stream-only items that bypass session persistence
- **Composable patterns library** — Observer, Chain-of-Agents, and other reusable sequencer compositions
- **fsdev eval CLI command** — Run eval suites from the terminal
- **fsdev dev** — Launch the DevTool against your own flows with a single command
- **Session retention policies** — Bounded item log with maxItems/maxAge eviction

## Planned (Wave 2)

- **CLI TUI mode** — Ink-based pretty-print rendering for human-friendly terminal output
- **Middleware extension system** — Public interceptor API for caching, observability, and policy
- **Observability middleware package** — @flow-state-dev/middleware-observability
- **Production eval middleware** — Sample live traffic, score async, export to observability platforms

## Planned (Wave 3)

- **Durable execution** — Suspend/resume, checkpoint management, human-in-the-loop patterns
- **Production hardening** — Request size limits, stream caps, security headers
- **Embedded in-app DevTools widget** — First-party UI component for debugging flows in production

## Research (Wave 4)

- To be determined based on Wave 1–3 learnings and community feedback
