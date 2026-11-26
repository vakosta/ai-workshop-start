// The decisions in spec/web.md, checked on the real server: over HTTP, for ./fixture and for the
// small GitHub repository answered in tests/helpers.ts, and through the real CLI.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createBrowserBackend } from '../src/browser.ts';
import { openGitHub, parseGitHubUrl } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';
import { createWebServer, listen } from '../src/web.ts';
import { atlas, CLI, EXAMPLE, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const github = replay(EXAMPLE);
const server = createWebServer({
  open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token: 'test' }) : openDirectory(input)),
});
const base = await listen(server, 0);
test.after(() => server.close());

/** A GET to the test server, with the Host header a browser would send unless given another. */
function get(path: string, host = new URL(base).host): Promise<{ status: number; type: string; headers: Record<string, unknown>; text: string }> {
  return new Promise((resolve, reject) => {
    request(`${base}${path}`, { headers: { host } }, (response) => {
      let text = '';
      response.setEncoding('utf8').on('data', (chunk) => (text += chunk));
      response.on('end', () => resolve({ status: response.statusCode!, type: String(response.headers['content-type']), headers: response.headers, text }));
    })
      .on('error', reject)
      .end();
  });
}

type Scanned = { skills: { path: string; copies: string[] }[] };

const scan = (target: string) => get(`/api/scan?target=${encodeURIComponent(target)}`);

test('listens on 127.0.0.1 only', () => {
  assert.equal((server.address() as AddressInfo).address, '127.0.0.1');
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('GET / → the page: one field, Scan, and a script that reads ?target=', async () => {
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.equal(page.type, 'text/html; charset=utf-8');
  assert.match(page.text, /<input id="target"/);
  assert.match(page.text, /<button id="go" type="submit">Scan<\/button>/);
  assert.match(page.text, /new URLSearchParams\(location\.search\)\.get\('target'\)/);
  assert.match(page.text, /history\.pushState\(null, '', '\?target=' \+ encodeURIComponent\(target\)\)/);
  // What the API answers goes in as text: no innerHTML anywhere.
  assert.doesNotMatch(page.text, /innerHTML/);
  assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
});

test('/?target=<input> serves the same page, which scans at once', async () => {
  const page = await get(`/?target=${encodeURIComponent(FIXTURE)}`);
  assert.equal(page.status, 200);
  assert.equal(page.text, (await get('/')).text);
});

test('GET /api/scan, a GitHub URL → the repository, each skill with its first sentence and pinned link', async () => {
  const response = await scan('https://github.com/JetBrains/example');
  assert.equal(response.status, 200);
  assert.equal(response.type, 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(response.text), {
    repository: {
      id: 'JetBrains/example',
      organization: 'JetBrains',
      name: 'example',
      url: 'https://github.com/JetBrains/example',
      commit: EXAMPLE_COMMIT,
    },
    skills: [
      {
        name: 'commits',
        summary: 'Write commit messages the way this repository does.',
        description: 'Write commit messages the way this repository does. Use for every commit.',
        path: '.claude/skills/commits/SKILL.md',
        link: `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
        copies: [],
      },
    ],
    warnings: [],
  });
});

test('GET /api/scan, a local directory → sorted by name, linked to the files, with the warning', async () => {
  const body = JSON.parse((await scan(FIXTURE)).text);
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(body.repository.id, 'fixture');
  assert.deepEqual(
    body.skills.map((skill: { name: string; link: string }) => [skill.name, skill.link]),
    [
      ['code-style', `${root}/.github/skills/code-style/SKILL.md`],
      ['commits', `${root}/.claude/skills/commits/SKILL.md`],
      ['release-checklist', `${root}/.agents/skills/release-checklist/SKILL.md`],
    ],
  );
  assert.equal(body.skills[2].summary, '');
  assert.equal(body.warnings.length, 1);
  assert.match(body.warnings[0], /^\.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
});

test('GET /api/scan shows what the CLI prints: the same skills, sentences and links', async () => {
  const body = JSON.parse((await scan(FIXTURE)).text);
  const cli = await atlas(['scan', FIXTURE]);
  const lines = body.skills.flatMap((skill: { name: string; summary: string; link: string }) => [
    skill.summary ? `${skill.name} — ${skill.summary}` : skill.name,
    `  ${skill.link}`,
  ]);
  assert.equal(cli.stdout, [`fixture · ${body.skills.length} skills`, ...lines].join('\n'));
});

test('GET /api/scan, copies → `copies` on the one skill', async () => {
  const copy = '.claude/skills/commits/SKILL.md';
  const github = replay({
    ...EXAMPLE,
    'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
      status: 200,
      body: { total_count: 2, items: [{ path: '.agents/skills/commits/SKILL.md' }, { path: copy }] },
    },
    [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.agents/skills/commits/SKILL.md`]:
      EXAMPLE[`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/${copy}`],
  });
  const copies = createWebServer({ open: (input) => openGitHub(input, { fetch: github, token: 'test' }) });
  const address = await listen(copies, 0);
  try {
    const body = (await (await fetch(`${address}/api/scan?target=github.com/JetBrains/example`)).json()) as Scanned;
    assert.equal(body.skills.length, 1);
    assert.equal(body.skills[0].path, '.agents/skills/commits/SKILL.md');
    assert.deepEqual(body.skills[0].copies, [copy]);
  } finally {
    copies.close();
  }
});

test('no target → 400; unreachable repository → 422 with the CLI message; other paths → 404', async () => {
  for (const path of ['/api/scan', '/api/scan?target=', '/api/scan?target=%20']) {
    const missing = await get(path);
    assert.equal(missing.status, 400, path);
    assert.deepEqual(JSON.parse(missing.text), { error: 'Usage: /api/scan?target=<GitHub URL | directory>' });
  }

  const directory = await scan(`${FIXTURE}/no-such-directory`);
  assert.equal(directory.status, 422);
  assert.deepEqual(JSON.parse(directory.text), { error: `Not a GitHub URL or a readable directory: ${FIXTURE}/no-such-directory` });

  const offline = await scan('https://github.com/JetBrains/not-answered');
  assert.equal(offline.status, 422);
  assert.deepEqual(JSON.parse(offline.text), {
    error: 'Cannot reach GitHub: not recorded: https://api.github.com/repos/JetBrains/not-answered',
  });

  for (const path of ['/index.html', '/api', '/api/scan/x', '/../src/cli.ts']) assert.equal((await get(path)).status, 404, path);
});

test('a Host other than 127.0.0.1 or localhost → 403, so DNS rebinding cannot reach it', async () => {
  const port = new URL(base).port;
  for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1.evil.example:${port}`]) {
    const forbidden = await get(`/api/scan?target=${encodeURIComponent(FIXTURE)}`, host);
    assert.equal(forbidden.status, 403, host);
    assert.doesNotMatch(forbidden.text, /fixture/);
  }
  assert.equal((await get('/', `localhost:${port}`)).status, 200);
  assert.equal((await get('/', `127.0.0.1:${port}`)).status, 200);
});

test('the CLI: serve prints its address and answers until stopped', async (t) => {
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const address = await new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      out += chunk;
      const match = /^Skill Atlas at (http:\/\/127\.0\.0\.1:\d+)\n/.exec(out);
      if (match) resolve(match[1]);
    });
    child.on('exit', (code) => reject(new Error(`exited with ${code}`)));
  });
  const body = (await (await fetch(`${address}/api/scan?target=${encodeURIComponent(FIXTURE)}`)).json()) as Scanned;
  assert.equal(body.skills.length, 3);
  assert.equal(child.exitCode, null);
});

test('the CLI: a port that is taken or invalid → a clear message, exit code 1', async (t) => {
  const taken = createServer();
  await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
  t.after(() => taken.close());
  const port = (taken.address() as AddressInfo).port;
  // spawnSync would block the event loop that holds the port; this one runs alongside it.
  const busy = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, 'serve', '--port', String(port)]);
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('exit', (code) => resolve({ code, stderr }));
  });
  assert.equal(busy.code, 1);
  assert.equal(busy.stderr, `Port ${port} is already in use; try --port <n>\n`);

  for (const value of ['abc', '-1', '70000', '1.5']) {
    const invalid = spawnSync(process.execPath, [CLI, 'serve', '--port', value], { encoding: 'utf8' });
    assert.equal(invalid.status, 1, value);
    assert.equal(invalid.stderr, `Not a port: ${value}\nUsage: skill-atlas serve [--port <n>]\n`);
  }
  const extra = spawnSync(process.execPath, [CLI, 'serve', 'now'], { encoding: 'utf8' });
  assert.equal(extra.status, 1);
  assert.equal(extra.stderr, 'Usage: skill-atlas serve [--port <n>]\n');
});

test('help lists serve; the browser terminal, which cannot run a server, says so', async () => {
  assert.match((await atlas(['help'])).stdout, /serve \[--port <n>\] +the same scan in a browser/);
  const output = await createBrowserBackend({ fetch: replay({}) }).run('skill-atlas serve');
  assert.equal(output, 'serve: not available here; run ./skill-atlas serve');
});
