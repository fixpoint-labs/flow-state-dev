---
"@flow-state-dev/shift-manager": patch
---

A coding step that ran a here-document says what it did instead of showing the line that opened it (FIX-2891): an inline script reads "Run a python3 script", `cat > file` or `tee file` reads "Write file", and any other command shows without the `<<'EOF'` marker.
