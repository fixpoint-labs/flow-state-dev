# Rules — Workforce: Layer 2 Abstraction

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

What every epic under this project obeys. Each rule has **exactly one owner** — the epic that
implements and proves it; the others inherit it. A rule with two owners is a seam; a rule with none
is a wish.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When a concept is proposed for this project, then it ships here only if there are **several valid assemblies** of it; exactly one → it is substrate and lives in `core` / `engine` / `orchestration` | FIX-1332 | The epic objective gate |
| **PR-2** | When a convention needs behaviour, then it **composes Layer 1 primitives** and never introduces a parallel primitive — Layer 2 stays transparently implemented, no black box | FIX-1332 | Package-boundary review |
| **PR-3** | When a convention ships, then it ships with a **reader and a consumer that exercises it**, not a format alone | FIX-1351 | The thin pentest lab |
| **PR-4** | When a file declares a thing, then every key the convention **derives** is refused by name — a file may not say where it lives, what its identity is, or what its state shape is | FIX-1351 | Reader tests, per-convention |
| **PR-5** | When a new surface names a Layer 2 concept, then it uses the **settled name** (Role, Strategy, Instructions, stream visibility), never the superseded one | FIX-1407 | A check over the changing epic's own diff. W4 met it that way (ER-19); the repo-wide pass is **unowned** |
| **PR-6** | When an epic writes a hireable worker kind, then it **composes `workerConfigSchema()`** — the four imposed keys `instructions`, `teamInstructions`, `seatSkills`, `seatTools` — and a file that authors any of them is refused by name | FIX-1351 | The closed schema at every mint; a kind that cannot take the bag refuses at boot, naming the key |

**No epic may:**

- Add a **second claim system**. There is one task board and correctness depends on that (PD-2).
- Expose the **agent bundle** — Persona, Skills, Memory, Instructions, Strategy — as the public
  API. An Agent is invoked or assigned work, not decomposed (PD-3).
- Run the **propagation pass** before the vocabulary locks (PD-4). Renaming an unratified model
  costs the rename twice. **W4's wrap is folded and the answer is that the pass did not run:** what
  FIX-1385 owed was a name check over W4's own diff, ER-19 was narrowed to exactly that, and the
  repo-wide pass was **named out at the wrap with no owner**
  ([Decisions](DECISIONS.md) → *Recorded at the wrap*). The prohibition now stands on PD-4 alone,
  with no epic holding it and nobody scheduled to run it.
- Put a concept here **because it is convenient**. PR-1 is a test, not a preference.

---

## Where PR-4 came from, and why it is worded this way

PR-4 is the one rule here that was **corrected after it was first written**, and the correction is
the reason it names *derived keys* rather than a specific key.

It began inside `FIX-1354 §7` as a table of seven inherited shape rules — a rule set living inside a
document it governs, where a sibling epic could not find it. Two of those rules were wrong; the
correction reached a comment on a Linear issue and never reached the table. Review then found, by
running it, that carrying the remaining frontmatter through verbatim let a file point itself at
another document's storage row.

So the rule is stated as the general form — *every derived key is refused* — rather than as the one
key that happened to be found first. **That generalization is the rule; a list of refused key names
would rot the same way the original table did.**

This is also the clearest argument for why this document exists at project altitude at all.
