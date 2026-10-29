# FIX-2334 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what (identity first, plus a tool-use rule) and leaves placement to the
Architect. D1 is placement and the one to sign; D2 is what the block reads.

```mermaid
flowchart TD
  I["FIX-2334"] --> D1["D1 · Workforce's default layer, first in the built-in worker flow's prompt"]
  D1 -.->|"rejected"| X1["each app's WORKER.md"]
  D1 -.->|"rejected"| X2["a capability an app adds through uses"]
  D1 -.->|"rejected"| X3["core's generator, or the engine"]
  I --> D2["D2 · read from the roster each turn · reach = what sendMessage takes"]
  D2 -.->|"rejected"| X4["frozen into settings at the hire"]
  D2 -.->|"rejected"| X5["only the worker's own team"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · The identity is Workforce's default layer, first in the built-in worker flow's prompt

| | Default layer, front of the array (chosen) | Each app's `WORKER.md` | A capability in `uses` | Core or engine |
|---|---|---|---|---|
| Every app gets it | yes | only apps that write it | only apps that add it | yes |
| A worker a person hires gets it | yes | no | yes, if added | yes |
| Stays right after a rename or a fire | yes, read each turn | no | yes | yes |
| Layer boundary | Workforce (L2) | app | Workforce | **breaks it**: core has no roster or team |
| New mechanism | none: the slot C1 reserved | none | a second way in to the prompt | a hook core doesn't need |

- **Instead of** `WORKER.md`: that is the fix the issue rules out ("every app gets it").
- **Instead of** a capability: the C1 contract says the default prompt is consumed by this flow
  and "defines no second one"; a capability would be the second, and an app could leave it out.
- **Because:** the C1 contract already names the place, first, and says nothing else moves. Its
  code comment says not to grow it into a compose helper, registry or type; this is one more
  array entry.
- **Locks in:** the layer is the built-in flow's, fixed text plus roster facts, not a setting. An
  app that wants other words registers its own `agent` worker flow (C1's door) and may put the
  exported identity block first. Configuring it per app, team or org is FIX-1344's remaining part,
  not this issue's. The order promise stays "order, not precedence": a `WORKER.md` that says
  "you are Alex" contradicts the block, and the model decides.

**Ownership.** On main the default prompt has no owner: FIX-1344 (Done) carried it as its third
part and closed without it, and the C1 doc's pointer is stale. This issue takes the slot and its
first two pieces; the rest of the default prompt files as its own issue when someone needs it.
The question is open to fsd-architect on agent-mailbox#46; an answer that moves placement
re-drafts D1.

<a name="d2"></a>
## D2 · The block reads the roster each turn, and its reach is what `sendMessage` would take

- **Self:** `rosterWorker(workerId)`'s `name` (its id when null), `description`, `teamName`
  (omitted for an org worker). The text says the role is how the user reads it, since descriptions
  are written to the user ("runs the team's work with you").
- **Others:** the shared recipients reader, the filter `sendMessage`'s description uses today:
  roster minus self, minus workers with a `problem`. A worker whose flow hears in `task-sessions`
  only goes on a separate "takes tasks" line, with the `createTask` assignee to use. Each entry
  shows its name and the id a send or task takes. Cut at the same cap the tool uses (25).
- **Instead of** freezing it into settings at the hire: a fired or hired worker would be wrong
  until restart, and settings are the worker flow's schema, which would gain a key every
  hand-written flow refuses.
- **Instead of** the worker's own team only: the roster is who it can actually reach, across teams
  and the org's workers, and one list matches the refusals a send gives.
- **Locks in:** the identity and the `sendMessage` list come from one reader. The tool keeps its
  list, since a model reads a tool's description where it reads the tool.

## Decided, not asked

- **E1 · Off an installation** (a bare `hireWorkforce` roster, no `installation` option) there is
  no roster to read: the block is "You are `<workerId>`." and no reach.
- **E2 · Layer boundary:** all of it is Workforce. Core's prompt slot already resolves async
  entries and drops absent ones.
- **E3 · Only the built-in worker flow** gets it by default. The error reporter and app flows
  (the Teammates coder, harness flows) have their own prompts; they can compose the export.
- **E4 · The tool-use rule** is general and short, and names no tool. App-specific "act, don't
  offer" guidance (FIX-2336's Chief of Staff) stays in that worker's file.
- **E5 · Vocabulary:** the text says worker, team and teammates.
- **E6 · Cost:** the prompt slot resolves before every step of the tool loop. Read the roster
  once per turn if that measures as a cost.

## Considered and dropped

- **Leave the roster in `sendMessage`'s description only.** The worker can't see it when the tool
  is off, and a model doesn't read a tool description as "who I am".
- **Name the worker in the first user message.** It goes out of the history window, and the
  prompt is where a model looks for who it is.

## Notes from review

None yet.
