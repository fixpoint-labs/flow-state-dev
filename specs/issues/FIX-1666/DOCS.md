# FIX-1666 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**No site documentation changes.** The change lives in a private goal lab under `goals/`, which
publishes nothing a framework user reads, and it uses the stock approval suspension that
`apps/docs` already documents. The epic's [DOCS.md](../../epics/FIX-1649/DOCS.md) owns App Lab's
own pages.

One internal README changes: `goals/devforce-lab/lab/README.md`.

## Update · the checks table

Change "Three checks drive it." to "Four checks drive it." and add a fourth row after the product
check:

> | [`../it-waits-for-a-person-before-it-files/`](../it-waits-for-a-person-before-it-files/) | The approval check. With the ask turned on, the EM seat asks a person before it files a feature. Approve files the row and the coder starts; Deny files nothing. No model, and the answer goes through the session's own resume. |

## Create · a section after "What it works around"

> ## The ask
>
> Nothing in this tree asked a person anything, so an Inbox pointed at it had nothing to show.
> The EM seat now has a third door beside `file` and the channel post: it pauses on a stock
> approval before it files, and files only if a person approves. Deny files nothing and says so.
>
> The door is off unless the host asks for it. `openLab` takes the feature to ask about, turns on
> durable execution, and raises the ask once in the EM seat's own session, as the lab's person.
> Opening again over the same store finds the ask, or the row an earlier approval filed, and
> raises nothing. The three older checks don't ask for it, so they run exactly as before.
>
> ```ts
> const lab = await openLab({
>   stores,
>   harness: stub.slot,
>   workspace,
>   coderSeatId,
>   ask: { issue: "search-bar", goal: "Add a search bar to the header" },
> });
> // The EM's session now holds one pending approval. Answer it through
> // POST /<em-seat>/requests/<requestId>/resume with "approve" or "reject".
> ```

The option name `ask` is illustrative; the implementer swaps in the shipped name when publishing.
