---
title: Skills
type: catalog
description: "Markdown playbooks that join a prompt only when a task calls for them, kept as files anyone can edit."
---

import Figure from "@site/src/components/Figure";
import SkillActivating from "./figures/skill-activating.svg";

# Skills

A skill is a Markdown file of instructions for one kind of task: how your team writes release notes, how to handle a refund, what an incident report has to cover. An app with a dozen of these can't put them all in the prompt. The prompt grows, and the model weighs every procedure on every turn, including the ones the turn has nothing to do with.

A skill keeps its procedure out until it is needed. Each one has a one-line description that is always visible, and a body that joins the prompt only on turns that call for it. A skill is stored text, so it can be edited in a running app.

The examples follow a team that wants every release note in one format.

## What a skill is

A skill is a folder named for the skill, with a `SKILL.md` at its root. The file is YAML frontmatter, then the instructions.

```md title="src/skills/release-notes/SKILL.md"
---
description: Write release notes for a version, in the team's house format.
keywords: [release notes, changelog]
---

Write release notes for the version the user names.

1. Group changes under Added, Changed and Fixed.
2. Lead each entry with what a user can now do, not with the commit message.
3. Call out any change a user has to act on, and say what they do.
4. Keep each entry to one line.
```

The folder name, `release-notes`, is the skill's name. `description` is the only required key, and it is what shows wherever skills are listed, so say when the skill applies. `keywords` lets a word in a message trigger the skill. The body is the playbook.

Other files in the folder travel with the skill, and the body can point at them and at the text the skill was activated with. [Body substitutions](../reference/skill-md.md#body-substitutions) lists how.

A skill adds its body to the prompt of a generator, the block that calls a model, and nothing else. Every frontmatter key and the naming rules are on the [reference](../reference/skill-md.md#frontmatter-fields).

## Skill or capability?

A capability is code that ships with the app: tools, stored data and prompt additions, on for every generator that lists it. A skill is Markdown, on only when something activates it, and editable by anyone who can write to the app's skills.

A checklist for writing release notes is a skill. It is text, it applies to some turns, and an editor can tune it. Reach for a [capability](../concepts/capabilities.md) when the guidance needs a tool or data the generator can't already reach. The skills library, below, is itself installed as a capability. The skills it carries are Markdown.

## Install it

```bash
pnpm add @flow-state-dev/orchestration
```

Skills are a library inside the orchestration package. There is nothing to add to `fsdev.config.ts`; you wire it into a flow.

## Use it

### A skills folder

`readSkillsDirectory` reads a folder of skills into the list that `createSkillsLibrary` takes as `initialSkills`, and returns the `errors` for any it could not read. The [folder rules](../reference/skill-md.md#folder-rules) are on the reference.

```ts title="src/flows/changelog/skills.ts"
import path from "node:path";
import { createSkillsLibrary, readSkillsDirectory } from "@flow-state-dev/orchestration";

export const { skills: initialSkills, errors } = await readSkillsDirectory(
  path.resolve("src/skills"),
);
for (const { name, error } of errors) console.warn(`skill "${name}":`, error.message);

export const activeState = { scope: "session", field: "activeSkills" } as const;
export const allowed = ["release-notes"];

export const skills = createSkillsLibrary({ initialSkills });
```

`createSkillsLibrary` returns the skills library: a capability that stores the skills and puts them in a generator's prompt. Listing `skills` in `uses` on its own gives a generator no skills. `skills.config({ allowed })` says which ones it gets (see Give skills to one generator).

### How a skill activates

<Figure
  svg={SkillActivating}
  caption="A message matches a skill, and its body joins the prompt"
  description={"Three boxes joined by arrows. The first holds the message 'write the release notes for 2.4'. The second, the skill-activator, tries three steps: slash finds no match, keyword matches release-notes and is highlighted, classifier is not needed. The third, drawn dashed because it lasts one action run, is the writer's prompt for the turn: the writer's instructions, the release-notes body and the message. Two notes say a slash name or keyword costs no model call, and that the next message is matched again from scratch."}
/>

A matcher can pick a skill from the user's message before the generator runs, or the generator's model can load one itself partway through the turn.

`createSkillActivator` builds the matcher as a block. Add it ahead of the generator with `.tap`, which leaves the input as it was. Give it the same `initialSkills` as the library: it runs before the generator, so on a new store it would otherwise find no skills on the first message.

```ts title="src/flows/changelog/flow.ts"
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { createSkillActivator } from "@flow-state-dev/orchestration";
import { z } from "zod";
import { writer } from "./blocks/writer";
import { activeState, allowed, initialSkills } from "./skills";

const skillActivator = createSkillActivator({ initialSkills, allowed, activeState });

export const changelog = defineFlow({
  kind: "changelog",
  actions: {
    write: sequencer({ name: "write", inputSchema: z.object({ message: z.string() }) })
      .tap(skillActivator)
      .step(writer),
  },
})();
```

The matcher tries a slash name, then the skills' `keywords`, then one call to a small model, and stops at the first that finds a skill. "write the release notes for 2.4" matches the `release notes` keyword, with no model call. It decides again on every message. [What decides that a skill matches?](../reference/skill-md.md#what-decides-that-a-skill-matches) has each step and the activator's options. To use your own classifier for that last step, see [Route with an evaluator](../build/route-with-an-evaluator.md).

In the other route the generator's prompt lists the skills and gives the model a `loadSkill` tool. When one applies, the model calls it and the body joins the prompt on the next step of the same turn, at the cost of one extra model call. The [library options](../reference/skill-md.md#library-options) cover the list and the tool.

### Give skills to one generator

The library holds the skills once for the whole app. A binding says which of them one generator has, and how. Two generators in a flow can hold different skills without seeing each other's.

```ts title="src/flows/changelog/blocks/writer.ts"
import { generator } from "@flow-state-dev/core";
import { activeState, allowed, skills } from "../skills";

export const writer = generator({
  name: "writer",
  model: "openai/gpt-6-luna",
  prompt: "You help the team write up what shipped.",
  user: (input: { message: string }) => input.message,
  uses: [skills.config({ allowed, activeState }).presets({ dynamicActivation: true })],
});
```

`allowed` is the set `loadSkill` may pull from. `activeState` names the field the matcher writes, so the generator reads what the matcher picked. `dynamicActivation` gives it `loadSkill`. `skills.config({ active: ["release-notes"] })` instead puts that skill's body in the prompt on every step. [Binding options](../reference/skill-md.md#binding-options) has every key.

**Keep skills off helper generators.** A generator's `itemVisibility` says whether its output reaches the client and the conversation history. Give the library an `itemVisibility` and its skills attach only to generators with the same value. A generator with none set counts as `{ client: true, history: true }`. Set the library to that value and a helper to `{ client: true, history: false }`, and the helper gets no skills. The `supervisor` pattern, where one generator hands parts of a task to helper generators, marks its default reviewer that way. See [library options](../reference/skill-md.md#library-options).

**One skill list for the whole session.** `createSkillsCapability` keeps activations in one session list, read by every generator that lists the capability. Use the library unless that is what you want.

```ts title="src/flows/changelog/blocks/session-writer.ts"
import { generator } from "@flow-state-dev/core";
import { createSkillsCapability } from "@flow-state-dev/orchestration";
import { initialSkills } from "../skills";

export const sessionWriter = generator({
  name: "session-writer",
  model: "openai/gpt-6-luna",
  prompt: "You help the team write up what shipped.",
  user: (input: { message: string }) => input.message,
  uses: [createSkillsCapability({ initialSkills })],
});
```

It gives the generator a `runSkill` tool in place of `loadSkill`. The model calls it with a skill's name, and that skill's body joins the prompt. It stays there until the session ends, alongside any skills loaded later, in every generator of the session that lists the capability. A generator without it never sees the body. The limits of `runSkill` are under [capability options](../reference/skill-md.md#capability-options).

## Change it

Skills live in a resource collection named `skills`. [Stored skills](../reference/skill-md.md#stored-skills) says who owns and sees each copy, and where it is kept.

A skill's body is read from the store on every step, so an edit shows from the next step. Anything that can write the `skills` collection can make one: DevTool, the client package, or an admin screen you build.

`initialSkills` is a starting set. A redeploy doesn't overwrite an edit, a deleted skill stays deleted, and a folder you add to the directory appears after the next deploy. Editing `SKILL.md` on disk and redeploying therefore changes nothing for a store that already has the skill. To push the edit there, call `refreshSeededSkills` with the skills collection and the skills to refresh; its effects are listed with [stored skills](../reference/skill-md.md#stored-skills).

## Next

- [SKILL.md and skills options](../reference/skill-md.md): every frontmatter key, folder rule and option.
- [Capabilities](../concepts/capabilities.md): the code-side counterpart to a skill.
