# FIX-1717 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Three updates and a release note. No new page: `run.task` is one field on a documented hook, and
what a Shift Manager run is handed belongs beside the rest of what Shift Manager's README says
about a task.

## UPDATE · `apps/docs/docs/orchestration/harness-manager.md` · "What a phase is"

Replace the sample and add one paragraph after "`buildPrompt` runs on every attempt…":

```ts
const implementPhase = {
  phase: "implement",
  buildPrompt: (run) =>
    `${run.task.goal}\n\nWork in ${run.workspacePath}, on branch ${run.branch}.`,
  isDone: (run) =>
    run.stopReport === "stopped-at-limit" ? false : pullRequestExists(run.branch),
};
```

`run.task` is the row the manager claimed, as the board handed it over: its `goal`, and its
`title`, `context`, `input`, `deps` and `priorWork` when the row has them. A field the row doesn't
have is absent, not empty. It's the same on every attempt, so a retry or a run that resumes after
someone's message starts from the same task. What goes into a run's prompt is the row and
whatever your phase adds, nothing else. If a run needs something that was said in a conversation,
write it on the task's `context` when you file it.

## UPDATE · `packages/harness-manager/README.md` · "What a phase supplies"

Same sample change. After the paragraph on `buildPrompt`, add:

`run.task` is the claimed row's brief as the board packed it: `goal`, plus `title`, `context`,
`input`, `deps` and `priorWork` when present. Build the prompt from it rather than from
`run.issue`, which is only the row's identity.

## UPDATE · `labs/shift-manager/README.md` · new subsection after "A task", before "Not there yet"

### What a coding run is handed

When you approve a feature in Inbox, or post `slug: what to build` on a workstream, the team's
coordinator files it as a task and a coder seat picks it up as a coding run. In the `devteam`
profile, the run's prompt holds, in this order:

- **The task.** The line you approved or posted, word for word.
- **The seat's own files.** Its instructions, the document it names (the team's standing brief),
  and its skills.
- **The workstream's charter**, when the coder seat is a member of that workstream.
- **Where and how to work.** Its own checkout and branch, and what counts as done.

It never gets the coordinator seat's session or the workstream's transcript. Anything a run
needs from a conversation has to be written on the task. A message you send to a running task
reaches it separately, as described under *Talking to a worker*. Which environment variables a
run sees isn't decided here.

Another Lab decides its own prompt. Every Lab's prompt builder is handed the task the same way.

## Release note · `.changeset/<name>.md`

```md
---
"@flow-state-dev/harness-manager": minor
---

A phase's `buildPrompt` and `isDone` now receive `run.task`: the claimed row's goal, plus its title, context, input, dependency outputs and selected prior work when present. Prompt builders that only read `run.issue` keep working unchanged.
```

## Voice notes for the publisher

The Shift Manager section is for someone running a team, not a framework author: no `run.task`
there. Watch for em-dashes and "This …" openers. Introduce *charter* as the workstream's own
description on first use if the surrounding README hasn't.
