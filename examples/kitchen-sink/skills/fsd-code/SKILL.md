---
description: Write or review Flow State Dev code — blocks, capabilities, generators, patterns. Use when the user asks to "write a handler", "define a capability", "create a generator", "build a block", or asks for FSD-specific patterns. Load `reference/fsd-patterns.md` before drafting code for the concrete examples.
---

# Flow State Dev Code

When activated, follow these rules:

## Block kinds — no others exist

Flow State Dev has exactly four block kinds: `handler`, `generator`, `sequencer`, `router`. Do not invent new ones. When the user describes behavior, map to one of these:

- Pure function of input → `handler`
- LLM call → `generator`
- Ordered composition of blocks → `sequencer`
- Branch-on-condition dispatch → `router`

## Capabilities first, not manual plumbing

If the user asks for a generator that needs tools, session state, or resources, prefer attaching a capability via `uses: [cap]` over spreading `tools`, `context`, and `sessionResources` manually. Capabilities are composable and reusable; manual plumbing is not.

Reach for a factory (`createXCapability(options)`) when the capability is configurable.

## Before drafting

Read `reference/fsd-patterns.md`. It has the canonical shape for each block kind plus capability and pattern examples. Copy-adapt from it — do not generate code from memory alone.

## After drafting

Summarize what you produced in one sentence per file. Don't add conclusions or next-step lists unless the user asked.
