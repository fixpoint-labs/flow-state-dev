# FIX-1762 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

No new page. Three existing pages or READMEs grow a section, and one README gets a new one. Watch
for em-dashes, sentences that open with "This", and introducing *checkout*, *remote* and
*workspace host* on first use. Don't say "seat"; say worker.

## UPDATE · `apps/docs/docs/workforce/projects.md` · "The row" table

Add one row after `workstreams`:

> | `repository` | The git remote the project's code lives in, such as `https://github.com/acme/storefront.git`, or `null` |

## CREATE section · `apps/docs/docs/workforce/projects.md` · after "One project per workstream"

> ## A project's code and files
>
> A project can name the repository its code lives in. It's a remote, the address you'd pass to
> `git clone`, not a folder on some machine. Set it when you create the project, or later:
>
> ```ts
> await createProject({ id: "storefront", title: "Storefront", repository: "https://github.com/acme/storefront.git" });
> await setRepository({ projectId: "storefront", repository: null });
> ```
>
> Only members can change it. When the chief of staff sets it for you, it asks you to approve the
> change in Inbox first. A bare path is refused, and so is an address carrying a token or
> password; an SSH login like `git@github.com:acme/storefront.git` is fine.
>
> When a coding worker picks up work from one of the project's workstreams, it works in a fresh
> branch of that repository, as long as the host running the Lab allows that remote. Nobody names
> a folder. Changing the repository applies to new work; work already started stays on the
> repository it began with.
>
> ### Projects without a repository
>
> A project with no repository still runs coding work. The first run starts from an empty set of
> files, and everything it writes is saved to the project. The next run starts from what the last
> one left. If two runs change the same file, the change is merged; a real conflict is reported
> on the run instead of overwriting anyone's work.
>
> ### The project's own files
>
> Notes, memory and anything a worker keeps live in the organization's `project-files` collection,
> under the project's id. Only the project's members can read them. In a project with a
> repository, a coding run finds them in `project/`, next to its checkout and never inside it, so
> they never show up in `git status`. Whatever the run leaves there is saved back.

## UPDATE · `packages/workspace/README.md` · new section "Workspace hosts and run sources"

> ## Workspace hosts and run sources
>
> A **run source** says where a run's files come from: a git repository and the ref to branch
> from, or a set of files kept in a collection. A **workspace host** turns that into a place a
> worker can edit, saves the work back, and frees the place when it's done. Harness workers and
> tool workers use the same host.
>
> ```ts
> import { localWorkspaceHost } from "@flow-state-dev/workspace";
>
> const host = localWorkspaceHost({
>   root: "/var/fsd/runs",
>   remotes: { allow: ["github.com"] },   // list "file" to allow file:// remotes
>   source: mySource,                      // (ctx) => { kind: "repo", repo, baseRef } | { kind: "files", projectId } | a refusal
> });
> ```
>
> For a repository, the host keeps one clone per remote under `root` and cuts each run a fresh
> branch in `checkout/`. It only reaches remotes listed in `remotes.allow`. For a set of files,
> it fills `workspace/` from the collection, scoped to one key prefix, and saves changes back.
>
> A mount can be scoped to a key prefix so a place only ever sees and writes `<prefix>/…`.

## UPDATE · `packages/harness-manager/README.md` · Quick start and new "Running a project's work"

> ## Running a project's work
>
> Hand the manager a workspace host instead of a fixed repository, and each run gets its files
> from whatever the host's source says:
>
> ```ts
> import { localWorkspaceHost } from "@flow-state-dev/workspace";
> import { projectWorkspace } from "@flow-state-dev/workforce";
>
> harnessManager({
>   boardCollectionId: work.id,
>   boardCollection: work,
>   workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace({ board: work }) }),
>   // ...
> });
> ```
>
> The manager saves the run's files at the end of each turn, when the run asks a question, and
> when the harness fails. A fixed `sourceRepo` still works as before.

## UPDATE · `packages/workforce/README.md` · Projects section

> `createProject` takes an optional `repository`, and `setRepository` changes it (members only).
> `projectWorkspace({ board })` is a run source: the repository of the project that holds that
> board's workstream, or the project's files when it has no repository.

## Publication ownership

Each section publishes with the PR that ships it (PLAN → Docs). The projects page is FIX-1718's;
this adds a section without rewriting its existing ones.
