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
- **This opens the message item on purpose.** Until now `MessageItem` carried no open field, and
  a structured payload rode a `component` item (the Architect cites FIX-1585 for this; its spec is
  not in the repository to check). D1 reverses that for messages only, because the data describes
  the line itself, and a second item would have to be paired back to it.
- **How this reads ER-1 beside FIX-2422 (#4386).** The two specs don't pick opposite answers. They
  use two different fields for two different meanings. FIX-2422 stamps the typed `taskId` on a door
  turn's items because that turn works for the task, and that is exactly what `taskId` already
  means. This spec carries data about a line that a filer says *about* a task. Core has no field
  for that meaning, and it would be a package noun. So the reading is: a meaning core already types
  keeps its typed field, and a package's own data about a line rides `metadata` under that
  package's key, with its reader. The epic records this one reading in its ER-1 row
  ([Who owns what](../../epics/FIX-2369/DECISIONS.md#who-owns-what), amended by #4408), and both
  specs cite it.
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
- **E7 · The keys stay internal.** Apps call `parseNotice` and `delegateAnswerOf`, which check
  the shape. They don't read `metadata.taskNotice` or `metadata.delegateAnswer` directly, so neither package
  exports its key (Cursor review).
- **E8 · Two readers, not one.** A delegate's answer is a workforce noun, and orchestration knows
  nothing of delegates (ER-1), so each package reads its own key. Cursor's single
  orchestration-owned reader would move workforce's noun into orchestration.

## How it got here

- Drafted 2026-10-31 with the build prototyped beside it, so each control was seen failing before
  the check was proposed (see the build PR).

## Notes from review

- FSD Architect (bcb54d8): FIX-2422 and this spec read ER-1 differently. Folded into D1: they use
  two fields for two meanings, and the epic is asked to record the one reading. The FIX-1585
  reversal is named in D1.
- Cursor (bcb54d8, approved): the keys made internal (E7). Two readers kept (E8). `title` and
  `detail` kept (E3). Notes on repeated wave narration and the mermaid figure are left to the
  template, which asks for both.
- Codex (bcb54d8): no findings.
