# POC · where should a workforce skill live?

Experimental design evidence for FIX-1728. This is not production code, a workspace package, or
an implementation proposal. It makes three authoring conventions concrete so the call site and
the day-two editing experience can be reviewed before any loader is built.

## The question

When a skill may belong to an organization, a team, or one worker, should ownership be expressed
by **where the skill folder lives**, by **selectors in the skill file**, or by **imports in each
worker file**?

Abandon the recommended direction if a reviewer cannot answer both “who owns this?” and “who gets
this?” from a directory listing, or if moving a skill necessarily changes its identity.

## Run the comparison

```bash
node specs/issues/FIX-1728/poc/skill-file-conventions/compare.mjs
```

The command checks that each sketch contains the files its convention promises, then prints the
three consumer-facing examples side by side. It has no dependencies and does not call a model.

## The variants

|                                      | A · placement is scope                    | B · selectors are scope                      | C · workers import skills                   |
| ------------------------------------ | ----------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| Author says who gets a skill         | Moves its folder to the owning level      | Writes `applies-to` in `SKILL.md`            | Adds a path to each `WORKER.md`             |
| Worker file knows its inventory      | No                                        | No                                           | Yes                                         |
| Directory listing explains ownership | Yes                                       | No; inspect frontmatter                      | Partly; trace imports                       |
| Sharing with a new team              | Move/copy a folder                        | Edit one selector                            | Edit every worker                           |
| Rename or move                       | Name stays `review`; path is placement    | Name stays `review`; selectors stay metadata | Update every importing worker               |
| Main failure mode                    | Same name arrives from two visible levels | Selector language becomes policy code        | Lists drift and shared intent is duplicated |

### A · placement is scope — **recommended**

See [`variant-a-placement/`](./variant-a-placement/). A skill is the same `SKILL.md` folder at all
three levels. The tree is the access rule: org skills reach everyone, team skills reach that team,
and skills beside a worker reach only that worker. The usage code asks for a seat, not for a scope:

```ts
const { skills, errors } = await readSeatSkills("./workforce", {
  team: "pentest",
  worker: "recon",
});
```

This is the smallest new convention because it preserves the existing skill folder and returns the
existing skill record. It also keeps the caller out of policy assembly. The loader should refuse a
duplicate bare name rather than invent precedence: `org/review` and `teams/pentest/review` describe
two owners for the same thing, not an override relationship.

### B · selectors are scope

See [`variant-b-selectors/`](./variant-b-selectors/). All skills sit in one catalog and carry an
`applies-to` selector. This is strongest when skills need arbitrary audiences, but that flexibility
creates a selector language, makes ownership invisible in the tree, and couples a reusable skill
format to Workforce's team/worker vocabulary.

### C · workers import skills

See [`variant-c-imports/`](./variant-c-imports/). Each worker explicitly lists skill paths. It is
easy to understand from one `WORKER.md`, but organization-wide and team-wide intent is repeated in
every seat. Adding a worker can silently omit policy; moving a shared skill edits many manifests.

## Recommendation

Choose **A, placement is scope**. It makes the common review operation — scan the tree and see what
belongs where — trivial, while the consumer code names only the seat it is already constructing.
It composes an existing folder convention rather than adding selectors or an import language.

The deciding product question is whether arbitrary cross-cutting audiences are a real requirement.
If a skill must target “three workers across unrelated teams” often enough to be first-class, B
earns its complexity. Until then, A makes the organization and team boundaries legible and asks an
exceptional audience to use an explicit second skill or a future composition mechanism.

## What this POC does not answer

It does not design activation, persistence, refresh, or runtime registration. Those happen after a
seat has received a set of ordinary skill records and should not distort the file convention.
