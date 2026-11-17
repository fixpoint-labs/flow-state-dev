#!/usr/bin/env bash
# Compiles input.css with Tailwind and prints how each sample class is sized.
# Throwaway POC evidence; not production code. Run on 4.1.12 and 4.3.0 (the version the
# lockfile resolves for the labs), same output. Needs a directory with both packages
# installed (npm i tailwindcss@4.3.0 @tailwindcss/cli@4.3.0):
#   TW_DIR=/path/to/that/dir ./run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d "$TW_DIR/poc.XXXX")"
cp "$here"/input.css "$here"/scale.css "$here"/sample.html "$work"/
cd "$work"
"$TW_DIR/node_modules/.bin/tailwindcss" -i input.css -o out.css 2>/dev/null
echo "--- @layer theme (Tailwind's defaults, and the registered semantic step):"
awk '/@layer theme/,/^}/' out.css | grep -E -- '--text-(xs|sm|meta)' || true
echo "--- utilities:"
awk '/^  \.text-/,/^  }/' out.css
echo "--- unlayered (outside any @layer), so it wins over @layer theme:"
awk '/^:root/,/^}/' out.css
rm -rf "$work"
