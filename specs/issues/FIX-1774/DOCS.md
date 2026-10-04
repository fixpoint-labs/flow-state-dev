# FIX-1774 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Three updates to pages that exist. No new page and no sidebar change: the behaviour belongs to
the chief of staff and the DevTeam profile, which already have homes. Write "worker", never
"seat", in every sentence added; leave the rest of each page's wording alone.

## 1 · Update `apps/docs/docs/workforce/chief-of-staff.md` — new section after *Adding one*

> ## Handing it coding work
>
> A chief of staff that knows where coding work goes can take a request like "build me a
> hello-world page" and start it, instead of hiring someone for it. Tell it in its `WORKER.md`
> which worker does the coding, which workstream that worker takes its tasks from, and how a
> line on that workstream has to look. `discover` lists your workers and mailboxes, but it doesn't
> say which board a worker works or what a workstream files from, so the file has to.
>
> ```md title="workforce/org/workers/chief-of-staff/WORKER.md (excerpt)"
> **Get coding work done.** When the person asks for code to be written, hand
> it to the worker who already does coding: `eng.coder` runs every task filed
> on `eng.feature`. Do not hire for it.
>
> - Post one line on `eng.feature` with `post-to-mailbox`, shaped
>   `<short-slug>: <what to build>`. The EM files it and the coder starts.
> - If the person left choices to you, pick plain defaults and put them in
>   the line. Do not ask about them.
> ```
>
> The chief of staff has to be a member of that workstream for the post to land.
>
> Don't tell it to hire a worker for a task. A worker it hires isn't on any workstream, and no
> board hands it tasks, so nothing would start. Hiring is for changing who works here, when the
> person asks for that.

**Voice watch:** the page already says "seat" throughout; don't reword it here, and don't add the
word. Introduce *workstream* as the page's readers know it from [Projects](../workforce/projects.md).

## 2 · Update `labs/shift-manager/README.md` — the `devteam` bullet under *Team profiles*

After "The EM answers every line posted in a project's room.", add:

> Ask the chief of staff for something to be built and it posts the request on the feature
> workstream as `slug: what to build`, with any choices you left open filled in, and the coder
> starts on it. It doesn't hire anyone for that. Ask for coding work in a project that has no
> workstream the coder works from, Platform for one, and it tells you so and starts nothing.

And in *What a coding run is handed*, the sentence "When you approve a feature in Inbox, or post
`slug: what to build` on a workstream, …" stays as it is: it becomes true.

## 3 · Update `apps/docs/docs/shift-manager/overview.md` — the `devteam` paragraph

After "Two projects exist from the start, Storefront and Platform.", add:

> Ask the chief of staff on Shift Coordinator to build something and it hands the request to the
> coder through Storefront's feature workstream, and the run shows up under Tasks. Platform has no
> workstream yet, so coding work asked for there gets an explanation instead of a run.

## Not changed

- The Workforce `hire` and `post-to-mailbox` reference: neither tool changes.
- `goals/devforce-lab/lab/README.md` is a check's notes, updated in the PR (S3), not site docs.
