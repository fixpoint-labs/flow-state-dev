# Eval playbook — skills as the unit under test

Evals are unit tests for skills. Use this when a skill change is the thing you
need to prove — a new checklist line, a flipped default, a merge of two skills —
not when the cycle-ledger already answers "did the rework class fall."

> **Attribution.** The blinding rules, the organic-prompt step, the
> different-family judge, and hill-climbing the variant are adapted from the
> MIT-licensed **pstack** `poteto-mode` playbook `playbooks/eval.md` by Lauren
> Tan — <https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/eval.md>.
> The copyright notice is in [`LICENSE.upstream`](./LICENSE.upstream). FSD
> substitutions: model tiers from `AGENTS.md` (not `pstack-models.mdc`);
> candidates are Agent-tool dispatches; transcripts stay in this workspace.

## You own the experiment

Plan, blind, run, synthesize. Do not ask the candidate to grade itself.

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

1. **Frame.** State what variant is under test and what behavior counts as
   success. Write the rubric (3–6 concrete criteria) for the judge only. Hold
   it back from candidates.
2. **Set up sanitized environments.** One working dir per candidate, with the
   variant in place (a worktree, or a copy of the skill under a neutral name).
   Plant the context an organic task would have: a small fixture repo or the
   skills the candidate would naturally read. Keep those dirs **out of this
   repo**.
3. **Author one organic prompt.** What a user would type. No leakage of what
   is being measured.
4. **Spawn N parallel candidates** on different models. Pin `model` explicitly
   (AGENTS.md tiers: Opus for judgment-shaped tasks, Sonnet for decided checks).
   Same prompt to each. Each works in its own sanitized dir.
5. **Spawn one blinded judge on a different model family** from the parent
   and from the candidates when you can (Claude vs Grok vs GPT). The judge
   sees outputs by sanitized label and the rubric, never a model name.
6. **Verify the chain from transcripts, not self-report.** Stay inside this
   workspace's transcript directory. Grade chain-following from the files
   each candidate actually opened plus the shape of the output.
7. **Read every candidate output yourself.** Compare to the judge's verdict.
   Disagreement means a model is biased or the rubric is ambiguous. Synthesize.

## Hill-climb

Change **one** lever per cycle (a sentence in the skill, a default, a
checklist line). Re-run the same prompt and rubric. Promote the variant only
when the judge and your read agree it won on the named criteria, and a higher
enforcement level (architecture / lint / test — see the parent skill) was not
available.

## Reply

Variant under test, rubric, per-candidate notes, judge's verdict, your
synthesis, and a recommendation: promote, iterate, or drop.
