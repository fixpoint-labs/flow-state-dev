---
sidebar_position: 1
description: Packages and app-facing layers that sit outside the core runtime.
---

# Ecosystem

The core runtime gives you blocks, flows, state, streaming, the server, the client, and testing. The ecosystem packages sit on top of that foundation. They are useful, but they are not required to understand the irreducible runtime.

Use this section when you want prebuilt agent architectures, external tools, skill playbooks, UI components, cognitive primitives, or local development tooling.

## What lives here

| Area | Package or surface | What it gives you |
|------|--------------------|-------------------|
| Patterns | `@flow-state-dev/patterns` | Higher-level sequencer factories such as `parallelTasks`, `supervisor`, `planAndExecute`, routed specialists, and event actors. |
| Tools | `@flow-state-dev/tools` | Reusable tool blocks and tool capabilities for fetch, crawl, bash, MCP, and related integrations. |
| Skills | `@flow-state-dev/skills` | Markdown playbooks that can be loaded into generators inline or through forked sub-agents. |
| UI | `@flow-state-dev/ui` | Component registry and prebuilt UI pieces that render Flow State item types directly. |
| Thought Fabric | `@thought-fabric/core` | Cognitive architecture primitives for attention, memory, identity, and metacognition. |
| Dev Experience | `@flow-state-dev/cli`, `@flow-state-dev/devtool` | The `fsdev` CLI and browser DevTool for local flow development. |

## How to choose

Start with Core when you are learning how execution works. You should know what a block, flow, action, scope, resource, and item are before adopting an ecosystem package.

Reach for the ecosystem when you recognize a repeated shape:

- A workflow keeps reimplementing decomposition, dispatch, review, or synthesis. Use a pattern.
- A generator needs outside-world actions such as web fetch, bash, or MCP servers. Install a tool capability.
- An agent needs task-specific written instructions that can change without a deploy. Use skills.
- A frontend needs standard renderers for messages, task plans, or custom item components. Use UI.
- An agent needs durable memory, attention scoring, or a stable perspective. Use Thought Fabric.

## Related pages

- [Using capabilities](/docs/fundamentals/capabilities)
- [Patterns overview](/docs/patterns/overview)
- [Tools overview](/docs/tools/overview)
- [Skills overview](/docs/skills/overview)
- [Thought Fabric](/docs/ecosystem/thought-fabric-pointer)
