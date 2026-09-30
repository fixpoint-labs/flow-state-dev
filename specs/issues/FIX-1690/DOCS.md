# FIX-1690 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Four published surfaces change, plus App Lab's README. No new page: each change is a section
under a concept that already has one (the harness manager, the inventory, flows). Voice rules
most at risk here: say *what a turn does to a run* before naming any API; no em-dash chains;
introduce *door* once, in plain words, on each page that uses it; no issue numbers under
`apps/docs/`. Implementation reconciles every sentence below against the shipped behaviour.

## CREATE · `apps/docs/docs/orchestration/harness-manager.md` · after "Asking and being answered"

> ## Talking to a run
>
> A person can send a running coding run a message. The run stops where it is, and its next
> attempt continues **the same coding session** with the message as its prompt. The checkout and
> the harness's memory of the conversation both carry over, so the run picks up with what it had
> already read and tried, plus what you said.
>
> The manager gives you the action that does this. Declare it on the kind whose rows run coding
> work:
>
> ```ts
> const manager = harnessManager({ /* … */ });
>
> defineFlow({
>   kind: "coder",
>   actions: { message: manager.messageDoor },
>   task: { actions: { work: { block: manager } } },
> });
> ```
>
> Call `message` with `{ message }` on the run's own session. The person's words go into that
> session as a user message the moment the action starts, so a UI can show them as delivered by
> reading the session, not by trusting the response.
>
> What happens depends on where the task is:
>
> | The task is | Your message |
> |---|---|
> | Running | Stops the attempt and continues the session with your message |
> | Waiting on its own question, or between attempts | Kept, and given to the next attempt |
> | Not started, or finished | Refused, with the reason |
>
> **A message doesn't spend a retry.** The run parks for your turn and comes back without
> being charged an attempt, so talking to a run never makes it fail sooner.
>
> **A message isn't an answer.** If the run is waiting on its own question, your message is
> kept for later but the question still needs answering.
>
> **Only the run's own person can send one.** Anyone else gets the same answer as for a run
> that doesn't exist.
>
> The stop costs the step the run was in the middle of. A harness that can take a message
> mid-step without stopping isn't used that way yet.

## UPDATE · `apps/docs/docs/orchestration/harness-manager.md` · "Limits"

Add one bullet:

> - A run on a harness that can't resume a session, such as Claude Code's cloud dispatch, can't
>   be sent a message. The action refuses and says so.

## UPDATE · `packages/harness-manager/README.md` · after "Continuing a run"

> ## Talking to a run
>
> `manager.messageDoor` is a public action a coding kind declares. Sent `{ message }` on a run's
> session, it keeps the message, stops a running attempt, and re-queues the row without charging
> an attempt; the next attempt resumes the same coding session with the message as its prompt.
> A row waiting on a question or between attempts keeps the message for its next attempt. A
> finished or never-started row, a harness that can't resume, or a caller who isn't the run's
> person is refused. See the docs page's *Talking to a run*.

## UPDATE · `apps/docs/docs/workforce/inventory.md` · "What each row holds"

Replace the seat example and add a paragraph after it:

> ```ts
> { id: "engineering.lead", kind: "agent", door: "run" }
> ```
>
> `door` is the action that takes a person's message for this seat: its kind's one public action
> that declares `userMessage` and takes `{ message }`. The built-in worker's is `run`. A kind with
> no such action gets `door: null`, and an app should say that seat takes no message rather than
> guess. A kind with two is reported as a problem at hire, and gets `null`.

## UPDATE · `packages/workforce/README.md` · "Hiring a workforce"

> A seat takes a person's message through its **door**: the one public action its kind declares
> with `userMessage` and a `{ message }` input. The hire finds it and writes it on the seat's
> inventory row. Two such actions on one kind is a hire problem.

## UPDATE · `apps/docs/docs/fundamentals/flows.md` · after the `userMessage` example

> A block can also stop another request running in its own session, the way the abort route
> does from outside. It's how an action that takes a message can make room for it:
>
> ```ts
> const result = await ctx.session.stopRequest(requestId);
> // "stopped" | "already-finished" | "not-in-this-session"
> ```
>
> The stop is recorded on the request, so it reaches a request running in another process on
> that process's next heartbeat, exactly like an abort.

The method's name is the implementer's; the sentence and the three outcomes are what this page
promises.

## UPDATE · `labs/app-lab/README.md`

Replace the *"A post appears in the transcript…"* paragraph's neighbourhood with:

> **Talking to a worker.** Start a line with `@` and a worker's name to send it to that worker's
> task in this workstream instead of the channel. If it has several, the composer asks which.
> If it has none, Send is off and says so. In a task, the composer sends to that task's run.
> From Inbox, the reply box sends to the worker that asked, if its kind takes messages; DevForce's
> EM doesn't, so its reply box says so.
>
> A running coding run stops where it is and carries on in the same session with your message.
> The composer says *delivered* once the run's session holds your line, not before. A finished
> task takes no message.

In *Not there yet*, delete the first row. In *What isn't here yet*, delete *Addressing one
worker* and add:

> - **Posting a task's message to its workstream too.** Sending to the worker and posting to the
>   channel are two separate things for now.
