---
sidebar_position: 4
---

# Identity

The identity domain (`@thought-fabric/core/identity`) will define how an agent interprets information and constrains its own behavior. Right now it ships placeholder types only. Both `perspective()` and `constitution()` throw "Not implemented" and are planned for Wave 2.

## What's There Today

You can import the functions and config types. Calling them will throw:

```ts
import { perspective, constitution } from '@thought-fabric/core/identity'

// Both throw: "Not implemented — placeholder for Wave 2"
perspective({ role: 'assistant', expertise: ['typescript'] })
constitution({ values: ['honesty'], constraints: ['Never share secrets'] })
```

## Design Intent

### perspective

A perspective defines a role and expertise that shape how an agent interprets information. Different perspectives lead to different readings of the same text. A "code reviewer" perspective focuses on bugs and style; a "product manager" perspective focuses on scope and priorities. The plan is for perspective to influence context formatting, prompt framing, and interpretation of user messages.

### constitution

A constitution defines values and constraints that guide agent behavior. Values are things the agent cares about (e.g. honesty, helpfulness). Constraints are hard limits (e.g. never share API keys, never make commitments on behalf of the user). The plan is for constitution to have an `evaluate(action)` method that returns whether an action is allowed and why. This would feed into tool-gating, response filtering, or explicit guardrails.

## Why Placeholders?

Identity touches interpretation and constraint at many points. Getting the design right requires more use-case work. The placeholders reserve the API surface so that flows can declare their intent today without wiring up real behavior. When Wave 2 lands, existing flows that call `perspective()` or `constitution()` will get real implementations.

## Tradeoffs

Identity is the least developed of the three domains. Attention and memory are production-ready. Identity is speculative. If you need behavior constraints now, use flow-level validation, tool guards, or post-processing filters. The constitution abstraction, when it ships, will centralize that logic.
