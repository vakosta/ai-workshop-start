// The local web view: one page and one JSON endpoint over the same core as the CLI, on
// 127.0.0.1 only. Nothing is stored.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { firstSentence } from './commands.ts';
import { AtlasError } from './core/errors.ts';
import { skillLink } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export const HOST = '127.0.0.1';

export type WebOptions = {
  /** Opens what the user asked to scan, as for the CLI. */
  open(input: string): Promise<Source>;
};

/** The skills of a scan, as the page shows them. */
export async function scanJson(source: Source) {
  const { repository, skills, warnings } = await scan(source);
  return {
    repository,
    skills: skills.map((skill) => ({
      name: skill.name,
      summary: firstSentence(skill.description),
      description: skill.description,
      path: skill.path,
      link: skillLink(repository, skill),
      copies: skill.copies,
    })),
    warnings,
  };
}

export function createWebServer(options: WebOptions): Server {
  return createServer((request, response) => {
    handle(request, response, options).catch((error) => {
      send(response, 500, { error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` });
    });
  });
}

/** Starts the server on 127.0.0.1; resolves to its address once it listens. */
export function listen(server: Server, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const failed = (error: NodeJS.ErrnoException) =>
      reject(new AtlasError(error.code === 'EADDRINUSE' ? `Port ${port} is already in use; try --port <n>` : `Cannot listen on port ${port}: ${error.message}`));
    server.once('error', failed);
    server.listen(port, HOST, () => {
      server.off('error', failed);
      const address = server.address();
      resolve(`http://${HOST}:${typeof address === 'object' && address ? address.port : port}`);
    });
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, { open }: WebOptions) {
  // Only this machine's own names: a page elsewhere cannot rebind its domain to 127.0.0.1.
  const host = /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(request.headers.host ?? '');
  if (!host) return send(response, 403, { error: 'Forbidden host' });
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Method not allowed' });

  const url = new URL(request.url ?? '/', `http://${HOST}`);
  if (url.pathname === '/') return sendPage(response);
  if (url.pathname !== '/api/scan') return send(response, 404, { error: 'Not found' });

  const target = url.searchParams.get('target')?.trim();
  if (!target) return send(response, 400, { error: 'Usage: /api/scan?target=<GitHub URL | directory>' });
  try {
    send(response, 200, await scanJson(await open(target)));
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    send(response, 422, { error: error.message });
  }
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function sendPage(response: ServerResponse) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
  });
  response.end(PAGE);
}

/** The page: plain HTML, CSS and a script; everything from the API goes in as text, never as HTML. */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skill Atlas</title>
<style>
  :root { color-scheme: light dark; --muted: #6b7280; --line: #d1d5db; --accent: #2563eb; --warn: #b45309; --err: #b91c1c; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; margin: 0 0 1rem; }
  form { display: flex; gap: .5rem; }
  input { flex: 1; font: inherit; padding: .5rem .7rem; border: 1px solid var(--line); border-radius: 6px; }
  button { font: inherit; padding: .5rem 1rem; border: 0; border-radius: 6px; background: var(--accent); color: #fff; cursor: pointer; }
  button:disabled { opacity: .6; cursor: progress; }
  #status { margin: 1.25rem 0 .5rem; font-weight: 600; }
  #status.error { color: var(--err); font-weight: 400; white-space: pre-wrap; }
  #warnings { margin: 0 0 1rem; padding: 0; list-style: none; color: var(--warn); font-size: .9rem; }
  #skills { margin: 0; padding: 0; list-style: none; }
  #skills li { padding: .75rem 0; border-top: 1px solid var(--line); }
  #skills a { font-weight: 600; color: var(--accent); text-decoration: none; }
  #skills a:hover { text-decoration: underline; }
  .summary { margin: .15rem 0; }
  .path, .copies { color: var(--muted); font: .82rem ui-monospace, monospace; }
</style>
</head>
<body>
<h1>Skill Atlas</h1>
<form id="scan">
  <input id="target" name="target" placeholder="https://github.com/owner/repo or a local directory" autocomplete="off" required autofocus>
  <button id="go" type="submit">Scan</button>
</form>
<div id="status"></div>
<ul id="warnings"></ul>
<ul id="skills"></ul>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text) e.textContent = text; return e; };

async function run(target) {
  $('target').value = target;
  $('go').disabled = true;
  $('status').className = '';
  $('status').textContent = 'Scanning ' + target + '…';
  $('warnings').replaceChildren();
  $('skills').replaceChildren();
  try {
    const response = await fetch('/api/scan?target=' + encodeURIComponent(target));
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    show(body);
  } catch (error) {
    $('status').className = 'error';
    $('status').textContent = error.message;
  } finally {
    $('go').disabled = false;
  }
}

function show({ repository, skills, warnings }) {
  $('status').textContent = repository.id + ' · ' + skills.length + (skills.length === 1 ? ' skill' : ' skills');
  $('warnings').replaceChildren(...warnings.map((w) => el('li', '', 'warning: ' + w)));
  $('skills').replaceChildren(...skills.map((skill) => {
    const li = el('li');
    const link = el('a', '', skill.name);
    link.href = skill.link;
    link.target = '_blank';
    link.rel = 'noopener';
    li.append(link);
    if (skill.summary) { const p = el('div', 'summary', skill.summary); p.title = skill.description; li.append(p); }
    li.append(el('div', 'path', skill.path));
    if (skill.copies.length) li.append(el('div', 'copies', 'also in ' + skill.copies.join(', ')));
    return li;
  }));
}

$('scan').addEventListener('submit', (event) => {
  event.preventDefault();
  const target = $('target').value.trim();
  if (!target) return;
  history.pushState(null, '', '?target=' + encodeURIComponent(target));
  run(target);
});
const initial = () => { const target = new URLSearchParams(location.search).get('target'); if (target) run(target); };
addEventListener('popstate', initial);
initial();
</script>
</body>
</html>
`;
