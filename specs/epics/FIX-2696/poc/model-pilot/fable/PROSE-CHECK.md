# Editor review: `y` pages

Standard: `docs/contributing/user-docs.md`. Figures checked against the drawing classes in
`labs/design-system/page.css` (imported by `apps/docs/src/css/custom.css`), the `<Figure>` component
(`apps/docs/src/components/Figure/index.tsx`), the header of `apps/docs/scripts/lint-brand.mjs`, and
existing site figures (`apps/docs/docs/orchestration/task-board-parts.svg`, `docs/glossary/layers.svg`).

Mechanical sweep: zero em-dashes on all three pages. No *now / still / no longer / anymore /
deliberate / just*. The voice holds up well. The real problems are the figures and a few paragraphs
pitched at Reference depth.

---

## Shared across all three pages (counted once, applies to each)

S1. **all three `.md`, the italic line under each image: writer note left in the published text**
   Quote: "*… Description for the site's `Figure`: On the left, the stored list of tasks …*" (tasks-and-boards:15, what-flow-state-is:17, workers:34)
   Why: the reader sees "Description for the site's `Figure`:" printed under the drawing, followed by a paragraph-long alt text. The site renders figures through `<Figure svg caption description>`, and these pages use `![]()` instead.
   Fix: use `<Figure>` in MDX. The short first sentence becomes `caption`, and the rest becomes `description` (screen readers only). Delete the italic paragraph.

S2. **figures/board.svg, layers.svg, worker.svg, lines 2–14: each one embeds a `<style>` block with hex colours**
   Why: the brand lint bans `<style>`, `style=`, and every colour literal in a diagram ("the page and `<Figure>` own those"), so CI fails all three. When SVGR inlines the drawing, the unscoped `text{…}`, `.c`, `.t` and `.hl` rules also apply to the whole page. Their dark block follows the OS setting (`prefers-color-scheme`), not the site's theme toggle. The comment in the file says the page's rules win. That holds for the classes, but not for the global `text` selector or anything else on the page that uses those class names.
   Fix: delete the `<style>` block and the comment. Keep `<defs>` (hatch, arrowhead), which is what `task-board-parts.svg` does.

---

## tasks-and-boards.md: REVISE (7 findings + S1, S2)

1. **:61 + figures/board.svg ("Several of these loops run at once"): two different accounts of how work runs at the same time**
   Quote: "The drain runs up to four ready tasks at a time unless you set another limit" vs. the figure and caption: "Several of these loops run at once."
   Why: the reader can't tell whether there is one drain running four tasks or several drains, and the page defines "the drain" as one loop (:11).
   Fix: give one account in both places. In the figure: "Up to four tasks run at once." Drop "several loops".

2. **:59 vs :65: the status table leaves out a status the next section uses**
   Quote: "`pending`, then `in_progress`, then `completed` or `errored`" … "Tasks that depended on it are cancelled"
   Why: a reader who checks a dependent's status finds a value the table never listed.
   Fix: add `cancelled` to the row ("… `completed`, `errored` or `cancelled`"), or describe the dependents without naming a status.

3. **:61: wrong level / mechanism as reassurance**
   Quote: "and a task is only ever claimed once."
   Why: "claimed" is never defined on the page, and the reader can't observe this. It reads as proof of quality from inside the engine. The "four at a time" default is Reference detail too.
   Fix: cut the clause. Move the concurrency default and its option to the reference.

4. **:84: wrong level, an edge mode on a Concepts page**
   Quote: "By default the drain waits for that session to finish. A board in delegation mode returns as soon as its tasks are handed out, and each session settles its task later."
   Why: "delegation mode" and "settles" turn up with no definition, and a newcomer doesn't need them yet. The link to Background work is the useful part.
   Fix: "A task can also be handed to work that outlives the request. [Background work](./background-work.md) covers that."

5. **:82: unexplained term**
   Quote: "or run in a session of its own."
   Why: :71 defines a session as "one conversation", and a task running in a conversation of its own doesn't make sense to a newcomer. It's also what sets up the delegation paragraph in finding 4.
   Fix: cut the clause, or say what the reader gets ("…or run separately, with its own history").

6. **figures/board.svg: the line style contradicts the page's main claim about lifetime**
   Why: page.css says "dashed `5 4` for what does not last", and existing site figures (`task-board-parts.svg`) use dashed for request and hatch for durable. The drain is the part with "no lifetime of its own" (:78), yet it is drawn as solid boxes. The stored list gets neither treatment. The figure misses the chance to show the point that :78 makes.
   Fix: put a dashed frame around the drain column. Leave the list solid, or hatch it if it should read as durable.

7. **:88: counted preamble (mild)**
   Quote: "Three common shapes ship as patterns, ready-made compositions that build the board for you:"
   Fix: "Patterns are ready-made compositions that build the board for you:"

## what-flow-state-is.md: REVISE (5 findings + S1, S2)

1. **:52–54: wrong level / unobservable claim**
   Quote: "A kit names the kits whose slots it fills, and never reaches into how they work. A kit that fills a slot can open slots of its own, so features stack. That is how one person's app becomes the base for someone else's."
   Why: on the first page a newcomer reads, slot chaining is mechanism. "Never reaches into how they work" is a design claim the reader can't check, and the last sentence is a triumphant closer.
   Fix: stop after "`harnesses` opens a slot for coding agents and `claudeCode` fills it." Move the stacking to a Kits concept or reference page.

2. **:17 + figures/layers.svg (kits row): the figure says more than the page does**
   Quote: "the claude-code kit fills a slot the harnesses kit opened, and harnesses fills one that workforce opened"
   Why: the page never says harnesses fills a workforce slot, so the figure brings in a relation the reader has no context for. The arrows point from the kit that fills a slot to the kit that opened it, which is the opposite of the dependency reading most readers will assume. The figure labels the kit `claude-code` while the code (:47) calls it `claudeCode()`.
   Fix: show the kits as a list with no arrows, or show the one pair the page explains (harnesses, claudeCode) and use the same name the code uses.

3. **:9: contrast cadence on the opening line**
   Quote: "Most agent frameworks hand you parts. Flow State hands you an app."
   Why: the "X, not Y" shape the voice section rules out. It sells before it says anything.
   Fix: start at :11: "Run a starter and you have an app: a team of AI workers …"

4. **:36: missing referent**
   Quote: "Add a folder with a second file and the team has a new member."
   Why: the page never shows where worker files live, so the reader doesn't know which folder.
   Fix: "Add another worker folder under `./workforce` …", or link to Workers.

5. **:40: sentence that doesn't parse on a first read**
   Quote: "The team, with the task board its members share, and the coding agents it hands work to all come from kits."
   Fix: "The team, its shared task board and its coding agents all come from kits."

Note: the frontmatter says `type: start`, not `concept`. Flagged only because the brief called all three pages Concepts pages.

## workers.md: REVISE (5 findings + S1, S2)

1. **figures/worker.svg (rosters): dashed frame on something that lasts**
   Why: in the site's drawing style, dashed means "does not last", but rosters are per-user and persistent. The label "ON EACH PERSON'S ROSTER" also uses *roster* before the page defines it (:80).
   Fix: draw the rosters with solid frames, and label them "ONE PER PERSON", or move the figure below :80.

2. **figures/worker.svg, column label: broken phrase**
   Quote: "WHERE ALICE'S WORKS"
   Fix: "WHERE ALICE'S LEAD WORKS"

3. **:28: wrong level, Reference rules packed into the intro**
   Quote: "The team and worker folders give it the id, and `name` is what people see. The settings between the `---` lines say what it is and what it can reach, and `description` is the only one a file must have."
   Why: five rules in one paragraph. Which field is required is a WORKER.md reference fact, and the reference is already linked at :111.
   Fix: keep the path → id sentence and "Everything below the second `---` is its instructions." Cut the rest or move it to the reference.

4. **:66: unclear claim**
   Quote: "The worker sees the recent turns of that conversation, and those turns stay in it."
   Why: "stay in it" could mean they persist, or that they don't leak to other sessions. The reader can't tell which promise is being made.
   Fix: name the promise, for example "Nothing from this conversation shows up in another one."

5. **:63: unexplained field**
   Quote: "`.flow(session.flowKind)`"
   Why: the page never says what a flow kind is or why the client needs it.
   Fix: add a short clause, for example "`flowKind` is the flow the worker runs on (see below)."

Taste, not blocking: :74 (the refusal names the worker) is an edge rule that could live in the reference.

---

SUSPECTED INACCURACIES
- tasks-and-boards.md:59/:65: whether `cancelled` is a real task status, or dependents end up some other way.
- tasks-and-boards.md:61: is the default really four, and is it per drain or per board? The figure suggests more than one drain.
- what-flow-state-is.md:17: does harnesses really fill a slot that workforce opened? The page body never says so.

OFFERED CONTEXT DECLINED
- None was offered.
