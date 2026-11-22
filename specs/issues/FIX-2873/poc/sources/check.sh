#!/usr/bin/env bash
# FIX-2873 spec evidence: every place that decides whose GitHub comments a coding run trusts.
#
# Throwaway, retained with the spec. Not production code and not run by any suite.
#
#   bash specs/issues/FIX-2873/poc/sources/check.sh [--after] [--control] [ROOT]
#
# Totality: every non-test source file under packages/ and labs/ that mentions a reviewer
# term is classified below, by path. A file nobody classified fails the run, so a fourth
# source can't hide. Today it expects three sources and two copies of the operator helpers;
# --after expects the one source in workforce. --control plants an unclassified env read in
# labs/ and must FAIL.
set -uo pipefail
MODE=today CONTROL=0 ROOT=.
for a in "$@"; do case "$a" in --after) MODE=after ;; --control) CONTROL=1 ;; *) ROOT=$a ;; esac; done
cd "$ROOT"

TERMS='GITHUB_REVIEWERS|githubTrustedReviewersScreen|reviewedPullRequestFollow|githubReviewers\(|function operatorGitHub|github-reviewers'
PLANT=labs/_fix2873_control.mts
if [ "$CONTROL" = 1 ]; then echo 'export const r = process.env.ACME_GITHUB_REVIEWERS;' > "$PLANT"; trap 'rm -f "$PLANT"' EXIT; fi

files=$(grep -rlE "$TERMS" packages labs --include=*.ts --include=*.mts --include=*.tsx --include=*.md 2>/dev/null \
  | grep -vE '/(node_modules|dist|test|tests)/|\.test\.|\.spec\.|CHANGELOG|README' || true)
folder=$(find packages labs -name github-reviewers.md -not -path '*/node_modules/*' 2>/dev/null || true)

fail=0
# What each classified file is. `source:` lines are counted; `uses:` lines only read the one source.
classify() {
  case "$1" in
    packages/workforce/src/service-flows/github/trusted-reviewers.ts) echo "source: workforce screen + stored list" ;;
    packages/workforce/src/service-flows/github/operator.ts) echo "copy: operatorGitHub, operatorGitHubToken (workforce)" ;;
    packages/workforce/src/service-flows/github/follow-pull-request.ts) echo "source: allow-list follow (reviewedPullRequestFollow)" ;;
    packages/workforce/src/service-flows/index.ts|packages/workforce/src/index.ts|packages/workforce/src/server.ts) echo "uses: re-export" ;;
    packages/shift-manager/teams/devteam/host.mts) echo "source: stored list, its flow, tool and screen (Shift Manager) + copy: operator helpers" ;;
    packages/shift-manager/teams/devteam/workforce/org/resources/github-reviewers.md) echo "source: folder file seed" ;;
    packages/shift-manager/teams/devteam/workforce/org/workers/*/WORKER.md) echo "uses: worker guidance" ;;
    packages/shift-manager/teams/devteam/*fsdev.config.mts) echo "uses: token helper" ;;
    labs/teammates/fsdev.config.mts) echo "source: TEAMMATES_GITHUB_REVIEWERS env var" ;;
    labs/teammates/host.mts) echo "uses: follow wiring" ;;
    *) echo "UNCLASSIFIED" ;;
  esac
}
for f in $files $folder; do c=$(classify "$f"); echo "$f -> $c"; [ "$c" = UNCLASSIFIED ] && fail=1; done | sort -u
for f in $files $folder; do [ "$(classify "$f")" = UNCLASSIFIED ] && fail=1; done

env_reads=$(grep -rhoE 'process\.env\.[A-Z_]*GITHUB_REVIEWERS' packages labs --include=*.ts --include=*.mts 2>/dev/null | grep -v node_modules | sort -u | wc -l)
copies=$(grep -rlE 'export function operatorGitHubToken' packages labs --include=*.ts --include=*.mts 2>/dev/null | grep -vE 'node_modules|/dist/' | wc -l)
deciders=$(grep -rlE 'githubTrustedReviewersScreen\(|reviewedPullRequestFollow\(' packages labs --include=*.ts --include=*.mts 2>/dev/null \
  | grep -vE 'node_modules|/dist/|/test/|\.test\.' | grep -v 'packages/workforce/src/service-flows/github/' | wc -l)
nfolder=$(echo -n "$folder" | grep -c . || true)
echo "env reads of *GITHUB_REVIEWERS: $env_reads · folder seed files: $nfolder · operatorGitHubToken definitions: $copies · app-side screen builders: $deciders"

if [ "$MODE" = today ]; then want="1 1 2 2"; else want="0 0 1 0"; fi
# After: the one env read lives in workforce, so no `process.env.*GITHUB_REVIEWERS` in an app; workforce reads env by name.
got="$env_reads $nfolder $copies $deciders"
[ "$MODE" = after ] && got="$(grep -rhoE 'process\.env\.[A-Z_]*GITHUB_REVIEWERS' labs packages/shift-manager --include=*.ts --include=*.mts 2>/dev/null | grep -v node_modules | sort -u | wc -l) $nfolder $copies $deciders"
[ "$got" = "$want" ] || { echo "counts $got, want $want ($MODE)"; fail=1; }
[ "$fail" = 0 ] && echo "PASS ($MODE)" || { echo "FAIL ($MODE)"; exit 1; }
