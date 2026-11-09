import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectReplay, compareMeasuredRuns } from './data.mjs';
import { collectRuns, handleDemoRequest, selectedHost } from '../scripts/serve-demo.mjs';
import { loadTasks } from '../evals/contract.ts';
import { replayRun } from '../evals/replay.ts';

const synthetic = JSON.parse(await readFile(new URL('../examples/replay-synthetic.json', import.meta.url), 'utf8'));
function measuredReplay(run = 1, session = `session-test-${run}`) {
  const replay = structuredClone(synthetic);
  replay.synthetic = false; replay.run_id = run; replay.session_id = session;
  replay.tasks.forEach(task => { task.synthetic = false; task.run_id = run; task.session_id = session; });
  return replay;
}
function lowerScoredReplay() {
  const replay = measuredReplay(2);
  const task = replay.tasks[0], finding = { category: 'configuration', evidence_ids: ['ev-1u4'], explanation: 'Recorded extra finding.' };
  task.parsed_answer.findings.push(finding);
  task.scoring.score = 0.88; task.scoring.passed = false; task.scoring.precision = 0.6667; task.scoring.finding_f1 = 0.8;
  task.scoring.noise_count = 1;
  task.scoring.noise.push({ ...finding, reason: 'No remaining expected finding matched this exact category and citation set.' });
  replay.summary.score = 88; replay.summary.tasks_passed = 0;
  return replay;
}
async function fixtureRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'breakpoint-demo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(['runs/run-01', 'examples', 'demo'].map(path => mkdir(join(root, path), { recursive: true })));
  await writeFile(join(root, 'runs/run-01/replay.json'), JSON.stringify(measuredReplay()));
  await writeFile(join(root, 'runs/run-01/score.json'), JSON.stringify({ run: 1, session_id: 'session-test-1', contract_sha256: synthetic.contract_sha256, tokens: 234, toolCalls: 2, duration_s: 3, agent_commit: 'abcdef123456789' }));
  await writeFile(join(root, 'runs/run-01/session.json'), 'PRIVATE SESSION CONTENT');
  await writeFile(join(root, '.env'), 'PRIVATE MODEL KEY');
  await writeFile(join(root, '.local'), 'PRIVATE LOCAL STATE');
  await writeFile(join(root, 'examples/replay-synthetic.json'), JSON.stringify(synthetic));
  await writeFile(join(root, 'demo/styles.css'), 'body { color: white }');
  return root;
}

test('projection preserves the full contracted task/source/diagnostic shape and is idempotent', () => {
  const replay = projectReplay(measuredReplay());
  assert.equal(replay.tasks[0].schema_version, '1.0');
  assert.equal(replay.tasks[0].run_id, 1);
  assert.equal(replay.tasks[0].session_id, 'session-test-1');
  assert.equal(replay.tasks[0].task.id, 'case-p6a3');
  assert.equal(replay.tasks[0].scoring.matched_count, 2);
  assert.equal(replay.tasks[0].scoring.matched[0].expected_reason, synthetic.tasks[0].scoring.matched[0].expected_reason);
  assert.deepEqual(projectReplay(replay), replay);
});

test('projection rejects source/schema mismatches, malformed observations, and invalid aggregates', () => {
  const wrongSource = measuredReplay(); wrongSource.tasks[0].session_id = 'other';
  assert.throws(() => projectReplay(wrongSource), /source\/schema mismatch/);
  const badScore = measuredReplay(); badScore.tasks[0].scoring.score = 4;
  assert.throws(() => projectReplay(badScore), /bad score/);
  const badObservation = measuredReplay(); badObservation.tasks[0].task.observations[0].status = 'unknown';
  assert.throws(() => projectReplay(badObservation), /bad observation/);
  const badCount = measuredReplay(); badCount.tasks[0].scoring.matched_count++;
  assert.throws(() => projectReplay(badCount), /diagnostic counts differ/);
  const badSummary = measuredReplay(); badSummary.summary.score = 99;
  assert.throws(() => projectReplay(badSummary), /run summary differs/);
});

test('projection accepts a contract-valid failed parse with zeroed scorer metrics', () => {
  const replay = measuredReplay(), task = replay.tasks[0], expected = task.scoring.matched;
  task.parsed_answer = null;
  Object.assign(task.scoring, { score: 0, passed: false, parsed: false, verdict_correct: false, precision: 0, recall: 0, finding_f1: 0,
    matched_count: 0, missed_count: expected.length, noise_count: 0, error: 'invalid_json_or_schema', matched: [],
    missed: expected.map(item => ({ category: item.category, evidence_ids: item.evidence_ids, reason: item.expected_reason })), noise: [] });
  replay.summary.score = 0; replay.summary.tasks_passed = 0;
  assert.equal(projectReplay(replay).tasks[0].parsed_answer, null);
});

test('projection accepts an actual scorer replay whose score uses unrounded F1', () => {
  const task = loadTasks().find(candidate => candidate.expected.findings.length === 2);
  assert.ok(task, 'expected a task with two scorer findings');
  const findings = task.expected.findings.map(item => ({ category: item.category, evidence_ids: item.evidence_ids, explanation: item.why }));
  const duplicate = structuredClone(findings[0]);
  const reply = JSON.stringify({ verdict: task.expected.verdict, findings: [...findings, duplicate, structuredClone(duplicate), structuredClone(duplicate)] });
  const replay = replayRun([{ task, reply }], { run_id: 1, session_id: 'score-rounding-test', synthetic: false }, 'a'.repeat(64));
  const projection = projectReplay(replay);
  assert.equal(projection.tasks[0].scoring.finding_f1, 0.5714);
  assert.equal(projection.tasks[0].scoring.score, 0.7429);
});

test('measured comparisons require consistent scored data, same contract, and ordered context', () => {
  const before = projectReplay(measuredReplay());
  const after = projectReplay(lowerScoredReplay());
  assert.equal(compareMeasuredRuns(before, after).score_delta, -12);
  const changedContext = structuredClone(after); changedContext.tasks[0].task.observations.reverse();
  assert.equal(compareMeasuredRuns(before, changedContext).comparable, false);
  const changedContract = structuredClone(after); changedContract.contract_sha256 = 'a'.repeat(64);
  assert.equal(compareMeasuredRuns(before, changedContract).comparable, false);
  const copiedRun = structuredClone(after); copiedRun.run_id = before.run_id;
  assert.equal(compareMeasuredRuns(before, copiedRun).comparable, false);
  const copiedSession = structuredClone(after); copiedSession.session_id = before.session_id;
  assert.equal(compareMeasuredRuns(before, copiedSession).comparable, false);
  assert.equal(compareMeasuredRuns(projectReplay(synthetic), after).comparable, false);
});

test('request handler exposes only curated records and rejects private/arbitrary paths', async t => {
  const root = await fixtureRoot(t);
  async function request(url, method = 'GET') {
    const response = { headers: {}, status: 0, body: '' };
    response.setHeader = (key, value) => { response.headers[key.toLowerCase()] = value; };
    response.writeHead = (status, headers) => { response.status = status; Object.assign(response.headers, Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))); };
    response.end = body => { response.body = body?.toString() ?? ''; };
    await handleDemoRequest({ method, url }, response, root);
    return response;
  }
  const [runs, examples, privateFile, localFile, sessionFile, arbitrary, staticFile, post] = await Promise.all([
    request('/api/runs'), request('/api/examples'), request('/.env'), request('/.local'), request('/runs/run-01/session.json'), request('/anything'), request('/styles.css'), request('/api/runs', 'POST')
  ]);
  assert.equal(runs.status, 200); assert.equal(examples.status, 200);
  assert.equal(privateFile.status, 404); assert.equal(localFile.status, 404); assert.equal(sessionFile.status, 404); assert.equal(arbitrary.status, 404);
  assert.equal(staticFile.status, 200); assert.equal(post.status, 405);
  const data = JSON.parse(runs.body);
  assert.equal(data.runs[0].replay.summary.score, 100);
  assert.equal(data.runs[0].metrics.tokens, 234);
  assert.equal(JSON.stringify(data).includes('PRIVATE'), false);
  assert.equal(JSON.parse(examples.body).examples[0].replay.synthetic, true);
  assert.match(runs.headers['content-security-policy'], /default-src 'self'/);
});

test('run discovery handles absent data and reads only valid run files from its supplied root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'breakpoint-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await collectRuns(root), []);
  await mkdir(join(root, 'runs/run-01'), { recursive: true });
  await writeFile(join(root, 'runs/run-01/replay.json'), JSON.stringify(measuredReplay()));
  assert.equal((await collectRuns(root)).length, 1);
  await mkdir(join(root, 'runs/run-02'), { recursive: true });
  await writeFile(join(root, 'runs/run-02/replay.json'), JSON.stringify(measuredReplay())); // directory suffix disagrees
  await writeFile(join(root, 'runs/run-02/score.json'), '{}');
  await mkdir(join(root, 'runs/run-001'), { recursive: true });
  await writeFile(join(root, 'runs/run-001/replay.json'), JSON.stringify(measuredReplay())); // duplicate run number
  await mkdir(join(root, 'runs/run-03'), { recursive: true });
  await writeFile(join(root, 'runs/run-03/replay.json'), JSON.stringify(measuredReplay(3, 'session-test-1'))); // duplicate session
  assert.equal((await collectRuns(root)).length, 1);
  await writeFile(join(root, 'runs/run-01/replay.json'), '{broken');
  await writeFile(join(root, 'runs/run-001/replay.json'), '{broken');
  await writeFile(join(root, 'runs/run-03/replay.json'), '{broken');
  assert.deepEqual(await collectRuns(root), []);
});

test('demo host accepts loopback by default and the two supported bind addresses', () => {
  assert.equal(selectedHost([]), '127.0.0.1');
  assert.equal(selectedHost(['--host', '127.0.0.1']), '127.0.0.1');
  assert.equal(selectedHost(['--host', '0.0.0.0']), '0.0.0.0');
  assert.throws(() => selectedHost(['--host', 'localhost']), /--host must be/);
  assert.throws(() => selectedHost(['--host']), /--host must be/);
});
