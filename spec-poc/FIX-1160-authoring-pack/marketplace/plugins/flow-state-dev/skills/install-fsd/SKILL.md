---
name: install-fsd
description: Add flow-state.dev to a project that already exists — detect the project's shape, write the config, flow and mount, and leave the result as a diff to review. Use when the user says "add FSD to this project", "set up flow-state.dev here", or "wire this repo up for flows".
---

You are adding FSD to the user's existing repository. You are NOT working in the framework
repository, and you must not copy files out of one.

## Before you start: run the report

```
npx @flow-state-dev/cli init --report --json
```

That report is the source of truth for this project's shape — host framework, package
manager, module system, whether a config already exists, whether `.env.local` is tracked by
git. **This skill does not guess any of it and does not overrule it.** Run the report
first, every time; `npx` is used because a project that has not been through init has no
`fsdev` on its path.

If the report names a refusal condition, stop. State it in the developer's own terms and
print the remediation it carries. Do not write anything.

## Then

1. State the plan out loud: one line per file, created or appended.
2. Write only the files the report's plan names. Append only inside our own delimiters —
   never read or rewrite anything outside them.
3. Install through the package manager the report named.
4. Run every command before you print it.
5. Leave the working tree dirty. The developer reviews the diff. Never commit.

---

*POC sketch only.* FIX-1159 owns this skill's real content. What is being checked here is
**packaging**: that a fifth skill directory is discovered without editing any manifest, and
that a skill grounded in the report rather than in `AGENTS.md` loads exactly the same way.
