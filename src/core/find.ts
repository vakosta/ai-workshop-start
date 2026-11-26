/** A skill found in a repository: its SKILL.md, its name and its copies. */
export type SkillFile = { path: string; name: string; copies: string[] };

/** Where agents keep a repository's own skills, in the order that picks the skill among its copies. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/** Never the repository's own skills. */
const VENDORED = 'node_modules';

/**
 * The project skills among the paths: `<base>/<root>/<skill>/SKILL.md`, named after `<skill>`.
 * The same `<skill>` under several roots of one base is one skill; the others are its copies.
 */
export function findSkills(paths: string[]): SkillFile[] {
  const groups = new Map<string, { path: string; name: string; order: number }[]>();
  for (const path of paths) {
    const found = locate(path);
    if (!found) continue;
    const key = `${found.base}\0${found.name}`;
    groups.set(key, [...(groups.get(key) ?? []), { path, ...found }]);
  }
  return [...groups.values()]
    .map((group) => group.sort((a, b) => a.order - b.order))
    .map(([skill, ...copies]) => ({ path: skill.path, name: skill.name, copies: copies.map((copy) => copy.path) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The base, the skill directory and the root's order, if the path is a project skill. */
function locate(path: string): { base: string; name: string; order: number } | undefined {
  const segments = path.split('/');
  if (segments.length < 2 || segments.at(-1) !== 'SKILL.md' || segments.includes(VENDORED)) return undefined;
  const name = segments.at(-2)!;
  const directory = segments.slice(0, -2).join('/');
  for (const [order, root] of SKILL_ROOTS.entries()) {
    if (directory === root) return { base: '', name, order };
    if (directory.endsWith(`/${root}`)) return { base: directory.slice(0, -root.length), name, order };
  }
  return undefined;
}
