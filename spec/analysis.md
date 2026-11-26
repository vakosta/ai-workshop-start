# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every *project skill*: **name**, **description**, **link**
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit, copies
## Project skill
A skill an agent loads when it works *in* the repository: `<base>/<root>/<skill>/SKILL.md`
- **root**: `.agents/skills`, `.claude/skills`, `.github/skills` or `agent/skills`; exact case
- **base**: the repository root or *any directory* in it, so a module's own skills count
- **skill**: exactly *one* directory under the root; the file is named exactly `SKILL.md`
- Not a project skill, so not listed:
  - a `SKILL.md` outside a root: the repository root, `docs/`, a published `skills/` collection, test data
  - `<root>/SKILL.md` (no skill directory); `<root>/a/b/SKILL.md` (a skill's own files, or a grouping agents do not load)
  - `skill.md`, `Skill.md`; `.Claude/skills`
  - anything under `node_modules`: someone else's skills
  - a symbolic link, to a file or a directory: the target is the skill
- **Copies**: the same `<skill>` under two roots of the same base is *one* skill
  - The first root in the order above is the skill; the others are its copies
  - The same `<skill>` under two *bases* is two skills
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the skill directory
- The link pins the *scanned commit*; for a local directory, the file itself
- Malformed front matter → a *warning*, the scan goes on
- Without a token, a tree too large for one answer → only the roots at the repository root, and a *warning*
- No project skill → `· 0 skills`, exit code 0
- Unreachable repository → a clear message, exit code 1
