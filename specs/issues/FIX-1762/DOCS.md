# FIX-1762 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

No new page. Two existing pages and two package READMEs grow a section each. Watch for:
em-dashes, sentences that open with "This", and introducing *checkout* and *remote* on first use.

## UPDATE · `apps/docs/docs/workforce/projects.md` · "The row" table

Add one row after `workstreams`:

> | `repository` | The git remote the project's code lives in, such as `https://github.com/acme/storefront.git`, or `null` |

## CREATE section · `apps/docs/docs/workforce/projects.md` · after "One project per workstream"

> ## A project's repository
>
> A project can name the repository its code lives in. It's a remote, the address you'd pass to
> `git clone`, not a folder on some machine. A project with no repository is still a project:
> a launch plan or a hiring push doesn't need one.
>
> Set it when you create the project, or later:
>
> ```ts
> await createProject({ id: "storefront", title: "Storefront", repository: "https://github.com/acme/storefront.git" });
> await setRepository({ projectId: "storefront", repository: "git@github.com:acme/storefront-v2.git" });
> await setRepository({ projectId: "storefront", repository: null });
> ```
>
> Only members can change it. When the chief of staff sets it for you, it asks you to approve
> the change in Inbox first, the same way it asks before a fire. A bare path like
> `/home/me/storefront` is refused, and so is an address carrying a token or password (an SSH login like `git@` is fine): the row is
> visible to the whole organization, so credentials stay in the host's own git setup.
>
> When a coding run picks up work from one of the project's workstreams, it works in a fresh
> branch of that repository, as long as the host running the Lab allows that remote. Nobody
> names a folder. The harness manager's README, under
> "Running a project's work", shows how a host wires it.
>
> If the project names no repository, a coding row filed there is refused before any agent runs,
> and the error says which project to fix. Changing the repository applies to new rows. A row
> that already started stays on its old checkout and is refused on its next attempt, naming
> both repositories, so nothing it did is overwritten.
>
> ### The project's own files
>
> A project also keeps files that aren't code: notes, memory, anything that belongs to the
> project rather than to a branch. They live in the organization's `project-files` collection,
> under the project's id, and only the project's members can read them.
>
> A coding run gets a directory for these files beside its checkout, never inside it, so
> nothing there shows up in `git status`. The run's files in that directory aren't saved to the
> collection yet; a host that wants them kept can do it in the manager's after-run hook.

## UPDATE · `packages/harness-manager/README.md` · new section after "Running a mailbox's board"

> ## Running a project's work
>
> A fixed `sourceRepo` sends every run to one repository. When the repository depends on the
> work, give the manager a run source instead. It's called at each attempt, with the block's
> context and nothing else, and answers with the remote to work in or a reason to refuse:
>
> ```ts
> import { projectWorkspace } from "@flow-state-dev/workforce";
>
> harnessManager({
>   boardCollectionId: work.id,
>   boardCollection: work,
>   workspace: {
>     root,
>     remotes: { allow: ["github.com"] },
>     ...projectWorkspace({ board: work }),
>   },
>   // ...
> });
> ```
>
> The manager only reaches remotes listed in `remotes.allow`. `file://` is off unless you list
> `file`. Anything else is refused at the attempt, before git runs, naming the remote.
>
> It keeps one clone per remote under `root`, made the first time a run needs it. Before cutting
> a new branch it fetches, and it branches from the remote's default branch. A retry continues
> its existing checkout and never fetches, resets or rebases. Access is the host's own git
> credentials; a remote the host can't read fails the attempt before the harness runs.
>
> Each run also gets a directory beside its checkout, outside the worktree, named in the
> prompt context. Pass `before` and `after` hooks to fill it and keep what the run left there;
> `after` runs whether the harness succeeded or failed.
>
> A fixed `sourceRepo` still works as before.

## UPDATE · `packages/workforce/README.md` · Projects section

> `createProject` takes an optional `repository`, and `setRepository` changes it (members only).
> `projectWorkspace({ board })` gives a harness manager the repository of the project that holds
> that board's workstream. See the docs site's Projects page.

## Publication ownership

PR B publishes the Workforce page and README after V5 passes; PR C publishes the harness-manager
section after the goal check passes. No overlap with FIX-1650's shared narrative: the projects
page is FIX-1718's, and this adds a section without rewriting its existing ones.
