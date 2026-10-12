# FIX-1914 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

FIX-1914 publishes the opening of Kitchen Sink's README ([epic DOCS](../../epics/FIX-1907/DOCS.md#ownership)).
When it merges only Flow State runs, so the opening names no coding harness as runnable; FIX-1915,
FIX-1916 and FIX-1917 each add their mode as it lands. The Flow State paragraph follows the
[settled answer](DECISIONS.md#open): keep, from Jake's merge of #3167. No page under `apps/docs` changes:
none describes what `/` shows.

## UPDATE · `apps/kitchen-sink/README.md` · the opening, replacing the first paragraph

> Kitchen Sink is where you use each coding harness flow-state-dev supports, directly, and see
> whether its integration holds. It opens on a picker of modes. **Flow State** is the framework's
> own flows: the assistant, and the support desk with a coordinator and four specialists (see
> [The support team](#the-support-team-workforce)). The coding harness modes are listed beside it
> and say "not built yet" until each one lands.
>
> Kitchen Sink sets up a session and keeps it in step with the harness. It doesn't plan work for
> a harness or move work between harnesses; that is
> [Shift Manager](../../packages/shift-manager/README.md).

## UPDATE · `apps/kitchen-sink/README.md` · "Run it", after "The app runs at…"

> The front page is the picker. Pick **Flow State** for the assistant and the support desk, at
> [http://localhost:3000/flow-state](http://localhost:3000/flow-state). A mode this machine can't
> run is listed with the reason, and opening it does nothing.
>
> Coding harness modes work on a git repository. With `pnpm dev`, that is the checkout the server
> runs from, and you set nothing. To use another checkout, or to run them on a production server,
> name its top level:
>
> ```bash
> # apps/kitchen-sink/.env.local
> KITCHEN_SINK_HARNESS_WORKSPACE=/Users/me/code/flow-state-dev
> ```
>
> The path has to be the top level of an existing git checkout; anything else turns the modes off
> and says why. Each session gets its own worktree and branch of that repository, so it never
> edits your checkout or another session's work. A production server without the setting keeps
> the harness modes off, and so does Vercel, even with it, because Kitchen Sink has no sign-in
> and anyone who can reach it acts as the same user. Restart the server after changing the
> setting; the picker reads it once, at start.

## UPDATE · `apps/kitchen-sink/README.md` · "What to read first", second bullet

> - `app/page.tsx`: the picker. `app/flow-state/page.tsx`: the Flow State shell, with one
>   navigator on the left, the stream in the middle, and the roster on the right.

## UPDATE · `apps/kitchen-sink/README.md` · "The page (`app/`)", first bullet

> - **Front page**: the picker. Each mode has its own address: `/flow-state`, `/claude-code`,
>   `/codex`, `/cursor`. Every mode's rail opens with the mode's name and a link back here.
> - **Layout** (Flow State): three columns…

The rest of the bullet is unchanged.

## UPDATE · `apps/kitchen-sink/README.md` · "Environment variables", new row after `KITCHEN_SINK_TEST_MODE`

> | `KITCHEN_SINK_HARNESS_WORKSPACE` | The top level of the git checkout the coding harness modes work on. Each session gets its own worktree and branch of it, outside the checkout. Unset: the server's own checkout in local development, off otherwise. Ignored on Vercel, where they're always off. |

## UPDATE · `apps/kitchen-sink/README.md` · "Architecture" tree

> ```
>   app/                       Next.js App Router
>     page.tsx                 The picker: four modes, each with its availability
>     flow-state/page.tsx      The Flow State shell: navigator rail, stream, standing panel
> ```

## Ownership

| Material | Publisher |
|---|---|
| Everything above | FIX-1914, after its goal check passes |
| Each coding harness's own section (setup, sign-in, what it shows) and its name in the opening | FIX-1915, FIX-1916, FIX-1917 |
| `apps/kitchen-sink/CLAUDE.md` layout lines and the root `CLAUDE.md` package-map row | FIX-1914, internal, no draft |

The epic's shared opening says the coding harnesses run "in a directory you choose". When a harness
issue publishes that sentence, it reads "on a repository you choose". The epic's own draft is
merged, so it is amended by a follow-up PR from `main`, not here.

Voice: no em-dash chains, no "seamless", no issue numbers in the published README text.
