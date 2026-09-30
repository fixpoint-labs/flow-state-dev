---
"@flow-state-dev/fsdev": patch
---

`fsdev ui add a b c` installs every component in one shadcn call. It used to call shadcn once per component, so a later component that shared a dependency with an earlier one stopped at an overwrite prompt for the file the earlier call had just written (FIX-1655).
