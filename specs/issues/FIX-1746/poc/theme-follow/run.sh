#!/bin/bash
# Does a plate's own dark palette follow the docs site's theme toggle?
#
# The docs site (Docusaurus + Infima) sets `color-scheme` on <html> from its theme
# toggle. A plate is an SVG loaded through <img>, with its palette switched by
# `@media (prefers-color-scheme: dark)` inside the file. This renders one such SVG in
# headless Chromium under every pairing of page `color-scheme` and OS preference and
# prints the plate's top-left pixel. White = light palette, black = dark palette.
#
# Expected: page light -> white, page dark -> black, whatever the OS says. The `normal`
# rows are the control: with no page color-scheme the OS decides, which shows the OS
# flag really took effect.
#
# Run: bash specs/issues/FIX-1746/poc/theme-follow/run.sh
# Needs: Chromium (CH, default the Playwright copy on cloud VMs) and python3.
# Throwaway evidence for the spec's D2. Writes only into a temp directory.
set -euo pipefail
CH=${CH:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)}
W=$(mktemp -d)
cat > "$W/t.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><style>:root{--bg:#ffffff}@media (prefers-color-scheme: dark){:root{--bg:#000000}} rect{fill:var(--bg)}</style><rect width="200" height="100"/></svg>
EOF
for cs in light dark normal; do
  printf '<html style="color-scheme:%s"><body style="margin:0"><img src="t.svg" width="200"></body></html>' "$cs" > "$W/p-$cs.html"
done
for cs in light dark normal; do
  for os in light dark; do
    if [ "$os" = dark ]; then flags="--force-dark-mode --blink-settings=preferredColorScheme=0"
    else flags="--blink-settings=preferredColorScheme=1"; fi
    # shellcheck disable=SC2086
    "$CH" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --allow-file-access-from-files $flags \
      --window-size=200,100 --screenshot="$W/o.png" "file://$W/p-$cs.html" >/dev/null 2>&1
    python3 - "$W/o.png" "$cs" "$os" <<'PY'
import struct, sys, zlib
d = open(sys.argv[1], "rb").read(); i = 8; idat = b""
while i < len(d):
    n = struct.unpack(">I", d[i:i+4])[0]; t = d[i+4:i+8]; c = d[i+8:i+8+n]
    if t == b"IHDR": ct = c[9]
    if t == b"IDAT": idat += c
    i += 12 + n
px = zlib.decompress(idat)[1:4]
print(f"page color-scheme={sys.argv[2]:<6} os={sys.argv[3]:<5} -> {'dark palette' if px[0] < 128 else 'light palette'}")
PY
  done
done
rm -rf "$W"
