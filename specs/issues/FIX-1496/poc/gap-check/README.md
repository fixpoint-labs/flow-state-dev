# `gap-check` — the spec's factual base, re-derived from the repository

An experiment, not a supported API. Nothing imports it, it is not a workspace package, and it
is in no build, test or lint discovery path. It exists so the gap table in
[`SPEC.md`](../../SPEC.md) can be checked rather than believed.

## What it checks

FIX-1496's argument is that ER-DevForce is mostly built and exactly four things are missing.
That is a counted claim, and a counted claim argued in review converges one row at a time while
the rows nobody looked at stay wrong. So the twelve statements the spec rests on are asserted
here instead:

| Claim | The spec row it holds up |
|---|---|
| Every TypeScript file under `goals/devforce-lab/` is classified | Nothing in the lab escaped the claims below |
| Two goal checks, exactly one model-backed, no PASS recorded on it | "The proof is written and has never been run" |
| The artifact's repository is created under the OS temp directory, and nothing pushes it | "The artifact does not outlive the run" |
| The model-backed check runs on `inMemoryStores()` | ER-3's *durable across the run* is unmet |
| Nothing in the lab calls `openChannels`, one `CHANNEL.md` is declared, and **both** sibling labs do call it | "The channel is walked but never driven, and the path is proven next door" |
| Nothing reads the browsable child-session surface; parentage is read as provenance only | FIX-1440 does not fence this work |

## Run it

```bash
node specs/issues/FIX-1496/poc/gap-check/check.mjs
```

Node only. No install, no network, no credential, no model.

## The two properties a hand-written checker usually lacks

**A totality assertion.** Claim 0 asserts that *every* `.mts`/`.ts` file under the lab is
classified as a goal runner, lab root code, or a kind. A checker that inspects only the files it
already knew about cannot report the one nobody listed, so this one runs first and is fatal.

**Negative controls, actually run.** `--plant <kind>` injects the exact defect a claim exists to
catch. `--plant list` prints them. Observed 2026-09-22 on `spec/FIX-1496`:

| Plant | Result |
|---|---|
| *(none)* | **PASS** — 12 claims held |
| `unclassified-file` | **FAIL** on claim 0 alone, naming the planted path, and stops before the rest |
| `channel-is-opened` | **FAIL** on the channel gap alone; the other 11 hold |
| `durable-stores` | **FAIL** on the durability gap alone; the other 11 hold |
| `model-check-passed` | **FAIL** on "never run" alone; the other 11 hold |

Each control perturbs one thing and goes red on one claim, so a red here names its own cause.
Plants are applied to the in-memory copy of the tree; nothing on disk is touched, so a control
run cannot leave the repository perturbed.

## Limits

It reads the repository, not a running workforce. It can tell you the channel is never opened;
it cannot tell you the proof would pass once it is. That is the goal check's job, and building
it is what this issue is for.
