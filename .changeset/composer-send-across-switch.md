---
"@flow-state-dev/shift-manager": patch
---

A message sent while its image is still uploading is no longer sent without the image when the conversation changes before the upload finishes; nothing is sent, and the draft stays (FIX-2521).
