---
title: Authoring a delegating skill
sidebar_label: Authoring a delegating skill
description: Write a skill whose agents plan their own work. Declare the team, staff each seat, let the coordinator assign tasks on a private board, and drain it with one runBoard call.
---

# Authoring a delegating skill

A **skill** is a folder with a `SKILL.md` in it. Its body gets spliced into a
generator's system prompt when the skill matches, so most skills are just
instructions. Some jobs are too big for one set of instructions and one model
turn: research a company from three angles, analyze every competitor in a
category, review a document section by section. Those want a small team.

Declaring a team is what this guide is about. You add one field to the skill's
frontmatter, and the generator that binds the skill gets a private **task
board** — a ledger of work with dependency ordering and a concurrent runner over
it. That generator is the **coordinator**: it plans the work as tasks and runs
the whole graph in one call. The teammates it hands tasks to are **agents**.

Nothing about the plan is fixed in your code. The coordinator decides how many
tasks there are and who does what, per request.

**Which page you want.** This one takes a single skill from empty frontmatter to
a running team, the model-plans-the-work way.
[Building a research team](/guides/building-a-research-team) is the tutorial: it
builds the same team several ways starting from code you write yourself, which is
the better entry if you'd rather see the board before the skill.
[Delegation](/docs/skills/delegation) is the reference for the fields and knobs.

**Before you start.** You should have skills wired into your app already
([Adding skills to your app](/guides/adding-skills-to-your-app)) and know what a
`SKILL.md` looks like ([Authoring skills](/docs/skills/authoring)). Knowing how a
board seeds, runs, and settles helps too, but you can pick it up as you go
([The board lifecycle](/guides/board-lifecycle)).

:::tip Full, runnable code
Every `SKILL.md` snippet in this guide is a trimmed copy from
[`examples/guides/research-team`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/research-team);
open the example for the complete source. Two short illustrations are generic
rather than from it: the rosterless binding under
[Without a roster](#6-without-a-roster), and the rejected-assignee error under
[When it goes wrong](#7-when-it-goes-wrong). To watch a team actually run:

```bash
cd examples/guides/research-team
OPENAI_API_KEY=... TAVILY_API_KEY=... pnpm fsdev run research-team chat \
  -i '{"message":"research ACME Corp"}'
```

That path needs two keys configured, not one. A model key, because the
coordinator and every agent are models. And a **search** key, because the
analysts carry `search` and call it on their first step — with no search
provider configured it throws rather than degrading, so the run dies there. Any
one supported provider will do; `TAVILY_API_KEY` above is an example, and
[Search](/docs/tools/search) lists them all. The agents also carry `fetch`,
which needs no key: it falls back to a built-in reader.

(The example's other two actions use deterministic handler workers and need no
keys at all, but they don't go through delegation.)

One thing to know before you run it: that flow preloads both of the example's
skills at once, so a single `chat` turn has two teams available and may start
the wrong one, or ask a clarifying question that belongs to the other skill.
This guide teaches `research-company` and names it explicitly.
:::

## 1. Declare a team

Add an `agents:` map to the skill's frontmatter. Each key is an agent name, each
value says where that agent's persona comes from.

```yaml title="src/skills/research-company/SKILL.md (frontmatter, trimmed)"
---
description: Multi-angle company research delivered by a small team of analysts.
agents:
  market-analyst:
    prompt-ref: ./reference/market.md
    tools: [search, fetch]
  financial-analyst:
    prompt-ref: ./reference/financials.md
    tools: [search, fetch]
  synthesizer:
    prompt-ref: ./reference/synthesis.md
---
```

Declaring the field is what turns delegation on. When a generator binds this
skill, the skills library installs three things on it: a private task board, a
set of tools for planning work on that board, and a `runBoard` tool that runs it.
The board is scoped to that one generator. Nothing else in your app can see or
write to it.

That default holds unless the binding overrides it. `delegation: false` on
`skills.with({...})` suppresses the whole surface even for a skill that declares
agents. `delegation: true` installs it for a skill that declares none, which is
[Without a roster](#6-without-a-roster) below.

The set of declared agents is the board's **roster**. It shows up in two places:
in a short prompt fragment the library injects so the coordinator knows who it
has, and in the board's dispatch table, so a task assigned to `market-analyst`
reaches the persona in `./reference/market.md`.

## 2. Staff each seat

An agent needs a persona, and there are two ways to give it one.

**Inline.** Write the persona in the skill folder and point at it with
`prompt-ref`, or put it directly in the frontmatter with `prompt`. That is what
all three agents above do. The payoff is portability: the skill folder carries
its own team, and copying the folder into another app carries the team with it.
No app code registers anything.

**From the registry.** Define the agent once in app code with `defineAgent`, then
borrow it by name with `agent-ref`:

```yaml
agents:
  analyzer:
    agent-ref: competitor-analyst
```

The tradeoff is the mirror image. A registry agent can't travel alone, because
it resolves against the `agentRegistry` your app hands to `createSkillsLibrary`.
What you buy is reuse: one definition, borrowed by as many skills as you like.
`research-company` is entirely inline, so the snippet above comes from the
example's other skill, `competitor-analysis`. For the registry form end to end,
including the `defineAgent` call and the library wiring,
[the research-team tutorial walks it](/guides/building-a-research-team#5-two-ways-to-staff-an-agent).

Inline agents take a few more keys: `tools` (catalog keys the agent may call
itself), `model`, `visibility`, and `context-supply`. See
[Delegation](/docs/skills/delegation#declaring-agents) for the full field list
and [Agents](/docs/orchestration/agents) for the registry side.

One thing that surprises people: the one-line blurb the coordinator sees for each
agent is not something you write. For an inline agent it's the first non-blank
line of the persona, truncated. So make that line say what the agent is for. A
registry agent doesn't get a blurb at all — it's listed as ``agent `competitor-analyst` ``,
its reference name and nothing else. The `description` you gave `defineAgent`
isn't used here.

## 3. Plan the work as a graph

The skill body is where you tell the coordinator what to put on the board. You're
writing instructions for a model, so write them as steps.

The planning tool is `addTask`. It takes a `goal` and, optionally, an `assignee`
naming one of your agents, `deps` listing task ids that must finish first, and a
structured `input` payload the agent receives. It returns the new task's id.

```markdown title="src/skills/research-company/SKILL.md (body, trimmed)"
You run the board. Extract the target from the user's message, then:

1. `addTask` — goal: `"Analyze market positioning of <target> — category,
   target customer, key differentiators, recent narrative shifts. Cite
   sources."`, `assignee: "market-analyst"`.
2. `addTask` — goal: `"Analyze financial health of <target> — revenue scale
   and trajectory, funding or public financials, profitability/burn, runway
   signals. Cite sources."`, `assignee: "financial-analyst"`.
3. `addTask` — goal: `"Synthesize the prior reports into a single research
   brief for <target>. Lead with the takeaway, then evidence, then risks."`,
   `assignee: "synthesizer"`, `deps` set to the two task ids returned above.
4. Call `runBoard` once. The analysts run in parallel; the synthesizer starts
   when both complete.
```

That's a fan-out and a fan-in. Two tasks with no dependencies, and a third that
waits on both. `deps` is the only thing expressing the ordering. You never write
"wait for the analysts" anywhere, and the two analysts run at the same time
because nothing says they can't.

The board is what makes that work. Its runner hands out tasks whose dependencies
have all completed and holds the rest back. A delegation board runs four at a
time, and that isn't tunable from the skill. For the primitive underneath, and
the knobs you do get when you build a board yourself, see
[Task board](/docs/orchestration/task-board).

## 4. Draining is the running

**`addTask` writes a task, it does not run one.** This is the thing people get
wrong first. Nothing executes until the coordinator calls `runBoard`.

`runBoard` **drains** the board. Draining means dispatching every task whose
dependencies are satisfied, waiting, dispatching whatever that unblocked, and
repeating until nothing runnable is left. It returns once, with every task's
output.

So the whole shape of a delegating skill is: plan with `addTask`, run with
`runBoard`, read the result. There is no other way to execute a delegated agent.
There is no per-agent tool the coordinator calls directly, and nothing drains the
board behind the coordinator's back. The skill body decides when to run it.

Reading results works the same way inside the team. The synthesizer's persona
gets its dependencies' outputs on `input.deps`, keyed by task id, so it can read
both analyst reports without either of them being in its conversation.

`addTask` and `runBoard` are the two you'll write instructions for. Seven more
task tools come with them, for steering a board mid-flight rather than planning
one: `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`,
`updateTask`, `listTasks`. They're documented in
[Delegation](/docs/skills/delegation#what-the-coordinator-gets), including which
of them can throw rather than returning a soft error.

## 5. An agent that plans more work

An agent can put work on the board too. Give one `taskTools` in its `tools:` list
and it can call `addTask` mid-drain, onto the same board:

```yaml title="src/skills/competitor-analysis/SKILL.md (frontmatter, trimmed)"
agents:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]
  analyzer:
    agent-ref: competitor-analyst
  comparison-writer:
    prompt-ref: ./reference/compare.md
```

Now the coordinator's plan can be one task:

```markdown
1. `addTask` — goal: `"Identify 3 to 5 competitors for <target> across direct /
   adjacent / DIY-status-quo tiers, then enqueue one analyzer task per
   competitor plus a single comparison-writer task whose deps cover every
   analyzer task you queued."`, `assignee: "discoverer"`.
2. Call `runBoard` once.
```

One `addTask`, one `runBoard`. The drain runs the discoverer, which decides there
are (say) four competitors and enqueues four analyzer tasks plus a
comparison-writer gated on all four. The same drain picks those up, runs the
analyzers in parallel, and runs the writer once they're all done. The number four
is nowhere in your code.

Reach for `taskTools` on an agent when the shape of the work depends on what an
earlier step found. Grant it through the agent's `tools:` list, which is the path
that reaches the coordinator's board.

## 6. Without a roster

You can delegate without declaring a team at all. Every delegation board comes
with a **default worker** underneath the roster: a generic, capable agent with no
persona and no tools, which runs any task the roster doesn't claim. Force
delegation on with no `agents:` field, and it's the only worker there is.

```ts
const planner = generator({
  uses: [skills.with({ active: ["triage"], delegation: true })],
});
// addTask({ goal }) with no assignee runs on the default worker.
```

This is the cheapest way into delegation. You get task planning, dependency
ordering, and parallel execution without writing a single persona. Reach for it
when the work decomposes into steps but the steps don't need specialists.

Be aware that it inverts one behavior. With a declared roster, a typo'd assignee
is rejected. With no roster there is nothing to check a name against, so any
assignee is accepted and everything lands on the default worker either way. If
you're relying on the rejection to catch mistakes, declare the team.

## 7. When it goes wrong

Three assignment outcomes behave differently, and one of them isn't an error at
all. Treating them as one thing is what sends people down the wrong path. Caps
are a separate topic and come last.

**A wrong assignee, on a board with a declared roster.** `addTask` refuses. No
task is created, and the error names the agents that do exist so the coordinator
can correct itself and retry. `assignTask` and `updateTask` check the same way.
It comes back as a tool result, not a thrown error, so the turn continues:

```
addTask({ goal: "Find sources", assignee: "reseacher" })
→ { ok: false, error: 'unknown_assignee: "reseacher" is not an agent on this
                       board. Available: …' }
```

The full message lists every declared agent with its blurb and tells the
coordinator it can leave `assignee` unset instead —
[Delegation](/docs/skills/delegation#what-the-coordinator-gets) has it verbatim.

Catching it at creation rather than at dispatch is deliberate. A typo can't sit
on the board and resurface twenty seconds later as a failed task.

**No assignee at all.** Not a failure. The task runs on the default worker
described above. Leaving `assignee` unset is how you say "anyone can do this," and it's the
only way to reach the default worker on a board that has a roster. Mistyping a
specialist's name is not the same thing and doesn't get the same treatment.

**A board that didn't fully drain.** `runBoard` reports how it ended:
`status: "drained"` when every task settled, `status: "blocked"` when any task is
left unresolved. Read `blocked` as "work is still outstanding," not as "something
failed." It has more than one cause, and they want different responses.

The one people hit first is a task stranded behind a failed dependency. Its
dependents don't fail and don't get skipped. They stay pending, because a
dependency counts as satisfied only when it *completes*. The drain runs out of
runnable work and stops. Read the settled board it hands back to find which task
errored. (Delegation has no opt-in cascade that cancels stranded dependents. Some
patterns do, like [Supervisor](/docs/patterns/supervisor), but it isn't wired
into this drain.)

The other cause is deliberate. A coordinator can mark a task with `blockTask`
when it's waiting on something outside the board, and such a task counts as
unresolved, so the drain settles as `blocked` with nothing having failed. Same
status, opposite meaning. Inspect the tasks before you treat a `blocked` board as
a failure.

Know what `blockTask` commits you to, though: it's one-way. No task tool moves a
task back out of `blocked` — `cancelTask` is the only exit. So it retires a task
with a reason attached rather than pausing one you can resume. If work needs to
wait and then continue, keep it off the board until its precondition holds.

You'll meet the word "blocked" on both board surfaces. They are two different
contracts with different triggers, so don't read one as the other:

- **Delegation.** `runBoard` returns `status: "blocked"` when a task is left
  `pending`, `in_progress`, `awaiting_review`, or `blocked`. Terminal tasks don't
  count toward it.
- **A code-defined board.** Its final item carries
  `terminationReason: "blocked-by-failures"` whenever any task is not
  `completed` — `errored` and `cancelled` included.

They can disagree about the identical board. One errored task with everything
else complete reports `blocked-by-failures` on the code-first side and `drained`
on the delegation side. The code-first name is loose on its own terms too: the
classification is purely structural, so a board that stops with tasks still
pending reports `blocked-by-failures` even when nothing failed. On that surface,
read the `counts` rather than the reason string. The tutorial covers it in
[When the board stops, and when it waits](/guides/building-a-research-team#7-when-the-board-stops-and-when-it-waits).

**Too much work.** A board won't accept new tasks forever, and it refuses in two
ways that recover differently. `addTask` returns `enqueued_task_cap_exceeded`
when too many tasks are waiting to start, and draining with `runBoard` frees
those slots, because that bound counts only pending work. It returns
`total_task_cap_exceeded` at the board's lifetime ceiling, which draining does
*not* relieve — there the coordinator has to finish with a smaller plan rather
than retry. Both are soft results; the numbers and how to change them are in
[Delegation](/docs/skills/delegation#how-much-work-the-board-will-take-on).

There's a trap where that meets the previous section. Draining only frees
enqueue slots for tasks that can actually run. A task stranded behind a failed
dependency stays `pending` and keeps its slot, and that's precisely the board
that comes back `blocked`. So if `runBoard` returns `blocked` and `addTask` is
still refusing, draining again changes nothing — cancel or replan the stranded
tasks first.

## When the graph belongs in code instead

Delegation is for when the *coordinator* should decide the tasks. When your code
already knows the graph — a fixed set of seeded tasks, a custom collection
backing, a tuned dispatcher — you don't need `agents:` or `runBoard` at all.

Build a code-defined [task board](/docs/orchestration/task-board) and call it as a
single tool. A `taskBoard(...).drain` is a block, and
[any block can be a tool](/docs/fundamentals/blocks#any-block-can-be-a-tool).
Register the drain block in the skills catalog, list it under the skill's
`allowed-tools`, and the generator calls the whole board in one shot, getting back
only the finished result.

The two shapes, side by side:

- **The coordinator plans the work per request** — a delegation skill with
  `agents:`. It assigns tasks and drains the board with `runBoard`. This guide.
- **The graph is fixed in code** — a code-defined `taskBoard` called as a tool, or
  mounted directly in a flow. Your code seeds the tasks and the board's own
  dispatcher runs them.

## Related

- [Delegation](/docs/skills/delegation) — the reference: every `agents:` field, the board overrides, the caps, and the default worker.
- [Building a research team](/guides/building-a-research-team) — the tutorial. Builds the same team several ways from an empty flow, code-first first, and covers the two ways to staff an agent in depth.
- [The board lifecycle](/guides/board-lifecycle) — seed, drain, read, from a code-first angle.
- [Agents](/docs/orchestration/agents) — the registry side of `agent-ref`.
- [Task board](/docs/orchestration/task-board) — the concurrent-drain primitive underneath, and its config.
- [Context supply](/docs/orchestration/context-supply) — how to let an agent inherit the conversation so far instead of seeing only its task input.
