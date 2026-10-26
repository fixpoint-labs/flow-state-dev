# Eval playbook — skills as the unit under test

Evals are unit tests for skills. Use this when a skill change is the thing you
need to prove — a new checklist line, a flipped default, a merge of two skills —
not when the cycle-ledger already answers "did the rework class fall."

Dispatch candidates with the Agent tool. Model tiers are `AGENTS.md`. Transcripts
stay in this workspace. You plan, blind, run, and synthesize. The candidate does
not grade itself.

## Non-negotiables for blinding

- No `eval`, `test`, `judge`, `experiment`, `rubric`, `score`, `compare`,
  `benchmark`, `candidate`, or `arena` in any directory, file, or prompt the
  candidate sees.
- The candidate prompt looks like an organic user request. State the goal, not
  the meta.
- No chain-eliciting cues. Do not ask the candidate to list which skills,
  principles, or files they applied. Ask for design notes generally and grade
  chain-following from code shape and the files they opened, not self-report.
- Sanitize directory and slug names. Use project-shaped names a user might pick.
- Do not tell the candidate other candidates exist.
- The judge can know it is judging but sees outputs by sanitized label only,
  never by model name.
- Comparing two variants: one judge scores both sets in a single pass on one
  scale, blind to which set each came from.

## Steps

The blinding rules above apply to every step.

1. **Frame.** State what variant is under test and what behavior counts as
   success. Write the rubric (3–6 concrete criteria) for the judge only. Hold
   it back from candidates.
2. **One working dir per candidate**, out of this repo. Variant in place (a
   worktree, or a copy of the skill under a neutral name) and the context an
   organic task would have.
3. **One prompt.** What a user would type.
4. **N parallel candidates.** Pin `model` (Opus for judgment-shaped tasks,
   Sonnet for decided checks). Same prompt. Each in its own dir.
5. **One judge on a different model family** from the parent and from the
   candidates when you can (Claude vs Grok vs GPT). It sees the rubric.
6. **Grade from transcripts** in this workspace, per the non-negotiables.
7. **Read every candidate output yourself.** Disagreement with the judge means
   a model is biased or the rubric is ambiguous.

## Hill-climb

Change **one** lever per cycle (a sentence in the skill, a default, a
checklist line). Re-run the same prompt and rubric. Promote the variant only
when the judge and your read agree it won on the named criteria, and a higher
enforcement level (architecture / lint / test — see the parent skill) was not
available.

## Reply

Variant under test, rubric, per-candidate notes, judge's verdict, your
synthesis, and a recommendation: promote, iterate, or drop.
