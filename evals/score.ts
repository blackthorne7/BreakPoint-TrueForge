// Deterministic scorer for recorded security-evidence triage. Freeze the public contract after run 1.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTasks, TAXONOMY, type Category, type ExpectedFinding, type Task, type Verdict } from "./contract.ts";

export interface Finding { category: Category; evidence_ids: string[]; explanation: string }
export interface ParsedAnswer { verdict: Verdict; findings: Finding[] }
export interface Match { expected: ExpectedFinding; actual: Finding }
export interface TaskScore {
  task_id: string; score: number; passed: boolean; parsed: boolean; verdict_correct: boolean;
  verdict_score: number; precision: number; recall: number; finding_f1: number;
  matches: Match[]; missed: ExpectedFinding[]; noise: Finding[]; error?: string;
}

/** Strictly parse the complete reply; fenced, partial, coerced, or extra fields are invalid. */
export function parseAnswer(reply: string): ParsedAnswer | null {
  try {
    const raw: unknown = JSON.parse(reply);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    if (Object.keys(obj).sort().join(",") !== "findings,verdict") return null;
    if (obj.verdict !== "confirmed_vulnerable" && obj.verdict !== "unconfirmed") return null;
    if (!Array.isArray(obj.findings)) return null;
    const findings: Finding[] = [];
    for (const item of obj.findings) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const f = item as Record<string, unknown>;
      if (Object.keys(f).sort().join(",") !== "category,evidence_ids,explanation") return null;
      if (typeof f.category !== "string" || !TAXONOMY.includes(f.category as Category)) return null;
      if (!Array.isArray(f.evidence_ids) || !f.evidence_ids.length || f.evidence_ids.some((id) => typeof id !== "string")) return null;
      if (new Set(f.evidence_ids).size !== f.evidence_ids.length) return null;
      if (typeof f.explanation !== "string" || !f.explanation.trim()) return null;
      findings.push({ category: f.category as Category, evidence_ids: [...f.evidence_ids] as string[], explanation: f.explanation.trim() });
    }
    return { verdict: obj.verdict as Verdict, findings };
  } catch { return null; }
}

function citationKey(f: { category: string; evidence_ids: string[] }): string {
  return `${f.category}\0${[...f.evidence_ids].sort().join("\0")}`;
}

export function scoreTask(task: Task, reply: string): TaskScore {
  const answer = parseAnswer(reply);
  if (!answer) return { task_id: task.id, score: 0, passed: false, parsed: false, verdict_correct: false, verdict_score: 0,
    precision: 0, recall: 0, finding_f1: 0, matches: [], missed: [...task.expected.findings], noise: [], error: "invalid_json_or_schema" };
  const evidenceIds = new Set(task.observations.map((o) => o.id));
  const invalidCitation = answer.findings.some((f) => f.evidence_ids.some((id) => !evidenceIds.has(id)));
  const remaining = [...task.expected.findings];
  const matches: Match[] = [];
  const noise: Finding[] = [];
  for (const actual of answer.findings) {
    const ix = remaining.findIndex((expected) => citationKey(expected) === citationKey(actual));
    if (ix >= 0 && !actual.evidence_ids.some((id) => !evidenceIds.has(id))) matches.push({ expected: remaining.splice(ix, 1)[0], actual });
    else noise.push(actual);
  }
  const precision = answer.findings.length ? matches.length / answer.findings.length : task.expected.findings.length ? 0 : 1;
  const recall = task.expected.findings.length ? matches.length / task.expected.findings.length : 1;
  const findingF1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const verdictCorrect = answer.verdict === task.expected.verdict;
  // A wrong verdict is always zero. Correct verdicts receive a 0.4 base and up to 0.6 for exact findings.
  const score = verdictCorrect ? 0.4 + 0.6 * findingF1 : 0;
  const exactFindings = matches.length === task.expected.findings.length && noise.length === 0;
  return { task_id: task.id, score: round(score, 4), passed: verdictCorrect && exactFindings && !invalidCitation,
    parsed: true, verdict_correct: verdictCorrect, verdict_score: Number(verdictCorrect), precision: round(precision, 4),
    recall: round(recall, 4), finding_f1: round(findingF1, 4), matches, missed: remaining, noise,
    ...(invalidCitation ? { error: "unknown_evidence_id" } : {}) };
}

export function scoreRun(tasks: TaskScore[]) {
  return { score: round(tasks.length ? 100 * tasks.reduce((sum, t) => sum + t.score, 0) / tasks.length : 0, 2),
    tasks_passed: tasks.filter((t) => t.passed).length, tasks_total: tasks.length };
}

function round(n: number, d: number): number { const k = 10 ** d; return Math.round(n * k) / k; }
function perfectReply(task: Task): string {
  return JSON.stringify({ verdict: task.expected.verdict, findings: task.expected.findings.map((f) => ({ category: f.category, evidence_ids: f.evidence_ids, explanation: f.why })) });
}
function selftest(): void {
  const tasks = loadTasks();
  const check = (name: string, ok: boolean) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) process.exitCode = 1; };
  check("perfect answers", tasks.every((t) => scoreTask(t, perfectReply(t)).passed));
  check("missing findings score below perfect", tasks.some((t) => scoreTask(t, JSON.stringify({ verdict: t.expected.verdict, findings: [] })).score < 1));
  check("wrong verdict never passes", tasks.every((t) => !scoreTask(t, JSON.stringify({ verdict: t.expected.verdict === "unconfirmed" ? "confirmed_vulnerable" : "unconfirmed", findings: t.expected.findings.map((f) => ({ category: f.category, evidence_ids: f.evidence_ids, explanation: f.why })) })).passed));
  check("wrong verdict always scores zero", tasks.every((t) => scoreTask(t, JSON.stringify({ verdict: t.expected.verdict === "unconfirmed" ? "confirmed_vulnerable" : "unconfirmed", findings: [] })).score === 0));
  check("malformed reply scores zero", tasks.every((t) => scoreTask(t, "{} trailing").score === 0));
  const t = tasks.find((x) => x.expected.findings.length)!;
  const f = t.expected.findings[0];
  const shape = (findings: unknown[]) => JSON.stringify({ verdict: t.expected.verdict, findings });
  const good = { category: f.category, evidence_ids: f.evidence_ids, explanation: "supported" };
  check("wrong citation does not match", scoreTask(t, shape([{ ...good, evidence_ids: [t.observations[0].id] }])).matches.length === 0);
  check("duplicate finding is noise", scoreTask(t, shape([good, good])).noise.length === 1);
  check("unknown evidence ID cannot pass", !scoreTask(t, shape([{ ...good, evidence_ids: ["unknown"] }])).passed);
  check("clean negative passes with empty list", tasks.filter((x) => !x.expected.findings.length).every((x) => scoreTask(x, JSON.stringify({ verdict: "unconfirmed", findings: [] })).passed));
}
function rescore(dir: string): void {
  const data = JSON.parse(readFileSync(resolve(dir, "results.json"), "utf8")) as { task_id: string; reply: string }[];
  const tasks = new Map(loadTasks().map((t) => [t.id, t]));
  const scored = data.map((r) => { const t = tasks.get(r.task_id); if (!t) throw new Error(`unknown task ${r.task_id}`); return scoreTask(t, r.reply); });
  console.log(JSON.stringify({ tasks: scored, ...scoreRun(scored) }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === "--selftest") selftest();
  else if (arg) rescore(arg);
  else console.log("usage: npm run score -- runs/run-NN | --selftest");
}
