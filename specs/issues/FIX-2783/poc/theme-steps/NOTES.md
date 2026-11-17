# theme-steps · does a new value for a Tailwind step resize every use?

Characterization POC for D1. Throwaway; not production code.

**Question.** If the design system sets `--text-sm` on `:root` (unlayered, the way it already
sets `--radius-*` and `--font-*`), does every `text-sm` change size with no class edit? And
what does a role name such as `text-meta` need before Tailwind makes a class for it?

**Run.** `TW_DIR=<dir with tailwindcss and @tailwindcss/cli installed> ./run.sh`. First run on
4.1.12, the floor of the three labs' `^4.1.12` range; re-run on 4.3.0, the version the lockfile
resolves for all three, with byte-identical output. `result.txt` is that output (Kitchen Sink
resolves 4.2.0; it is outside this POC's question).

**Answer: CONFIRMED.**

- `text-sm` and `text-xs` compile to `font-size: var(--text-sm)` and
  `line-height: var(--tw-leading, var(--text-sm--line-height))`. Tailwind's defaults sit in
  `@layer theme`; the stand-in scale's `:root` values are outside every layer, so they win.
- `text-[11px]` compiles to a literal `font-size: 11px`. No token reaches it, which is why
  D2 clears the hard-coded sizes.
- `text-meta` gets a class only because `scale.css` registers it in an `@theme` block. A
  registry component written with a role name would get no class at all in an app without
  that block, with no error.
