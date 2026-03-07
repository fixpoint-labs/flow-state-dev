# Project Objectives

## Current Focus

Prove the concept with real-world usage. Prioritize patterns and paradigms that are harder to replicate in other frameworks. Complete the Phase 1 foundation and ensure the framework delivers on its core promise at the fundamentals level, so there's a solid base to build on as it matures.

## Goals

### 1. Validate through real usage

Ship working examples and integrations that exercise the framework end-to-end. Synthetic tests aren't enough. The framework needs to handle real workflows with real AI providers to prove it works.

### 2. Differentiate on hard problems

Focus on capabilities that other frameworks handle poorly or not at all:
- Structured multi-block workflows with typed state flow between blocks
- Resumable streaming with sequence-number-based reconnection
- Scoped state management (session, user, project) with CAS consistency
- Block-level retry, rescue routing, and error normalization
- Composable sequencer/router patterns with declarative DSL

### 3. Complete Phase 1 foundation

Finish the remaining waves (1.l CLI, 1.m devtool, 1.n cross-package validation) with the same rigor as waves 1.a–1.k. No shortcuts on the foundation. Every package boundary, type contract, and runtime behavior should be solid before moving to Phase 2.

### 4. Keep the foundation honest

Don't paper over gaps. If something doesn't work well, fix it or document the limitation clearly. The framework's value comes from getting the fundamentals right, not from feature count.

## Non-Goals (for now)

- Production deployment guides or infrastructure tooling
- Plugin/extension ecosystem
- Performance optimization beyond correctness
- Multi-provider abstraction (Vercel AI SDK is the Phase 1 provider)
