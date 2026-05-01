---
sidebar_position: 6
title: Using capabilities
description: Install bundled capabilities on blocks with the uses slot.
---

# Using capabilities

A capability is a bundle you install on a block with `uses`. It can add resources, tools, prompt context, state schemas, and typed helper functions. The consumer view is deliberately small: import the capability, pass it to `uses`, and turn presets on or off when you need a different shape.

Use capabilities when a package gives you a whole feature, not just one function. Memory, MCP tools, skills, bash-backed files, artifacts, and pattern substrates all fit that shape.

## The basic move

```ts
import { generator } from "@flow-state-dev/core";
import { createBashCapability } from "@flow-state-dev/tools/bash";

const bashCap = createBashCapability({
  provider: { type: "local" },
});

export const assistant = generator({
  name: "assistant",
  model: "preset/medium",
  prompt: "You can inspect and edit files when that helps the user.",
  uses: [bashCap],
});
```

The generator does not need to know which tools and context snippets make bash work. The capability installs them. If the capability declares resources or state, those declarations bubble through sequencers and up to the flow definition the same way block-level declarations do.

## Install more than one

Capabilities compose through the same `uses` array:

```ts
import { generator } from "@flow-state-dev/core";
import { createBashCapability } from "@flow-state-dev/tools/bash";
import { createMcpCapability } from "@flow-state-dev/tools/mcp";
import { createSkillsCapability } from "@flow-state-dev/skills";

const bashCap = createBashCapability({ provider: { type: "local" } });

const mcpCap = createMcpCapability({
  servers: [
    {
      name: "linear",
      description: "Project management: issues, projects, cycles, teams.",
      transport: {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: `Bearer ${process.env.LINEAR_MCP_API_KEY}` },
      },
    },
  ],
});

const skillsCap = createSkillsCapability({
  scope: "user",
  agentType: "primary",
});

export const assistant = generator({
  name: "assistant",
  agentType: "primary",
  model: "preset/medium",
  prompt: "Use the installed tools and active skills when they apply.",
  uses: [bashCap, mcpCap, skillsCap],
});
```

Each capability owns its own setup. Bash contributes shell tools and workspace guidance. MCP contributes remote tools and selection guidance. Skills contributes skill storage, active-skill context, and optional tool-call activation.

## Use packaged systems

Some packages expose a factory that returns blocks plus a capability. Thought Fabric memory is an example. The capture pipeline observes a session, and the capability makes memory available to generators:

```ts
import { generator, sequencer } from "@flow-state-dev/core";
import { memory } from "@thought-fabric/core/memory";

const mem = memory.system({
  model: "preset/small",
  working: true,
  episodic: true,
  semantic: true,
});

const assistant = generator({
  name: "assistant",
  agentType: "primary",
  model: "preset/medium",
  prompt: "Use relevant memory when answering.",
  uses: [mem.capability],
});

export const chatPipeline = sequencer({ name: "chat" })
  .then(assistant)
  .work(mem.captureFromItems);
```

Here `uses: [mem.capability]` installs the memory resources, injects memory context into the prompt, and exposes helpers such as `ctx.cap.memory.recall()`.

## Configure presets

Many capabilities ship with named presets. A preset is a piece of block config the capability can contribute, such as tools or context. Presets are usually on by default.

Disable a preset at the use site when a block needs only part of the capability:

```ts
const readOnlyAssistant = generator({
  name: "read-only-assistant",
  model: "preset/medium",
  prompt: "Answer from available context. Do not call tools.",
  uses: [skillsCap.presets({ runSkill: false })],
});
```

The exact preset names are package-specific. For example:

| Capability | Common presets |
| --- | --- |
| Skills | `tools`, `context`, `runSkill` |
| Thought Fabric memory system | `context` |
| Custom app capabilities | Whatever the app author declared |

If a preset contributes generator-only fields such as `context` or `tools`, use it on a generator. The framework reports a clear error if you attach a block-kind-specific preset to the wrong block kind.

## Dynamic uses

`uses` can also include a function. Use this when a capability should attach only for a given request or session state:

```ts
import type { CapabilityRef } from "@flow-state-dev/core";

const maybeMcp = (ctx): CapabilityRef[] => {
  return ctx.session.state.remoteToolsEnabled ? [mcpCap] : [];
};

const assistant = generator({
  name: "assistant",
  model: "preset/medium",
  prompt: "Use remote tools only when they are enabled.",
  uses: [skillsCap, maybeMcp],
});
```

Dynamic capability entries can add runtime context and tools. Resources must be declared by a static capability somewhere in the block graph, because resources need to exist before execution starts.

## Helpers on `ctx.cap`

Capabilities can expose typed helpers on `ctx.cap.{name}`:

```ts
const rememberPreference = handler({
  name: "remember-preference",
  uses: [mem.capability.presets({ context: false })],
  inputSchema: z.object({ preference: z.string() }),
  execute: async (input, ctx) => {
    await ctx.cap.workingMemory.add({
      content: input.preference,
      importance: 0.8,
    });
  },
});
```

Not every capability exposes helpers. Some only install tools or context. Check the package page for the capability you are using.

## Where to go next

- [Tools overview](/docs/tools/overview) covers bundled tool capabilities such as bash and MCP.
- [Skills](/docs/skills/overview) covers runtime-editable skill bundles.
- [Thought Fabric](/docs/ecosystem/thought-fabric-pointer) explains the cognitive layer built on top of flow-state-dev.
- [Authoring capabilities](/docs/advanced/capabilities-authoring) covers `defineCapability`, presets, composition, and merge rules.
