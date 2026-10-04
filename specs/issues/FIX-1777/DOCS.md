# FIX-1777 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Two updates to pages that exist. No new page and no sidebar change: the behaviour belongs to the
DevTeam profile, which already has a home on both pages. Write "worker", never "seat", in every
sentence added; leave the rest of each page's wording alone.

[FIX-1774](https://linear.app/fixpoint-labs/issue/FIX-1774)'s draft adds sentences to the same two
paragraphs about the chief of staff. Those stay FIX-1774's; this issue owns only the sentence on
posting.

## 1 · Update `labs/shift-manager/README.md` — the `devteam` bullet under *Team profiles*

After "The EM answers every line posted in a project's room.", add:

> A line posted on a workstream as `slug: what to build` is filed as a task and the coder starts
> on it right away, with no approval first. With `DEVFORCE_LAB_HARNESS=claude-code` set, each new
> slug you post is a coding run your model key pays for. Posting the same slug again starts nothing.

In *What a coding run is handed*, the sentence "When you approve a feature in Inbox, or post
`slug: what to build` on a workstream, …" stays as it is: it becomes true.

## 2 · Update `apps/docs/docs/shift-manager/overview.md` — the `devteam` paragraph

After "On start the EM asks you to approve one feature, so Inbox has something in it.", add:

> You can also skip Inbox: post `slug: what to build` on the feature workstream's Stream and the
> coder starts on it at once. There's no approval step on that path, so with a real coding agent
> configured, every new slug costs a run.

**Voice watch:** no em-dashes added; *workstream* and *Stream* are already introduced on the page.

## Not changed

- The Workforce mailbox reference: the mailbox kind doesn't change.
- `goals/devforce-lab/lab/README.md` is a check's notes, updated in the PR (S4), not site docs.
