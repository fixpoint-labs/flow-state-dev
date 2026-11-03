#!/usr/bin/env bash
# FIX-2421 POC (throwaway, not production code). Question: can a Claude Code run load a
# repository's CLAUDE.md and skills while the repository's hooks stay off?
#
# Each arm makes a fresh git repo holding a CLAUDE.md with a code word, one project skill,
# and a project hook that touches a marker file, then asks the real `claude` CLI two
# questions. The Agent SDK passes `settingSources` as `--setting-sources` and `settings` as
# `--settings`, so these flags are what a block's options reach.
#
# Needs a signed-in `claude` on PATH. Costs ten short model calls.
#   bash specs/issues/FIX-2421/poc/project-settings-hooks/run.sh
set -u
arm() { # name, extra flags...
  local name=$1; shift
  local dir; dir=$(mktemp -d); cd "$dir" || exit 1; git init -q .
  printf 'The code word for this repository is PERIWINKLE-42. When asked for the code word, answer with it exactly.\n' > CLAUDE.md
  mkdir -p .claude/skills/zebra-check
  printf -- '---\nname: zebra-check\ndescription: Checks zebras. Use when asked about zebras.\n---\nSay ZEBRA.\n' > .claude/skills/zebra-check/SKILL.md
  cat > .claude/settings.json <<JSON
{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"touch $dir/HOOK_RAN"}]}]}}
JSON
  # No tools for the code word, so the answer can only come from loaded instructions, not a Read.
  local word; word=$(claude -p "Without using any tool, what is the code word for this repository? Reply with only the code word, or NONE." --tools "" "$@" 2>&1 | tail -1)
  local skill; skill=$(claude -p "Without using any tool: is a skill named zebra-check listed as available to you? Reply YES or NO only." --tools "Skill" "$@" 2>&1 | tail -1)
  local hook=no; [ -e "$dir/HOOK_RAN" ] && hook=yes
  echo "$name | code word=$word | skill=$skill | hook ran=$hook"
  cd / && rm -rf "$dir"
}
arm "settingSources []  (Kitchen Sink today)"          --setting-sources ""
arm "settingSources [project]  (the issue's sketch)"    --setting-sources project
arm "[project] + disableAllHooks  (D1)"                 --setting-sources project --settings '{"disableAllHooks":true}'
arm "[project] + disableAllHooks + plain systemPrompt"  --setting-sources project --settings '{"disableAllHooks":true}' --system-prompt "You are a coding agent. Do what you are asked."
arm "option unset + plain systemPrompt  (Shift Manager today)" --system-prompt "You are a coding agent. Do what you are asked."
