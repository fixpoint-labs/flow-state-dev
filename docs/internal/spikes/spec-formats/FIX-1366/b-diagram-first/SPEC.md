# FIX-1366 · Teach the built-in worker kind

Docs only · 0 new pages · 5 surfaces · 1 rename · 1 PR · epic FIX-1359 · [plan](PLAN.md)

## 1. Today

```mermaid
flowchart LR
  R["reader wants a worker"] --> O["Workforce → Overview<br/>the front door"]
  O --> K["first example:<br/>a kinds map is the required step"]
  K --> P["kind named worker-agent<br/>reads like a built-in"]
  W["workers-on-disk.md · line 258<br/>the built-in, taught well"] -.->|"never linked from the front door"| O
  W --> T["reference says 3 settings<br/>API has 5 + 4"]
  AT["Atlas workforce.html · public"] --> S["calls a removed API<br/>an invent-kill candidate"]
```

The built-in is already taught, two-thirds down a page about the file format. The front door never mentions it, the example kind reads like a shipped default, and the reference undercounts the API.

## 2. After

```mermaid
flowchart LR
  R["reader wants a worker"] --> O["Workforce → Overview<br/>leads with the zero-code hire"]
  O --> M["names the built-in<br/>states: no memory"]
  M -->|"anchor link"| W["workers-on-disk.md · same section, grown<br/>5 app options + 4 worker settings<br/>tools: fence + its hole"]
  O --> C["custom kinds shown as custom-agent"]
  AT["Atlas workforce.html"] --> AF["3 classes of false claim corrected<br/>nothing else"]
```

No new page. The front door answers the question it's asked and links into the section that already holds the answer. That section grows only where it was thin.

## 3. What gets touched

```mermaid
flowchart TD
  OV["overview.md<br/>reshaped"] -->|"new anchor"| WD["workers-on-disk.md<br/>section grown"]
  OV -->|"custom-agent"| RM["workforce README<br/>swept"]
  WD -->|"custom-agent"| RM
  CT["workforce-agent-kind.md<br/>renamed → workforce-default-worker-kind.md"] -->|"link + text"| AR["architecture-reference.md"]
  CT -->|"provenance header"| SRC["agent-worker-flow.ts"]
  ATL["docs/atlas/workforce.html<br/>3 classes corrected"]
```

Edges are the links that must stay in step. The docs build catches the anchor. Nothing catches the other three, so each gets a grep in the plan.

## 4. Where the decisions fell

```mermaid
flowchart TD
  I["FIX-1366"] --> D1["D1 · grow + promote in place<br/>no new page"]
  D1 -.->|"rejected twice"| X1["new built-in-worker.md<br/>· then a redirect stub"]
  X1 -.->|"why"| E["premise was 'nothing teaches it'<br/>evidence said otherwise"]
  I --> D2["D2 · reference lists all 9 options<br/>emphasis unchanged"]
  D2 -.->|"rejected"| X2["ship '3 + a switch' as if whole"]
  D2 -.->|"acceptable alt"| X3["list 3, defer 2 in one explicit line"]
  I --> D3["D3 · Atlas: bounded pass<br/>workforce.html only"]
  D3 -.->|"rejected"| X4["restructure · or sweep all 4 pages"]
```

Solid edges are what you're signing. Dashed edges are what lost, and why. D1's dashed branch is the one worth reading: the spec's own first draft died on evidence.

## 5. What each decision locks in

| | Locks in |
|---|---|
| D1 | No sidebar entry names the concept. If nobody finds it, a sidebar label fixes it later |
| D2 | `classifierModel`, `confidenceThreshold`, `enableLlmClassifier` become public surface. Narrowing later reads as a removal |
| D3 | Sibling atlas pages keep asserting a removed API until FIX-1387 |

## 6. The pages must

- [ ] Answer "what do I get with no code?" in the overview's first example
- [ ] State **no memory** on the new front door, as prominently as today
- [ ] List all 5 app options and 4 worker settings
- [ ] Not push readers toward the LLM classifier. Opt-in, off by default
- [ ] Teach the `tools:` fence as the guarantee, and name the hole
- [ ] Carry no `worker-agent` on teaching surface, and no issue numbers under `apps/docs`
- [ ] Build clean

## 7. Boundary

```mermaid
flowchart LR
  subgraph this["this issue"]
    A["promote + grow the built-in"]
    B["custom-agent sweep"]
    C["Atlas workforce.html"]
    D["contract rename"]
  end
  subgraph shipped["already shipped"]
    F["docstring + README counts<br/>FIX-1392"]
  end
  subgraph elsewhere["owned elsewhere"]
    G["3 sibling atlas pages<br/>FIX-1387"]
    H["core tool resolution<br/>FIX-1393"]
    J["memory composition<br/>FIX-1364"]
    K["skills entry points<br/>FIX-1362"]
    L["createChannelFlow rename<br/>FIX-1386"]
  end
```

Also untouched, on purpose: the pages documenting `agentRegistry` / `materializeAgent` as bring-your-own options. They're correct.

## 8. How it got here

```mermaid
flowchart LR
  A["draft<br/>new page"] --> B["round 1<br/>duplicates a section →<br/>move, don't copy"]
  B --> C["round 2<br/>premise false →<br/>grow + promote"]
  C --> D["ruling · epic PR 1730<br/>tools: fence stands<br/>teach it, name the hole"]
```

**One open call → recommend yes.** Promote by anchor only, no sidebar entry. Cost if wrong: one label change, after someone fails to find it.
