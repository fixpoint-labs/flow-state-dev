# FIX-1904 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic owns the shared paragraph ([epic DOCS](../../epics/FIX-1903/DOCS.md)). This issue
publishes it without the Linear sentences, which FIX-1905 adds, and with the profile's final name.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "Working on Shift Manager itself"

Replaces the section's first paragraph, which says `dev` runs the `devteam` profile.

> In this repository, `pnpm shift-manager:dev` opens the `fsd` profile: a Lab for working on
> this repository with Shift Manager itself. It has two projects from the start. **FSD** is the
> framework packages, and **Shift Manager** is this app. Both are shared with everyone in the
> Lab, and both point at this repository.
>
> Ask the chief of staff for work on either project, and say which one, for example "on Shift
> Manager, make the empty Inbox say who to ask". A coding agent picks it up in a fresh worktree of
> your checkout, on a branch of its own cut from your local `main`. It doesn't fetch first, so pull
> `main` when you want the run to start from the latest. Review the work in that worktree, or from
> your checkout with `git diff main...<branch>`. The branch stays checked out in its worktree, so
> git won't check it out a second time in yours.
>
> The coding agent is Claude Code. Sign in to Claude Code, or set `ANTHROPIC_API_KEY`, before you
> start. Without either, the Lab refuses to start and says so. To run the scripted coder instead,
> which writes one file and costs nothing, set `DEVFORCE_LAB_HARNESS=stub`. The chief of staff
> answers on a model of its own, so its turns need `ANTHROPIC_API_KEY` or `AI_GATEWAY_API_KEY`.
>
> The Lab keeps its data in SQLite at `packages/shift-manager/.fsdev/fsd.sqlite`, or wherever
> `FSD_STORE` points. Delete the file to start fresh.
>
> `--dev` serves Shift Manager's pages from source, so a change to a screen shows as you save
> it. `start` runs the same profile on the built pages, and builds them first when they're
> older than their source. To open the `devteam` profile instead, pass its config:
> `pnpm --filter @flow-state-dev/shift-manager dev --config teams/devteam/fsdev.config.mts`.

The section's second paragraph, opening another Lab with `--config`, stays.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "The `devteam` profile"

Replace the first paragraph's last sentence, "Two projects exist from the start, Storefront and
Platform.", which is wrong today (it opens with three), and add one opening sentence:

> `devteam` is the profile this repository's checks run against. Open it with `--config`, as
> above.
>
> … On start the EM asks you to approve one feature, so Inbox has something in it. Three projects
> exist from the start: Storefront, with two workstreams, and Platform and Sandbox, with none.

The rest of the section stays.

## UPDATE · `packages/shift-manager/README.md` · "Working on Shift Manager itself" and "The `devteam` profile"

The same two changes. The README's `devteam` section already lists three projects; it gets only
the opening sentence.

## UPDATE · `packages/shift-manager/teams/devteam/README.md`

One line under its file list: `fsd.fsdev.config.mts` is the `fsd` profile, the same tree with
two projects on this repository and Claude Code as its coder; `fsdev.config.mts` is DevTeam's.

## Voice

No issue numbers, no "seat", no em-dash chains. "Profile" here is a team profile; the shift
themes are "shifts" on this page already, so the two don't collide.
