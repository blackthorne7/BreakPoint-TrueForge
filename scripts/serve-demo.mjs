import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectReplay } from '../demo/data.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const staticFiles = new Map([
  ['/', ['demo/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['demo/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['demo/styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['demo/app.js', 'text/javascript; charset=utf-8']],
  ['/data.mjs', ['demo/data.mjs', 'text/javascript; charset=utf-8']]
]);

function response(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function scoreMetadata(root, runDir, replay) {
  try {
    const raw = JSON.parse(await readFile(join(root, 'runs', runDir, 'score.json'), 'utf8'));
    if (raw.run !== replay.run_id || raw.session_id !== replay.session_id || raw.contract_sha256 !== replay.contract_sha256) return null;
    const score = {};
    for (const key of ['tokens', 'toolCalls', 'duration_s']) if (Number.isFinite(raw[key]) && raw[key] >= 0) score[key] = raw[key];
    if (typeof raw.agent_commit === 'string' && /^[a-f0-9]{7,64}$/i.test(raw.agent_commit)) score.agent_commit = raw.agent_commit;
    return score;
  } catch { return null; }
}

export async function collectRuns(root = repoRoot) {
  let dirs = [];
  try { dirs = await readdir(join(root, 'runs'), { withFileTypes: true }); } catch { return []; }
  const result = [];
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  const seenRuns = new Set();
  const seenSessions = new Set();
  for (const dir of dirs) {
    if (!dir.isDirectory() || !/^run-[0-9]+$/.test(dir.name)) continue;
    try {
      const raw = JSON.parse(await readFile(join(root, 'runs', dir.name, 'replay.json'), 'utf8'));
      const replay = projectReplay(raw);
      if (replay.synthetic) continue;
      const directoryRun = Number(dir.name.slice(4));
      if (!Number.isSafeInteger(directoryRun) || directoryRun !== replay.run_id || seenRuns.has(replay.run_id) || seenSessions.has(replay.session_id)) continue;
      result.push({ replay, metrics: await scoreMetadata(root, dir.name, replay) });
      seenRuns.add(replay.run_id);
      seenSessions.add(replay.session_id);
    } catch { /* A malformed replay is excluded rather than partially displayed. */ }
  }
  result.sort((a, b) => a.replay.run_id - b.replay.run_id);
  return result;
}

export async function collectSynthetic(root = repoRoot) {
  const result = [];
  for (const name of ['replay-partial-synthetic.json', 'replay-synthetic.json']) {
    try {
      const replay = projectReplay(JSON.parse(await readFile(join(root, 'examples', name), 'utf8')));
      if (replay.synthetic) result.push({ label: basename(name, '.json'), replay });
    } catch { /* Missing or malformed examples remain unavailable. */ }
  }
  return result;
}

export async function handleDemoRequest(req, res, root = repoRoot) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') return response(res, 405, { error: 'Method not allowed.' });
  if (url.pathname === '/api/runs') return response(res, 200, { runs: await collectRuns(root) });
  if (url.pathname === '/api/examples') return response(res, 200, { examples: await collectSynthetic(root) });
  const file = staticFiles.get(url.pathname);
  if (!file || url.search) return response(res, 404, { error: 'Not found.' });
  try {
    const body = await readFile(join(root, file[0]));
    res.writeHead(200, { 'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  } catch { return response(res, 404, { error: 'Demo asset unavailable.' }); }
}

export function createDemoServer(root = repoRoot) {
  return createServer((req, res) => { handleDemoRequest(req, res, root).catch(() => response(res, 500, { error: 'Local demo request failed.' })); });
}

function selectedPort(argv) {
  const index = argv.indexOf('--port');
  if (index === -1) return 4173;
  const port = Number(argv[index + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535');
  return port;
}
export function selectedHost(argv) {
  const index = argv.indexOf('--host');
  if (index === -1) return '127.0.0.1';
  const host = argv[index + 1];
  if (host !== '127.0.0.1' && host !== '0.0.0.0') throw new Error('--host must be 127.0.0.1 or 0.0.0.0');
  return host;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const port = selectedPort(args);
    const host = selectedHost(args);
    const server = createDemoServer();
    server.on('error', error => {
      if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Choose another with: npm run demo -- --port <port>`);
      else console.error(`Could not start the BreakPoint demo: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, host, () => console.log(`BreakPoint demo at http://${host}:${port}`));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
