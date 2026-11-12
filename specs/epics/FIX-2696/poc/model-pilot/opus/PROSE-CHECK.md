# Editor review: x/

Read: the three pages and x/figures/*.svg, docs/contributing/user-docs.md, the drawing classes in
labs/design-system/page.css (imported by apps/docs/src/css/custom.css), and the two published
figures in apps/docs/docs/fundamentals/ to check the house style.

Mechanical scan: zero em-dashes in body prose, no diff-narrative words, no counted preambles, no
significance tics. The problems are level (reference material on Concepts pages) and figure
conventions.

---

## what-flow-state-is.md: SHIP

The voice is right and it stays at the newcomer's level. The findings below are small; none would
stop a reader.

1. what-flow-state-is.md:49: level (edge-case rule)
   Quote: "If two kits put the same key in one slot, or a kit needs another kit that isn't installed, the app refuses to start and names the problem."
   Why: A reader meeting slots for the first time doesn't need the collision rule yet. It also cuts against the paragraph's opening line, "Kits build on each other without knowing about each other."
   Fix: Move it to Kits and slots, or cut it here.

2. what-flow-state-is.md:62: level, plus mechanism as reassurance
   Quote: "A file in that folder the kit doesn't understand stops the app starting, with the file named, so a typo never fails silently."
   Why: This is a startup-validation rule, and "so a typo never fails silently" is there to reassure.
   Fix: Cut it, or keep "The file is yours. You edit it like any other source file." and stop there.

3. what-flow-state-is.md:139-145 vs figures/layers.svg: figure and prose disagree
   Why: The list has five moves, in the order WORKER.md, kit, slot/config, flow, block. The figure has four (01 add a kit, 02 change a kit's feature, with WORKER.md folded in, 03 flow, 04 block). Both claim to "start at the top", but they start in different places.
   Fix: Give the list and the figure the same rungs in the same order.

4. what-flow-state-is.md:147: closer that repeats line 135
   Quote: "When you do write one, it is the same kind of piece the kits are made of."
   Why: The page makes this point three times (the figure, line 135, line 147).
   Fix: Cut line 147's second sentence.

## tasks-and-boards.md: REVISE

Roughly a third of the page is reference material: lease timing, retry counts, ordering, the
stop-reason table, and settlement rules. A reader new to boards needs a model of "a list of tasks
with dependencies, worked by a loop that runs only inside a request". They don't need the
claim-expiry policy.

1. tasks-and-boards.md:56-64: level (mechanism and edge-case rules)
   Quote: "If the process running a task dies, its claim runs out after about two minutes and the task is claimed again as a fresh attempt. A task abandoned this way three times ends `errored`."
   Why: Lease length, the abandonment limit, claim ordering and the default concurrency are reference values. The whole "How a task is claimed" section is mechanism a newcomer can't act on.
   Fix: Fold the section to one sentence ("Each ready task runs once, by one assignee; the board runs up to four at a time unless you set `concurrency`.") and move the rest to the task reference.

2. tasks-and-boards.md:60, 80 and figures/task-life.svg: unclear whether `held` is a status
   Quote: "A `pending` task is claimed only when every task it depends on has completed and nothing is holding it." / "A task can be filed **held**, too"
   Why: The figure draws `held` as a status box beside `pending`. Line 60 makes holding a condition on a pending task. The stop table (line 102) lists "is held" next to "failed". The reader can't tell which is true.
   Fix: Pick one. If it's a status, say so where it's introduced. If it's a flag, drop the box from the figure.

3. tasks-and-boards.md:96-107: level (reference table)
   Quote: the six-row stop-reason table, then "A board stopped on `waiting-on-a-user` has done everything it can until someone answers."
   Why: An enum listing belongs in Reference. Line 107 just restates row 3.
   Fix: Keep one sentence ("When the drain stops, its last item says why: finished, stuck, or waiting") with a link to the reference. Cut line 107.

4. tasks-and-boards.md:112: mechanism as reassurance
   Quote: "Only the assignee holding the claim can settle a task; a late result from one that lost it is dropped."
   Why: "Settle" and "lost the claim" are internals. The guarantee is all the reader needs.
   Fix: "A task records one result per attempt."

5. tasks-and-boards.md:78, 84: undefined terms, mechanism
   Quote: "the task gets one more turn on the same attempt, starting from its brief and the answer." / "the ending reaches its session as a notice."
   Why: "Turn", "attempt", "brief" and "notice" all arrive unexplained, and line 78 describes how resumption is implemented.
   Fix: "Once the answer arrives, the task picks up where it left off." For line 84, say what the filer sees.

6. tasks-and-boards.md:40: terms not introduced
   Quote: "Kept in a collection at session, user or org scope, they last across requests."
   Why: "Collection" and "scope" are new to this reader.
   Fix: Gloss each in a few words, or link to State and scopes.

7. tasks-and-boards.md:119: dangling reference
   Quote: "The task reference lists every status move and every refusal."
   Why: There's no link. This is the page the cut material should point to.
   Fix: Link it.

## workers.md: REVISE

The opening and the roster model are clear. Hire/Fork/Edit/Fire (lines 88-96) drift into
edge-case rules, and one sentence there is ambiguous.

1. workers.md:92, 96: level (edge-case rules)
   Quote: "An edit that moves the worker to another flow leaves its earlier conversations on the old one, where new messages are refused" / "A task assigned to a worker that was fired before the task ran fails, and the conversation that filed it hears so."
   Why: Mid-turn edits, flow-change edits, and messages or tasks aimed at a fired worker are reference rules. They bury the one-line meaning of each verb.
   Fix: Keep one or two sentences per verb (what it does, and whether it's reversible). Move the rest to the `WORKER.md` or workforce reference.

2. workers.md:94: ambiguous
   Quote: "The copy keeps its conversations and the file's flow."
   Why: Whose conversations? The user's conversations with the standard worker before the edit? The copy is brand new, so "its" has nothing to refer to.
   Fix: "Your earlier conversations with the standard worker carry over to your copy, which runs on the same flow as the file."

3. workers.md:66 (and figures/roster.svg:367): unobservable mechanism
   Quote: "Every process sees it on the user's next turn, nothing restarts"
   Why: "Every process" assumes a multi-process deployment the reader hasn't been told about.
   Fix: "It takes effect on the user's next turn, with no restart." Make the same change in the figure.

4. workers.md:126: dangling reference
   Quote: "they share a project, which has its own page."
   Why: There's no link, and "project" hasn't been introduced.
   Fix: Link the page, or cut the clause.

5. workers.md:132: dangling reference
   Quote: "The `WORKER.md` reference lists every key a worker file takes."
   Fix: Link it.

## Figures: consistency with each other and with the site

The three figures use the right drawing classes and the same grid, type scale and arrowheads. The
emphasis colours follow the house rules: one highlighter per figure, and red only on "refused on a
standard one". They depart from the published figures (fundamentals/state-scopes.svg,
flow-type-instance-session.svg) in the following ways.

1. figures/*.svg: the hatch band means something different in each, and none has a key
   Why: On the published figures, the hatch is keyed "OUTLIVES THE REQUEST". Here it caps the app box (layers.svg:9), the workforce/ folder (roster.svg:9) and the ENDED box (task-life.svg:52). That's three meanings ("container", "files", "final"), none of them stated. A reader who has seen the fundamentals figures will read "persists" into all three.
   Fix: Use the hatch only for "outlives the request", with a legend row as the site figures do. Otherwise drop it.

2. figures/*.svg: dashed lines mean something different in each, and none has a key
   Why: page.css defines dashed as "what does not last", and state-scopes.svg keys it "LASTS ONE ACTION RUN". Here dashed means "a kit you might write" (layers.svg:28), "another user, not drawn in detail" (roster.svg:52), and an optional transition (the held and retry paths in task-life.svg:13 and 61).
   Fix: Draw these solid, or add a legend that states the meaning. Don't reuse the dash for "optional".

3. figures/task-life.svg: numbers used two ways in one drawing
   Why: Elsewhere (and in the other two figures) 01-0N are ordinals in a side list. Here 01 and 02 are callouts on arrows, explained in a footnote line (y=512), and 03-05 are list ordinals. The footnote reads like prose stuck to the bottom of the drawing.
   Fix: Drop the footnote and the 01/02 numbers on the plates. The plates already say CLAIM and RETRY.

4. figures/task-life.svg:42: label and prose disagree
   Why: The box says `in_progress`. The prose and the figure description say "in progress", and the prose never names that status in code.
   Fix: Pick one spelling across the page and the figure.

5. figures/layers.svg: see what-flow-state-is finding 3 (the four rungs don't match the prose's five).

---

SUSPECTED INACCURACIES
- what-flow-state-is.md:14: "The server runs a team of AI workers". Workers come from the workforce kit. An app without that kit has none.
- workers.md:114 vs 121: the code renders `w.name`, but line 121 lists a row's fields as id, flow and standard. Check whether rows carry `name`.
- tasks-and-boards.md:60 vs task-life.svg: `held` is drawn as a status but described as a condition (see tasks finding 2).

OFFERED CONTEXT DECLINED
- None offered.
