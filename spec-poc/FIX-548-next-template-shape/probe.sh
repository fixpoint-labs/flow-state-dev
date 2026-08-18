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
#   2  the run could not be completed (scaffold/install failed, no free port)
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
rm -rf "$APP"
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
echo "AGENTS.md delimiters:"; grep -o 'BEGIN:[a-z-]*' AGENTS.md || echo "  (none)"
echo ".gitignore env line:"; grep -n '^\.env' .gitignore || echo "  (none)"
echo "manifest type field: $(node -p "require('./package.json').type ?? '(absent)'")"
echo "tsconfig include:    $(node -p "JSON.stringify(require('./tsconfig.json').include)")"

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
variant() {
  local label="$1" cfg="$2" spec="$3" want_build="$4" want_import="$5"
  rm -f fsdev.config.ts fsdev.config.mts
  printf '%s\n' "$CONFIG_BODY" > "$cfg"
  printf 'export { default as flowstate } from "%s";\n' "$spec" > lib/flowstate.ts
  echo
  echo "=== variant: $label ==="

  # Status via a temp file, not a pipeline — a pipe would report grep's status.
  npx next build > build.log 2>&1
  local build_status=$?
  grep -E "error TS|Module not found|Failed to|Compiled successfully|Route \(app\)" build.log | head -4 | sed 's/^/  /'
  local got_build; [ $build_status -eq 0 ] && got_build=pass || got_build=fail
  echo "  build: $got_build (expected $want_build)"
  [ "$got_build" = "$want_build" ] || fail "$label: build $got_build, README claims $want_build"

  # A rejected import must fail the probe; an expected warning must be present.
  # Set exitCode and return — never process.exit() here. Node emits
  # MODULE_TYPELESS_PACKAGE_JSON asynchronously, and an immediate exit() cuts it
  # off before it reaches stderr, which made this probe report "clean" for the
  # variant whose whole point is that it warns.
  node -e "import('./$cfg').then(m=>{
      if(m.default.marker!=='config-module-loaded'){console.error('WRONG MODULE');process.exitCode=3}
    }).catch(e=>{console.error('IMPORT THREW: '+e.message);process.exitCode=3})" > import.log 2>&1
  local import_status=$?
  local got_import
  if [ $import_status -ne 0 ]; then
    got_import=error
  elif grep -q MODULE_TYPELESS_PACKAGE_JSON import.log; then
    got_import=warn
  else
    got_import=clean
  fi
  echo "  native import: $got_import (expected $want_import)"
  [ "$got_import" = "$want_import" ] || fail "$label: import $got_import, README claims $want_import"
}

set_pkg_type none
set_tsconfig_flag false
variant ".mts, explicit .mts extension"      fsdev.config.mts "../fsdev.config.mts" fail clean
variant ".mts, extensionless import"         fsdev.config.mts "../fsdev.config"     fail clean
set_tsconfig_flag true
variant ".mts + allowImportingTsExtensions"  fsdev.config.mts "../fsdev.config.mts" pass clean
set_tsconfig_flag false
variant ".ts, no type field"                 fsdev.config.ts  "../fsdev.config"     pass warn
set_pkg_type module
variant ".ts + type:module   <-- CHOSEN"     fsdev.config.ts  "../fsdev.config"     pass clean

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
npx next dev --port "$PORT" > dev.log 2>&1 &
DEV_PID=$!
sleep 18

BARE=$(curl -s --max-time 20 --noproxy '*' "http://127.0.0.1:$PORT/api/flows")
echo "  GET /api/flows          -> $BARE"
[ "$BARE" = "$MARKER:200" ] || fail "bare route: expected $MARKER:200"

CATCH=$(curl -s --max-time 20 --noproxy '*' "http://127.0.0.1:$PORT/api/flows/sessions/abc")
echo "  GET /api/flows/sessions/abc -> $CATCH"
[ "$CATCH" = "$MARKER:catchall:sessions/abc:200" ] || fail "catch-all route: expected $MARKER:catchall:sessions/abc:200"

FSD_N=$(grep -c 'FSD SECTION SENTINEL' AGENTS.md)
NEXT_N=$(grep -c 'BEGIN:nextjs-agent-rules' AGENTS.md)
echo "  FSD section survived next dev: $FSD_N (expect 1)"
echo "  next's own block still there:  $NEXT_N (expect 1)"
[ "$FSD_N" = 1 ] || fail "appended FSD section did not survive next dev"
[ "$NEXT_N" = 1 ] || fail "next's own block is not intact"

kill "$DEV_PID" 2>/dev/null; wait "$DEV_PID" 2>/dev/null

echo
[ "$RC" = 0 ] && echo "probe: PASS" || echo "probe: FAIL"
exit "$RC"
