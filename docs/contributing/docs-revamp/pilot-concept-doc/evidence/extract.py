"""Cut a concept doc down to the sections concept-doc's handoff allows into a docs-writer brief.

Drops: "Why this doc", "What this replaces" (headings and bold-led paragraphs), naming debates,
retired-terms tables, decisions, and "Where today's code differs". Keeps everything else.
Usage: python3 extract.py <in.md> <out.md>
"""
import re
import sys

DROP = re.compile(r"why this doc|what this replaces|naming debates|retired terms|^decisions$|where today", re.I)

src = open(sys.argv[1]).read().split("\n")
out, skip_level = [], None
for line in src:
    m = re.match(r"^(#{1,6})\s+(.*)$", line)
    if m:
        level, title = len(m.group(1)), m.group(2).strip()
        if skip_level is not None and level <= skip_level:
            skip_level = None
        if skip_level is None and DROP.search(re.sub(r"^\d+\.\s*", "", title)):
            skip_level = level
            continue
    if skip_level is not None:
        continue
    if re.match(r"^\*\*What this replaces", line):
        continue
    # image references point at B's figures, which the writer does not get
    if re.match(r"^!\[.*\]\(.*\)$", line):
        continue
    out.append(line)
open(sys.argv[2], "w").write("\n".join(out))
