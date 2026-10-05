# FIX-1785 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Five edits in four files, all **update**. No new page: this is one field on an entry the Discovery
page already explains. New prose says worker, never seat; untouched sentences around it are
left for the vocabulary rename.

## 1 · `apps/docs/docs/orchestration/discovery.md` → "Asking" (update)

Replace the entry example and the paragraph after "That line is what the agent chooses on…"
through "…only need to choose." with:

> An entry is deliberately short: an id, what kind of thing it is, and a line saying what it is
> for. Some entries also carry `facts`, stored data the agent should read rather than infer:
>
> ```ts
> {
>   id: "eng.feature",
>   kind: "mailbox",
>   purpose: "Where this team talks about the feature it is building.",
>   facts: {
>     members: ["eng.em", "eng.coder", "eng.reviewer", "chief-of-staff"],
>     openedAt: "2026-10-05T09:12:00.000Z",
>   },
> }
> ```
>
> The purpose line is what the agent chooses on, so it is worth writing well. A worker whose
> purpose reads "does engineering things" will not get picked over one that says what it
> actually does.
>
> `facts` come back on every call. Who is on a mailbox, or which kind a worker was hired into,
> is a record, and an agent asked about it should quote the record, not guess. Workforce puts
> a mailbox's `members` and a worker's `workerKind` here.
>
> Entries can also carry an optional `contract`: advice on how to work with the thing, like the
> uri to read a resource by. That one is withheld from a plain call and returned by
> `discover({ detail: "full" })`, so a catalog stays cheap on the calls that only need to choose.

## 2 · `apps/docs/docs/orchestration/discovery.md` → "Setting it up" (update)

After "Outside a workforce, build the door yourself…" and its code block, add:

> A source you write fills the same fields. Put anything the agent must not miss in `facts`,
> as flat values: a string, number, boolean or list of strings. A fact is a value read from a
> stored record that someone could ask the agent to report as it is. Keep it short, since every
> call that lists the entry pays for it; past about 1 KB on one entry, make it a resource the
> agent reads instead. Put advice in `contract`. A value of any other type makes that domain
> report a problem, and the other domains still answer.

## 3 · `packages/contracts/README.md` → "Agent discovery" (update)

`ManifestEntry` (`{ id, kind, purpose, contract? }`) becomes
`ManifestEntry` (`{ id, kind, purpose, facts?, contract? }`), and add after the sentence:

> `facts` is stored data, returned on every read; `contract` is advice, returned only on a
> detailed one.

## 4 · `packages/workforce/README.md` → capability table row for `createWorkforceCapability` (update)

Append to the row's description:

> Each mailbox entry carries `facts.members` and each worker entry `facts.workerKind`, on every
> `discover` call.

## 5 · `packages/core/README.md` → "Agent discovery" (update)

`(`{ id, kind, purpose, contract? }`)` becomes `(`{ id, kind, purpose, facts?, contract? }`)`, and add:

> `facts` comes back on every call; `contract` only with `detail: "full"`.

## Voice notes for the implementer

Watch for em-dashes (the current page uses several; don't add more) and for "seat" in any
sentence you write. Check the example entry against what the DevTeam tree's `eng.feature` returns.
