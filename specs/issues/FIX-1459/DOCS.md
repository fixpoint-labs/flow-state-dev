# FIX-1459 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose. PR-A publishes the two grant edits; PR-B publishes the rest. Every
passage is reconciled against shipped behaviour before it lands, and goes through `docs-writer`
and `docs-editor` rather than being pasted from here.

## CREATE · `apps/docs/docs/workforce/packages-on-disk.md`

Sidebar: Workforce, directly after `capabilities-on-disk`. Frontmatter `sidebar_label: Packages on disk`.

> # Packages on disk
>
> A **package** is a folder you hand to a worker: a `PACKAGE.md` that tells it how to do something,
> and a `blocks/` folder with the tools it needs to do it. No TypeScript wiring, no change to your
> app's source. Put the folder where the worker can see it and restart.
>
> ## Writing one
>
> ```
> packages/refunds/
>   PACKAGE.md
>   blocks/issue-refund.ts
> ```
>
> ```md
> ---
> description: How we issue refunds, and the tool that does it
> ---
> Refund only against an invoice you looked up in this conversation.
> Over $500, page on-call with the invoice id before calling issue-refund.
> ```
>
> The body is instructions. The worker reads it on every turn, after its team's instructions and
> its own. `description` is a label for people and never reaches the model. It is the only key the
> frontmatter takes.
>
> Every block in `blocks/` is a tool of the package, written the way any block in a
> [`blocks/` folder](./code-on-disk.md#blocks-a-worker-can-call) is. A package with no `blocks/`
> folder is fine: it is instructions and nothing else.
>
> Run `fsdev gen` after adding or removing a block, as you would for any other `blocks/` folder.
> Editing `PACKAGE.md` needs a restart and nothing more.
>
> ## Giving one to a worker
>
> Where the folder sits says who it is for.
>
> | The folder | Who gets it |
> | --- | --- |
> | `workforce/teams/<team>/workers/<worker>/packages/<name>/` | that worker, always |
> | `workforce/teams/<team>/packages/<name>/` | a worker on that team that names it |
> | `workforce/org/packages/<name>/` | any worker that names it |
>
> A worker names a package from its team's or the org's folder in its own file:
>
> ```md
> ---
> description: Handles refund requests
> packages: [escalation]
> ---
> ```
>
> The team's folder is looked in first, then the org's. A worker that names nothing gets nothing
> from either, so putting a package in a shared folder changes no worker until one asks for it.
>
> A worker that holds a package can call its tools. It doesn't also have to list them under
> `tools:`. A worker with `tools: []` calls nothing, whatever it holds: it still reads the package's
> instructions.
>
> A package's tools reach only the workers that hold it. They are not in your app's tool catalog,
> and a worker that doesn't hold the package can't name them.
>
> ## When a file is wrong
>
> Every mistake is found when the app starts, and every bad worker and file is named in one message.
> The app is refused when:
>
> | What | Why |
> |------|-----|
> | `PACKAGE.md` is missing, has no frontmatter, or has no `description` | A folder under `packages/` is a package. |
> | the frontmatter has another key | `description` is the only one. |
> | a worker names a package no folder in its reach has | The message lists the folders it looked in. |
> | a worker holds a package under a name its team or org also uses, and names it | One name is one package. Rename one of them. |
> | a package's block has the same name as another tool the worker can call | Nothing is quietly hidden. Rename one of them. |
> | a package folder holds `resources/`, `references/`, `skills/` or `packages/` | A package is instructions and tools. Documents belong to the organization; see [Documents on disk](./documents-on-disk.md). |
> | anything in the package is a symlink | Nothing in the tree is followed through a shortcut. |
>
> The rules for a block's own name and for blocks that declare a store are the same as in any
> [`blocks/` folder](./code-on-disk.md#blocks-a-worker-can-call).
>
> ## What this does not do
>
> - It does not load a package partway through a conversation. A package a worker holds is there on
>   every turn. For guidance that should arrive only when it's relevant, write a
>   [skill](../skills/overview.md).
> - It does not carry documents.
> - It does not change skills, capabilities or `WORKER.md`. They work as they did.
> - It does not read packages while your app runs. The text is read at startup and the blocks are
>   found by `fsdev gen`.

## UPDATE · `apps/docs/docs/workforce/capabilities-on-disk.md` · "Tools and controls in a preset" (PR-A)

Replace the first paragraph with:

> Presets carry tools as well as context. A worker that selects a preset gets both: its context and
> its tools. A worker with `tools: []` calls nothing, whatever it selected. That is how you give a
> worker a preset's guidance without its tools.

Replace the code comment `// held back, whatever that worker's \`tools:\` says` with
`// reaches a worker that selects \`radio\`, unless it writes \`tools: []\``, and the sentence under
the example with:

> A worker whose file selects `radio` gets the `radio` context and can call `ping` and `lookup`.
> With `tools: []` it gets the context and can call `ping` only, because a control is not a tool
> the list can hold back.

Add under "What this does not do":

> - It does not pass on tools a worker didn't pick. A capability your app installs on the kind can
>   switch presets on by default; those presets' tools reach no worker unless its file picks them.

### Upgrading

Add at the end of the page:

> **Coming from an earlier version:** a worker that selected a tool-bearing preset and had no
> `tools:` line used to get the context only. It now gets the tools too. To keep the old reach,
> write `tools: []` and list the tools you want.

## UPDATE · `apps/docs/docs/workforce/built-in-worker.md` · "Tools" (PR-A for the first two, PR-B for the rest)

- Replace *"An empty `tools:`, or none at all, means no tools, whatever is registered."* with:
  *"A worker also gets the tools of the capability presets it selects and the packages it holds.
  `tools: []` written out means no tools at all."*
- Replace *"That list is the whole of what a worker can call."* with *"That list, plus what the
  worker picked, is what it can call."* Keep the memory paragraph; it stays true (BR-29).
- In the paragraph that begins *"The settings a worker writes for itself…"*, add `packages` to the
  list, and make *"Three more reach the seat in the same bag"* four, adding *"the instructions of
  the packages it holds"*.
- After *"Declaring a tool under a skill's `allowed-tools` does not grant it."* add: *"A package is
  different: holding one is choosing its tools. See [Packages on disk](./packages-on-disk.md)."*

## UPDATE · `apps/docs/docs/workforce/code-on-disk.md` · "Blocks a worker can call"

Add a row to the table: `| a package's `blocks/` | the workers that hold that package |`. Replace
*"A name is resolved nearest first: the worker's own folder, then its team's, then the catalog."*
with *"A name is resolved nearest first: the worker's own folder, then its team's, then the
catalog. A package's blocks are the worker's own for this purpose, and a name the worker's folder
also uses is refused rather than shadowed."*

## UPDATE · `apps/docs/docs/skills/overview.md` · "When to use a skill vs a capability"

Add a third bullet:

> - **Package.** Markdown instructions plus the tools they need, handed to one worker as a folder.
>   Always on for the workers that hold it. Workforce only; see
>   [Packages on disk](../workforce/packages-on-disk.md).

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · "What this does not do"

In the bullet on what the tree reader opens, add after the skills clause: *"and each worker's
packages, from its own folder and from the team and org folders its `packages:` names ([Packages
on disk](./packages-on-disk.md))."*

## UPDATE · `packages/workforce/README.md`

- Add `teams/engineering/workers/triage/packages/runbook/PACKAGE.md` and its `blocks/` to the tree
  under "Kinds and blocks from files", and `packageBlocks` to the generated exports.
- A new `### Packages from files` after "What one seat picks up": the same two tables as the page
  above, cut to the API (`readWorkforce` returns packages; `hireWorkforce` takes `packageBlocks`).
- In the reserved `tools` key paragraph, name the second grant source: what the seat chose.

## UPDATE · `docs/architecture/capabilities.md` · the worker-colocated tool paragraph (PR-A, PR-B)

Replace *"Nothing crosses the fence that the seat did not declare"* with: *"Nothing crosses the
fence that the seat did not choose. `workforce` adds to the declaration what the seat's own file
picked (a preset's tools, a held package's blocks) unless the seat wrote `tools: []`; core sees
one declared list and stays exactly as literal as it reads above."*

## UPDATE · `docs/architecture/workforce-default-worker-kind.md` · the reserved `tools` key (PR-A)

After the sentence on `seatTools`, add: *"The hire step also records whether the file wrote
`tools: []`, before that split, so a kind can tell an explicit withhold from a list that emptied
because every name was the seat's own."*

## UPDATE · `apps/docs/docs/workforce/built-in-worker.md` · the memory paragraph (PR-A)

Replace *"To give a worker one of them, put it in the catalog and let the worker name it, like any
other tool."* with *"To give a worker one of them, pick the preset in its `capabilities:`, or put
the tool in the catalog and name it in `tools:`."*

The agent kind's module comments that state the old rule are rewritten in PR-A as code comments,
not docs; PLAN S12a carries them.

## Publication ownership

This issue owns every passage above. No epic shares these pages.
