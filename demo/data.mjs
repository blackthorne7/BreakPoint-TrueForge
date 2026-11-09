const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const categories = new Set(['access-control', 'data-exposure', 'injection', 'authentication', 'configuration']);
const statuses = new Set(['completed', 'transport_error', 'tool_error', 'incomplete']);
const verdicts = new Set(['confirmed_vulnerable', 'unconfirmed']);

function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid replay: ${message}`);
}
function ranged(value, min, max) { return finite(value) && value >= min && value <= max; }
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function hasShape(input, keys) { return object(input) && sameJson(Object.keys(input).sort(), [...keys].sort()); }

function copyObservation(input, taskId) {
  requireValue(hasShape(input, ['id', 'target', 'tool', 'status', 'content']) && string(input.id) && string(input.target) && string(input.tool) && statuses.has(input.status) && string(input.content), `bad observation in ${taskId}`);
  return { id: input.id, target: input.target, tool: input.tool, status: input.status, content: input.content };
}
function copyFinding(input, taskId) {
  requireValue(hasShape(input, ['category', 'evidence_ids', 'explanation']) && categories.has(input.category) && Array.isArray(input.evidence_ids) && input.evidence_ids.length > 0 && input.evidence_ids.every(id => typeof id === 'string') && new Set(input.evidence_ids).size === input.evidence_ids.length && string(input.explanation) && input.explanation.trim().length > 0, `bad finding in ${taskId}`);
  return { category: input.category, evidence_ids: [...input.evidence_ids], explanation: input.explanation };
}
function copyDiagnostic(input, taskId, type) {
  const diagnosticKeys = type === 'matched' ? ['category', 'evidence_ids', 'expected_reason', 'actual'] : type === 'missed' ? ['category', 'evidence_ids', 'reason'] : ['category', 'evidence_ids', 'explanation', 'reason'];
  requireValue(hasShape(input, diagnosticKeys) && categories.has(input.category) && Array.isArray(input.evidence_ids) && input.evidence_ids.length > 0 && input.evidence_ids.every(id => typeof id === 'string') && new Set(input.evidence_ids).size === input.evidence_ids.length, `bad ${type} diagnostic in ${taskId}`);
  const item = { category: input.category, evidence_ids: [...input.evidence_ids] };
  if (type === 'matched') {
    requireValue(string(input.expected_reason) && object(input.actual), `bad matched detail in ${taskId}`);
    item.expected_reason = input.expected_reason;
    item.actual = copyFinding(input.actual, taskId);
  } else {
    requireValue(string(input.reason), `bad ${type} reason in ${taskId}`);
    item.reason = input.reason;
    if (type === 'noise') {
      requireValue(string(input.explanation), `bad noise explanation in ${taskId}`);
      item.explanation = input.explanation;
    }
  }
  return item;
}

function closeEnough(actual, expected, places = 4) {
  return finite(actual) && Math.abs(actual - expected) < 0.5 * (10 ** -places) + Number.EPSILON;
}

function validateTask(entry, root, index) {
  requireValue(hasShape(entry, ['schema_version', 'run_id', 'session_id', 'synthetic', 'task', 'parsed_answer', 'scoring']) && entry.schema_version === root.schema_version && entry.run_id === root.run_id && entry.session_id === root.session_id && entry.synthetic === root.synthetic, `task ${index + 1} source/schema mismatch`);
  const task = entry.task;
  requireValue(hasShape(task, ['id', 'title', 'target', 'scenario', 'observations']) && string(task.id) && string(task.title) && string(task.target) && string(task.scenario) && Array.isArray(task.observations) && task.observations.length > 0, `bad task ${index + 1}`);
  const observationIds = new Set();
  const observations = task.observations.map(obs => {
    const safe = copyObservation(obs, task.id);
    requireValue(!observationIds.has(safe.id), `duplicate observation id in ${task.id}`);
    observationIds.add(safe.id);
    return safe;
  });

  const answer = entry.parsed_answer;
  requireValue(answer === null || (hasShape(answer, ['verdict', 'findings']) && verdicts.has(answer.verdict) && Array.isArray(answer.findings)), `bad parsed answer in ${task.id}`);
  const findings = answer === null ? null : answer.findings.map(f => copyFinding(f, task.id));
  const scoring = entry.scoring;
  requireValue(hasShape(scoring, ['score', 'passed', 'parsed', 'verdict_correct', 'precision', 'recall', 'finding_f1', 'matched_count', 'missed_count', 'noise_count', 'error', 'matched', 'missed', 'noise']) && ranged(scoring.score, 0, 1) && typeof scoring.passed === 'boolean' && typeof scoring.parsed === 'boolean' && typeof scoring.verdict_correct === 'boolean', `bad score/flags in ${task.id}`);
  for (const key of ['precision', 'recall', 'finding_f1']) requireValue(ranged(scoring[key], 0, 1), `bad ${key} in ${task.id}`);
  for (const key of ['matched', 'missed', 'noise']) requireValue(Array.isArray(scoring[key]), `bad ${key} diagnostics in ${task.id}`);
  for (const key of ['matched_count', 'missed_count', 'noise_count']) requireValue(Number.isInteger(scoring[key]) && scoring[key] >= 0, `bad ${key} in ${task.id}`);
  const matched = scoring.matched.map(x => copyDiagnostic(x, task.id, 'matched'));
  const missed = scoring.missed.map(x => copyDiagnostic(x, task.id, 'missed'));
  const noise = scoring.noise.map(x => copyDiagnostic(x, task.id, 'noise'));
  requireValue(scoring.matched_count === matched.length && scoring.missed_count === missed.length && scoring.noise_count === noise.length, `diagnostic counts differ in ${task.id}`);
  requireValue(scoring.error === null || scoring.error === 'invalid_json_or_schema' || scoring.error === 'unknown_evidence_id', `bad scoring error in ${task.id}`);

  const expectedTotal = matched.length + missed.length;
  const answerCount = findings?.length ?? 0;
  const precision = answer === null ? 0 : answerCount ? matched.length / answerCount : expectedTotal ? 0 : 1;
  const recall = answer === null ? 0 : expectedTotal ? matched.length / expectedTotal : 1;
  const f1 = answer === null ? 0 : precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const anyUnknown = findings?.some(f => f.evidence_ids.some(id => !observationIds.has(id))) ?? false;
  const passed = answer !== null && scoring.verdict_correct && missed.length === 0 && noise.length === 0 && !anyUnknown;
  requireValue(scoring.parsed === (answer !== null), `parsed-answer flag mismatch in ${task.id}`);
  requireValue(scoring.error === (answer === null ? 'invalid_json_or_schema' : anyUnknown ? 'unknown_evidence_id' : null), `scoring error mismatch in ${task.id}`);
  requireValue(scoring.verdict_correct === (answer !== null && scoring.verdict_correct), `verdict flag mismatch in ${task.id}`);
  requireValue(scoring.passed === passed, `pass flag mismatch in ${task.id}`);
  requireValue(closeEnough(scoring.precision, Math.round(precision * 10000) / 10000) && closeEnough(scoring.recall, Math.round(recall * 10000) / 10000) && closeEnough(scoring.finding_f1, Math.round(f1 * 10000) / 10000), `precision/recall/F1 mismatch in ${task.id}`);
  const expectedScore = scoring.verdict_correct ? 0.4 + 0.6 * f1 : 0;
  requireValue(closeEnough(scoring.score, Math.round(expectedScore * 10000) / 10000), `score formula mismatch in ${task.id}`);
  if (answer === null) requireValue(matched.length === 0 && noise.length === 0 && scoring.score === 0 && !scoring.verdict_correct, `invalid answer has scored findings in ${task.id}`);
  else {
    const findingKey = finding => JSON.stringify([finding.category, [...finding.evidence_ids].sort(), finding.explanation]);
    const reported = [...matched.map(item => item.actual), ...noise.map(item => ({ category: item.category, evidence_ids: item.evidence_ids, explanation: item.explanation }))].map(findingKey).sort();
    const actual = findings.map(findingKey).sort();
    requireValue(sameJson(reported, actual), `answer findings differ from matched/noise diagnostics in ${task.id}`);
  }

  return {
    schema_version: root.schema_version, run_id: root.run_id, session_id: root.session_id, synthetic: root.synthetic,
    task: { id: task.id, title: task.title, target: task.target, scenario: task.scenario, observations },
    parsed_answer: answer === null ? null : { verdict: answer.verdict, findings },
    scoring: { score: scoring.score, passed: scoring.passed, parsed: scoring.parsed, verdict_correct: scoring.verdict_correct,
      precision: scoring.precision, recall: scoring.recall, finding_f1: scoring.finding_f1,
      matched_count: matched.length, missed_count: missed.length, noise_count: noise.length, error: scoring.error,
      matched, missed, noise }
  };
}

/** Validate a replay and return a curated object that round-trips the replay contract. */
export function projectReplay(raw) {
  requireValue(hasShape(raw, ['schema_version', 'run_id', 'session_id', 'synthetic', 'contract_sha256', 'summary', 'tasks']) && raw.schema_version === '1.0', 'unsupported root schema');
  requireValue(typeof raw.synthetic === 'boolean', 'missing source flag');
  requireValue(raw.synthetic ? raw.run_id === null && raw.session_id === null : Number.isInteger(raw.run_id) && raw.run_id > 0 && string(raw.session_id), 'source metadata mismatch');
  requireValue(string(raw.contract_sha256) && /^[a-f0-9]{64}$/i.test(raw.contract_sha256), 'bad contract fingerprint');
  requireValue(hasShape(raw.summary, ['score', 'tasks_passed', 'tasks_total']) && ranged(raw.summary.score, 0, 100) && Number.isInteger(raw.summary.tasks_passed) && Number.isInteger(raw.summary.tasks_total) && raw.summary.tasks_total > 0 && raw.summary.tasks_passed >= 0 && raw.summary.tasks_passed <= raw.summary.tasks_total, 'bad summary');
  requireValue(Array.isArray(raw.tasks) && raw.tasks.length === raw.summary.tasks_total, 'task count differs from summary');
  if (raw.synthetic) requireValue(raw.tasks.length === 1, 'synthetic examples must contain one task');
  const ids = new Set();
  const tasks = raw.tasks.map((entry, index) => {
    const item = validateTask(entry, raw, index);
    requireValue(!ids.has(item.task.id), `duplicate task id ${item.task.id}`);
    ids.add(item.task.id);
    return item;
  });
  const passed = tasks.filter(task => task.scoring.passed).length;
  const average = tasks.reduce((sum, task) => sum + task.scoring.score, 0) / tasks.length * 100;
  requireValue(raw.summary.tasks_passed === passed && raw.summary.tasks_total === tasks.length && closeEnough(raw.summary.score, Math.round(average * 100) / 100, 2), 'run summary differs from task scores');
  return { schema_version: raw.schema_version, run_id: raw.run_id, session_id: raw.session_id, synthetic: raw.synthetic,
    contract_sha256: raw.contract_sha256, summary: { score: raw.summary.score, tasks_passed: passed, tasks_total: tasks.length }, tasks };
}

function taskContext(run) { return JSON.stringify(run.tasks.map(({ task }) => task)); }

/** Compare measured runs only when contract and every ordered task context match. */
export function compareMeasuredRuns(before, after) {
  if (!before || !after || before.synthetic || after.synthetic) return { comparable: false, reason: 'Comparisons require two measured runs.' };
  if (!Number.isInteger(before.run_id) || !Number.isInteger(after.run_id) || after.run_id <= before.run_id || !before.session_id || !after.session_id || before.session_id === after.session_id) return { comparable: false, reason: 'Comparisons require distinct, ordered run sessions.' };
  if (before.contract_sha256 !== after.contract_sha256) return { comparable: false, reason: 'The contract fingerprints differ.' };
  if (taskContext(before) !== taskContext(after)) return { comparable: false, reason: 'The ordered task context differs.' };
  return { comparable: true, score_delta: after.summary.score - before.summary.score,
    passed_delta: after.summary.tasks_passed - before.summary.tasks_passed,
    tasks: after.tasks.map((task, index) => ({ id: task.task.id, score_delta: task.scoring.score - before.tasks[index].scoring.score, pass_changed: task.scoring.passed !== before.tasks[index].scoring.passed })) };
}
