# FIX-817 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Five operations. One new reference page (a new term users will search for), three extensions,
and two package READMEs. The new page's prose names the door's tool, so it is finished once
[Open-1](DECISIONS.md#open-1) is answered; the shape below assumes the recommended single tool
and says so where it matters.

> **Voice watch for this topic.** Introduce *seat*, *channel* and *capability* in plain terms on
> first use — a reader arriving from a search for "how does my agent find things" may know none
> of them. Resist "powerful" and "first-class" around a discovery feature; both are the house
> tells. Keep em-dashes rare. And do not write the history: no reader needs to know that skills
> used to be pasted into the prompt, only what happens now.

---

## CREATE · `apps/docs/docs/orchestration/discovery.md`

**Sidebar:** `apps/docs/sidebars.ts`, the `orchestration` category, immediately after
`orchestration/task-substrate` and before `orchestration/flow-policy`. Reading order, not
alphabetical: the substrate says what work is, this says how an agent finds who can do it, and
policy then says how it is routed. `sidebar_label: Discovery`.

> # Discovery
>
> An agent that has to decide *who does this* needs to know what is around it. Discovery is how
> it asks: one tool call that returns a short list of what is in scope right now — the seats it
> can hand work to, the channels those seats talk in, the skills it can load, and the resources
> it can read.
>
> A **seat** is one worker in a workforce, declared by a file. A **channel** is a place seats
> share work. A **skill** is a set of instructions an agent can pull into context on demand.
>
> ## Why not just put the list in the prompt
>
> You can, and for a handful of entries you probably should. It stops working for the same
> reason any fixed context does: the list is paid for on every step of every turn, including the
> turns that never needed it, and it cannot reflect anything that changed while the turn was
> running. A channel that opened a minute ago is not in a prompt written at boot.
>
> Discovery is the other half of that trade. Nothing is spent until the agent asks, and what it
> gets back is read at the moment it asks.
>
> ## Asking
>
> ```ts
> // Inside a seat's turn, the model calls this itself.
> // Ask for everything in scope:
> discover({})
>
> // Or one kind of thing:
> discover({ domain: "seats" })
> ```
>
> An entry is deliberately short — an id, what kind of thing it is, and a line saying what it is
> for:
>
> ```ts
> {
>   id: "engineering.reviewer",
>   kind: "seat",
>   purpose: "Reviews diffs for correctness and flags regressions before merge.",
> }
> ```
>
> That line is what the agent chooses on, so it is worth writing well. A seat whose purpose
> reads "does engineering things" will not get picked over one that says what it actually does.
>
> ## What an agent can and cannot see
>
> Discovery never widens reach. An agent sees a domain only if the flow's scope carries it, and
> within that domain only what it is already allowed to use: a skill marked
> `disable-model-invocation` is absent, and so is a resource collection that is not readable by
> a model. These are absent, not listed-and-marked — there is nothing to be tempted by.
>
> A seat can narrow this further in its own file:
>
> ```yaml
> ---
> name: coordinator
> discover: [seats, channels]
> ---
> ```
>
> Naming a domain the scope does not carry does not add it. A worker file may narrow what a seat
> sees; it can never grant something the app did not.
>
> ## When a domain has nothing, or fails
>
> A domain with no entries returns an empty list. That is an ordinary answer — a workforce with
> no open channels is not an error, and an agent should read it as "none right now" rather than
> as a fault. If one domain cannot be read at all, the others still answer and that domain
> reports the problem, so a single misconfigured collection does not cost the agent its turn.
>
> ## Not to be confused with
>
> The [resource manifest](../resources/manifest.md) answers a different question for a different
> reader: it describes, for a browser, which resources a session exposes and what a UI is
> permitted to do with them. It is fixed for a flow and is not what an agent calls at runtime.
>
> Discovery is also not installation. Choosing which capability and resource modules an app
> *has* happens when the app is built and booted; discovery reports what is in scope for this
> agent, now.

---

## UPDATE · `apps/docs/docs/resources/manifest.md` · a new closing section

> ## Not the same as agent discovery
>
> This manifest is for a client: it is fixed for a flow, describes permissions, and is read by
> DevTool and React UIs at session bootstrap. An agent asking what it can work with at runtime
> uses [discovery](../orchestration/discovery.md) instead, which is read live and carries
> purpose rather than permissions.

The existing page says "Runtime introspection" in its *When to use it* list. Reword that bullet
to "Session bootstrap" so the two pages do not both claim the phrase.

---

## UPDATE · `apps/docs/docs/workforce/inventory.md` · after the existing body

> ## Reaching the inventory from an agent
>
> The rows on this page are what the framework knows about seats and channels. An agent does not
> read them directly: it calls [discovery](../orchestration/discovery.md), which turns the same
> rows into short entries it can plan against. Nothing here changes when it does — discovery
> reads these rows and writes none.

---

## UPDATE · `apps/docs/docs/skills/overview.md` · in the section describing how an agent finds a skill

> By default, the names and descriptions of the skills an agent can load are supplied to it as
> context, so it knows they exist from its first step. In an app with many skills you can turn
> that off and let the agent look them up through
> [discovery](../orchestration/discovery.md) instead, which it pays for only when it asks.

---

## UPDATE · `packages/workforce/README.md` · the `createWorkforceCapability` entry

> `createWorkforceCapability({ roster, inventory })` installs the seat and channel discovery
> sources for a workforce, so an agent in this flow can ask what seats exist and which channels
> are open.
>
> **Changed:** the `agents` option has been removed. Pass the declared roster and the inventory
> keys instead; the capability reads both rather than taking a pre-built registry.

---

## UPDATE · `packages/core/README.md` · the resource tools entry

> `resourceTools()` no longer returns `listResources`. To let an agent enumerate what it can
> read, register the resources discovery source and use the discovery tool, which applies the
> same readable gate the content tools apply.

---

## Publication ownership

FIX-817 publishes all six operations, reconciled against the shipped tool name and argument
shape. It owns the new discovery page outright. It does not rewrite the resource-manifest page
or the inventory page beyond the sections named here; both are owned elsewhere and this adds the
cross-links that keep the three senses of *manifest* from colliding for a reader.
