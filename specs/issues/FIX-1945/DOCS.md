# FIX-1945 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose. The implementer reconciles it against shipped behaviour before
publishing (PLAN → Docs). Voice: `CLAUDE.md` → "Writing Style"; say "worker", never "seat";
don't call rules memory (FIX-1786 ER-15: no memory layer a flow doesn't keep).

## CREATE · `apps/docs/docs/workforce/standing-rules.md`

Sidebar: `sidebars.ts`, Workforce category, after `workforce/built-in-worker`, before
`workforce/coordinators`. Frontmatter `sidebar_label: Standing rules`.

> # Standing rules
>
> You coach a worker the way you'd coach a colleague: "name the project first", "ask before
> filing more than three tasks". A standing rule is how that coaching outlasts the conversation.
> The worker saves your note as a rule, and every later session with you follows it.
>
> ## How a worker takes a note
>
> Tell the worker something meant to last. It adds a rule and the conversation shows a line
> saying so:
>
> ```
> You: Always name the project before the status.
> ✎ Rule added (3 of 20): "Name the project before giving a status."
> ```
>
> It doesn't ask first. You just told it, and the line is there so you can object. Ask it to
> change or drop a rule the same way, in words.
>
> ## The tools
>
> | Tool | What it does |
> |---|---|
> | `rules/read` | Lists the worker's rules for you, numbered |
> | `rules/add` | Adds one rule |
> | `rules/change` | Rewrites one rule, named by number and its current text |
> | `rules/remove` | Drops one rule, named the same way |
>
> Every worker on the built-in `agent` flow and every coordinator has them. A `tools:` line in
> `WORKER.md` doesn't need to list them. They are offered only on a turn you started. A task
> the worker runs for you follows your rules but can't change them.
>
> ## Where they apply
>
> Every turn the worker takes for you, in any session, gets its rules after its own
> instructions. The worker file stays the base; rules are added after it, never in place of it.
> An edit counts from the next turn.
>
> ## Whose rules they are
>
> Rules belong to one worker and one person. A note you give the coordinator doesn't reach
> your other workers, and two people using the same worker each have their own list. A fork
> starts with none.
>
> Rules aren't memory. Memory is shared by all of your workers and comes back when a search
> finds it. A rule comes back on every turn.
>
> ## Limits
>
> A worker keeps up to 20 rules for you, each one line of up to 300 characters. At 20, an add
> is refused and the worker asks which rule to merge or drop. Rules sit in every prompt, so a
> short list is a cheap one.
>
> ## Editing them yourself
>
> In Shift Manager, open a worker from the Roster, or open the Shift Coordinator, and go to
> **Rules**. Workers on a custom flow don't keep rules, and their row says so. You see each rule, when it was added and the conversation it came from. Add,
> edit and delete there; the next turn reads the change. The same limits apply.
>
> ## What it won't do
>
> - Change the worker's `WORKER.md` or its instructions.
> - Summarize or rewrite your rules on its own.
> - Let a task turn, or text a delegate sent back, edit a rule.
> - Keep rules when you move your worker to a different worker flow.

## UPDATE · `apps/docs/docs/workforce/built-in-worker.md` · "What a worker keeps"

After the sentence ending "…shared by that user's workers.":

> Standing rules, the notes you've asked a worker to keep, are kept per worker and per person,
> and read on every turn. See [Standing rules](./standing-rules.md).

Add to "Related pages": `- [Standing rules](./standing-rules.md) — notes a worker keeps for you, and how to edit them.`

## UPDATE · `apps/docs/docs/workforce/chief-of-staff.md` · after "Giving it memory"

> ## Coaching it
>
> Tell the Shift Coordinator how you want it to work and it keeps the note as a
> [standing rule](./standing-rules.md) for you. Your rules are yours: another person on the
> same Shift Manager has their own. See and edit them under **Rules** on the Shift Coordinator
> view.

Add the four `rules/*` tools to "The tools" table, "Asks first" column: no.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "What you see"

Add to the Shift Coordinator row and the Roster row: "Rules: the notes this worker keeps for
you; add, edit or delete them."

## UPDATE · `packages/workforce/README.md` · after "The memory recipe"

> #### Standing rules
>
> Workers on `agent` and coordinators keep standing rules per worker and per person:
> `rules/read`, `rules/add`, `rules/change`, `rules/remove`, offered on person-started turns.
> Each worker's flow has an action that reads and writes them for the signed-in person;
> the workforce client reaches it through the worker's session. Limits: 20 rules, 300
> characters. See the Standing rules docs page.

## UPDATE · `packages/shift-manager/README.md` · "Shift Coordinator" and "Roster"

One line each: "**Rules** shows the notes this worker keeps for you, and lets you edit them."

## Publication ownership

FIX-1945 publishes all of the above. PR A publishes the workforce pages and README; PR B the
Shift Manager page, the overview row and its README. No blog post.
