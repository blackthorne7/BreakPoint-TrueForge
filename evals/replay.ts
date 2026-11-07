import { parseAnswer, scoreRun, scoreTask, type TaskScore } from "./score.ts";
import type { Task } from "./contract.ts";

export const REPLAY_SCHEMA_VERSION = "1.0";
export interface ReplaySource { run_id: number | null; session_id: string | null; synthetic: boolean }

export function replayTask(task: Task, reply: string, source: ReplaySource) {
  const answer = parseAnswer(reply);
  const scored: TaskScore = scoreTask(task, reply);
  return {
    schema_version: REPLAY_SCHEMA_VERSION,
    ...source,
    task: { id: task.id, title: task.title, target: task.target, scenario: task.scenario, observations: task.observations },
    parsed_answer: answer ? { verdict: answer.verdict, findings: answer.findings } : null,
    scoring: {
      score: scored.score, passed: scored.passed, parsed: scored.parsed,
      verdict_correct: scored.verdict_correct, precision: scored.precision, recall: scored.recall,
      finding_f1: scored.finding_f1, matched_count: scored.matches.length,
      missed_count: scored.missed.length, noise_count: scored.noise.length, error: scored.error ?? null,
      matched: scored.matches.map(({ expected, actual }) => ({ category: expected.category, evidence_ids: expected.evidence_ids, expected_reason: expected.why, actual })),
      missed: scored.missed.map((finding) => ({ category: finding.category, evidence_ids: finding.evidence_ids, reason: finding.why })),
      noise: scored.noise.map((finding) => ({ category: finding.category, evidence_ids: finding.evidence_ids, explanation: finding.explanation, reason: "No remaining expected finding matched this exact category and citation set." })),
    },
  };
}

export function replayRun(items: { task: Task; reply: string }[], source: ReplaySource, contractSha256: string) {
  const taskRecords = items.map(({ task, reply }) => replayTask(task, reply, source));
  const totals = scoreRun(items.map(({ task, reply }) => scoreTask(task, reply)));
  return {
    schema_version: REPLAY_SCHEMA_VERSION,
    ...source,
    contract_sha256: contractSha256,
    summary: totals,
    tasks: taskRecords,
  };
}

export function syntheticPerfectReply(task: Task): string {
  return JSON.stringify({ verdict: task.expected.verdict, findings: task.expected.findings.map((f) => ({ category: f.category, evidence_ids: f.evidence_ids, explanation: f.why })) });
}
export function syntheticPartialReply(task: Task): string {
  const first = task.expected.findings[0];
  return JSON.stringify({ verdict: task.expected.verdict, findings: first ? [{ category: first.category, evidence_ids: first.evidence_ids, explanation: "Synthetic partial example." }] : [] });
}
