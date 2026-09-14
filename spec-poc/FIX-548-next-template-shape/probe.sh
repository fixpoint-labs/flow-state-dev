#!/usr/bin/env bash
# Reproduces every row of README.md's table. Needs network. ~3 minutes.
#
#   bash probe.sh [workdir]
#
# Scaffolds a real create-next-app@16.3.1 project, then for each candidate shape
# of the FSD config runs `next build` (the bundler + TypeScript half) and a native
# `import()` (the fsdev CLI half). Ends by serving the shape the spec specifies —
# both route files, with the canonical route exports — and asserting the mounted
# route returns this run's config module.
#
# EXIT STATUS IS THE EVIDENCE. Every check below feeds it:
#   0  every variant matched its expected outcome AND the served-route and
#      AGENTS.md assertions held
#   1  at least one check disagreed with what the README claims
#   2  the run could not be completed (scaffold/install failed, no free port,
#      workdir occupied, dev server never bound)
# The 1/2 split is load-bearing, not cosmetic: a slow machine on which `next dev`
# has not bound yet must never be reported as a disproved claim.
# Each variant declares the outcome README.md claims for it, and a variant that
# behaves differently fails the probe — including the two that are EXPECTED to
# fail to build. "The build broke" is not automatically a probe failure here;
# "the build did something other than what we documented" is.
set -u

RC=0
fail() { echo "  MISMATCH — $1"; RC=1; }

WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK" || exit 2
APP="$WORK/probe"
# Never delete a directory the caller may care about. The argument is a workdir,
# not a scratch space we own, and `rm -rf` on it was a data-loss hazard.
if [ -e "$APP" ]; then
  echo "refusing to run: $APP already exists — remove it or pass a different workdir" >&2
  exit 2
fi
echo "workdir: $WORK"

# Exact, not @16 — a range would re-resolve and this script is cited as evidence,
# so a reader running it later must get the version the findings were measured on.
npx --yes create-next-app@16.3.1 "$APP" \
  --ts --app --no-tailwind --no-eslint --no-biome --no-src-dir \
  --no-react-compiler --no-rspack --import-alias "@/*" \
  --agents-md --skip-install --disable-git || exit 2

cd "$APP" || exit 2

echo "=== what create-next-app wrote (findings 1-4) ==="
ls -a | tr '\n' ' '; echo
echo "manifest type field: $(node -p "require('./package.json').type ?? '(absent)'")"
echo "tsconfig include:    $(node -p "JSON.stringify(require('./tsconfig.json').include)")"

# ASSERTED, NOT PRINTED — and asserted HERE, before this script writes anything.
# The greenfield-appends design rests on AGENTS.md existing in the scaffold output,
# and this check is self-concealing if it runs later: the append near the end
# recreates AGENTS.md itself. A probe that checked at the end would go green
# exactly when the pinned scaffolder had stopped writing these files.
#
# Note what this does and does not establish. The invocation above passes
# --agents-md explicitly (as the spec requires of every flag), so these assertions
# guard "create-next-app still writes AGENTS.md WHEN ASKED" — which is what the
# design depends on. They say nothing about the flag's default, and the README
# does not claim they do.
[ -f AGENTS.md ] \
  && echo "  AGENTS.md: present" \
  || fail "create-next-app no longer writes AGENTS.md — the spec's append-not-create premise is dead"
grep -q 'BEGIN:nextjs-agent-rules' AGENTS.md 2>/dev/null \
  && echo "  AGENTS.md: carries next's own delimited block" \
  || fail "AGENTS.md has no nextjs-agent-rules block — the append target is not what the spec describes"
[ -f CLAUDE.md ] \
  && echo "  CLAUDE.md: present" \
  || fail "create-next-app no longer writes CLAUDE.md — README finding 2 is stale"
# Ask git, not the text. A `grep '^\.env'` passes on a .gitignore that only lists
# `.env.example`, which does NOT ignore .env.local — so the credential stop
# (spec decision 7) could rest on a premise the probe reported as true. The
# scaffold runs with --disable-git, so init a throwaway repo just to evaluate the
# rules. check-ignore works on a path that does not exist yet, which is the state
# the real command is in when it decides whether it may write the key.
# If git itself is unavailable or init fails, this claim CANNOT BE TESTED — it is
# not disproved. Without this guard the check-ignore below falls through to
# `fail`, reporting exit 1 (claim disproved) for a true claim, which is the one
# direction of wrongness that trains a reader to ignore a red result.
git init -q . 2>/dev/null || { echo "  git init failed — .gitignore claim CANNOT VERIFY"; exit 2; }
if git check-ignore -q .env.local; then
  echo "  .gitignore: git would ignore .env.local ($(git check-ignore -v .env.local | awk '{print $1":"$2}'))"
else
  fail "git would NOT ignore .env.local in a fresh scaffold — spec decision 7 loses its host-supplied entry"
fi

# The route shape the spec specifies: a catch-all plus a sibling bare route, both
# carrying the canonical exports from packages/next/README.md. An earlier version
# of this probe exercised only a hand-made bare route, so its green said nothing
# about the shape the spec actually asks for.
mkdir -p lib "app/api/flows/[...path]"
cat > "app/api/flows/[...path]/route.ts" <<'EOF'
import { flowstate } from "@/lib/flowstate";

// Stands in for `export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate)`.
// The adapter is not installed here (no FSD deps in this probe), but the exports
// beside it are the specified shape and are what this file exists to exercise.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const router = await flowstate.getRouter();
  return new Response(`${flowstate.marker}:catchall:${path.join("/")}:${(await router.GET()).status}`);
}
EOF
cat > app/api/flows/route.ts <<'EOF'
import { flowstate } from "@/lib/flowstate";

// The sibling bare route: a required catch-all cannot match zero segments.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const router = await flowstate.getRouter();
  return new Response(`${flowstate.marker}:${(await router.GET()).status}`);
}
EOF

# Stands in for createFlowState({ flows, stores }). The question under test is
# module resolution and parsing, not FSD behaviour, so it has no FSD imports.
CONFIG_BODY='const flowstate = {
  marker: "config-module-loaded",
  async getRouter() {
    return { GET: () => new Response("ok") };
  },
};
export default flowstate;'

npm install --no-audit --no-fund || exit 2

set_tsconfig_flag() { # $1 = true|false
  node -e "const f='tsconfig.json',fs=require('fs');const j=JSON.parse(fs.readFileSync(f,'utf8'));
  if ('$1'==='true') j.compilerOptions.allowImportingTsExtensions=true; else delete j.compilerOptions.allowImportingTsExtensions;
  fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
}
set_pkg_type() { # $1 = module|none
  node -e "const f='package.json',fs=require('fs');const j=JSON.parse(fs.readFileSync(f,'utf8'));
  if ('$1'==='module') j.type='module'; else delete j.type;
  fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
}

# $1 label · $2 config filename · $3 import specifier
# $4 expected build: pass|fail · $5 expected import: clean|warn
# $6 grep -E pattern that MUST appear in build.log for this variant
#
# $6 is what makes a `fail` row mean something. Without it any nonzero exit —
# a typo in the shared route files, a dependency failure, a future Next
# regression — reads as "matched the documented result", and the probe could go
# green without ever reproducing TS5097 or the module-resolution behaviour that
# is the entire justification for decision 4. Pass rows assert the route
# compiled, not merely that the process exited 0.
variant() {
  local label="$1" cfg="$2" spec="$3" want_build="$4" want_import="$5" want_diag="$6"
  rm -f fsdev.config.ts fsdev.config.mts
  printf '%s\n' "$CONFIG_BODY" > "$cfg"
  printf 'export { default as flowstate } from "%s";\n' "$spec" > lib/flowstate.ts
  echo
  echo "=== variant: $label ==="

  # Status via a temp file, not a pipeline — a pipe would report grep's status.
  npx next build > build.log 2>&1
  local build_status=$?
  grep -E "error TS|Module not found|Failed to|Compiled successfully|Route \(app\)|/api/flows" build.log | head -4 | sed 's/^/  /'
  local got_build; [ $build_status -eq 0 ] && got_build=pass || got_build=fail
  echo "  build: $got_build (expected $want_build)"
  [ "$got_build" = "$want_build" ] || fail "$label: build $got_build, README claims $want_build"

  if grep -qE "$want_diag" build.log; then
    echo "  diagnostic: matched /$want_diag/"
  else
    fail "$label: build was '$got_build' but /$want_diag/ never appeared — the documented cause is unproven"
  fi

  # A rejected import must fail the probe; an expected warning must be present.
  # Set exitCode and return — never process.exit() here. Node emits
  # MODULE_TYPELESS_PACKAGE_JSON asynchronously, and an immediate exit() cuts it
  # off before it reaches stderr, which made this probe report "clean" for the
  # variant whose whole point is that it warns.
  # Node's warning suppression is inherited from the environment, and this check
  # reads stderr to decide whether a documented warning appeared. With
  # NODE_NO_WARNINGS=1 or --no-warnings in NODE_OPTIONS, the no-`type`-field
  # variant emits nothing, classifies as `clean`, and the probe reports a TRUE
  # claim about Node as DISPROVED — the same false-disproof direction as the
  # `git init` case, from a different cause. Cleared for this invocation only.
  NODE_NO_WARNINGS= NODE_OPTIONS= \
  node -e "import('./$cfg').then(m=>{
      if(m.default.marker!=='config-module-loaded'){console.error('WRONG MODULE');process.exitCode=3}
    }).catch(e=>{console.error('IMPORT THREW: '+e.message);process.exitCode=3})" > import.log 2>&1
  local import_status=$?
  local got_import
  # `clean` means NOTHING on stdout or stderr — not merely "no MODULE_TYPELESS".
  # Testing only for the one warning we expect classifies any NEW diagnostic (a
  # future loader or deprecation warning) as clean, so the probe would exit 0
  # while the README says "clean, no warning". Measured: a healthy run of this
  # import writes 0 bytes, so empty is the honest bar. Anything else is `noisy`,
  # which matches no documented row and therefore fails.
  if [ $import_status -ne 0 ]; then
    got_import=error
  elif [ ! -s import.log ]; then
    got_import=clean
  elif grep -q MODULE_TYPELESS_PACKAGE_JSON import.log; then
    got_import=warn
  else
    got_import=noisy
  fi
  echo "  native import: $got_import (expected $want_import)"
  if [ "$got_import" != "$want_import" ]; then
    fail "$label: import $got_import, README claims $want_import"
    sed 's/^/      /' import.log
  fi
}

set_pkg_type none
set_tsconfig_flag false
variant ".mts, explicit .mts extension"      fsdev.config.mts "../fsdev.config.mts" fail clean \
        "error TS5097"
variant ".mts, extensionless import"         fsdev.config.mts "../fsdev.config"     fail clean \
        "Module not found.*fsdev\.config"
set_tsconfig_flag true
variant ".mts + allowImportingTsExtensions"  fsdev.config.mts "../fsdev.config.mts" pass clean \
        "/api/flows"
set_tsconfig_flag false
variant ".ts, no type field"                 fsdev.config.ts  "../fsdev.config"     pass warn \
        "/api/flows"
set_pkg_type module
variant ".ts + type:module   <-- CHOSEN"     fsdev.config.ts  "../fsdev.config"     pass clean \
        "/api/flows"

echo
echo "=== chosen shape, served for real ==="
# A unique marker per run, on a port proven free first. Without both, this check
# can pass by reaching a stale dev server left over from an earlier run — a green
# result from a neighbour of the claim, which is the failure it exists to catch.
MARKER="served-$$-$(date +%s)"
sed -i "s/config-module-loaded/$MARKER/" fsdev.config.ts
PORT=0
for p in $(seq 3990 3999); do
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then PORT=$p; break; fi
done
if [ "$PORT" = 0 ]; then echo "  no free port in 3990-3999 — CANNOT VERIFY"; exit 2; fi
echo "  port $PORT (verified free)"

printf '\n<!-- BEGIN:fsd -->\nFSD SECTION SENTINEL\n<!-- END:fsd -->\n' >> AGENTS.md

# Both AGENTS.md sections, captured COMPLETE and before the server starts, so the
# survival check below can compare rather than count. See the check itself.
FSD_B='<!-- BEGIN:fsd -->';                  FSD_E='<!-- END:fsd -->'
NXT_B='<!-- BEGIN:nextjs-agent-rules -->';   NXT_E='<!-- END:nextjs-agent-rules -->'
section() { # $1 file · $2 begin marker · $3 end marker -> the whole block, inclusive
  awk -v b="$2" -v e="$3" 'index($0,b){inside=1} inside{print; if(index($0,e)) exit}' "$1"
}
FSD_BEFORE=$(section AGENTS.md "$FSD_B" "$FSD_E")
NXT_BEFORE=$(section AGENTS.md "$NXT_B" "$NXT_E")
# A section that is already malformed cannot speak to survival either way. That is
# "could not verify" (2), never "the claim is false" (1).
case "$FSD_BEFORE" in *"$FSD_E"*) ;; *) echo "  FSD section malformed before next dev — CANNOT VERIFY"; exit 2;; esac
case "$NXT_BEFORE" in *"$NXT_E"*) ;; *) echo "  next's block malformed before next dev — CANNOT VERIFY"; exit 2;; esac

npx next dev --port "$PORT" > dev.log 2>&1 &
DEV_PID=$!

# Poll for the bind against a bounded deadline; do NOT sleep a fixed interval.
# A cold or loaded machine can take far longer than any constant to bind, and the
# request then gets connection-refused — which a fixed sleep reports as a FAILED
# ROUTE CLAIM (1) when the claim is fine and the machine was just slow. Startup
# that never completes is "could not verify" (2). Readiness is the TCP bind, not a
# 200 from the route: a route that answers wrongly must still fail as 1, so it is
# asserted separately below.
READY=0
DEADLINE=$((SECONDS + 180))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "  next dev exited before binding port $PORT — CANNOT VERIFY"; tail -20 dev.log | sed 's/^/    /'; exit 2
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != 1 ]; then
  echo "  next dev did not bind port $PORT within 180s — CANNOT VERIFY"; tail -20 dev.log | sed 's/^/    /'
  kill "$DEV_PID" 2>/dev/null; wait "$DEV_PID" 2>/dev/null; exit 2
fi
echo "  next dev bound port $PORT after ${SECONDS}s"

# Generous per-request timeout: the bind precedes compilation, and the FIRST
# request is what triggers Turbopack to compile the route.
#
# CHECK CURL'S STATUS BEFORE COMPARING THE BODY. Polling the bind fixed only half
# of this: a first compile that outruns the timeout, or a connection that drops
# after the bind, leaves an empty or partial body, and comparing that to the marker
# records a TRANSPORT failure as a DISPROVED CLAIM (1) when it is an incomplete
# probe (2). Both requests go through here so the two paths cannot drift apart.
#
# Assigns to a global instead of echoing into $( ) on purpose: command substitution
# runs in a subshell, so an `exit 2` inside one would end only that subshell and
# the caller would carry on with an empty body — reintroducing the exact
# misclassification this exists to prevent.
REQ_BODY=""
request() { # $1 = path · $2 = label
  local rc
  REQ_BODY=$(curl -sS --max-time 120 --noproxy '*' "http://127.0.0.1:$PORT$1" 2>curl.err)
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "  GET $1 -> curl exit $rc — CANNOT VERIFY ($2 is untested, not disproved)"
    sed 's/^/    /' curl.err
    tail -20 dev.log | sed 's/^/    /'
    kill "$DEV_PID" 2>/dev/null; wait "$DEV_PID" 2>/dev/null
    exit 2
  fi
}

request /api/flows "the bare route"
echo "  GET /api/flows          -> $REQ_BODY"
[ "$REQ_BODY" = "$MARKER:200" ] || fail "bare route: expected $MARKER:200"

request /api/flows/sessions/abc "the catch-all route"
echo "  GET /api/flows/sessions/abc -> $REQ_BODY"
[ "$REQ_BODY" = "$MARKER:catchall:sessions/abc:200" ] || fail "catch-all route: expected $MARKER:catchall:sessions/abc:200"

# SURVIVAL, not restoration. Next's block was already present before the server
# started, so this proves it was left alone — it does not prove `next dev` would
# re-create a missing block, and the README does not claim it does. Restoration is
# irrelevant to the design: what matters is that our appended section is still
# there afterwards.
#
# COMPARE THE WHOLE SECTION, do not count markers. The previous version counted one
# sentinel line and one opening delimiter, which still passes if `next dev` truncates
# our section after its sentinel, drops the closing delimiter, or rewrites next's
# block while keeping its BEGIN line — all while the README claims both sections are
# intact. Byte equality of the complete block is the claim. The occurrence counts are
# kept alongside it because equality alone cannot see a duplicate: the extraction
# stops at the first END, so a second appended copy would compare equal.
FSD_AFTER=$(section AGENTS.md "$FSD_B" "$FSD_E")
NXT_AFTER=$(section AGENTS.md "$NXT_B" "$NXT_E")
FSD_N=$(grep -c 'BEGIN:fsd' AGENTS.md)
NEXT_N=$(grep -c 'BEGIN:nextjs-agent-rules' AGENTS.md)
echo "  our appended FSD section: $([ "$FSD_AFTER" = "$FSD_BEFORE" ] && echo 'byte-identical' || echo 'CHANGED'), $FSD_N copy/copies (expect 1)"
echo "  next's own block:         $([ "$NXT_AFTER" = "$NXT_BEFORE" ] && echo 'byte-identical' || echo 'CHANGED'), $NEXT_N copy/copies (expect 1)"
[ "$FSD_AFTER" = "$FSD_BEFORE" ] || fail "our appended FSD section did not survive next dev intact"
[ "$NXT_AFTER" = "$NXT_BEFORE" ] || fail "next's own block was altered by next dev"
[ "$FSD_N" = 1 ] || fail "our appended FSD section was duplicated by next dev ($FSD_N copies)"
[ "$NEXT_N" = 1 ] || fail "next's own block was duplicated by next dev ($NEXT_N copies)"

kill "$DEV_PID" 2>/dev/null; wait "$DEV_PID" 2>/dev/null

echo
[ "$RC" = 0 ] && echo "probe: PASS" || echo "probe: FAIL"
exit "$RC"
