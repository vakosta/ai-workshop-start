// Records what GitHub answers when skill-atlas scans real repositories, for
// tests/real-repositories.test.ts to replay offline:
//
//   node tests/real-repositories/record.ts JetBrains/MPS JetBrains/android JetBrains/koog
//
// The scan goes without a token, through the tree, as most users run it. GITHUB_TOKEN, if set,
// only raises the rate limit while recording. The answers are trimmed to what the scan reads.
import { writeFileSync } from 'node:fs';
import type { Fetch } from '../../src/core/github.ts';
import { openGitHub } from '../../src/core/github.ts';
import type { Recorded, Recording } from '../../src/core/replay.ts';
import { scan } from '../../src/core/scan.ts';
import { recordingFile } from './recordings.ts';

const token = process.env.GITHUB_TOKEN || undefined;
const repositories = process.argv.slice(2);
if (repositories.length === 0) {
  console.error('Usage: node tests/real-repositories/record.ts <owner/repo>...');
  process.exit(1);
}

for (const repository of repositories) {
  const answers: Recording = {};
  const recording: Fetch = async (url, init) => {
    const headers = { ...init?.headers, ...(token && url.startsWith('https://api.github.com/') ? { Authorization: `Bearer ${token}` } : {}) };
    const response = await fetch(url, { headers });
    const text = await response.clone().text();
    // The API answers JSON; a raw file is text, whatever it looks like.
    const api = url.startsWith('https://api.github.com/');
    answers[url] = trim(url, { status: response.status, body: api ? JSON.parse(text) : text });
    return response;
  };
  const result = await scan(await openGitHub(`https://github.com/${repository}`, { fetch: recording }));
  const file = recordingFile(repository);
  writeFileSync(file, `${JSON.stringify(sorted(answers), null, 1)}\n`);
  console.log(`${result.repository.id} · ${result.skills.length} skills at ${result.repository.commit} → ${file}`);
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/** Only what the scan looks at, so a recording of a large repository stays small. */
function trim(url: string, answer: Recorded): Recorded {
  if (answer.status !== 200) return answer;
  const body = answer.body as Record<string, unknown>;
  if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return { ...answer, body: { full_name: body.full_name, default_branch: body.default_branch } };
  if (url.includes('/commits/')) return { ...answer, body: { sha: body.sha } };
  if (url.includes('/git/trees/')) {
    const tree = body as Tree;
    // A truncated tree is only checked for being truncated; a walk down one level needs the
    // directories; a whole tree needs the files named like a SKILL.md, right or wrong.
    if (tree.truncated) return { ...answer, body: { truncated: true, tree: [] } };
    const recursive = url.endsWith('?recursive=1');
    const kept = tree.tree.filter((item) => (recursive ? /(^|\/)skill\.md$/i.test(item.path) : item.type === 'tree'));
    return { ...answer, body: { truncated: false, tree: kept.map(({ path, mode, type, sha }) => ({ path, mode, type, sha })) } };
  }
  // A SKILL.md: the scan prints only what its front matter says.
  if (typeof answer.body === 'string') return { ...answer, body: frontMatter(answer.body) };
  return answer;
}

/** The front matter with its `---` lines; the whole text if it has none. */
function frontMatter(text: string): string {
  const lines = text.split('\n');
  const end = lines[0].trim() === '---' ? lines.findIndex((line, index) => index > 0 && line.trim() === '---') : -1;
  return end < 0 ? text : `${lines.slice(0, end + 1).join('\n')}\n`;
}

function sorted(recording: Recording): Recording {
  return Object.fromEntries(Object.entries(recording).sort(([a], [b]) => (a < b ? -1 : 1)));
}
