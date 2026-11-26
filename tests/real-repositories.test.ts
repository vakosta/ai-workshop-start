// End to end on real repositories: what the real command prints for JetBrains/MPS, JetBrains/android
// and JetBrains/koog, with GitHub answering as it did when tests/real-repositories/ was recorded
// (`npm run record` records again). Without a token, through the tree, as most users run it; a
// request that was not recorded fails, so these tests never reach the network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atlas } from './helpers.ts';
import { recorded } from './real-repositories/recordings.ts';

const MPS_COMMIT = '1cbf7f783dbc5c74c8e5231d31f61b02829143de';
const KOOG_COMMIT = '709079e4a34d6c9234583352550e6a2b88a0bb85';

const TRUNCATED =
  'warning: the tree is too large to list at once; looked only in .agents/skills, .claude/skills, .github/skills, agent/skills (GITHUB_TOKEN searches everywhere)';

/** `skill-atlas scan https://github.com/<repository>`, answered from its recording. */
function scan(repository: string) {
  return atlas(['scan', `https://github.com/${repository}`], recorded(repository), { token: '' });
}

/** Each skill as printed: its first line, its link and its copies. */
function skills(stdout: string) {
  const [, ...lines] = stdout.split('\n');
  const result: { line: string; link: string; copies?: string }[] = [];
  for (const line of lines) {
    if (!line.startsWith('  ')) result.push({ line, link: '' });
    else if (line.startsWith('  also in ')) result.at(-1)!.copies = line.slice('  also in '.length);
    else result.at(-1)!.link = line.slice(2);
  }
  return result;
}

test('JetBrains/koog: a tree small enough for one answer, every skill with its first sentence and pinned link', async () => {
  const koog = await scan('JetBrains/koog');
  assert.equal(koog.code, 0, koog.stderr);
  assert.equal(koog.stderr, '');
  assert.equal(
    koog.stdout,
    [
      'JetBrains/koog · 2 skills',
      'add-java-code-snippets-in-docs — Use when the user asks to add Java tabs/examples to mkdocs docs that already have Kotlin examples (files under docs/docs/**.md using === "Kotlin" / Knit INCLUDE+SUFFIX blocks).',
      `  https://github.com/JetBrains/koog/blob/${KOOG_COMMIT}/.claude/skills/add-java-code-snippets-in-docs/SKILL.md`,
      'split-jvm-nonjvm — Splits a class or several classes in the common source set commonMain into JVM and non-JVM parts into jvmCommonMain and nonJvmCommonMain.',
      `  https://github.com/JetBrains/koog/blob/${KOOG_COMMIT}/.claude/skills/split-jvm-nonjvm/SKILL.md`,
    ].join('\n'),
  );
});

test('JetBrains/MPS: a tree too large for one answer → the roots at the repository root, and a warning', async () => {
  const mps = await scan('JetBrains/MPS');
  assert.equal(mps.code, 0, mps.stderr);
  assert.equal(mps.stderr, TRUNCATED);
  assert.match(mps.stdout, /^JetBrains\/MPS · 43 skills\n/);
  assert.equal(skills(mps.stdout).length, 43);
});

test('JetBrains/MPS: each skill in .agents/skills and .claude/skills is one skill, with .claude/skills as its copy', async () => {
  const mps = skills((await scan('JetBrains/MPS')).stdout);
  assert.equal(mps.length, 43);
  for (const { line, link, copies } of mps) {
    const name = line.split(' — ')[0];
    assert.equal(link, `https://github.com/JetBrains/MPS/blob/${MPS_COMMIT}/.agents/skills/${name}/SKILL.md`);
    assert.equal(copies, `.claude/skills/${name}/SKILL.md`);
  }
});

test('JetBrains/MPS: sorted by name; a folded description is cut at its first sentence', async () => {
  const mps = skills((await scan('JetBrains/MPS')).stdout);
  const names = mps.map(({ line }) => line.split(' — ')[0]);
  assert.deepEqual(names, names.toSorted());
  assert.deepEqual(names.slice(0, 3), ['actions', 'bugfix-workflow', 'code-style']);
  // `description: >-` over several lines in the file.
  assert.equal(
    mps.find(({ line }) => line.startsWith('commits'))?.line,
    'commits — Use this skill whenever the user asks to commit changes, write or fix a commit message, amend or rename a commit, or do a workflow that includes committing in the IntelliJ repository.',
  );
});

test('JetBrains/android: agent/ and .agents/ without a skills root → · 0 skills, exit code 0', async () => {
  const android = await scan('JetBrains/android');
  assert.equal(android.code, 0, android.stderr);
  assert.equal(android.stdout, 'JetBrains/android · 0 skills');
  assert.equal(android.stderr, TRUNCATED);
});
