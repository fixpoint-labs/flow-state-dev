# FIX-1872 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Only the changed material. The shared "giving another worker work" story and the glossary are the
epic's ([FIX-1870 DOCS](../../epics/FIX-1870/DOCS.md)), published by FIX-1875 and FIX-1876; these
pages link to them rather than repeat them. `dispatchTask`'s exact shape is FIX-1875's, so its
calls below are reconciled against that merge before publishing.

## UPDATE · `apps/docs/docs/workforce/coordinators.md` · "Choosing how it routes", the `judgment` row

> | `judgment` (the default) | The coordinator's own turn reads the post and decides. It hands the post on by calling `dispatchTask` with `post: true` and a delegate as `assignee`, as many times as it likes, or answers itself. The delegate gets the post as you wrote it; the coordinator chooses who, not what they read. |

## UPDATE · `coordinators.md` · "Who can be a delegate", the paragraph after the table

> A worker whose flow takes tasks but not posts can be added. A post handed to it is skipped, and
> the record's reason is `Worker "<id>" runs on flow "<flow>", which can't take a delegated post.`
> When the coordinator's own turn hands it a post with `dispatchTask`, the refusal goes on to name
> the delegates in the conversation that do take posts, so the turn can pick one of them:

## CREATE · `coordinators.md` · new section after "Letting delegates answer each other": "How a post is tracked"

> ## How a post is tracked
>
> Each delegate a post goes to gets a task for it on the conversation's
> [task board](./delegating-work.md), one per delegate per round. It shows in `listTasks` and in
> any board view next to the tasks you filed yourself, and it ends like any task: completed with
> the delegate's answer, or failed.
>
> That task is what makes an answer count once. However many times its ending is sent, after a
> restart or a dropped connection, the conversation gets one line. A delegate handed the same post
> twice in one round gets one task, and the record says the second was skipped.
>
> The task runs in the delegate's own session for this conversation, the same one every post
> from it goes to, so the delegate keeps what it was told before. A post to a
> [workstream](./projects.md) runs in the workstream's own session.
>
> You can cancel a post's task from the board. That delegate's part ends with no line, and if
> its turn is still running, what it says afterwards doesn't land. Reassigning a post's task is
> refused: the post was for that delegate.
>
> With 25 delegates, `everyone` and `rounds: 3`, one post adds up to 100 tasks to the board.
> They stay there like any finished task.

## UPDATE · `coordinators.md` · "Letting delegates answer each other", the deadline sentences

> A round closes when every delegate in it has answered or failed, or at its deadline: five
> minutes, unless you set `roundDeadlineMs`. A delegate whose turn fails ends its task at once,
> so the round doesn't wait on it. One whose run is cancelled does the same when its flow sets
> [`delegatedPostOnFinished`](#making-your-own-flow-a-delegate), as the built-in `agent` flow
> does. One still working at the deadline keeps working; the round closes without it, and its
> answer lands once when it comes, going no further.

## UPDATE · `coordinators.md` · "What it won't do", replace the *Recall a post* bullet

> - **Stop a delegate's turn.** Cancelling a post's task ends that delegate's part and drops
>   anything it says afterwards, but the turn itself runs on.

## UPDATE · `coordinators.md` · "Making your own flow a delegate"

The post entry moves from `internal` to `task` entries (S2):

> ```ts
>   task: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(door) } },
> ```
>
> Earlier versions declared it under `internal.actions`. A flow that still does is refused when
> the coordinator is built, with a message naming the new place.

And replace the sentence on cancelled runs:

> `delegatedPostOnFinished` ends a delegated run's task when the run is cancelled, so its round
> doesn't wait for the deadline.

## UPDATE · `apps/docs/docs/workforce/chief-of-staff.md` · the example `WORKER.md` and the line after it

> When they ask who your delegates are, call `listDelegates` and answer from
> what it returns. When they ask for work a delegate does, call `dispatchTask` with
> `post: true` and that delegate as `assignee`. Its answer lands in this conversation under its name, so
> don't answer for it. When no delegate does the work, hire a worker for it,
> add it with `addDelegate`, and hand it on.

> `listDelegates`, `addDelegate`, `removeDelegate` and `setFallback` come with the coordinator
> flow, and so does `dispatchTask`, so `tools:` doesn't name them. A file that still names
> `handOff` is refused when the app loads.

## UPDATE · `packages/workforce/README.md` · Coordinators

> The judgment turn is the built-in agent's own turn. […] The four delegate tools and
> `dispatchTask` are on every coordinator, whatever its `tools:` line grants.

> - **Routing.** `judgment` runs the coordinator's own turn, which hands the post on with
>   `dispatchTask` or answers itself. […]

> - **Delivery.** Each post is one task per delegate per round on the conversation's board,
>   fenced by the board's claim, so its answer lands once however many times its ending is sent.
>   Each delegate's task runs in its own session per conversation, created naming the delegate
>   as its worker, and reused for that conversation's later posts. […]

Export table, the two rows that change:

> | `delegatedPostEntry(turn)` | The entry that makes a flow's workers delegates that take posts. It takes a post's task from the conversation's board, runs `turn` on it, and ends the task with the reply. At the round's deadline, while the turn is still running, it tells the coordinator so the round can close. |
> | `delegatedPostOnFinished` | A delegate flow's request `onFinished`: when a delegated run is cancelled, it fails the post's task, so the round doesn't wait for its deadline. The built-in `agent` flow sets it. |

## No change

`delegating-work.md` and `task-board.md`: a post's task is an ordinary task, and those pages
already describe one. The *giving another worker work* section is FIX-1875's.

## Voice

Watch for: "hand-off" used for delivering new work (D3 of the epic: say "hands it on" for the
person's view, `dispatchTask` for the call); em-dashes as connectors; "seamless".
