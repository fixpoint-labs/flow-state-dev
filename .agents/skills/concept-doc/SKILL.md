---
name: concept-doc
description: Write a concept doc, a plain-language explanation of how one part of the framework works (or should work), built up one part at a time so both its author and a newcomer can hold the model in their head. Target model first, then where today's code differs, verified against the code. Use when an area is hard to explain, earlier explanations failed, or the user asks how X should work. Not for API reference, specs, or a codebase map. Feeds issue-spec / epic specs and, once agreed, user docs via docs-writer.
argument-hint: "<the area, e.g. 'Workforce', 'memory tiers', 'scopes and sharing'>"
---

# Concept Doc

A concept doc explains how one part of FSD works, or should work, so that a person can hold the
whole model in their head. It is written for two readers at once: the person who designed the
area and a bright newcomer. If the designer can't follow it, the model is wrong. If the newcomer
can't, the writing is.

When no explanation of an area lands, the model is often the problem. A concept doc is how you
find out, and the agreed version later gets polished into user docs.

## When to use it, and when not

**Use it** when an area is hard to explain, or before an epic reshapes a subsystem and everyone
needs the same picture.

**Not for:**

- **API reference or a guide page.** That's `add-docs-page`, written by `docs-writer`.
- **A spec.** A concept doc has no goal check, no plan and no approval gate. Its gap table and open
  decisions *feed* `issue-spec` or an epic spec; they don't replace one.
- **A map of unfamiliar code.** That's `zoom-out`.
- **Stress-testing a plan by interview.** That's `grill-me`.

## Read first

Apply these; don't restate them in the doc or here.

- **The bar:** [`specs/epics/FIX-1786/concept/CONCEPT.md`](../../../specs/epics/FIX-1786/concept/CONCEPT.md),
  the Workforce concept doc this skill was distilled from. Read all of it before writing, and
  match its depth: every part answered concretely, one cast of examples throughout, costs stated,
  a cited gap table. (Its opening banner and source comment exist because it was copied into an
  epic spec; a new concept doc doesn't need them.)
- [`writing-for-humans.md`](../../../docs/contributing/writing-for-humans.md) → "Density".
- [`user-docs.md`](../../../docs/contributing/user-docs.md) → "Voice" and the tells table.
- [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md) for any open
  question that needs a real sign-off.
- [`spec-figures.md`](../../../docs/contributing/spec-figures.md) for mermaid vs SVG and the one
  sentence under every figure.
- `apps/docs/docs/glossary.md` and the area's `docs/architecture/*.md`, for the vocabulary that
  already exists.

## The shape

Sections in this order. Title it `<Area>: How It Should Work` for a target model, or
`<Area>: How It Works` when describing today. A "How It Works" doc has no target, so it drops
section 10 and "what this replaces", and every claim in its body cites the code it was read from.

1. **Why this doc.** Two or three sentences. What hurts, and, for a target model, that the doc
   describes the target first and lists the gap to today last.
2. **Base terms.** Declare the few terms everything rests on, once, as bold one-line statements:
   *"A user is always a person."* Then say "user" every time after.
3. **The parts, in the order you meet them.** An ordered list, one line per part, saying what each
   part is for. Each part uses only the ones above it. Start abstract and simple; the concrete
   cases come in the sections that follow.
4. **One section per part,** in the list's order: what it's for, how it's built, then an example
   and, where position or flow carries meaning, a diagram. Tables for comparisons. A "why not X?"
   subsection only where a reader would genuinely reach for X. Every part the model stores
   answers, in the text or a table:
   - **Who owns it, and who can see it.**
   - **Where it's stored:** which scope, which resource or collection, keyed how.
   - **How many exist:** one per user, per project, per piece of work? (A small "work → sessions"
     table often does this.)
   - **What it replaces, and what that costs**, when the part changes something that exists: a
     "what this replaces" note, then each cost and how it's handled.
   - **When to use it** over its neighbours, if a reader could pick the wrong one.
5. **How it flows.** One concrete scenario traced end to end through every part, as a numbered
   list with a diagram, using the doc's cast (below). This is where a reader checks the parts
   actually fit together.
6. **Naming debates.** One per contested name: a small table (what each name says, where it fits,
   familiar from, risks), then **Recommend X** and what would change it.
7. **The rules.** A numbered list, opened with: *"A behavior none of these rules explains is a bug
   in the model."* Security models and ownership models get this section; it's the doc's test.
   When the model changes a file format or config keys, add a migration table here or under the
   part: old key, new key, how many files use it today.
8. **Vocabulary.** A table: term, what it means, and any property the model turns on (for example
   private or shared). Above it, one line: *"One term, one thing. Retired: …"* listing every term
   the doc stopped using and what to say instead. Then a **retired-terms table**: the term, what to
   say instead, where it lives in code and docs today, and how many files mention it. That table
   is the refactor's checklist, so count by searching, not by guessing.
9. **Decisions.** A checklist, each item marked decided, open, punted or held. Open items carry a
   recommendation and, where useful, what would change our mind.
10. **Where today's code differs.** A two-column table, target vs today. Every "today" cell comes
   from reading the code in this session, with the file path in the cell or beside the table.
   Never from memory or from the docs.

## Writing rules

- **Purpose before mechanism.** A section that opens with a schema or a class name has started in
  the wrong place.
- **One term, one thing.** Use the user's vocabulary and the codebase's. Never coin a noun to
  explain one: analogies ("a desk", "a house and a world") add terms the reader has to map back.
  Prefer a plain dichotomy (private vs shared) over
  a metaphor. A genuinely new thing in the model gets a name only through the vocabulary table and,
  if contested, a naming debate.
- **Target and today stay apart.** The body describes the model as if it had always existed. What
  the code does now goes in the gap table, or in a short "what this replaces" note under the part it
  changes. Never interleave the two in one paragraph.
- **Code names stay out of the body.** Identifiers like `seatAuthored` or `sharedToLineage`
  belong in "what this replaces" and the gap table. Where the body needs the idea, give it a
  plain term and define it the first time it's used.
- **One cast, used everywhere.** Pick two users and three or four named things (Alice and Bob, a
  "researcher" and a "writer", a "launch" project) and reuse them in every example, diagram and
  scenario. A reader who has met Alice's researcher once never has to learn a new example again.
- **Label every example by kind:** "researcher (worker)", "launch (coordinator)".
- **Diagrams make one claim.** The caption states the finding, not the topic: *"a coordinator
  relaying a post, and a direct ask"*, followed by one sentence saying what to look at. Use the
  same names as the prose. Look at the rendered result before moving on; a diagram you haven't seen is a guess.
- **Language level:** short sentences and plain words that a bright 14-year-old could follow,
  without talking down. No counted preambles ("Three reasons.") or other tells from `user-docs.md`.

## Working on it with the user

- **Medium.** When the user wants to iterate together with comments and this harness has the
  Claude Docs tools, write it as a Claude Docs living doc (load the docs skill or the Claude Docs
  `guide` first). Otherwise, including in any harness without Claude Docs, a markdown file under
  `docs/internal/design/`, iterated through PR comments.
- **Verify every claim about current code** by reading it and citing the path. When the user's
  description of the code and the code disagree, say so in chat with the path; don't write either
  version into the doc until it's settled.
- **Read before you write.** The user edits the doc directly. Re-read the sections you're about to
  touch before every edit, and keep their wording unless they ask otherwise.
- **When the model changes, rewrite the affected sections.** Patching one sentence leaves the parts
  list, the diagrams, the rules, the vocabulary and the gap table describing the old model. After a
  change, walk all of them, and the flow scenario, and bring each in line. A wording fix that
  changes no part, rule or term needs none of this.
- **Answer challenges in chat, not in the doc.** Push back when the code disagrees. The doc records
  where you landed, not the argument.

## Checking it before you call it done

You wrote the doc, so you can't read it cold. Two checks catch what you can't see:

1. **The cold read.** Dispatch a fresh sub-agent with only the doc: no conversation, no code, no
   spec. Ask it to:
   - list the parts in order and say what each is for, who owns it and where it's stored
   - answer four to six scenario questions you write from the rules, using the doc's cast. Make at
     least two of them edge cases, e.g. "Bob's researcher answers in a channel Alice also reads.
     Who is it acting as, and can Alice open its session?"
   - list every term it had to guess at

   Every wrong answer or guessed term is a gap in the doc. Fix the doc, then rerun the check with
   a new sub-agent. Never argue with the reader.
2. **The bar check.** Put the doc beside the exemplar under "Read first" and go part by part: does
   each of your parts answer what its counterpart there answers? A part with no "who owns it",
   "where it's stored" or "how many" is thinner than the bar.

Tell the user what the cold read got wrong and what you changed. It's often where the model
itself is still unclear.

## Handing off

- **To specs.** Once the model is agreed, the gap table is the backlog. Rows become issues or an
  epic's sub-issues through `issue-spec` or `epic-lifecycle`, which link the concept doc rather
  than copy it.
- **To user docs.** Dispatch `docs-writer` then `docs-editor`, per
  [`user-docs.md`](../../../docs/contributing/user-docs.md) → "Who writes them". Brief the writer
  from the target-model sections only (parts, per-part sections, rules, vocabulary), and only for
  what has shipped. "What this replaces", the naming debates, the decisions and the gap table are
  design history; they never go in the brief.

## Done when

- A cold-read sub-agent, given only the doc, names every part in order, says what each is for,
  and answers every scenario question correctly.
- Every part the model stores says who owns it, who can see it, where it's stored and how many
  exist.
- One cast of examples runs through the whole doc, including every diagram and the flow scenario.
- Every term in the body is in the vocabulary table, and no retired term appears outside it or
  the retired-terms table.
- No example in the doc needs a behavior the rules don't explain.
- Every open question has a recommendation.
- Every "today" claim cites a file you read in this session.
