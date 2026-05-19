---
sidebar_position: 3
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

Files inside the folder are bundled with the skill when it's seeded into the resource collection. They're addressable from the body via the `${SKILL_DIR}` substitution (see below), so your body can say "open `${SKILL_DIR}/reference/rubric.md`" and the agent knows where to find it.

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
| `description` | yes | string (≤ 1024 chars) | What the up-front classifier and the `runSkill` catalog listing both see. The trigger for both activation paths — write it well. |
| `keywords` | no | string[] | Lowercased tokens for the up-front router's tier-2 keyword scan. Plain substring matches against the user message. Ignored on the `runSkill` path. See below. |
| `context` | no | `inline` \| `fork` | Activation mode. Default `inline`. |
| `allowed-tools` | no | string[] | Catalog keys the skill can invoke in fork mode. Ignored in inline mode (tools come from the parent). |
| `when-to-use` | no | string | Extra guidance appended to the description for the classifier and the `runSkill` catalog. Keep it short. |
| `disable-model-invocation` | no | boolean | When `true`, the skill stays in the collection but every activation path skips it (no slash, no keyword match, hidden from the classifier and the `runSkill` catalog). Useful for drafts or admin-only skills. |

Unknown frontmatter keys are preserved but not interpreted. The parser validates the shape up front — a malformed skill won't poison the seeding pass.

### Writing good descriptions

The description is the only thing the model sees in the catalog. It decides whether to invoke `runSkill` based entirely on that string. Two guidelines:

- **Name the trigger, not the implementation.** "Use when the user asks about competitors" is better than "Runs a competitor analysis workflow".
- **Front-load the match phrase.** The model scans descriptions quickly. Putting the matching intent in the first clause beats burying it.

A description that never triggers is a skill that never runs. A description that triggers on every question is a skill that pollutes every turn. Write carefully, then check the DevTool's tool-calls panel to see whether the model is activating as intended.

### Writing keywords

`keywords` is consumed by `createSkillActivator`'s tier-2 scan (see [Activation paths](./activation)). The scan lowercases the user message and matches each keyword as a plain substring. A match activates the skill without an LLM call.

```yaml
---
description: Answer questions about current events…
keywords: [news, latest, breaking, today, current, happening, recent]
---
```

Two guidelines:

- **Pick high-precision tokens.** Each keyword is a substring match — `news` matches `newscast`, `news anchor`, but also `newsletter`. Words that read as the trigger phrase in normal speech are usually fine; jargon and unusual punctuation are not.
- **Keep the list short.** Five to ten tokens covers the obvious matches. Anything subtler should fall through to the classifier — that's what it's for.

Skipping `keywords` is fine. The classifier still picks up the skill from its description; you just pay the LLM call when nothing else matched. Adding them is a cost optimization on common phrasings, not a correctness requirement.

## Body

The body is plain Markdown. It becomes either the substituted system prompt (fork mode) or is spliced into the parent generator's system prompt after the skill is activated (inline mode).

Treat the body as an imperative playbook, not a conversation. Short sections. Bullet lists for enforceable rules. Headings the model can refer back to. Avoid qualifiers like "you might consider" — the skill exists because the author has an opinion.

## Substitution

Two variables are substituted into the body at runtime:

- `$ARGUMENTS` — the `input` string passed to `runSkill`, if any. Lets the model pass a topic or target through to the playbook.
- `${SKILL_DIR}` — the filesystem path where the skill's bundled files live when the bash capability is mounted. Derived from the skills collection's pattern prefix: for the default `skills/**` collection, it resolves to `/workspace/skills/<skill-name>/`. If you configure a custom collection prefix (`collectionConfig: { prefix: "playbooks" }`), the path follows automatically.

Both substitutions run on the body after frontmatter is stripped. If a variable isn't used, nothing changes.

`${CLAUDE_SKILL_DIR}` is preserved as an alias for `${SKILL_DIR}`. It exists so skill folders authored against [Claude Code's skill format](https://docs.claude.com/en/docs/claude-code/skills) drop in here without edits — the two systems share the same SKILL.md shape and the same substitution token under a different name. New skills should use `${SKILL_DIR}`; the alias is documented for the import case.

Example:

```markdown
---
description: Research a topic using the method in reference/method.md
---

# Research

The user asked about: $ARGUMENTS

Open ${SKILL_DIR}/reference/method.md for the step-by-step process,
then follow it exactly.
```

Called via `runSkill({ name: "research", input: "quantum computing" })`, the body renders with `$ARGUMENTS` replaced by `"quantum computing"` and `${SKILL_DIR}` replaced by `/workspace/skills/research`.

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
- `${SKILL_DIR}/reference/dimensions.md` — the evaluation axes
- `${SKILL_DIR}/reference/scoring-rubric.md` — how to rate each axis

Follow the sections in order.
```

For the agent to actually open these files, bash has to be on the generator. The bash capability auto-discovers every collection on the block's resource context — when skills is installed, it gets mounted at `/workspace/skills/` with no extra configuration:

```ts
import { createBashCapability } from "@flow-state-dev/tools/bash";

const bashCap = createBashCapability({
  provider: { type: "local" },
});
```

With bash on, `${SKILL_DIR}` resolves to `/workspace/skills/<skill-name>/` and reference files are reachable via `cat`, `python3`, or any other bash-side tool. Writes to files in the skills mount flush back to the skills collection — which means the agent CAN edit skills mid-run if you want that. To disable, mount it read-only:

```ts
createBashCapability({
  provider: { type: "local" },
  collections: [{ key: "skills", writable: false }],
});
```

Without bash, reference files still exist as resources but the agent needs a different way to read them (e.g. a `readArtifact`-style tool that takes resource keys directly).

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

python3 ${SKILL_DIR}/scripts/date-window.py recent

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

Skills live in a resource collection at the scope you chose (`org`, `user`, or `session`). Once seeded, they're editable via any surface that can write to resources — the DevTool, a custom admin UI, or a CLI command. Changes take effect on the next generator turn since the catalog context formatter re-reads the collection each step.

This is the main operational reason skills exist as Markdown resources rather than imports: you can adjust how the agent handles a class of requests without shipping code.
