// What a project skill is, spec/analysis.md § Project skill: each case on what the real command
// prints for a repository built for it, locally or answered as GitHub would.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, type TestContext } from 'node:test';
import type { Recording } from '../src/core/replay.ts';
import { atlas } from './helpers.ts';

const skill = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n`;

/** A local repository named `repo` with these files; removed after the test. */
function repository(t: TestContext, files: Record<string, string>): string {
  const root = join(mkdtempSync(join(tmpdir(), 'skill-atlas-')), 'repo');
  t.after(() => rmSync(dirname(root), { recursive: true, force: true }));
  mkdirSync(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** The names and links the scan prints, one skill a line. */
async function scanned(root: string) {
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.replaceAll(`${pathToFileURL(root).href}/`, '');
}

test('a project skill is <root>/<skill>/SKILL.md, in each of the four roots', async (t) => {
  const root = repository(t, {
    '.agents/skills/a/SKILL.md': skill('a'),
    '.claude/skills/b/SKILL.md': skill('b'),
    '.github/skills/c/SKILL.md': skill('c'),
    'agent/skills/d/SKILL.md': skill('d'),
  });
  assert.equal(
    await scanned(root),
    [
      'repo · 4 skills',
      'a — The a skill.',
      '  .agents/skills/a/SKILL.md',
      'b — The b skill.',
      '  .claude/skills/b/SKILL.md',
      'c — The c skill.',
      '  .github/skills/c/SKILL.md',
      'd — The d skill.',
      '  agent/skills/d/SKILL.md',
    ].join('\n'),
  );
});

test('a SKILL.md outside a root, at the wrong depth or under another name is not a project skill', async (t) => {
  const root = repository(t, {
    'SKILL.md': skill('repository-root'),
    'docs/SKILL.md': skill('docs'),
    'skills/published/SKILL.md': skill('published'),
    'src/test/data/skills/x/SKILL.md': skill('test-data'),
    '.claude/skills/SKILL.md': skill('no-directory'),
    '.claude/skills/group/nested/SKILL.md': skill('grouped'),
    '.claude/skills/real/SKILL.md': skill('real'),
    '.claude/skills/real/examples/SKILL.md': skill('example-inside-a-skill'),
    '.claude/skills/lower/skill.md': skill('lower'),
    'x.claude/skills/prefixed/SKILL.md': skill('prefixed'),
  });
  assert.equal(await scanned(root), ['repo · 1 skill', 'real — The real skill.', '  .claude/skills/real/SKILL.md'].join('\n'));
});

test("a root in any directory counts: a module's own skills", async (t) => {
  const root = repository(t, { 'plugins/kotlin/.claude/skills/gradle/SKILL.md': skill('gradle') });
  assert.equal(
    await scanned(root),
    ['repo · 1 skill', 'gradle — The gradle skill.', '  plugins/kotlin/.claude/skills/gradle/SKILL.md'].join('\n'),
  );
});

test('the same skill under two roots of one base is one skill with copies; under two bases, two skills', async (t) => {
  const root = repository(t, {
    '.claude/skills/commits/SKILL.md': skill('commits'),
    '.github/skills/commits/SKILL.md': skill('commits'),
    '.agents/skills/commits/SKILL.md': skill('commits'),
    'module/.claude/skills/commits/SKILL.md': skill('commits'),
  });
  assert.equal(
    await scanned(root),
    [
      'repo · 2 skills',
      'commits — The commits skill.',
      '  .agents/skills/commits/SKILL.md',
      '  also in .claude/skills/commits/SKILL.md, .github/skills/commits/SKILL.md',
      'commits — The commits skill.',
      '  module/.claude/skills/commits/SKILL.md',
    ].join('\n'),
  );
});

test('a symbolic link, to a file or a directory, is not a skill: its target is', async (t) => {
  const root = repository(t, { '.agents/skills/commits/SKILL.md': skill('commits') });
  mkdirSync(join(root, '.claude/skills/linked'), { recursive: true });
  symlinkSync('../../../.agents/skills/commits/SKILL.md', join(root, '.claude/skills/linked/SKILL.md'));
  mkdirSync(join(root, '.github'));
  symlinkSync('../.agents/skills', join(root, '.github/skills'), 'dir');
  assert.equal(await scanned(root), ['repo · 1 skill', 'commits — The commits skill.', '  .agents/skills/commits/SKILL.md'].join('\n'));
});

test('no project skill → 0 skills, exit code 0', async (t) => {
  const root = repository(t, { 'README.md': '# Nothing here\n', 'docs/SKILL.md': skill('docs') });
  assert.equal(await scanned(root), 'repo · 0 skills');
});

// The case of a root is checked here: a local file system may ignore it.
test('on GitHub, the same model: node_modules, other places, case and copies', async () => {
  const commit = 'c0ffee0000000000000000000000000000000000';
  const api = 'https://api.github.com';
  const raw = `https://raw.githubusercontent.com/JetBrains/model/${commit}`;
  const recording: Recording = {
    [`${api}/repos/JetBrains/model`]: { status: 200, body: { full_name: 'JetBrains/model', default_branch: 'main' } },
    [`${api}/repos/JetBrains/model/commits/main`]: { status: 200, body: { sha: commit } },
    [`${api}/search/code?q=filename:SKILL.md+repo:JetBrains/model&per_page=100&page=1`]: {
      status: 200,
      body: {
        total_count: 6,
        items: [
          { path: '.Claude/skills/upper/SKILL.md' },
          { path: '.claude/skills/review/SKILL.md' },
          { path: '.agents/skills/review/SKILL.md' },
          { path: 'node_modules/some-package/.claude/skills/vendored/SKILL.md' },
          { path: 'skills/published/SKILL.md' },
          { path: '.claude/skills/review/skill.md' },
        ],
      },
    },
    // Only the skill is read: reading anything else fails the scan, as it is not recorded.
    [`${raw}/.agents/skills/review/SKILL.md`]: { status: 200, body: skill('review') },
  };
  const result = await atlas(['scan', 'https://github.com/JetBrains/model'], recording);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'JetBrains/model · 1 skill',
      'review — The review skill.',
      `  https://github.com/JetBrains/model/blob/${commit}/.agents/skills/review/SKILL.md`,
      '  also in .claude/skills/review/SKILL.md',
    ].join('\n'),
  );
});

test('the name comes from the front matter, else from the skill directory', async (t) => {
  const root = repository(t, {
    '.claude/skills/directory-name/SKILL.md': skill('front-matter-name'),
    '.claude/skills/unnamed/SKILL.md': '---\ndescription: No name here.\n---\n',
  });
  assert.equal(
    await scanned(root),
    [
      'repo · 2 skills',
      'front-matter-name — The front-matter-name skill.',
      '  .claude/skills/directory-name/SKILL.md',
      'unnamed — No name here.',
      '  .claude/skills/unnamed/SKILL.md',
    ].join('\n'),
  );
});

test('without a token, a tree too large for one answer → only the roots at the repository root, and a warning', async () => {
  const commit = 'b16b16b16b16b16b16b16b16b16b16b16b16b16b';
  const api = 'https://api.github.com/repos/JetBrains/large';
  const tree = (entries: string[]) => ({
    status: 200,
    body: { truncated: false, tree: entries.map((path) => ({ path, mode: '040000', type: 'tree', sha: `sha-${path}` })) },
  });
  const recording: Recording = {
    [api]: { status: 200, body: { full_name: 'JetBrains/large', default_branch: 'main' } },
    [`${api}/commits/main`]: { status: 200, body: { sha: commit } },
    // The whole tree is truncated: a module's own root inside it is not seen.
    [`${api}/git/trees/${commit}?recursive=1`]: {
      status: 200,
      body: { truncated: true, tree: [{ path: 'module/.claude/skills/hidden/SKILL.md', mode: '100644', type: 'blob', sha: 'x' }] },
    },
    [`${api}/git/trees/${commit}`]: tree(['.claude', 'module']),
    [`${api}/git/trees/sha-.claude`]: tree(['skills']),
    [`${api}/git/trees/sha-skills?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: [{ path: 'review/SKILL.md', mode: '100644', type: 'blob', sha: 'y' }] },
    },
    [`https://raw.githubusercontent.com/JetBrains/large/${commit}/.claude/skills/review/SKILL.md`]: { status: 200, body: skill('review') },
  };
  const result = await atlas(['scan', 'https://github.com/JetBrains/large'], recording, { token: '' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'JetBrains/large · 1 skill',
      'review — The review skill.',
      `  https://github.com/JetBrains/large/blob/${commit}/.claude/skills/review/SKILL.md`,
    ].join('\n'),
  );
  assert.equal(
    result.stderr,
    'warning: the tree is too large to list at once; looked only in .agents/skills, .claude/skills, .github/skills, agent/skills (GITHUB_TOKEN searches everywhere)',
  );
});
