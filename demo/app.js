import { compareMeasuredRuns } from './data.mjs';
const $ = selector => document.querySelector(selector);
const state = { runs: [], examples: [], selected: 0, activeTask: 0, filter: 'all', query: '', mode: 'measured', toastTimer: 0 };
const verdictLabel = verdict => verdict === 'confirmed_vulnerable' ? 'Confirmed vulnerable' : 'Unconfirmed';
const scoreLabel = score => `${Math.round(score * 100)}%`;
const deltaLabel = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
const runLabel = item => `Run ${String(item.replay.run_id).padStart(2, '0')}`;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function fmt(value, suffix = '') { return Number.isFinite(value) ? `${new Intl.NumberFormat().format(value)}${suffix}` : '—'; }
function currentEntry() { return state.mode === 'measured' ? state.runs[state.selected] : state.examples[state.selected]; }
function currentReplay() { return currentEntry()?.replay ?? null; }
function measuredBaseline() {
  const selected = state.mode === 'measured' ? state.runs[state.selected] : null;
  return selected ? state.runs.slice(0, state.selected).find(item => compareMeasuredRuns(item.replay, selected.replay).comparable) ?? null : null;
}
function setError(container, message) {
  container.replaceChildren();
  const box = el('div', 'error-box', message);
  const retry = el('button', '', 'Retry'); retry.type = 'button'; retry.addEventListener('click', load);
  box.append(' '); box.append(retry); container.append(box);
}

function renderOverview() {
  const replay = currentReplay(), entry = currentEntry(), area = $('#overview-content');
  area.replaceChildren();
  if (!replay) { $('#download-button').disabled = true; setError(area, 'No valid replay is available. Check the local run files and retry.'); return; }
  const metrics = el('div', 'metrics');
  const values = [
    ['Overall score', replay.summary.score, '/100', true],
    ['Tasks passed', replay.summary.tasks_passed, `/${replay.summary.tasks_total}`],
    ['Tokens', entry.metrics?.tokens, ''],
    ['Elapsed time', entry.metrics?.duration_s, ' sec'],
    ['Tool calls', entry.metrics?.toolCalls, '']
  ];
  values.forEach(([label, value, suffix, primary]) => {
    const item = el('div', `metric${primary ? ' metric-primary' : ''}`);
    item.append(el('div', 'metric-label', label));
    const amount = value === undefined ? '—' : fmt(value);
    const number = el('div', 'metric-value'); number.textContent = amount;
    if (suffix) number.append(el('small', '', suffix));
    item.append(number); metrics.append(item);
  });
  area.append(metrics);
  const callout = el('div', 'baseline-callout');
  callout.append(el('strong', '', state.mode === 'synthetic' ? 'Synthetic example' : replay.summary.score === 100 ? 'Baseline recorded' : 'Recorded baseline'));
  const calloutStatus = state.mode === 'synthetic' ? 'SYNTHETIC FIXTURE · NOT MEASURED' : state.runs.length < 2 ? 'AWAITING LATER RUN · SELF-IMPROVEMENT NOT YET DEMONSTRATED' : measuredBaseline() ? 'SCORE DELTA BELOW · AGENT REVISION NOT YET VERIFIED' : 'NO MATCHED EARLIER BASELINE FOR THIS RUN';
  callout.append(el('span', '', calloutStatus));
  area.append(callout);
  const provenance = el('details', 'provenance');
  const summary = el('summary', '', 'Replay provenance'); provenance.append(summary);
  const provenanceRows = el('dl', 'provenance-list');
  const rows = [['Source', replay.synthetic ? 'Synthetic fixture · not measured' : 'Recorded evaluation run'], ['Session ID', replay.session_id || 'Unavailable'], ['Contract SHA-256', replay.contract_sha256], ['Agent commit', entry.metrics?.agent_commit || 'Unavailable']];
  rows.forEach(([label, value]) => { provenanceRows.append(el('dt', '', label)); provenanceRows.append(el('dd', '', value)); });
  provenance.append(provenanceRows); area.append(provenance);
  $('#source-label').textContent = state.mode === 'synthetic' ? 'SYNTHETIC FIXTURE · NOT MEASURED' : 'MEASURED RUN';
  $('#run-heading').textContent = state.mode === 'synthetic' ? `Example · ${entry.label}` : `${runLabel(entry)} performance`;
  $('#download-button').disabled = false;
}

function renderComparison() {
  const host = $('#comparison-content'); host.replaceChildren();
  const actual = state.runs;
  if (state.mode === 'synthetic') {
    $('#comparison-status').textContent = 'SYNTHETIC MODE';
    host.append(el('div', 'compare-empty', 'Measured comparison is hidden while a synthetic fixture is selected. Return to measured runs to review run-to-run evidence.'));
    host.append(el('p', 'comparison-caption', 'SYNTHETIC FIXTURES ARE SEPARATE EXAMPLES AND ARE NOT MEASURED RUNS.'));
    return;
  }
  const selected = actual[state.selected];
  const baseline = measuredBaseline();
  $('#comparison-status').textContent = baseline ? 'COMPARABLE RUNS' : 'AWAITING MATCHED BASELINE';
  if (!selected) {
    host.append(el('div', 'compare-empty', 'No measured replay is available to compare.'));
  } else if (!baseline) {
    const box = el('div', 'compare-run'); box.append(el('strong', '', `Selected · ${runLabel(selected)}`)); box.append(el('span', '', `${selected.replay.summary.score}/100 · ${selected.replay.summary.tasks_passed}/${selected.replay.summary.tasks_total} passed`)); host.append(box);
    const empty = el('div', 'compare-empty');
    if (state.selected === 0) {
      empty.append(el('strong', '', 'No earlier measured run is recorded. '));
      empty.append(document.createTextNode('A later run must use this same contract and ordered task context before scores can be compared.'));
    } else {
      empty.append(el('strong', '', 'No earlier run with the same contract and ordered task context. '));
      empty.append(document.createTextNode('This selected run has no valid measured baseline in the recorded set.'));
    }
    host.append(empty);
  } else {
    const latest = selected, previous = baseline;
    const grid = el('div', 'comparison-body');
    for (const [item, label] of [[previous, 'Earlier measured run'], [latest, 'Selected measured run']]) {
      const box = el('div', 'compare-run'); box.append(el('strong', '', `${label} · ${runLabel(item)}`)); box.append(el('span', '', `${item.replay.summary.score}/100 · ${item.replay.summary.tasks_passed}/${item.replay.summary.tasks_total} passed`)); grid.append(box);
      if (item === previous) grid.append(el('div', 'compare-arrow', '→'));
    }
    host.append(grid);
    const comparison = compareMeasuredRuns(previous.replay, latest.replay);
    if (!comparison?.comparable) {
      const empty = el('div', 'compare-empty'); empty.textContent = `These runs cannot be compared: ${comparison?.reason ?? 'comparison data is unavailable'}`; host.append(empty);
    } else {
      const s = comparison.score_delta > 0 ? '+' : '';
      const p = comparison.passed_delta > 0 ? '+' : '';
      const empty = el('div', 'compare-empty'); empty.textContent = `Change: ${s}${deltaLabel(comparison.score_delta)} points · ${p}${comparison.passed_delta} tasks passed. This is a score comparison; an agent-authored revision between runs must be verified separately.`; host.append(empty);
    }
  }
  host.append(el('p', 'comparison-caption', 'COMPARISON USES THE EARLIEST EARLIER MEASURED RUN WITH MATCHING CONTRACT AND ORDERED TASK CONTEXT.'));
}

function renderRevision() {
  const host = $('#revision-content'); host.replaceChildren();
  host.append(el('span', 'empty-change-mark', '↗'));
  const message = el('div');
  message.append(el('strong', '', 'No agent revision details in the replay'));
  message.append(el('p', '', 'The replay contract records scores and evidence, but does not include revision history.'));
  host.append(message);
}

function visibleTasks(replay) {
  const q = state.query.trim().toLowerCase();
  return replay.tasks.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
    const pass = entry.scoring.passed === true;
    if (state.filter === 'passed' && !pass) return false;
    if (state.filter === 'review' && pass) return false;
    const task = entry.task;
    return !q || `${task.id} ${task.title} ${task.target} ${task.scenario}`.toLowerCase().includes(q);
  });
}

function renderTasks() {
  const replay = currentReplay(), list = $('#task-list');
  const restoreFocus = list.contains(document.activeElement);
  list.replaceChildren();
  if (!replay) {
    state.activeTask = -1;
    $('#task-count').textContent = '—'; $('#task-empty').textContent = 'No validated task replay is available.'; $('#task-empty').hidden = false;
    renderDetail(); return;
  }
  const visible = visibleTasks(replay);
  const baseline = measuredBaseline();
  if (!visible.some(item => item.index === state.activeTask)) state.activeTask = visible[0]?.index ?? -1;
  $('#task-count').textContent = `${replay.tasks.length} CASES`;
  $('#task-empty').hidden = visible.length > 0;
  visible.forEach(({ entry, index }) => {
    const { task, scoring } = entry;
    const btn = el('button', 'task-row'); btn.type = 'button'; btn.setAttribute('aria-pressed', String(index === state.activeTask)); btn.dataset.taskIndex = String(index);
    btn.append(el('span', 'task-row-title', task.title)); btn.append(el('span', 'task-row-score', scoreLabel(scoring.score)));
    btn.append(el('span', 'task-row-target', task.target));
    btn.append(el('span', 'task-row-id', task.id));
    const taskDelta = baseline ? (scoring.score - baseline.replay.tasks[index].scoring.score) * 100 : null;
    const deltaText = taskDelta === null ? '' : ` · Δ ${taskDelta > 0 ? '+' : ''}${Math.round(taskDelta)}pp`;
    const findingCount = entry.parsed_answer?.findings.length ?? 0;
    const findingText = `${findingCount} finding${findingCount === 1 ? '' : 's'}`;
    const observationText = `${task.observations.length} observation${task.observations.length === 1 ? '' : 's'}`;
    btn.append(el('span', 'task-row-meta', `${findingText} · ${observationText}${deltaText}`));
    btn.append(el('span', `mini-status${scoring.passed === true ? '' : ' review'}`, scoring.passed === true ? 'PASS' : 'REVIEW'));
    btn.addEventListener('click', () => { state.activeTask = index; renderTasks(); }); list.append(btn);
  });
  if (!visible.length) state.activeTask = -1;
  if (restoreFocus && state.activeTask >= 0) list.querySelector(`[data-task-index="${state.activeTask}"]`)?.focus({ preventScroll: true });
  renderDetail();
}

function citationChip(id, available) {
  const button = el('button', 'citation-chip', id); button.type = 'button'; button.setAttribute('aria-label', `Show observation ${id}`); button.setAttribute('aria-pressed', 'false');
  button.disabled = !available;
  if (!available) { button.title = 'No recorded observation has this evidence ID.'; button.setAttribute('aria-label', `Evidence ${id} has no matching recorded observation`); return button; }
  button.addEventListener('click', () => {
    const target = document.getElementById(`observation-${id}`);
    if (!target) return;
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    document.querySelectorAll('.observation-card.highlight').forEach(node => node.classList.remove('highlight'));
    document.querySelectorAll('.citation-chip[aria-pressed="true"]').forEach(node => node.setAttribute('aria-pressed', 'false'));
    target.classList.add('highlight'); button.setAttribute('aria-pressed', 'true');
    target.focus({ preventScroll: true });
  });
  return button;
}

function renderDetail() {
  const replay = currentReplay(), host = $('#task-detail'); host.replaceChildren();
  if (!replay) { setError(host, 'Task evidence is unavailable.'); return; }
  const item = replay.tasks[state.activeTask];
  if (!item) {
    $('#diagnostics-body').replaceChildren();
    host.append(el('div', 'empty-state', 'No task matches this search or filter. Adjust the search or choose another filter.'));
    return;
  }
  const { task, parsed_answer: answer, scoring } = item;
  const observationIds = new Set(task.observations.map(observation => observation.id));
  const head = el('div', 'detail-head'), left = el('div');
  left.append(el('div', 'detail-id', task.id)); left.append(el('h3', '', task.title)); left.append(el('div', 'detail-target', task.target));
  head.append(left);
  const verdict = el('div', `verdict${answer?.verdict === 'unconfirmed' ? ' inconclusive' : answer ? '' : ' failed'}`, answer ? verdictLabel(answer.verdict).toUpperCase() : 'PARSE ERROR');
  verdict.title = answer?.verdict === 'unconfirmed' ? 'Insufficient recorded evidence to confirm a finding' : '';
  const headStatus = el('div', 'detail-status'); headStatus.append(verdict);
  headStatus.append(el('div', `task-score${scoring.passed === true ? '' : ' review'}`, `${scoreLabel(scoring.score)} · ${scoring.passed === true ? 'PASS' : 'REVIEW'}`));
  const baseline = measuredBaseline();
  if (baseline) {
    const delta = (scoring.score - baseline.replay.tasks[state.activeTask].scoring.score) * 100;
    headStatus.append(el('div', 'task-delta', `${delta > 0 ? '+' : ''}${Math.round(delta)}pp`));
  }
  head.append(headStatus); host.append(head);
  host.append(el('p', 'scenario', task.scenario));
  host.append(el('div', 'subheading', 'AGENT RESPONSE'));
  const block = el('div', 'answer-block');
  const answerTitle = el('div', 'answer-verdict', answer ? verdictLabel(answer.verdict) : 'No valid structured answer'); block.append(answerTitle);
  if (answer?.findings.length) {
    answer.findings.forEach(finding => {
      const row = el('div', 'finding'); row.append(el('div', 'finding-title', finding.category));
      if (finding.explanation) row.append(el('p', '', finding.explanation));
      const citations = el('div', 'citation-row'); finding.evidence_ids.forEach(id => citations.append(citationChip(id, observationIds.has(id))));
      if (!finding.evidence_ids.length) citations.append(el('span', 'score-note', 'No evidence citations supplied.'));
      row.append(citations); block.append(row);
    });
  } else if (answer) block.append(el('p', '', 'No finding categories were returned for this case.'));
  host.append(block);
  const observations = el('div', 'observations'); observations.append(el('div', 'subheading', `RECORDED OBSERVATIONS · ${task.observations.length}`));
  task.observations.forEach(obs => {
    const card = el('section', 'observation-card'); card.id = `observation-${obs.id}`; card.tabIndex = -1;
    const obsHead = el('div', 'observation-head'); obsHead.append(el('strong', 'obs-id', obs.id)); obsHead.append(document.createTextNode('·')); obsHead.append(el('span', '', obs.tool)); obsHead.append(el('span', '', obs.target)); obsHead.append(el('span', 'observation-status', obs.status));
    card.append(obsHead); card.append(el('p', '', obs.content)); observations.append(card);
  });
  host.append(observations);
  host.append(el('p', 'score-note', 'The scorer checks verdicts, categories, and exact evidence citations; explanation quality is not graded.'));
  renderDiagnostics(item);
}

function renderDiagnostics(item) {
  const host = $('#diagnostics-body'), s = item.scoring; host.replaceChildren();
  host.append(el('p', 'diagnostic-note', 'Scorer-side diagnostics explain matching and parsing. Expected-side reasons below are evaluation metadata, not agent response text.'));
  const metrics = el('div', 'diagnostic-metrics');
  for (const [label, value] of [['Matched', s.matched.length], ['Missed', s.missed.length], ['Noise', s.noise.length]]) {
    const box = el('div', 'diagnostic-metric'); box.append(el('span', '', label)); box.append(el('b', '', fmt(value))); metrics.append(box);
  }
  host.append(metrics);
  const stats = el('div', 'diagnostic-metrics');
  for (const [label, value] of [['Precision', s.precision], ['Recall', s.recall], ['Finding F1', s.finding_f1]]) {
    const box = el('div', 'diagnostic-metric'); box.append(el('span', '', label)); box.append(el('b', '', value === null ? '—' : `${Math.round(value * 100)}%`)); stats.append(box);
  }
  host.append(stats);
  if (s.error) host.append(el('p', 'diagnostic-note', `Parsing / evidence-ID error: ${s.error}`));
  const lists = el('div', 'diag-lists');
  for (const key of ['matched', 'missed', 'noise']) {
    const col = el('section', 'diag-list'); col.append(el('h4', '', key));
    if (!s[key].length) col.append(el('p', '', 'None recorded.'));
    const ul = el('ul'); s[key].forEach(d => {
      const li = el('li'); li.textContent = `${d.category} · ${d.evidence_ids.join(', ') || 'no evidence IDs'}${d.reason ? ` — ${d.reason}` : ''}`; ul.append(li);
    });
    col.append(ul); lists.append(col);
  }
  host.append(lists);
}

function renderProvenance() {
  const select = $('#run-select'); select.replaceChildren();
  const list = state.mode === 'measured' ? state.runs : state.examples;
  list.forEach((item, index) => {
    const option = document.createElement('option'); option.value = String(index);
    option.textContent = state.mode === 'measured' ? `${runLabel(item)} · ${item.replay.summary.score}/100` : `Synthetic · ${item.label}`;
    select.append(option);
  });
  select.value = String(state.selected); select.disabled = list.length < 2;
  const modeButton = $('#example-mode');
  modeButton.hidden = state.runs.length === 0 || state.examples.length === 0;
  modeButton.textContent = state.mode === 'measured' ? 'View synthetic fixtures' : 'Back to measured runs';
}

function render() { renderProvenance(); renderOverview(); renderComparison(); renderRevision(); renderTasks(); renderDetail(); }
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove('show'), 2400);
}
function downloadReplay() {
  const replay = currentReplay(); if (!replay) return;
  const file = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file), a = document.createElement('a'); a.href = url;
  a.download = `${state.mode === 'synthetic' ? `synthetic-${currentEntry().label}` : `run-${String(replay.run_id).padStart(2, '0')}`}-curated-replay.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Curated replay JSON downloaded.');
}

function renderUnavailable(message) {
  state.runs = []; state.examples = []; state.selected = 0; state.activeTask = 0; state.mode = 'measured';
  renderProvenance(); renderOverview(); renderComparison(); renderRevision();
  setError($('#overview-content'), message);
  $('#source-label').textContent = 'DATA UNAVAILABLE';
  $('#download-button').disabled = true;
  $('#task-count').textContent = '—'; $('#task-list').replaceChildren();
  $('#task-empty').hidden = false; $('#task-empty').textContent = 'Recorded task evidence is unavailable.';
  setError($('#task-detail'), 'Task evidence could not be loaded.');
  $('#diagnostics-body').replaceChildren();
}

async function load() {
  state.runs = []; state.examples = []; state.selected = 0; state.activeTask = 0; state.mode = 'measured';
  renderProvenance(); renderRevision(); $('#download-button').disabled = true;
  $('#source-label').textContent = 'LOADING RECORDED RUNS';
  const area = $('#overview-content'); area.replaceChildren(el('div', 'loading', 'Loading recorded runs…'));
  $('#comparison-content').replaceChildren(el('div', 'loading', 'Loading comparison data…'));
  $('#task-count').textContent = '—'; $('#task-list').replaceChildren(); $('#task-empty').hidden = true;
  $('#task-detail').replaceChildren(el('div', 'loading', 'Loading task evidence…'));
  $('#diagnostics-body').replaceChildren();
  try {
    const [runsResponse, examplesResponse] = await Promise.all([fetch('/api/runs'), fetch('/api/examples')]);
    if (!runsResponse.ok || !examplesResponse.ok) throw new Error('The local demo API could not load replay data.');
    const [runs, examples] = await Promise.all([runsResponse.json(), examplesResponse.json()]);
    state.runs = runs.runs ?? []; state.examples = examples.examples ?? []; state.mode = state.runs.length ? 'measured' : 'synthetic'; state.selected = 0; state.activeTask = 0;
    if (!state.runs.length && state.examples.length) toast('Showing synthetic fixtures. These are not measured runs.');
    render();
  } catch (error) { renderUnavailable(`${error.message} Check the local server and retry.`); }
}

$('#run-select').addEventListener('change', event => { state.selected = Number(event.target.value); state.activeTask = 0; render(); });
$('#example-mode').addEventListener('click', () => { state.mode = state.mode === 'measured' ? 'synthetic' : 'measured'; state.selected = 0; state.activeTask = 0; render(); });
$('#download-button').addEventListener('click', downloadReplay);
$('#task-search').addEventListener('input', event => { state.query = event.target.value; renderTasks(); });
document.querySelectorAll('.filter-tabs button').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('.filter-tabs button').forEach(node => node.setAttribute('aria-pressed', String(node === button)));
  renderTasks();
}));
load();
