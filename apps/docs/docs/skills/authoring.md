---
sidebar_position: 2
---

# Authoring Skills

A skill is a folder with a `SKILL.md` at the root, plus any supporting files you want the playbook to reference. This page covers the format in detail.

## Folder shape

```
skills/
  <skill-name>/
    SKILL.md
    reference/
      something.md
      rubric.md
    examples/
      good.md
      bad.md
```

The skill name is the folder name. It must match `^[a-z0-9][a-z0-9-]*$` — lowercase, hyphens allowed, no leading digits in most use cases (the regex allows a leading digit, but avoid it).

Files inside the folder are bundled with the skill when it's seeded into the resource collection. They're addressable from the body via the `${CLAUDE_SKILL_DIR}` substitution (see below), so your body can say "open `${CLAUDE_SKILL_DIR}/reference/rubric.md`" and the agent knows where to find it.

Symlinks are rejected at read time for safety.

## SKILL.md frontmatter

The file opens with a YAML frontmatter block delimited by `---`, followed by the Markdown body:

```markdown
---
description: One or two sentences describing when this skill applies and what it does.
context: inline
allowed-tools: [search, fetch]
---

# Skill Title

Body goes here.
```

### Frontmatter keys

| Key | Required | Type | Purpose |
|-----|----------|------|---------|
| `description` | yes | string (≤ 1024 chars) | What the model sees in the skill catalog. This is the trigger — write it well. |
| `context` | no | `inline` \| `fork` | Activation mode. Default `inline`. |
| `allowed-tools` | no | string[] | Catalog keys the skill can invoke in fork mode. Ignored in inline mode (tools come from the parent). |
| `when-to-use` | no | string | Extra guidance appended to the description in the catalog listing. Keep it short. |
| `disable-model-invocation` | no | boolean | When `true`, the skill can still exist in the collection but `runSkill` will reject calls for it. Useful for drafts or skills only invokable by admins. |

Unknown frontmatter keys are preserved but not interpreted. The parser validates the shape up front — a malformed skill won't poison the seeding pass.

### Writing good descriptions

The description is the only thing the model sees in the catalog. It decides whether to invoke `runSkill` based entirely on that string. Two guidelines:

- **Name the trigger, not the implementation.** "Use when the user asks about competitors" is better than "Runs a competitor analysis workflow".
- **Front-load the match phrase.** The model scans descriptions quickly. Putting the matching intent in the first clause beats burying it.

A description that never triggers is a skill that never runs. A description that triggers on every question is a skill that pollutes every turn. Write carefully, then check the DevTool's tool-calls panel to see whether the model is activating as intended.

## Body

The body is plain Markdown. It becomes either the substituted system prompt (fork mode) or is spliced into the parent generator's system prompt after the skill is activated (inline mode).

Treat the body as an imperative playbook, not a conversation. Short sections. Bullet lists for enforceable rules. Headings the model can refer back to. Avoid qualifiers like "you might consider" — the skill exists because the author has an opinion.

## Substitution

Two variables are substituted into the body at runtime:

- `$ARGUMENTS` — the `input` string passed to `runSkill`, if any. Lets the model pass a topic or target through to the playbook.
- `${CLAUDE_SKILL_DIR}` — the conventional path the agent can use to refer to the skill's bundled files in prose. Defaults to `/workspace/.fsdev/skills/<skill-name>`; configure via `mountPath` on `createSkillsCapability`.

Both substitutions run on the body after frontmatter is stripped. If a variable isn't used, nothing changes.

Example:

```markdown
---
description: Research a topic using the method in reference/method.md
---

# Research

The user asked about: $ARGUMENTS

Open ${CLAUDE_SKILL_DIR}/reference/method.md for the step-by-step process,
then follow it exactly.
```

Called via `runSkill({ name: "research", input: "quantum computing" })`, the body renders with `$ARGUMENTS` replaced by `"quantum computing"` and `${CLAUDE_SKILL_DIR}` replaced by `/workspace/.fsdev/skills/research`.

## Inline vs fork in practice

Inline skills read like a coach sitting next to the agent. The conversation continues in the parent context. Use inline when:

- The skill is guidance about how to handle a class of requests.
- The user is collaborating with the agent and wants the guidance to persist.
- The skill doesn't need a different tool set from the parent.

Fork skills read like dispatching a junior agent to run a task and report back. Use fork when:

- The skill is a self-contained task with a clean input and a clean output (e.g. "research this topic").
- You want to restrict the tools the task can use.
- You don't want the sub-agent's tool calls and intermediate messages in the parent conversation's history.

Fork mode requires `allowed-tools` to be meaningful — it filters the parent's tool catalog down to the listed keys. Unknown keys are logged and skipped.

## Reference files

For skills with structured processes, put the process in a reference file rather than inlining it in `SKILL.md`. The `SKILL.md` stays short and the reference file can grow without ballooning every activation.

```
skills/
  competitor-analysis/
    SKILL.md
    reference/
      dimensions.md
      scoring-rubric.md
```

The body of `SKILL.md` tells the agent to load the reference when activated:

```markdown
---
description: Competitor analysis. Use for landscape, comparison, or "who competes with X" questions.
---

# Competitor Analysis

Before drafting, open:
- `${CLAUDE_SKILL_DIR}/reference/dimensions.md` — the evaluation axes
- `${CLAUDE_SKILL_DIR}/reference/scoring-rubric.md` — how to rate each axis

Follow the sections in order.
```

For the agent to actually open these files, something has to make them readable from the workspace. The recommended pattern is `readOnlyMounts` on `createBashCapability`, which materializes the skills collection into the bash sandbox at `/workspace/.fsdev/skills/<skill-name>/...`:

```ts
import { createBashCapability } from "@flow-state-dev/tools/bash";

const bashCap = createBashCapability({
  sessionResources: artifactResources,
  collectionKey: "artifacts",
  readOnlyMounts: [
    {
      resolve: (ctx) => ctx.project?.resources?.skills,
      pathPrefix: ".fsdev/skills",
    },
  ],
  provider: { type: "local" },
});
```

With this in place, `${CLAUDE_SKILL_DIR}` paths are reachable via `cat`, `python3`, or any other bash tool. Writes under the mount are kept local to the sandbox — they don't propagate back to the skills collection, so the agent can't accidentally edit a skill mid-run.

Without a mount, reference files still exist as resources but the agent needs a different path to read them (e.g. a `readArtifact`-style tool that takes resource keys directly). Pick one.

In fork mode, the sub-agent only sees tools listed in `allowed-tools`. If the skill expects to read reference files via bash, include `bash` or `bash-read-file` in the list.

## Bundling scripts

Because mounted skill files are materialized on real filesystem paths, scripts work too. The kitchen-sink's `check-news` skill ships a `scripts/date-window.py` helper that returns an ISO date range for different news recency targets:

```
skills/
  check-news/
    SKILL.md
    scripts/
      date-window.py
    reference/
      ai-news.md
      world-events.md
      business-markets.md
```

The body invokes it directly:

```markdown
Before searching, compute today's date window:

python3 ${CLAUDE_SKILL_DIR}/scripts/date-window.py recent

The script prints JSON like `{"since": "...", "until": "...", "days": 7}` —
use `since` in your search query's recency filter.
```

This gives the agent concrete ground truth (today's date) that it can't always reliably derive from its training data. The script runs in whatever sandbox the bash capability was configured with (just-bash, local, Vercel, etc.), so the capability's provider config determines what languages and binaries are available.

## Validation errors

The parser throws on:

- Missing or empty `description`
- `description` longer than 1024 chars
- `description` containing XML tags (reserved for future use)
- Missing or malformed frontmatter delimiters

Individual skills that fail validation during `readSkillsDirectory` are collected into an `errors` array instead of throwing the whole pass, so one broken skill doesn't block seeding the rest.

## Editing skills at runtime

Skills live in a resource collection at the scope you chose (`project`, `user`, or `session`). Once seeded, they're editable via any surface that can write to resources — the DevTool, a custom admin UI, or a CLI command. Changes take effect on the next generator turn since the catalog context formatter re-reads the collection each step.

This is the main operational reason skills exist as Markdown resources rather than imports: you can adjust how the agent handles a class of requests without shipping code.
