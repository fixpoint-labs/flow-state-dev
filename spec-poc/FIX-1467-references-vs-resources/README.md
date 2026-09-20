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

**Expect 3 failures out of 15.** The failures are the finding. Legs 1–4 are written as the
promise FIX-1467's POC spine makes, so a red leg there is the spine naming work that does not
exist yet. **Leg 5 is all green on purpose** — see below.

## The honest control

Each red leg is paired with a control that runs the **same harness** with exactly **one
input** changed, and the control goes **green**:

| Red | The one input the control changes | Control |
|---|---|---|
| A seat reads another team's handbook | the app's install filter | green |
| A seat can overwrite the org handbook | `writable: false` in that file's frontmatter | green |

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
| 4 · a mutable resource ungranted | **GREEN characterization.** The seat reaches it, and **must still** after FIX-1467 — see [BR-14](../../spec/FIX-1467/BUSINESS-RULES.md) and PLAN V4. A grant is optional narrowing, not a precondition for reach. The control proves [#1943](https://github.com/fixpoint-labs/flow-state-dev/pull/1943)'s narrowing still works |
| 5 · can D1 be built on today's core API? | **ALL GREEN — a feasibility answer, not work.** See below |

The load-bearing one is 3b. A Door A markdown document is **already** a seed-then-evolve
resource: the disk body is a first-boot seed, a write persists, and from then on the file
in git is dead weight that nothing reports. So `references/` is not a folder to rename —
it is a read path that does not exist yet.

## Leg 5 — the D1 feasibility question

Review round 1 asked whether D1 needs a **core/engine contract change**, because the answer
decides whether FIX-1467 collides with epic FIX-1457's *"W5 is composition, not a fourth
substrate epic."* Leg 5 answers it by running it. All five checks are green: they pin real
behaviour rather than naming work.

| Check | Shows |
|---|---|
| (a) `writable: false` refuses the write | **Expressible today.** Enforced at `resource-registry.ts:1971`. The handle still *carries* `writeContent` — a runtime refusal, not an absent verb |
| (b) sealed + `contentFile` re-reads on restart | **Expressible today**, per execution context. BR-2 holds with no core change |
| (b) unsealed + `contentFile` loses the file | **(a) is load-bearing for (b).** A stored row wins over `contentFile` (`resource-registry.ts:502`), so `contentFile` alone is a seed with a longer name |
| (b) a row written before the seal shadows the file | **The migration hole.** Sealing stops new writes but cannot evict an existing row — so S7 is a data migration |
| (b) an edit mid-context is not seen | **Literal "disk on every read" is not expressible.** `readContent()` reads an in-memory map; no core hook reaches the filesystem |

**Verdict: no core/engine contract change is required** — provided D1 reads "fresh on every
execution context" rather than "on every read." The full write-up is in
[DECISIONS → D1 feasibility](../../spec/FIX-1467/DECISIONS.md#d1-feasibility).

## Not here

**The bash mount.** Earlier drafts carried a red leg asserting references should be on the
agent's bash mount. It was cut in review round 1: SPEC and DECISIONS already defer mounts to
FIX-1382 and record "on no mount today" as settled, so keeping it red inflated the failure
count and read as part of the sign-off surface. The evidence stays in
[DECISIONS → Settled](../../spec/FIX-1467/DECISIONS.md#settled).
