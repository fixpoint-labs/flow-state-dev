---
"@flow-state-dev/shift-manager": minor
---

Shift Manager has three themes, Day, Evening and Night, instead of light and dark. The mark at the top of the sidebar changes the theme with a click, fading to the new one, and its sundial dot shows the time of day. `--shift` and `SHIFT_MANAGER_SHIFT` also take `evening`. A page started with no pick and no shift opens on the theme the clock calls for (Day from 06:00, Evening from 16:00, Night from 19:00) rather than following the OS's light or dark setting. The sidebar's Day shift / Night shift switch is gone.
