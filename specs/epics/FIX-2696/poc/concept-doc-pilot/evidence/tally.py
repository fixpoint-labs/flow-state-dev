"""Tally the blind results per page and arm."""
import re, statistics, os
os.chdir("/tmp/claude-0/-home-user-flow-state-dev/5f124f94-c1af-571f-8b2a-38d6390fd212/scratchpad/results")
key = {"what-flow-state-is": {"A": "Q", "B": "S", "C": "P"},
       "tasks-and-boards": {"A": "S", "B": "P", "C": "Q"},
       "workers": {"A": "P", "B": "Q", "C": "S"}}
for slug, m in key.items():
    for arm, l in sorted(m.items()):
        ID = f"{l}-{slug}"
        Rs, Ps = [], []
        for g in (2, 3, 4):
            r = p = 0.0
            for line in open(f"{ID}.grade{g}.txt"):
                mm = re.match(r"\**(R\d|P\d\.\d)\**\s+([\d.]+)", line.strip())
                if mm:
                    if mm.group(1).startswith("R"):
                        r += float(mm.group(2))
                    else:
                        p += float(mm.group(2))
            Rs.append(r); Ps.append(p)
        tot = [a + b for a, b in zip(Rs, Ps)]
        t = re.findall(r"TOTALS right=(\d+) wrong=(\d+) unsupported=(\d+)", open(f"{ID}.fact.txt").read())[-1]
        ed = re.findall(r"EDITOR verdict=(\w+) findings=(\d+)", open(f"{ID}.editor.txt").read())
        ch = open(f"{ID}.check.txt").read().split("\n")
        print(slug, arm, l, "R", Rs, "P", Ps, "tot", tot, "med", statistics.median(tot),
              "medR", statistics.median(Rs), "medP", statistics.median(Ps),
              "fact", t, "ed", ed[-1] if ed else None, ch[0].split("(")[-1], "|", " ".join(x.strip() for x in ch[1:-2]))
