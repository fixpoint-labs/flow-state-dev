---
title: Discovery
sidebar_label: Discovery
description: One tool call that tells an agent what is in scope for it right now — the seats it can hand work to, the channels they share, the skills it can load, and the resources it can read.
---

# Discovery

An agent that has to decide *who does this* needs to know what is around it. Discovery is how it asks: one tool call that returns a short list of what is in scope right now — the seats it can hand work to, the channels those seats talk in, the skills it can load, and the resources it can read.

A **seat** is one worker in a workforce, declared by a file. A **channel** is a place seats share work. A **skill** is a set of instructions an agent can pull into context on demand.

## Why not just put the list in the prompt

You can, and for a handful of entries you probably should. It stops working for the same reason any fixed context does: the list is paid for on every step of every turn, including the turns that never needed it, and it cannot reflect anything that changed while the turn was running. A channel that opened a minute ago is not in a prompt written at boot.

Discovery is the other half of that trade. Nothing is spent until the agent asks, and what it gets back is read at the moment it asks.

## Asking

```ts
// Inside a seat's turn, the model calls this itself.
// Ask for everything in scope:
discover({})

// Or one kind of thing:
discover({ domain: "seats" })
```

An entry is deliberately short — an id, what kind of thing it is, and a line saying what it is for:

```ts
{
  id: "engineering.reviewer",
  kind: "seat",
  purpose: "Reviews diffs for correctness and flags regressions before merge.",
}
```

That line is what the agent chooses on, so it is worth writing well. A seat whose purpose reads "does engineering things" will not get picked over one that says what it actually does.

Entries also carry an optional `contract` — a hint at how to work with the thing, like the uri to read a resource by or how many members a channel has. It is withheld from a plain call and returned by `discover({ detail: "full" })`, so a catalog stays cheap on the calls that only need to choose.

## Setting it up

Four domains exist. Each is a **source**: a projection of a reader the framework already has, computed when an agent asks. Nothing is stored, and no domain keeps a second copy of its own state.

```ts
import { resourcesManifestSource } from "@flow-state-dev/core";
import { skillsManifestSource } from "@flow-state-dev/orchestration";
import { createWorkforceCapability } from "@flow-state-dev/workforce";

const kind = defineAgentWorkerFlow({
  uses: [
    skills,
    createWorkforceCapability({
      // What the tree declared, read once at boot.
      roster: declaredRoster,
      // Where the inventory's seat and channel rows are mounted on this block.
      inventory: { seats: "seatInventory", channels: "channelInventory" },
      // The other domains, behind the same door.
      sources: [
        // `allowed` has to be the same array the binding was given. The
        // source cannot read it off the binding, and a catalog listing a
        // skill the loader then refuses is worse than a shorter one.
        skillsManifestSource({ allowed: ["deep-research", "competitor-scan"] }),
        resourcesManifestSource(),
      ],
    }),
  ],
});
```

Every seat of that kind now has `discover`. A domain you leave out is simply not there, and asking for it comes back empty.

Outside a workforce, build the door yourself and hand it to a generator:

```ts
import { createManifestRegistry, discoveryTools } from "@flow-state-dev/core";

const { discover } = discoveryTools(
  createManifestRegistry([resourcesManifestSource(), skillsManifestSource()]),
);
```

## What an agent can and cannot see

Discovery never widens reach. An agent sees a domain only if the flow's scope carries it, and within that domain only what it is already allowed to use: a skill marked `disable-model-invocation` is absent, and so is a resource collection that is not readable by a model. These are absent, not listed-and-marked — there is nothing to be tempted by.

The skills domain goes one step further and lists only what `loadSkill` will actually accept: inline skills, inside the set you give `skillsManifestSource({ allowed })`. That array has to match the one the generator's binding was given — the source reads the collection, not the binding, so nothing else keeps the two honest. A catalog that advertised a skill the loader then refused would send the agent somewhere it cannot go.

A seat can narrow this further in its own file:

```yaml
---
name: coordinator
discover: [seats, channels]
---
```

Naming a domain the scope does not carry does not add it. A worker file may narrow what a seat sees; it can never grant something the app did not. Omit the key and the seat sees every domain its scope carries.

## When a domain has nothing, or fails

A domain with no entries returns an empty list. That is an ordinary answer — a workforce with no channels registered yet is not an error, and an agent should read it as "nothing here" rather than as a fault. If one domain cannot be read at all, the others still answer and that domain reports the problem, so a single misconfigured collection does not cost the agent its turn.

Asking for a domain name that does not exist comes back with the four real names in the answer, so the next call can succeed.

## What an entry does and does not promise

An entry says a thing was **registered or declared** in this workspace. It does not promise the thing is open, running, or still there. Seats and channels are projected from a record that is only ever appended to, so discovery cross-checks those rows against what the tree declares before it lists them — a channel whose declaration is gone does not appear, even though its row remains. Treat an entry as "this exists and here is what it is for", and confirm the state of anything you are about to act on the same way you would without the catalog.

## Moving skills from the prompt to the door

By default the names and descriptions of the skills an agent can load are also supplied to it as context, so it knows they exist from its first step. In an app with many skills that is the cost discovery exists to remove. Moving them behind the door takes two settings, and the order matters.

**First, put the skills domain behind the door.** Add the source to the capability, with the same `allowed` array the binding was given:

```ts
createWorkforceCapability({
  roster: declaredRoster,
  inventory: { seats: "seatInventory" },
  sources: [skillsManifestSource({ allowed: ["deep-research", "competitor-scan"] })],
})
```

The `discover` tool itself is on as soon as the capability is composed. If you previously turned it off, switch it back on here, since this is what the agent is about to rely on:

```ts
createWorkforceCapability({ ... }).presets({ door: true })
```

**Then take the listing out of the prompt**, where the binding is made:

```ts
skills.with({ dynamicActivation: true, catalogContext: false })
```

Both flags belong in the same call. Preset overrides replace rather than merge, so chaining `.presets()` and `.with()` drops whichever came first.

Do it in that order. Between the two steps an agent has both the prompt listing and the door, which is wasteful but harmless. Reversed, there is a window where it has neither and cannot find a skill to load at all.

There is no third setting to keep in sync. The `loadSkill` tool's own description tells the agent where the names come from, and that sentence follows `catalogContext` automatically: with the listing on it points at the system context, and with it off it tells the agent to call `discover` first. You cannot end up with a tool pointing at a listing that is no longer there.

To check the move landed, have a seat call `discover({ domain: "skills" })`. What comes back is what `loadSkill` will accept, so an empty answer here means the binding and the source disagree about `allowed` rather than that the skills are missing.

## Not to be confused with

The [resource manifest](../resources/manifest.md) answers a different question for a different reader: it describes, for a browser, which resources a session exposes and what a UI is permitted to do with them. It is fixed for a flow and is not what an agent calls at runtime.

Discovery is also not installation. Choosing which capability and resource modules an app *has* happens when the app is built and booted; discovery reports what is in scope for this agent, now.
