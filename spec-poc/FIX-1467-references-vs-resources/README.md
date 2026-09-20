# FIX-1467 POC — what a Workforce `resources/*.md` document does today

Throwaway. Never merges. It exists to check FIX-1467's premises against real `main`
code — the loader, `hireWorkforce`, and a live execution context — instead of against
the teaching.

## Run it

```bash
ln -sfn ../../packages/workforce/node_modules \
  spec-poc/FIX-1467-references-vs-resources/node_modules   # deps, once
cd packages/workforce
env -u FSDEV_DEFAULT_MODEL pnpm exec vitest run \
  --root ../../spec-poc/FIX-1467-references-vs-resources
```

**Expect 5 failures out of 11.** The failures are the finding. Each leg is written as the
promise FIX-1467's POC spine makes, so a red leg is the spine naming work that does not
exist yet.

## The honest control

Every red leg is paired with a control that runs the **same harness** with exactly **one
input** changed, and the control goes **green**:

| Red | The one input the control changes | Control |
|---|---|---|
| A seat reads another team's handbook | the app's install filter | green |
| A seat can overwrite the org handbook | `writable: false` in that file's frontmatter | green |
| A seat reaches a mutable resource ungranted | the seat's own `resources:` key | green |

A harness that could not observe the behaviour at all would be red in both halves. These
are red on one side and green on the other, so the red is the gap and not the wiring.

## What it showed

| Leg | Verdict |
|---|---|
| 1 · loaders walk `workforce/**/resources/` | **GREEN.** Org, team and worker refs all load, path-qualified |
| 1b · characterization | Every document is minted `scope: "org"`. **The tree is a name, not a scope** |
| 2 · ungranted seat reads org + own team refs | **GREEN** — but only because absent-key narrows *nothing* |
| 2b · never cross-team | **RED.** The same seat reads `teams/sales/handbook` too |
| 3 · ungranted seat cannot write | **RED.** `writable` defaults to true; the seat overwrote the org handbook |
| 3b · the write sticks | **RED.** `expected 'DEFACED' to contain 'ORG HANDBOOK v1'` — the disk body never comes back |
| 4 · mutable resource needs an explicit grant | **RED.** Absent-key reaches it too |
| 5 · refs RO on the bash mount | **RED.** Bash mounts collections only; a document has no `pattern`, so refs are on **no** mount at all |

The load-bearing one is 3b. A Door A markdown document is **already** a seed-then-evolve
resource: the disk body is a first-boot seed, a write persists, and from then on the file
in git is dead weight that nothing reports. So `references/` is not a folder to rename —
it is a read path that does not exist yet.
