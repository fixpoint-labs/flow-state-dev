#!/usr/bin/env bash
# POC, throwaway: the rule lands before the sweep, held by ESLint's bulk
# suppressions. Passes only if (1) today's tree is green once suppressed,
# (2) a new JSDoc id in an already-suppressed file still fails, and
# (3) a pruned suppression file shrinks as the sweep fixes sites.
#   bash specs/issues/FIX-2453/poc/rule/ratchet.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
here=specs/issues/FIX-2453/poc/rule
cfg=$here/eslint.ratchet.config.mjs
sup=$(mktemp -d)/eslint-suppressions.json
target=packages/engine/src/context/createExecutionContext.ts
lint() { npx eslint --no-cache -c "$cfg" --suppressions-location "$sup" "$@" packages/engine/src packages/orchestration/src >/dev/null 2>&1; }

lint --suppress-rule fsd/no-tracker-ids || true
echo "suppressed sites: $(node -e "const s=require('$sup');let n=0;for(const f in s)n+=s[f]['fsd/no-tracker-ids']?.count??0;console.log(n)")"
if lint; then echo "1 PASS: today's tree is green under the suppressions"; else echo "1 FAIL"; exit 1; fi

cp "$target" "$sup.bak"
trap 'cp "$sup.bak" "$target"' EXIT
printf '\n/** Added by a sibling (FIX-9999). */\nexport const planted = 1;\n' >> "$target"
if lint; then echo "2 FAIL: a new id in a suppressed file passed"; exit 1; else echo "2 PASS: a new id in a suppressed file fails"; fi
cp "$sup.bak" "$target"

sed -i 's/ (FIX-735)\./\./' "$target"
before=$(node -e "console.log(require('$sup')['$target']['fsd/no-tracker-ids'].count)")
lint --prune-suppressions || true
after=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$sup','utf8'))['$target']['fsd/no-tracker-ids'].count)")
echo "3 $([ "$after" -lt "$before" ] && echo PASS || echo FAIL): fixing one site and pruning moves the count $before -> $after"
