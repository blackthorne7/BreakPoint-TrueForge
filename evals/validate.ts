import { contractFingerprint, loadTasks, taskPrompt, trainingTasks, validateTasks } from "./contract.ts";

const tasks = loadTasks();
const errors = validateTasks(tasks);
for (const task of tasks) {
  const prompt = taskPrompt(task);
  if (prompt.includes(task.id) || /"expected"\s*:/.test(prompt) || /"holdout"\s*:/.test(prompt)) errors.push(`${task.id}: prompt leaks evaluator-only fields`);
  for (const finding of task.expected.findings) if (prompt.includes(finding.why)) errors.push(`${task.id}: prompt leaks expected rationale`);
}
if (tasks.length < 5 || !tasks.some((t) => t.holdout) || trainingTasks(tasks).some((t) => t.holdout)) errors.push("task set needs 5+ cases and holdout exclusion");
if (errors.length) { console.error(errors.map((e) => `- ${e}`).join("\n")); process.exit(1); }
console.log(`Valid: ${tasks.length} tasks (${trainingTasks(tasks).length} training, ${tasks.length - trainingTasks(tasks).length} holdout)`);
console.log(`Contract SHA-256: ${contractFingerprint()}`);
