#!/usr/bin/env bash
# Render one figure the way the site draws it: inlined, with the page register's
# drawing classes (labs/design-system/page.css), once on Paper and once on Night.
#
#   docs/contributing/docs-revamp/figures/render.sh <figure.svg> [out-dir]
#
# Writes <out-dir>/<name>.light.png and <name>.dark.png (out-dir defaults to
# ./rendered beside this script). Needs a Chromium or Chrome binary: set CHROME,
# or have one under /opt/pw-browsers or on PATH. Without the site's installed
# fonts the text falls back to the system monospace, which has the same advance
# width as IBM Plex Mono, so overflow checks still hold.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
svg=$(realpath "$1")
out=${2:-$here/rendered}
css=$(realpath "$here/../../../../labs/design-system/page.css")
name=$(basename "$svg" .svg)
height=$(grep -oE 'viewBox="[0-9.]+ [0-9.]+ [0-9.]+ [0-9.]+' "$svg" | head -1 | grep -oE '[0-9.]+$')
chrome=${CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1 || true)}
chrome=${chrome:-$(command -v chromium || command -v google-chrome || true)}
[ -x "$chrome" ] || { echo "no Chromium found: set CHROME to a Chromium or Chrome binary" >&2; exit 1; }

mkdir -p "$out"
tmp=$(mktemp -d)
for theme in light dark; do
  {
    printf '<!doctype html><html data-theme="%s"><head><meta charset="utf-8">' "$theme"
    printf '<link rel="stylesheet" href="file://%s"></head><body style="margin:0">' "$css"
    sed 's/<svg /<svg class="drawing" width="920" style="display:block" /' "$svg"
    printf '</body></html>'
  } > "$tmp/$theme.html"
  "$chrome" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --window-size=920,"${height%.*}" --screenshot="$out/$name.$theme.png" "$tmp/$theme.html" 2>/dev/null
  echo "$out/$name.$theme.png"
done
rm -rf "$tmp"
