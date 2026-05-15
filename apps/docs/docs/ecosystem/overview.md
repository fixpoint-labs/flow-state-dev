---
sidebar_position: 1
---

# Ecosystem overview

The Core section covers the irreducible runtime: blocks, flows, sequencers, resources, items, server, client, testing. Everything in this section is built on top of that runtime, but isn't part of it. You can ship a flow without any of these. You'll usually want some of them.

The split matters because it shapes what you should learn first. Core is a small, fixed surface. Ecosystem packages can be swapped, replaced, or skipped depending on what you're building.

## What's here

**Patterns** are higher-level compositions — `planAndExecute`, `supervisor`, `parallelTasks`, `eventActors`, and others — that wire blocks together into common shapes. They sit on top of lower-level substrates like `task-board` and reuse the same block primitives you'd use directly.

**Tools** are reusable handler-style blocks: `fetch`, `crawl`, `bash`, MCP. Drop them into a generator's tool list or a sequencer step. The package is additive — you take what you need.

**Skills** are model-routed instructions that activate based on user input. They give you a way to ship many narrow behaviors that share infrastructure without forking flows.

**UI** is a component registry for rendering flow output in React. Common components, flow-aware components, and generative renderers.

**Memory** is the cross-turn memory system — working, episodic, semantic, and digest tiers behind a single `system()` factory. Lives at `@flow-state-dev/patterns/memory`.

**Thought Fabric** is a separate cognitive architecture sub-site. Attention, identity. It builds on Core but has its own conventions.

**Dev Experience** covers the CLI (`fsdev`) and the DevTool — a pre-built inspector you can mount into your own app or run standalone with `fsdev dev`.

A full map of the ecosystem is still being assembled. Until then, browse the package READMEs in the repo for what's currently published.

## How to read this section

You don't have to read it linearly. Most readers come here looking for a specific thing — "how do I add memory," "how do I render a flow's output," "how do I let a model use a search tool." Go to the relevant page directly. The Core section assumes nothing from Ecosystem; an Ecosystem page may assume you've read the Core fundamentals.
