import test from "node:test";
import assert from "node:assert/strict";
import { contractFingerprint, loadTasks, taskPrompt, trainingTasks, validateTasks, type Task } from "./contract.ts";
import { parseAnswer, scoreTask } from "./score.ts";
import { replayRun, syntheticPartialReply, syntheticPerfectReply } from "./replay.ts";
import { validateImprovement } from "../scripts/improve-guards.ts";

const tasks = loadTasks();
const positive = tasks.find((t) => t.expected.findings.length > 1)!;
function reply(task: Task, findings = task.expected.findings.map((f) => ({ category: f.category, evidence_ids: f.evidence_ids, explanation: f.why })), verdict = task.expected.verdict) {
  return JSON.stringify({ verdict, findings });
}

test("all tasks validate; invalid statuses, duplicate keys, empty confirmed, and failed/out-of-scope citations reject", () => {
  assert.deepEqual(validateTasks(tasks), []);
  const invalidStatus = structuredClone(tasks); invalidStatus[0].observations[0].status = "bad" as never;
  assert.ok(validateTasks(invalidStatus).some((e) => e.includes("invalid observation status")));
  const duplicate = structuredClone(tasks); duplicate[0].expected.findings.push(structuredClone(duplicate[0].expected.findings[0]));
  assert.ok(validateTasks(duplicate).some((e) => e.includes("duplicate expected finding")));
  const empty = structuredClone(tasks); empty[0].expected.findings = [];
  assert.ok(validateTasks(empty).some((e) => e.includes("confirmed case must define")));
  const badRef = structuredClone(tasks); badRef[0].observations[0].target = "other-target";
  assert.ok(validateTasks(badRef).some((e) => e.includes("invalid expected finding/citation")));
  const failedRef = structuredClone(tasks); failedRef[0].observations[0].status = "transport_error";
  assert.ok(validateTasks(failedRef).some((e) => e.includes("invalid expected finding/citation")));
});

test("perfect structured answers pass, clean negatives are exact, and missing findings are partial", () => {
  for (const task of tasks) assert.equal(scoreTask(task, reply(task)).passed, true, task.id);
  const negative = tasks.find((t) => !t.expected.findings.length)!;
  assert.equal(scoreTask(negative, JSON.stringify({ verdict: "unconfirmed", findings: [] })).score, 1);
  assert.equal(scoreTask(positive, reply(positive, [positive.expected.findings.slice(0, 1).map((f) => ({ category: f.category, evidence_ids: f.evidence_ids, explanation: f.why }))[0]])).score < 1, true);
});

test("duplicate, noisy, wrong citation, unknown ID, and malformed replies are scored strictly", () => {
  const first = tasks.find((t) => t.id === "case-k7m2")!;
  const correct = JSON.parse(reply(first)).findings[0];
  const duplicate = scoreTask(first, JSON.stringify({ verdict: first.expected.verdict, findings: [correct, correct] }));
  assert.equal(duplicate.noise.length, 1); assert.equal(duplicate.passed, false);
  const noisy = scoreTask(first, JSON.stringify({ verdict: first.expected.verdict, findings: [correct, { category: "configuration", evidence_ids: [first.observations[0].id], explanation: "unsupported" }] }));
  assert.equal(noisy.noise.length, 1); assert.equal(noisy.passed, false);
  const wrongCitation = scoreTask(first, JSON.stringify({ verdict: first.expected.verdict, findings: [{ ...correct, evidence_ids: [first.observations[0].id] }] }));
  assert.equal(wrongCitation.matches.length, 0);
  const unknown = scoreTask(first, JSON.stringify({ verdict: first.expected.verdict, findings: [{ ...correct, evidence_ids: ["unknown"] }] }));
  assert.equal(unknown.error, "unknown_evidence_id"); assert.equal(unknown.passed, false);
  assert.equal(parseAnswer("```json\n{}\n```"), null);
  assert.equal(scoreTask(first, "not json").score, 0);
});

test("wrong verdict always scores zero, even for an empty negative finding set", () => {
  for (const task of tasks) {
    const opposite = task.expected.verdict === "unconfirmed" ? "confirmed_vulnerable" : "unconfirmed";
    assert.equal(scoreTask(task, reply(task, [], opposite)).score, 0, task.id);
  }
});

test("holdout is excluded and every task prompt omits answer keys and holdout flag", () => {
  assert.ok(tasks.some((t) => t.holdout));
  assert.ok(trainingTasks(tasks).every((t) => !t.holdout));
  for (const task of tasks) {
    const prompt = taskPrompt(task);
    assert.ok(!prompt.includes(task.id)); assert.ok(!/"holdout"\s*:/.test(prompt)); assert.ok(!/"expected"\s*:/.test(prompt));
    for (const f of task.expected.findings) assert.ok(!prompt.includes(f.why));
  }
});

test("improvement guard catches identifiers, forbidden and duplicate paths, and protocol edits", () => {
  const protocol = "## Output protocol\nFixed schema.";
  const valid = [{ path: "agent/instructions.md", text: `General rules\n\n${protocol}\n` }];
  assert.deepEqual(validateImprovement(valid, tasks, protocol), []);
  assert.ok(validateImprovement([{ path: "agent/skills/review-checklist/SKILL.md", text: `---\nname: x\ndescription: y\n---\n${tasks[0].observations[0].id}\n` }], tasks, protocol).some((e) => e.includes("fixture identifier")));
  assert.ok(validateImprovement([{ path: "evals/tasks/case.json", text: "x" }], tasks, protocol).some((e) => e.includes("forbidden path")));
  assert.ok(validateImprovement([{ path: "agent/skills/new-skill/SKILL.md", text: "---\nname: x\ndescription: y\n---\n\nbody\n" }], tasks, protocol, ["agent/instructions.md", "agent/skills/review-checklist/SKILL.md"]).some((e) => e.includes("not in the existing agent files")));
  assert.ok(validateImprovement([...valid, ...valid], tasks, protocol).some((e) => e.includes("duplicate proposed path")));
  assert.ok(validateImprovement([{ path: "agent/instructions.md", text: "changed" }], tasks, protocol).some((e) => e.includes("output protocol")));
});

test("fingerprint and replay export envelope are stable for real and synthetic records", () => {
  assert.equal(contractFingerprint(), contractFingerprint());
  const task = positive;
  const hash = contractFingerprint();
  const perfect = replayRun([{ task, reply: syntheticPerfectReply(task) }], { run_id: null, session_id: null, synthetic: true }, hash);
  const real = replayRun([{ task, reply: syntheticPerfectReply(task) }], { run_id: 1, session_id: "session-demo", synthetic: false }, hash);
  assert.deepEqual(Object.keys(perfect).sort(), Object.keys(real).sort());
  assert.equal(perfect.schema_version, "1.0"); assert.equal(perfect.run_id, null); assert.equal(perfect.session_id, null); assert.equal(perfect.synthetic, true);
  assert.equal(perfect.contract_sha256, hash); assert.equal(perfect.tasks.length, 1);
  assert.equal(perfect.summary.score, 100); assert.equal(perfect.summary.tasks_total, 1);
  assert.equal(perfect.tasks[0].scoring.score, scoreTask(task, syntheticPerfectReply(task)).score);
  assert.equal(perfect.tasks[0].scoring.matched_count, task.expected.findings.length);
  assert.equal(real.run_id, 1); assert.equal(real.session_id, "session-demo"); assert.equal(real.synthetic, false);
  const partialReply = syntheticPartialReply(task);
  const partial = replayRun([{ task, reply: partialReply }], { run_id: null, session_id: null, synthetic: true }, hash);
  assert.equal(partial.tasks[0].scoring.passed, false); assert.equal(partial.tasks[0].scoring.missed_count, 1);
  assert.equal(partial.summary.score, 80);
  assert.equal(partial.tasks[0].scoring.matched.length, 1); assert.equal(partial.tasks[0].scoring.missed[0].reason, task.expected.findings[1].why);
});
