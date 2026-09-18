<!-- Verbatim snapshot. Do not edit, reflow, or fold. -->

# Linear project `content`, as read

**Read** 2026-09-18 from the Linear project
[Workforce: Layer 2 Abstraction](https://linear.app/fixpoint-labs/project/workforce-layer-2-abstraction-9f5c6119ed12)
· field `updatedAt` **2026-09-05T00:35:09.146Z** · **6,060 characters**

This is the project's own `content` field exactly as it stood when the
project-spec was built from it. It exists so that every "folded in" and
"dropped as stale" call made against it stays reversible by someone who
disagrees with it later, and so the field can be restored if a mirror write
goes wrong — the one action at this altitude that the Linear API cannot undo.

Taken late: the set was first built on 2026-09-17, before
[`project-spec-template.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/docs/contributing/project-spec-template.md)
required this snapshot. `updatedAt` predates that build, so the text below is
the same text the set was absorbed from.

Everything below the rule is untouched.

---

A conceptual revamp of how FSD presents itself to users: a two-layer architecture where **Layer 1** (blocks, scope state, resources, instructions format, sub-flow invocation, stream visibility) is the substrate, and **Layer 2** (Agents, Teams, Plans, Personas, Strategies, Roles, Archetypes, Skills, Memory) is the everyday API most users live in. Layer 2 is transparently implemented on Layer 1 — no black box — but the README, docs, and common path lead with Layer 2.

The framing is **agents-as-humans**: an Agent is a complete participant system, not an LLM-in-a-loop building block. Internally it bundles a Persona, Skills, Memory, Instructions, and a Strategy; externally it is invoked or assigned Tasks, not decomposed.

## What Workforce is, and the test for what belongs here

**Workforce is a strong set of opinions for getting up and running quickly with FSD, delivered**
**as file-based conventions.** Agents, teams, team collaboration. It is not where primitives or
core substrates are established — it is where they are *assembled* for you, so an end user is
not sticking so much together themselves, while Layer 1 stays fully available to anyone who
wants to extend past the conventions.

**The test is not complexity — it is whether there is one of it.**

* **Substrate (Layer 1)** — there is exactly one, and correctness depends on that. Blocks,
  Resources, Capabilities, the Task Board's claim system. Lives in core / engine /
  orchestration.
* **Convention (Layer 2)** — one opinionated assembly among several valid ones. A convention
  may still carry capabilities and be far more than config; being more than config does not
  make it substrate. Lives here.

Worked example: **Task is substrate** — it is the claim system, and there is one of it. **Plan**
**is a convention** — there are any number of ways to express a plan with what FSD already has,
including a resource a flow writes to. Same for Strategy, Role, Archetype and Team.

A concept that fails the test does not belong here even when it is convenient to put it here.

## Layer 2 manifest

* **Agent** — complete participant system; the canonical noun.
* **Persona** — the who-facet; resource-backed `.md` ([FIX-699](https://linear.app/fixpoint-labs/issue/FIX-699/resource-content-rendered-from-state-via-referenced-prompt-template-md)). Replaces "Identity."
* **Skill** — portable capability + instruction bundle an Agent has.
* **Strategy** *(convention)* — block composition for tackling a class of work. Replaces "Pattern."
* **Role** *(convention)* — a position within a Strategy, filled by an Agent. Replaces "Worker."
* **Archetype** *(convention)* — Agent factory / preconfigured template (e.g. "Task Manager," "Researcher").
* **Team** *(convention)* — a roster of Agents available to fill Roles. Teams collaborate over boards.
* **Task** — *moved to Layer 1.* A unit of work with a Goal, assigned to an Agent. It is the claim system; see the substrate list below.
* **Plan** *(convention)* — a structured sequence of Tasks.
* **Memory** — durable state attached to an Agent.
* **Perspective (TF)** — temporally-conditioned augmentation of Persona; TF-only.

## Layer 1 substrate (named separately)

* **Blocks** — generator / sequencer / router / handler primitives.
* **Scope state** — flat shared namespace.
* **Resources** — domain objects with identity, lifecycle, content/state.
* **Instructions format** — `.md` + frontmatter, templated ([FIX-669](https://linear.app/fixpoint-labs/issue/FIX-669/generator-prompts-as-md-files-with-frontmatter-and-templating) / [FIX-699](https://linear.app/fixpoint-labs/issue/FIX-699/resource-content-rendered-from-state-via-referenced-prompt-template-md)).
* **Sub-flow invocation** — runtime fork of a sequence.
* **Stream visibility** — how a generator's output surfaces (foreground / background / trace). Replaces "agentType."
* **Task Board** — the claim system: rows, assignees, leases, settlement. Began as an extension and is now core, because claiming is the thing correctness depends on. Lives in `orchestration`.
* **Dispatch** — one protocol, every arrival addressed by `(type, name)`. Delivery between sessions and flows.

## Vocabulary descriptors (not new concepts)

* **Participant** — Agent as a member of a process.
* **Collaborator** — Agent in peer relation to other Agents.

## Dropped / renamed

* **Identity** → collapsed to a system id field; Persona is the who-concept.
* **Worker** → Role.
* **Pattern** → Strategy.
* **Pattern-skill** → "a Skill that carries a Strategy."
* **Approach** → Strategy (same thing, two angles).
* **Prompt template** → Instructions (the concept) + `.md`+frontmatter (the file format).
* **agentType** → stream visibility.
* **Actor** → kept out of primary vocab; Agent owns the slot.

## Status

Working vocabulary. Pressure-testing via example code is next; the model isn't locked until concrete code shapes ratify it. Once locked, the propagation pass touches in-flight tickets, docs IA ([FIX-601](https://linear.app/fixpoint-labs/issue/FIX-601/docs-site-ia-revamp-for-launch-start-guides-examples-reference-top-nav)), README, and the renaming of the patterns package to strategies, the `agentType` field, and similar surface code.

## What lives here

This project is the workspace for the conceptual revamp itself: the foundational tickets that ratify the new vocabulary ([FIX-699](https://linear.app/fixpoint-labs/issue/FIX-699/resource-content-rendered-from-state-via-referenced-prompt-template-md), [FIX-450](https://linear.app/fixpoint-labs/issue/FIX-450/plantask-impl-7-reshape-fix-422-skills-declare-a-pattern-onto-unified), [FIX-641](https://linear.app/fixpoint-labs/issue/FIX-641/dynamic-worker-identities-runtime-bound-personas-of-a-worker-class), the agentType-rename, the rename-propagation tracker) and any subsequent tickets specific to introducing Layer 2 surfaces. Implementation work for Tasks / Plans, Skills internals, Memory, and so on continues to live in its own projects; this project owns the vocabulary and the few tickets that establish it.