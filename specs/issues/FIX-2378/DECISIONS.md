# FIX-2378 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what: structured task id and ending on the notice's item, `parseNotice`
beside `noticeText`, and a marked delegate answer. It leaves open where on the item the data
rides. That is D1, the one call; the rest is decided below.

<a name="d1"></a>
## D1 · The data rides a generic `metadata` field on message items

| | `metadata` on the message (chosen) | A companion `component` item | The item's `taskId` field | `parseNotice(text)` only |
|---|---|---|---|---|
| Survives a change to the words | yes | yes | task id only; the ending is still words | no |
| One item per line | yes | two, which a client must pair | yes | yes |
| Marks a delegate's answer | yes | yes | no | no |
| L1 change | one optional field and option, no task noun | none | none, but it changes what the field means | none |
| Means what it says | yes | yes | no: `taskId` is "emitted while working this task", read by the task-attribution helpers | yes |

- **Because:** it is the only shape that carries both the notice and the answer marker on the line
  itself, without bending an existing field's meaning. A companion item doubles every line and
  makes each client pair them by order; `taskId` would make the task-attribution helpers count the
  filer's line as the task's own work.
- **Generic, not a task field.** Core gains `metadata?: Record<string, unknown>` on `MessageItem`,
  the same name and shape `ContainerItem` already has, and the option on both message emitters.
  The engine never reads it, and history (`itemToLLMMessages`) holds the text alone. Orchestration
  owns the `taskNotice` key and workforce the `delegateAnswer` key, each with its reader (ER-1).
- **Locks in:** an open field any package may write. A key clash between two packages is possible
  in principle; each key names its package's noun, and the reader validates the shape, so a stray
  value reads as "not a notice".

![D1: metadata on the message chosen, beside a companion component item, the item's taskId field, and parsing the text. Decides it: one item that survives a reword and marks both kinds of line. Price: one optional field in core. Flips if core refuses open fields on items](figures/d1-where-the-data-rides.svg)

It comes down to one item that says what it is, without a second item or a field that means
something else.

## Decided, not asked

- **E1 · `parseNotice` falls back to the words for a line with no data (BP-030).** Sessions stored
  before this hold such lines, and the labs keep reading them as results. The regex sits beside
  `noticeText` and is tested against its output for every ending, so the two change together. A
  line that has data is never read off its words, so malformed data reads as "not a notice".
- **E2 · `delegateAnswerOf` has no fallback.** Nothing on an older answer told it apart but a
  guess at `agentName`, which is wrong for a hired worker with no team (`otto`). An older answer
  reads as a plain line under its delegate's name.
- **E3 · The data carries `title` and `detail`** (the output summary or the error, as the words
  have them), so the Claude Code-style lab reads its result card without the text. `detail` is the
  same at most 500 characters the words carry.
- **E4 · A routed failure's "couldn't answer" line carries `noticeMetadata` too.** Its words are
  not `noticeText`'s, but it reports that task's ending.
- **E5 · No app file in this slice.** The build order's wave 1 rule; each lab's stack 2 adopts the
  readers and deletes its regexes in the same PR (ER-3).
- **E6 · `parseNotice` takes a structural item type**, not core's `MessageItem`, so a lab's own
  narrower `Item` type fits once it adds `metadata`.

## How it got here

- Drafted 2026-10-31 with the build prototyped beside it, so each control was seen failing before
  the check was proposed (see the build PR).
