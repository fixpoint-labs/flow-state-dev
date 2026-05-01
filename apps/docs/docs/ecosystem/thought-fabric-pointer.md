---
sidebar_position: 6
---

# Thought Fabric

Thought Fabric is a cognitive architecture layer built on top of `@flow-state-dev/core`. It adds primitives for attention, memory, and identity — opinionated machinery for building agents that maintain state across turns rather than treating every request as a blank slate.

It lives in its own package (`@thought-fabric/core`) and has its own documentation site with its own sidebar. The framework treats it as ecosystem rather than core: you can build flows without it, and most simple flows don't need it.

## Where to read more

- **[Thought Fabric documentation](/thought-fabric/introduction)** — full sub-site covering attention, memory, identity, and the domain conventions
- The `@thought-fabric/core` package on npm

## Why it's separate

Core gives you the runtime — blocks, flows, sequencers, items. Thought Fabric gives you a particular *shape* of agent on top of that runtime. They're decoupled on purpose: people who want bare blocks shouldn't have to learn Thought Fabric's domain model, and people who want cognitive primitives shouldn't have to reimplement them.

If you're building anything where the agent needs to remember things across turns, decide what to attend to, or reason about its own identity, start with the Thought Fabric site.
