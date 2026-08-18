#!/usr/bin/env bash
# Reproduces every row of README.md's table. Needs network. ~2 minutes.
#
#   bash probe.sh [workdir]
#
# Scaffolds a real create-next-app@16 project, then for each candidate shape of
# the FSD config runs `next build` (the bundler + TypeScript half) and a native
# `import()` (the fsdev CLI half). Ends with a `next dev` + curl on the chosen
# shape, so the mounted route is proven to serve, not just to compile.
set -u

WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK" || exit 1
APP="$WORK/probe"
rm -rf "$APP"
echo "workdir: $WORK"

npx --yes create-next-app@16 "$APP" \
  --ts --app --no-tailwind --no-eslint --no-biome --no-src-dir \
  --no-react-compiler --no-rspack --import-alias "@/*" \
  --agents-md --skip-install --disable-git || exit 1

cd "$APP" || exit 1

echo "=== what create-next-app wrote (findings 1-4) ==="
ls -a | tr '\n' ' '; echo
echo "AGENTS.md delimiters:"; grep -o 'BEGIN:[a-z-]*' AGENTS.md || echo "  (none)"
echo ".gitignore env line:"; grep -n '^\.env' .gitignore || echo "  (none)"
echo "manifest type field: $(node -p "require('./package.json').type ?? '(absent)'")"
echo "tsconfig include:    $(node -p "JSON.stringify(require('./tsconfig.json').include)")"

mkdir -p lib "app/api/flows"
cat > app/api/flows/route.ts <<'EOF'
import { flowstate } from "@/lib/flowstate";
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

npm install --no-audit --no-fund || exit 1

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
variant() { # $1 = label, $2 = config filename, $3 = import specifier
  rm -f fsdev.config.ts fsdev.config.mts
  printf '%s\n' "$CONFIG_BODY" > "$2"
  printf 'export { default as flowstate } from "%s";\n' "$3" > lib/flowstate.ts
  echo
  echo "=== variant: $1 ==="
  npx next build 2>&1 | grep -E "error TS|Module not found|Failed to|Compiled successfully|✓ Compiled|Route \(app\)" | head -5
  node -e "import('./$2').then(m=>console.log('  native import: OK',m.default.marker)).catch(e=>console.log('  native import: FAIL',e.message))" 2>&1 | grep -E "native import|MODULE_TYPELESS" | head -3
}

set_pkg_type none
set_tsconfig_flag false
variant ".mts, explicit .mts extension"      fsdev.config.mts "../fsdev.config.mts"
variant ".mts, extensionless import"         fsdev.config.mts "../fsdev.config"
set_tsconfig_flag true
variant ".mts + allowImportingTsExtensions"  fsdev.config.mts "../fsdev.config.mts"
set_tsconfig_flag false
variant ".ts, no type field"                 fsdev.config.ts  "../fsdev.config"
set_pkg_type module
variant ".ts + type:module   <-- CHOSEN"     fsdev.config.ts  "../fsdev.config"

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
if [ "$PORT" = 0 ]; then echo "  no free port in 3990-3999 — skipped"; exit 0; fi
echo "  port $PORT (verified free)"

printf '\n<!-- BEGIN:fsd -->\nFSD SECTION SENTINEL\n<!-- END:fsd -->\n' >> AGENTS.md
npx next dev --port "$PORT" > dev.log 2>&1 &
DEV_PID=$!
sleep 18
BODY=$(curl -s --max-time 20 --noproxy '*' "http://127.0.0.1:$PORT/api/flows")
echo "  GET /api/flows -> $BODY"
case "$BODY" in
  "$MARKER":200) echo "  PASS — the route served this run's config module" ;;
  *)             echo "  FAIL — expected $MARKER:200" ;;
esac
echo "  FSD section survived next dev: $(grep -c 'FSD SECTION SENTINEL' AGENTS.md) (expect 1)"
echo "  next's own block still there:  $(grep -c 'BEGIN:nextjs-agent-rules' AGENTS.md) (expect 1)"
kill "$DEV_PID" 2>/dev/null; wait "$DEV_PID" 2>/dev/null
exit 0
