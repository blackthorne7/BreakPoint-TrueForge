// npm run improve [-- --run NN] [-- --coach] [-- --no-commit]
// Use failed training evidence to revise only the agent's instructions and skill.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { TaskScore } from "../evals/score.ts";
import { taskPrompt, trainingTasks } from "../evals/contract.ts";
import { validateImprovement } from "./improve-guards.ts";
import { client, die, exportSession, flag, git, isClean, loadTasks, option, readAgent, ROOT, runDir, runTurn, SUMMARY_CSV, writeJson } from "./lib.ts";

const rows = existsSync(SUMMARY_CSV) ? readFileSync(SUMMARY_CSV, "utf8").trim().split("\n").slice(1).filter(Boolean) : [];
if (!rows.length) die("No runs yet. Run npm run run-evals first.");
const run = Number(option("run") ?? rows.length);
const dir = runDir(run);
const nn = String(run).padStart(2, "0");
if (!existsSync(join(dir, "results.json"))) die(`No results for run ${nn} in ${dir}`);
if (!isClean("agent")) die("agent/ has uncommitted changes. Commit or discard them first: the agent's change must be its own.");

type Result = TaskScore & { reply: string };
const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as Result[];
const tasks = new Map(loadTasks().map((t) => [t.id, t]));
// Holdout status comes from the current task contract, never a stored result flag.
const trainingIds = new Set(trainingTasks([...tasks.values()]).map((t) => t.id));
const failed = results.filter((r) => trainingIds.has(r.task_id) && !r.passed);
if (!failed.length) {
  console.log(`Nothing to learn from run ${nn}: every training task passed. No improvement is claimed.`);
  process.exit(0);
}

const { agent, instructions, skills } = readAgent();
const currentFiles = [
  { path: "agent/instructions.md", text: instructions },
  ...skills.map((s) => ({ path: `${s.path}/SKILL.md`, text: readFileSync(join(ROOT, s.path, "SKILL.md"), "utf8") })),
];
const feedback = failed.map((r) => {
  const task = tasks.get(r.task_id)!;
  return [
    `Training example (score ${r.score.toFixed(2)})`, taskPrompt(task), "Your previous response:", r.reply.slice(-1200) || "(empty)",
    `Scorer diagnostics only: valid response=${r.parsed}; verdict correct=${r.verdict_correct}; exact-match precision=${r.precision}; exact-match recall=${r.recall}; unsupported/duplicate/incorrect-citation count=${r.noise.length}. Expected categories, evidence IDs, and explanations are omitted.`,
  ].join("\n\n");
}).join("\n\n");
const protocolMarker = "## Output protocol";
const protocol = instructions.slice(instructions.indexOf(protocolMarker));
const prompt = `This is a playbook improvement request, not a triage task. Use the failed training examples to improve your general reasoning about recorded security evidence. No expected answer key is provided.

Rules:
- Write general rules for unseen evidence. Do not add task titles, target names, evidence IDs, quotes, or fixture-specific answers.
- Preserve the Output protocol in agent/instructions.md exactly. The scorer depends on its JSON shape and taxonomy.
- Keep changes concise and total response under 1024 tokens.
- You may change only agent/instructions.md and agent/skills/<name>/SKILL.md. Preserve skill frontmatter.

Reply only in this format:
<<<FILE agent/skills/review-checklist/SKILL.md
(complete changed file)
>>>
<<<LEARNED
(one concise sentence)
>>>

## Current files
${currentFiles.map((f) => `<<<FILE ${f.path}\n${f.text.trim()}\n>>>`).join("\n\n")}

## Failed training examples (holdouts excluded)
${feedback}`;

const tf = client();
const coach = flag("coach");
const { data: session } = await tf.sessions.create({
  agent: coach ? { spec: { model: agent.model, instructions: "Coach an evidence-triage agent by revising its playbook from failed training examples. Never invent or expose answer keys.", config: { askUserQuestions: { enabled: false }, generativeUi: { enabled: false } } } } : { name: agent.name },
  metadata: { purpose: "improve", learned_from_run: nn },
});
await tf.sessions.update(session.id, { title: `improve from run ${nn}` });
console.log(`Asking ${coach ? "the coach" : `"${agent.name}"`} to revise its playbook from ${failed.length} training examples (session ${session.id})…`);
const turn = await runTurn(tf, session.id, prompt, false);
if (turn.status !== "done") die(`The turn ended with status ${turn.status}${turn.error ? `: ${turn.error}` : ""}`);

const files = [...turn.text.matchAll(/<<<FILE ([^\n]+)\n([\s\S]*?)\n>>>/g)].map((m) => ({ path: normalize(m[1].trim()), text: m[2].trimEnd() + "\n" }));
const learned = turn.text.match(/<<<LEARNED\n([\s\S]*?)\n>>>/)?.[1].trim() ?? "";
const guardErrors = validateImprovement(files, loadTasks(), protocol, currentFiles.map((f) => f.path));
if (guardErrors.length) die(`Rejected proposed playbook changes:\n  ${guardErrors.join("\n  ")}`);

for (const f of files) { mkdirSync(dirname(join(ROOT, f.path)), { recursive: true }); writeFileSync(join(ROOT, f.path), f.text); }
writeJson(join(dir, "improve-session.json"), await exportSession(tf, session.id));
if (isClean("agent")) { console.log("The agent sent its files unchanged. Nothing to commit."); process.exit(0); }
console.log(git("diff", "--stat", "--", "agent"));
const message = `agent: learn from run ${nn}\n\n${learned || "(no summary given)"}\n\nAgent-Session: ${session.id}`;
if (flag("no-commit")) console.log(`\nFiles written, not committed. To commit:\n  git add agent runs && git commit -F- <<'EOF'\n${message}\nEOF`);
else {
  git("add", "agent", join(dir, "improve-session.json"));
  git("commit", "-q", "-m", message);
  console.log(`\n✓ Committed the agent's change (Agent-Session: ${session.id}).`);
  console.log("  Review it: git show    Drop it: git reset --hard HEAD~1    Then: npm run run-evals");
}
