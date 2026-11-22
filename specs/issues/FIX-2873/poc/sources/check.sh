#!/usr/bin/env bash
# FIX-2873 spec evidence: every place that decides whose GitHub comments a coding run acts on.
#
# Throwaway, retained with the spec. Not production code and not run by any suite.
#
#   bash specs/issues/FIX-2873/poc/sources/check.sh [--after] [--control] [ROOT]
#
# Totality: every non-test source file under packages/ and labs/ that mentions a reviewer
# term is classified below, by path. A file nobody classified fails the run, so a fourth
# source can't hide. --control plants an unclassified env read in labs/ and must FAIL.
#
# The seven counters, in the order the echo line and the want strings use:
#   1 app_env_reads       `process.env.*GITHUB_REVIEWERS` read by an app (labs/, shift-manager)
#   2 folder_seeds        github-reviewers.md files that seed a list
#   3 token_helper_defs   definitions of `operatorGitHubToken`
#   4 app_screen_builders app-side calls that build a reviewer screen or allow-list follow
#   5 public_save_actions `setGitHubReviewers` registered as a public (HTTP) action
#   6 app_static_bots     an app passing `trustedBots` a fixed list
#   7 list_fed_trusted_bots  the stored list fed into the service-wide `trustedBots` (must stay 0:
#                         it would admit a listed bot on every subscription; bots are admitted per follow)
# Today: 1 1 2 2 1 1 0. After FIX-2873: 0 0 1 0 0 0 0.
set -uo pipefail
MODE=today CONTROL=0 ROOT=.
for a in "$@"; do case "$a" in --after) MODE=after ;; --control) CONTROL=1 ;; *) ROOT=$a ;; esac; done
cd "$ROOT"

TERMS='GITHUB_REVIEWERS|githubTrustedReviewersScreen|reviewedPullRequestFollow|githubReviewers\(|function operatorGitHub|github-reviewers|setGitHubReviewers'
PLANT=labs/_fix2873_control.mts
if [ "$CONTROL" = 1 ]; then echo 'export const r = process.env.ACME_GITHUB_REVIEWERS;' > "$PLANT"; trap 'rm -f "$PLANT"' EXIT; fi

src() { grep -rlE "$1" packages labs --include=*.ts --include=*.mts --include=*.tsx 2>/dev/null | grep -vE '/(node_modules|dist|test|tests)/|\.test\.|\.spec\.'; }
files=$(grep -rlE "$TERMS" packages labs --include=*.ts --include=*.mts --include=*.tsx --include=*.md 2>/dev/null \
  | grep -vE '/(node_modules|dist|test|tests)/|\.test\.|\.spec\.|CHANGELOG|README' || true)
folder=$(find packages labs -name github-reviewers.md -not -path '*/node_modules/*' 2>/dev/null || true)

fail=0
classify() {
  case "$1" in
    packages/workforce/src/service-flows/github/*.ts) echo "workforce: the one source, its screen, follow and operator helpers" ;;
    packages/workforce/src/service-flows/index.ts|packages/workforce/src/index.ts|packages/workforce/src/server.ts) echo "uses: re-export" ;;
    packages/shift-manager/teams/devteam/host.mts) echo "Shift Manager host: today its own list, flow, tool, screen and helper copies" ;;
    packages/shift-manager/teams/devteam/workforce/org/resources/github-reviewers.md) echo "source: folder file seed" ;;
    packages/shift-manager/teams/devteam/workforce/org/workers/*/WORKER.md) echo "uses: worker guidance" ;;
    labs/teammates/workforce/*/WORKER.md|labs/teammates/workforce/*/*/WORKER.md|labs/teammates/workforce/*/*/*/WORKER.md) echo "uses: worker guidance" ;;
    packages/shift-manager/teams/devteam/*fsdev.config.mts) echo "uses: token helper" ;;
    labs/teammates/fsdev.config.mts) echo "Teammates config: today TEAMMATES_GITHUB_REVIEWERS" ;;
    labs/teammates/host.mts) echo "uses: follow wiring" ;;
    *) echo "UNCLASSIFIED" ;;
  esac
}
for f in $files $folder; do echo "$f -> $(classify "$f")"; done | sort -u
for f in $files $folder; do [ "$(classify "$f")" = UNCLASSIFIED ] && fail=1; done

app_env_reads=$(grep -rhoE 'process\.env\.[A-Z_]*GITHUB_REVIEWERS' labs packages/shift-manager --include=*.ts --include=*.mts 2>/dev/null | sort -u | wc -l)
folder_seeds=$(echo -n "$folder" | grep -c . || true)
token_helper_defs=$(src 'export function operatorGitHubToken' | wc -l)
app_screen_builders=$(src 'githubTrustedReviewersScreen\(|reviewedPullRequestFollow\(' | grep -v 'packages/workforce/src/service-flows/github/' | wc -l)
public_save_actions=$(src 'actions: \{ *setGitHubReviewers' | wc -l)
app_static_bots=$(grep -rlE 'trustedBots: *(\[|options\.)' labs packages/shift-manager --include=*.ts --include=*.mts 2>/dev/null | grep -vE '/(node_modules|test)/|\.test\.' | wc -l)
list_fed_trusted_bots=$(src 'trustedBots: *(reviewers|[a-zA-Z]*[Rr]eviewers)\.' | wc -l)
got="$app_env_reads $folder_seeds $token_helper_defs $app_screen_builders $public_save_actions $app_static_bots $list_fed_trusted_bots"
echo "app_env_reads=$app_env_reads folder_seeds=$folder_seeds token_helper_defs=$token_helper_defs app_screen_builders=$app_screen_builders public_save_actions=$public_save_actions app_static_bots=$app_static_bots list_fed_trusted_bots=$list_fed_trusted_bots"

if [ "$MODE" = today ]; then want="1 1 2 2 1 1 0"; else want="0 0 1 0 0 0 0"; fi
[ "$got" = "$want" ] || { echo "counts $got, want $want ($MODE)"; fail=1; }
[ "$fail" = 0 ] && echo "PASS ($MODE)" || { echo "FAIL ($MODE)"; exit 1; }
