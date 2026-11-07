import type { Task } from "../evals/contract.ts";

export interface ProposedFile { path: string; text: string }
export function validateImprovement(files: ProposedFile[], tasks: Task[], outputProtocol: string, allowedPaths?: string[]): string[] {
  const errors: string[] = [];
  if (!files.length) errors.push("no proposed files");
  const allowed = /^agent\/(instructions\.md|skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md)$/;
  const seen = new Set<string>();
  for (const f of files) {
    if (!allowed.test(f.path)) errors.push(`forbidden path ${f.path}`);
    if (allowedPaths && !allowedPaths.includes(f.path)) errors.push(`path not in the existing agent files ${f.path}`);
    if (seen.has(f.path)) errors.push(`duplicate proposed path ${f.path}`);
    seen.add(f.path);
    if (f.path.endsWith("/SKILL.md") && (!/^---\n[\s\S]*?\bname:[\s\S]*?\bdescription:[\s\S]*?\n---\n/.test(f.text) || f.text.split("\n").length < 6)) errors.push(`${f.path} has invalid skill frontmatter/body`);
    if (f.path === "agent/instructions.md" && (!outputProtocol || !f.text.includes(outputProtocol))) errors.push("instructions.md changed the output protocol");
  }
  const leaks: string[] = [];
  for (const task of tasks) {
    const exact = [task.id, task.title, task.target, ...task.observations.map((o) => o.id)];
    for (const f of files) for (const q of exact) if (q && f.text.includes(q)) leaks.push(`${f.path} contains fixture identifier/title/target ${q}`);
    for (const o of task.observations) if (o.content.length >= 24) {
      for (const f of files) if (f.text.includes(o.content)) leaks.push(`${f.path} quotes a fixture observation`);
    }
  }
  errors.push(...leaks);
  return errors;
}
