# FIX-1366 · Plan

Executes [SPEC.md](SPEC.md). Docs only. One PR. No tests, no changeset.

## The sequence

```mermaid
flowchart TD
  S1["1 · re-run greps A + B<br/>confirm two zero-change findings"] --> S2["2 · rename the contract<br/>git mv + 2 inbound refs"]
  S1 --> S3["3 · sweep worker-agent → custom-agent<br/>README · overview · workers-on-disk"]
  S3 --> S4["4 · docs-writer, then docs-editor<br/>overview reshaped · section grown"]
  S1 --> S5["5 · Atlas pass<br/>workforce.html, classes 1–3"]
  S1 --> S6["6 · confirm FIX-1392 on main<br/>don't redo the docstring"]
  S4 --> S7["7 · pnpm --filter docs build"]
  S2 --> S7
  S5 --> S7
  S6 --> S7
  S7 --> S8["8 · PR · say: no changeset"]
```

| Step | Passes when |
|---|---|
| 1 | Superseded factory names: 0 hits repo-wide. Orchestration and skills pages untouched |
| 2 | `grep -rn workforce-agent-kind . \| grep -v node_modules` → empty |
| 3 | Grep A → only the Atlas hit remains |
| 4 | Spec §6 boxes tick by eye. The no-memory line is on the overview, not only in the linked section |
| 5 | Grep A → empty. Grep B on that page → anti-teaching framing only |
| 6 | `pnpm --filter @flow-state-dev/workforce typecheck` |
| 7 | Exit 0. `onBrokenLinks: "throw"` catches the anchor |

## Step 4 · the writer's brief

```mermaid
flowchart LR
  B["surface brief<br/>what the worker does<br/>the 9 options<br/>what it doesn't do<br/>overview leads zero-code"] --> W["docs-writer"]
  W --> E["docs-editor"]
  X["this spec · the diff<br/>the rename history"] -.->|"never"| W
```

Hand the writer the brief only. The outsider rule is the binding constraint. No new file, no `sidebars.ts` change.

## What the section grows into

```mermaid
flowchart TD
  APP["app supplies · AgentWorkerFlowOptions"] --> a1["catalog"]
  APP --> a2["skills"]
  APP --> a3["model"]
  APP --> a4["classifierModel"]
  APP --> a5["confidenceThreshold"]
  WK["worker declares · its own file"] --> w1["instructions"]
  WK --> w2["model"]
  WK --> w3["tools"]
  WK --> w4["skills.enableLlmClassifier<br/>default false"]
```

`classifierModel` and `confidenceThreshold` sit on the app because the matcher is built once per kind. Re-derive from `agent-worker-flow.ts` at implement time.

## The `tools:` fence

```mermaid
flowchart LR
  T["worker's tools: list"] -->|"exactly these"| G["generator · stock path"]
  CAP["a capability that contributes tools"] -.->|"unioned today,<br/>not intersected"| G
```

Teach the solid edge as the guarantee. Name the dashed edge as a known limit, one or two sentences, no dates. If FIX-1393 has landed, the dashed edge is gone: teach the fence flat.

## Grep A · teaching surface only

```bash
grep -rn "worker-agent\|workerAgentFlow" \
  --include=*.md --include=*.mdx --include=*.html \
  apps/docs packages/*/README.md docs/atlas
```

Empty after step 5. Not reached, must stay: the contract's C6 text · `docs/internal/design/kitchen-sink-agent-drift.md`. The repo-wide form can never pass.

## Grep B · the removed cluster

```bash
grep -rn "defineAgent\|materializeAgent\|AgentRegistry\|createAgentRegistry" \
  --include=*.md --include=*.mdx --include=*.html . | grep -v node_modules
```

Never empty. Most hits are correct and stay.

## Step 5 · Atlas, what to touch

```mermaid
flowchart TD
  L["a matching line on workforce.html"] --> Q1{"worker-agent shown<br/>as a built-in?"}
  Q1 -->|"yes"| F["fix"]
  Q1 -->|"no"| Q2{"pending-decision framing<br/>on the removed cluster?"}
  Q2 -->|"yes"| F
  Q2 -->|"no"| Q3{"asserts a kinds map<br/>is required at hire?"}
  Q3 -->|"yes"| F
  Q3 -->|"no"| LV["leave it"]
  Q2 -->|"it's anti-teaching framing"| LV
  LV -->|"ambiguous?"| PR["list it in the PR"]
```

Plus one mechanical edit: re-pin the `origin/main` line (242). Match entity-escaped HTML. Fix an SVG `<text>` and its `aria-label` together.

## Leave alone

| Surface | Because |
|---|---|
| `orchestration/configuration.md` · `orchestration/agents.md` · `skills/delegation.md` · `guides/building-a-research-team.md` | They document live bring-your-own options. Correct |
| `workers-on-disk.md:248` | FIX-1363 owns it |
| The built-in section's existing prose | Grow it. Don't move, copy, or re-voice |
| The contract's C6 body | Deliberate residue |
| Merged PR descriptions | History |

## At implement time

- FIX-1393 landed → teach the fence flat.
- FIX-1364 landed first → link its memory teaching, don't repeat.
- Option counts moved → source wins over the diagram above.
