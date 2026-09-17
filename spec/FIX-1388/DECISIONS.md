# FIX-1388 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

What was considered, what was chosen, why, and what each choice locks in. Two decisions and one
open fork are the sign-off surface. Everything else here is context for them.

## The tree

```mermaid
flowchart TD
  I["FIX-1388 · a .ts in resources/ does nothing"] --> D1["D1 · found by the build step<br/>fsdev gen grows a fourth family"]
  D1 -.->|"rejected"| X1["the framework imports user TS at boot<br/>works on Node, finds nothing behind a bundler"]
  I --> D2["D2 · a seat picks presets<br/>it never installs a capability"]
  D2 -.->|"rejected"| X2["WORKER.md names capabilities to install<br/>a file in a folder becomes an authority boundary"]
  I --> O["Open · which folders Door B reads"]
  O -.->|"the fork"| X3["the two the issue named<br/>or the three Door A grew since"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why. The open fork has
no solid edge yet.

<a name="d1"></a>
## D1 · A `.ts` resource is found by the build step, not by the running framework

| | |
|---|---|
| **Instead of** | The framework opening and importing the app's TypeScript when it starts |
| **Because** | A walk that works on a plain Node host finds nothing once an app is built for Vercel or Next: by then those files are not separate modules. We made this call once already, for worker kinds and blocks — a command reads the tree and writes a committed module of ordinary imports. A second discovery mechanism beside it is two answers to one question (tenet 1) |
| **Locks in** | Adding a capability is two steps forever: write the file, run the command. A team that forgets the second gets a seat that is quietly short, and the only thing that catches it is `fsdev gen --check` in CI — now load-bearing for a team's resources, not just its code |

The cost is a promise about ergonomics: the pitch of the file convention is *put a file in a
folder and it works*, and this puts a command between the two. It is the bargain the kinds and
blocks convention already struck, and the alternative is a convention that works in development and
silently empties itself in production.

**What would change my mind:** evidence that apps on this convention deploy to plain Node only. Then
a run-time read is one step instead of two and the command is pure overhead.

<a name="d2"></a>
## D2 · A seat picks presets from what its kind carries; it never installs a capability

| | |
|---|---|
| **Instead of** | A worker's file naming capabilities to attach to itself |
| **Because** | What a workforce *may* be able to do is the app's call, and a file a team edits is not where that is decided. Picking presets is the shape the skills switch already has, so an author who has written one worker file can read this one. A seat that names nothing carries the capability's defaults, which is what every seat gets today |
| **Locks in** | A seat adds; it never takes away. An app that wants a capability quieter for some seats turns it down where it installs it. Reversing that later lets a team's file subtract from what the app configured — an authority change, by which time rosters are written against the additive reading |

The subtractive version is the tempting one and the one that costs. Once a seat's file can turn off
what the kind installed, "what can this worker do?" is answered by two files owned by two people,
and every future capability has to decide which wins. Additive keeps one answer (tenet 5).

**What would change my mind:** a concrete seat that has to run with *less* than its kind's default —
a cost or a privacy reason, not a preference. Then the fork is real and worth its own issue.

## Decided, not asked

- **Capabilities reach the kind through the `uses` option that already exists**, and their declared
  resources bubble from there. Settled on FIX-1364's review; nothing here reopens it.
- **A module's plain resources merge into the map Door A already builds.** One map, one call site,
  no second registry (tenet 3).
- **Module discovery and the Markdown walk stay separate readers** over the shared walk primitives
  FIX-1389 published. Neither reader learns the other's convention.
- **The `.ts` skip in the Markdown reader stays a skip, and its comment is corrected** — it claims a
  non-`.md` file carries no sign anyone meant it, which stops being true here.
- **A file's path still mints its scope**, exactly as it does for a document.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A new `resources` option on the worker kind | Dropped on FIX-1364's review. A second install seam for a job `uses` does |
| Teaching the Markdown reader to also read `.ts` | One reader holding two conventions, and it widens Door A while Door A is held closed |
| Declaring capabilities in `.md` frontmatter | Frontmatter cannot author a schema. Ruled out when Door A was cut |
| A capability registry the seat looks names up in | A second place a capability can exist, to keep in step with the kind's `uses`. The generated map already is the list |
| Shipping Discover alone | A command that finds files and drops them. The three layers are one story |

<a name="open"></a>
## Open

### Which folders Door B reads: the two the issue named, or the three Door A has now?

**Plain terms.** A team's reference material can live in three places: shared across the whole
organisation, owned by one team, or sitting inside a single worker's own folder. When this issue
was cut, Markdown documents could live in the first two. Since then the third one shipped, so today
a `.md` file works in all three. If the new TypeScript door only reads the first two, someone who
puts a capability in a single worker's folder gets exactly the silence this issue exists to remove —
in the one place they'd most expect it to work, because the Markdown file beside it does.

**The trade-off.** Matching all three costs a little more work now and one more case to test.
Shipping two means the two doors disagree about where things may live, and the mismatch is
invisible until someone hits it. Undoing either direction later is cheap in code and not cheap in
explanation: "it works for documents but not for capabilities, in that one folder" is the kind of
rule people remember badly.

**My recommendation: read all three.** One folder convention should mean one thing regardless of
which file you put in it, and the asymmetry only exists because the third folder landed after this
issue was written — it is an accident of sequencing, not a decision anyone made. The extra work is
one more root in a walk that already handles the other two.

**What would change my mind:** if you want seat-local capabilities held back deliberately — because
a capability inside one worker's folder raises a question about who may give a single seat behaviour
that the document case doesn't raise. That is a real reason, and if it is the reason, the right
answer is to say so out loud in the docs rather than leave the gap unexplained.

**Cost of being wrong: low, and it surfaces fast.** Either direction is a small change to the same
walk, and whoever hits the gap tells us within a week. This is the cheap one — spend your attention
on D1.

## How it got here

- **Draft** — framed on the silent skip a `.ts` file gets in `resources/` today; joins the existing
  build-step discovery convention rather than adding a second one; installs through the `uses` seam
  that already exists, so the only new authoring surface is one key in a worker's file.
